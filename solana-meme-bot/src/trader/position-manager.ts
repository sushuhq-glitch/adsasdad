import type { AppConfig } from "../config/schema.js";
import type { ClosedTrade, Position, RiskBand, TokenCandidate } from "../types/index.js";
import { logger } from "../lib/logger.js";
import { nowIso, pctChange, uid } from "../lib/money.js";
import { LivePriceOracle, simulateDemoExitPrice } from "./live-price.js";
import type { ExecutionRouter } from "./venue-adapter.js";

export class PositionManager {
  private readonly oracle: LivePriceOracle;

  constructor(
    private readonly config: AppConfig,
    private readonly router: ExecutionRouter,
    oracle?: LivePriceOracle,
  ) {
    this.oracle = oracle ?? new LivePriceOracle(config.DEXSCREENER_BASE, undefined, config.PUMPFUN_API_BASE);
  }

  getOracle(): LivePriceOracle {
    return this.oracle;
  }

  dynamicSlippageBps(candidate: TokenCandidate): number {
    let bps = this.config.DEFAULT_SLIPPAGE_BPS;
    if (candidate.liquidityUsd < 50_000) bps += 100;
    if (candidate.liquidityUsd < 30_000) bps += 150;
    if (candidate.volume24hUsd / Math.max(1, candidate.liquidityUsd) > 10) bps += 50;
    return Math.min(bps, 800);
  }

  openFromFill(
    candidate: TokenCandidate,
    amountSol: number,
    fillPrice: number,
    tokenAmount: number,
    venue: Position["venue"],
    motivation: string,
    opts: {
      riskPct: number;
      riskBand: RiskBand;
      highProfitPotential: boolean;
    },
  ): Position {
    const takeProfitPct = opts.highProfitPotential
      ? this.config.MOONSHOT_TAKE_PROFIT_PCT
      : this.config.TAKE_PROFIT_PCT;
    return {
      id: uid("pos"),
      mint: candidate.mint,
      symbol: candidate.symbol,
      name: candidate.name,
      venue,
      entryPriceUsd: fillPrice,
      amountSol,
      tokenAmount,
      marketCapAtEntry: candidate.marketCapUsd,
      openedAt: nowIso(),
      motivation,
      takeProfitPct,
      stopLossPct: this.config.STOP_LOSS_PCT,
      trailingStopPct: this.config.TRAILING_STOP_PCT,
      peakPriceUsd: fillPrice,
      status: "open",
      riskPct: opts.riskPct,
      riskBand: opts.riskBand,
      highProfitPotential: opts.highProfitPotential,
    };
  }

  updatePeak(position: Position, markPrice: number): void {
    if (markPrice > position.peakPriceUsd) position.peakPriceUsd = markPrice;
  }

  exitSignal(
    position: Position,
    markPrice: number,
  ): null | "take_profit" | "stop_loss" | "trailing_stop" {
    const pnlPct = pctChange(position.entryPriceUsd, markPrice);
    if (pnlPct >= position.takeProfitPct) return "take_profit";
    if (pnlPct <= -position.stopLossPct) return "stop_loss";
    const drawdownFromPeak = pctChange(position.peakPriceUsd, markPrice);
    if (drawdownFromPeak <= -position.trailingStopPct && pnlPct > 0) return "trailing_stop";
    return null;
  }

