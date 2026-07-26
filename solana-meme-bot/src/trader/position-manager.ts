import type { AppConfig } from "../config/schema.js";
import type { ClosedTrade, Position, RiskBand, TokenCandidate } from "../types/index.js";
import { nowIso, pctChange, uid } from "../lib/money.js";
import type { ExecutionRouter } from "./venue-adapter.js";

export class PositionManager {
  constructor(
    private readonly config: AppConfig,
    private readonly router: ExecutionRouter,
  ) {}

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

  async closePosition(
    position: Position,
    markPrice: number,
    reason: ClosedTrade["reason"],
    solUsd = 150,
  ): Promise<{ trade: ClosedTrade; orderOk: boolean; error?: string }> {
    const slip = this.config.DEFAULT_SLIPPAGE_BPS;
    const order = await this.router.sell(position.mint, position.tokenAmount, markPrice, slip);
    if (!order.ok) {
      return {
        orderOk: false,
        error: order.error,
        trade: this.toClosed(position, markPrice, reason, solUsd),
      };
    }
    position.status = "closed";
    const trade = this.toClosed(position, order.filledPriceUsd || markPrice, reason, solUsd);
    return { orderOk: true, trade };
  }

  private toClosed(
    position: Position,
    sellPrice: number,
    reason: ClosedTrade["reason"],
    solUsd: number,
  ): ClosedTrade {
    const pnlPct = pctChange(position.entryPriceUsd, sellPrice);
    const pnlSol = position.amountSol * (pnlPct / 100);
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
