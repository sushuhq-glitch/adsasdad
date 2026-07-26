import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import { DexScreenerClient } from "../scrapers/dexscreener.js";
import type { PositionManager } from "../trader/position-manager.js";
import type { ExecutionRouter } from "../trader/venue-adapter.js";
import type { BotRuntimeState, ClosedTrade, Position, TokenCandidate } from "../types/index.js";
import { scoreCopyRisk } from "./copy-risk.js";
import type { CopyRiskProfile, MirrorSignal } from "./types.js";

export interface MirrorCallbacks {
  onCopyBuy: (position: Position, risk: CopyRiskProfile, signal: MirrorSignal, token: TokenCandidate) => Promise<void>;
  onCopySell: (trade: ClosedTrade, signal: MirrorSignal, latencyNote: string) => Promise<void>;
  onSkip: (reason: string, signal: MirrorSignal) => Promise<void>;
  persist: () => Promise<void>;
}

/**
 * Esegue COPY BUY / COPY SELL sincronizzati col wallet target.
 * La vendita del target ha priorità assoluta su TP/SL statici.
 */
export class MirrorEngine {
  private readonly dex: DexScreenerClient;
  /** mint -> posizione aperta da copy */
  private byMint = new Map<string, string>();

  constructor(
    private readonly config: AppConfig,
    private readonly state: BotRuntimeState,
    private readonly router: ExecutionRouter,
    private readonly positions: PositionManager,
    private readonly cbs: MirrorCallbacks,
  ) {
    this.dex = new DexScreenerClient(config.DEXSCREENER_BASE);
    this.reindex();
  }

  reindex(): void {
    this.byMint.clear();
    for (const p of this.state.openPositions) {
      if (p.copyFromAddress) this.byMint.set(p.mint, p.id);
    }
  }

  async handleSignal(signal: MirrorSignal): Promise<void> {
    if (this.state.status === "paused" || this.state.status === "stopped") {
      await this.cbs.onSkip(`Bot ${this.state.status}`, signal);
      return;
    }

    if (signal.side === "buy") {
      await this.copyBuy(signal);
      return;
    }
    await this.copySell(signal);
  }

  private async resolveToken(mint: string): Promise<TokenCandidate | null> {
    return this.dex.fetchToken(mint);
  }

  private async copyBuy(signal: MirrorSignal): Promise<void> {
    if (this.byMint.has(signal.mint) || this.state.openPositions.some((p) => p.mint === signal.mint)) {
      await this.cbs.onSkip("Posizione già aperta su mint", signal);
      return;
    }
    if (this.state.openPositions.length >= this.config.MAX_OPEN_POSITIONS) {
      await this.cbs.onSkip("Max open positions raggiunto", signal);
      return;
    }

    const token = await this.resolveToken(signal.mint);
    const risk = scoreCopyRisk(signal.wallet, token);
    if (risk.riskPct > this.state.maxRiskPct) {
      await this.cbs.onSkip(`Risk ${risk.riskPct}% > max ${this.state.maxRiskPct}%`, signal);
      return;
    }

    // Size: frazione del budget, ridotta se rischio alto
    const scale = Math.max(0.25, 1 - risk.riskPct / 130);
    const amountSol = Math.min(
      this.config.MAX_POSITION_SOL * scale,
      this.state.residualBudgetSol,
      this.config.COPY_TRADE_SOL,
    );
    if (amountSol < 0.01) {
      await this.cbs.onSkip("Budget insufficiente", signal);
      return;
    }

    const price = token?.priceUsd ?? 0.000001;
    const slip = token ? this.positions.dynamicSlippageBps(token) : this.config.DEFAULT_SLIPPAGE_BPS;
    const t0 = Date.now();
    const order = await this.router.buy(signal.mint, amountSol, price, slip);
    if (!order.ok) {
      await this.cbs.onSkip(order.error ?? "Buy fallito", signal);
      return;
    }

    const candidate: TokenCandidate = token ?? {
      mint: signal.mint,
      symbol: signal.mint.slice(0, 4).toUpperCase(),
      name: "Unknown",
      marketCapUsd: 0,
      liquidityUsd: 0,
      priceUsd: price,
      volume24hUsd: 0,
      ageMinutes: 0,
      source: "copy",
    };

    const motivation = `COPY BUY da ${signal.wallet.label} · sig ${signal.signature.slice(0, 8)}…`;
    const position = this.positions.openFromFill(
      candidate,
      order.filledAmountSol || amountSol,
      order.filledPriceUsd || price,
      order.filledTokenAmount,
      order.venue,
      motivation,
      {
        riskPct: risk.riskPct,
        riskBand: risk.band,
        highProfitPotential: risk.band === "high",
      },
    );
    position.copyFromAddress = signal.wallet.address;
    position.copyFromLabel = signal.wallet.label;
    position.copySourceSignature = signal.signature;
    position.listeningForCopySell = true;
    // Emergency TP/SL only — copy sell ha priorità
    position.takeProfitPct = this.config.COPY_EMERGENCY_TAKE_PROFIT_PCT;
    position.stopLossPct = this.config.COPY_EMERGENCY_STOP_LOSS_PCT;

    this.state.openPositions.push(position);
    this.state.residualBudgetSol = Math.max(0, this.state.residualBudgetSol - position.amountSol);
    this.byMint.set(position.mint, position.id);
    const latency = Date.now() - t0;
    logger.info({ mint: position.mint, latency, wallet: signal.wallet.label }, "COPY BUY eseguito");
    await this.cbs.onCopyBuy(position, risk, signal, candidate);
    await this.cbs.persist();
  }

  private async copySell(signal: MirrorSignal): Promise<void> {
    const posId = this.byMint.get(signal.mint);
    const position = this.state.openPositions.find((p) => p.id === posId || p.mint === signal.mint);
    if (!position) {
      // sell di un wallet su token che non abbiamo — ignora
      return;
    }

    // Solo se stiamo copiando QUESTO wallet (o qualsiasi tracked se configurato)
    if (
      position.copyFromAddress &&
      position.copyFromAddress !== signal.wallet.address &&
      !this.config.COPY_SELL_ANY_TRACKED
    ) {
      return;
    }

    const token = await this.resolveToken(signal.mint);
    const mark = token?.priceUsd ?? position.entryPriceUsd;
    const t0 = Date.now();
    const { trade, orderOk, error } = await this.positions.closePosition(
      position,
      mark,
      "copy_sell",
    );
    if (!orderOk) {
      await this.cbs.onSkip(error ?? "Copy sell fallito", signal);
      return;
    }

    this.state.openPositions = this.state.openPositions.filter((p) => p.id !== position.id);
    this.byMint.delete(position.mint);
    this.state.closedTrades.unshift(trade);
    this.state.closedTrades = this.state.closedTrades.slice(0, 200);
    this.state.realizedPnlSol += trade.pnlSol;
    this.state.residualBudgetSol += position.amountSol + trade.pnlSol;

    const latency = Date.now() - t0;
    const note =
      (signal.sellFraction ?? 1) >= 0.95
        ? `Il wallet ${signal.wallet.label} ha venduto il 100% della posizione. Transazione replicata in ${latency}ms.`
        : `Vendita parziale rilevata (~${Math.round((signal.sellFraction ?? 1) * 100)}%). Mirror sell eseguito in ${latency}ms.`;

    logger.info({ mint: position.mint, latency, pnl: trade.pnlSol }, "COPY SELL eseguito");
    await this.cbs.onCopySell(trade, signal, note);
    await this.cbs.persist();
  }
}