  /**
   * Chiude posizione usando SEMPRE un prezzo live fresco (bypass cache).
   * Mai fallback silenzioso all'entry price.
   */
  async closePosition(
    position: Position,
    markPriceHint: number | undefined,
    reason: ClosedTrade["reason"],
    solUsd = 150,
  ): Promise<{ trade: ClosedTrade; orderOk: boolean; error?: string; priceSource?: string }> {
    const mark = await this.resolveExitMark(position, markPriceHint);
    if (!(mark.priceUsd > 0)) {
      return {
        orderOk: false,
        error: "Impossibile ottenere prezzo live per la vendita (DexScreener/Jupiter/Pump.fun)",
        trade: this.toClosed(position, position.entryPriceUsd, reason, solUsd, 0),
        priceSource: "none",
      };
    }

    this.updatePeak(position, mark.priceUsd);
    const slip = Math.min(this.config.DEFAULT_SLIPPAGE_BPS, 200);
    const order = await this.router.sell(position.mint, position.tokenAmount, mark.priceUsd, slip);
    if (!order.ok) {
      return {
        orderOk: false,
        error: order.error,
        trade: this.toClosed(position, mark.priceUsd, reason, solUsd, 0),
        priceSource: mark.source,
      };
    }

    position.status = "closed";
    const sellPrice = order.filledPriceUsd > 0 ? order.filledPriceUsd : mark.priceUsd;
    // PnL SOL = capitale recuperato - capitale investito (include fee slip paper)
    const recoveredSol =
      order.filledAmountSol > 0
        ? order.filledAmountSol
        : position.amountSol * (1 + pctChange(position.entryPriceUsd, sellPrice) / 100);
    const trade = this.toClosed(position, sellPrice, reason, solUsd, recoveredSol);
    logger.info(
      {
        mint: position.mint,
        entry: position.entryPriceUsd,
        sell: sellPrice,
        pnlPct: trade.pnlPct,
        source: mark.source,
        reason,
      },
      "Posizione chiusa con prezzo live",
    );
    return { orderOk: true, trade, priceSource: mark.source };
  }

  private async resolveExitMark(
    position: Position,
    hint?: number,
  ): Promise<{ priceUsd: number; source: string }> {
    const live = await this.oracle.getLivePriceUsd(position.mint, { bypassCache: true });
    let priceUsd = live.priceUsd;
    let source: string = live.source;

    const isDemo =
      Boolean(position.copyFromLabel?.includes("DEMO")) ||
      Boolean(position.copySourceSignature?.startsWith("demo_"));

    const nearEntry = (p: number) =>
      position.entryPriceUsd > 0 && Math.abs(p - position.entryPriceUsd) / position.entryPriceUsd < 0.004;

    // DEMO paper: se il mercato non si è mosso (buy/sell nello stesso secondo), simula move
    if (isDemo && (!(priceUsd > 0) || nearEntry(priceUsd))) {
      const heldMs = Math.max(1_000, Date.now() - new Date(position.openedAt).getTime());
      priceUsd = simulateDemoExitPrice(position.entryPriceUsd, heldMs);
      source = "demo_simulated";
    }

    if (!(priceUsd > 0) && hint && hint > 0 && !nearEntry(hint)) {
      priceUsd = hint;
      source = "hint";
    }

    // Ultimo fallback utile: peak se ha battuto l'entry (mai entry piatto)
    if (!(priceUsd > 0) && position.peakPriceUsd > position.entryPriceUsd * 1.002) {
      priceUsd = position.peakPriceUsd;
      source = "peak";
    }

    if (!(priceUsd > 0) && hint && hint > 0) {
      // hint anche se ~entry: meglio di zero, ma logghiamo
      priceUsd = hint;
      source = "hint_weak";
      logger.warn({ mint: position.mint }, "Exit mark debole: hint ~ entry");
    }

    return { priceUsd, source };
  }

  private toClosed(
    position: Position,
    sellPrice: number,
    reason: ClosedTrade["reason"],
    solUsd: number,
    recoveredSol: number,
  ): ClosedTrade {
    const pnlPct = pctChange(position.entryPriceUsd, sellPrice);
    const pnlSol =
      recoveredSol > 0 ? recoveredSol - position.amountSol : position.amountSol * (pnlPct / 100);
    return {
      position: { ...position, status: "closed" },
      sellPriceUsd: sellPrice,
      closedAt: nowIso(),
      reason,
      pnlSol,
      pnlUsd: pnlSol * solUsd,
      pnlPct,
    };
  }
}
