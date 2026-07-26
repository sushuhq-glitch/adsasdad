import "dotenv/config";
import type { Server } from "node:http";
import { MaxProfitEngine } from "./analysis/max-profit-engine.js";
import type { AppConfig } from "./config/schema.js";
import { loadConfig } from "./config/schema.js";
import { AlertBus } from "./lib/alert-bus.js";
import { logger } from "./lib/logger.js";
import { nowIso } from "./lib/money.js";
import { createInitialState, StateStore } from "./lib/state-store.js";
import { MarketScanner } from "./scrapers/market-scanner.js";
import { TelegramService } from "./telegram/bot.js";
import type { TelegramCommand } from "./telegram/commands.js";
import { PositionManager } from "./trader/position-manager.js";
import { buildExecutionRouter, type ExecutionRouter } from "./trader/venue-adapter.js";
import { WalletManager } from "./trader/wallet-manager.js";
import type { BotRuntimeState, DecisionResult, RejectedTrade, RiskTolerance } from "./types/index.js";
import { startDashboard } from "./ui/server.js";

/**
 * Controller H24 — Max Profit Strategy:
 * scan → analisi tecnica/social → risk % → buy/sell → Telegram/UI
 */
export class BotController {
  readonly state: BotRuntimeState;
  readonly alerts = new AlertBus();
  readonly telegram: TelegramService;
  readonly wallet: WalletManager;
  readonly scanner: MarketScanner;
  readonly engine: MaxProfitEngine;
  readonly router: ExecutionRouter;
  readonly positions: PositionManager;
  private readonly store = new StateStore();

  private scanTimer: NodeJS.Timeout | null = null;
  private positionTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private running = false;
  private dailyLossSol = 0;

  constructor(private config: AppConfig) {
    this.state = createInitialState(
      config.BUDGET_SOL,
      config.TRADING_MODE,
      config.RISK_TOLERANCE,
      config.MAX_RISK_PCT,
    );
    this.telegram = new TelegramService(config);
    this.wallet = new WalletManager(config);
    this.scanner = new MarketScanner(config);
    this.engine = new MaxProfitEngine(config);
    this.router = buildExecutionRouter(config);
    this.positions = new PositionManager(config, this.router);

    this.alerts.onAlert(async (alert) => {
      this.state.alerts = this.alerts.list();
      if (alert.requiresUpdate) this.state.status = "awaiting_update";
      await this.telegram.notifyAlert(alert);
      await this.persist();
    });
  }

  async init(): Promise<void> {
    const loaded = await this.store.load(this.state);
    Object.assign(this.state, loaded, {
      tradingMode: this.config.TRADING_MODE,
      budgetSol: this.config.BUDGET_SOL,
    });
    if (!Number.isFinite(this.state.residualBudgetSol)) {
      this.state.residualBudgetSol = this.config.BUDGET_SOL;
    }
    this.state.riskTolerance = this.state.riskTolerance ?? this.config.RISK_TOLERANCE;
    this.state.maxRiskPct = this.state.maxRiskPct ?? this.config.MAX_RISK_PCT;
    this.engine.setRiskTolerance(this.state.riskTolerance);
    this.engine.setMaxRiskPct(this.state.maxRiskPct);
    this.telegram.start(async (cmd, chatId) => this.handleCommand(cmd, chatId), {
      stateProvider: () => this.getState(),
      modeLabel: () =>
        `${this.state.tradingMode}${this.config.DRY_RUN ? " dry-run" : ""}${this.state.tradingMode === "paper" ? " 🧪" : ""}`,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.state.status = "running";
    this.state.startedAt = this.state.startedAt ?? nowIso();
    await this.persist();
    logger.info("Controller H24 Max Profit avviato");

    const tickScan = async () => {
      try {
        await this.scanCycle();
      } catch (err) {
        logger.error({ err }, "Errore scanCycle");
        await this.alerts.push({
          severity: "warning",
          title: "Errore ciclo scan",
          message: err instanceof Error ? err.message : "scanCycle failed",
          requiresUpdate: false,
          source: "controller",
        });
      }
    };
    const tickPositions = async () => {
      try {
        await this.positionCycle();
      } catch (err) {
        logger.error({ err }, "Errore positionCycle");
      }
    };
    const tickHealth = async () => {
      try {
        await this.healthCycle();
      } catch (err) {
        logger.error({ err }, "Errore healthCycle");
      }
    };

    await tickScan();
    await tickPositions();
    await tickHealth();

    this.scanTimer = setInterval(tickScan, this.config.SCAN_INTERVAL_MS);
    this.positionTimer = setInterval(tickPositions, this.config.POSITION_POLL_INTERVAL_MS);
    this.healthTimer = setInterval(tickHealth, Math.max(60_000, this.config.TREND_POLL_INTERVAL_MS));
  }

  async stop(): Promise<void> {
    this.running = false;
    this.state.status = "stopped";
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.positionTimer) clearInterval(this.positionTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    await this.telegram.stop();
    await this.persist();
  }

  getState(): BotRuntimeState {
    this.refreshAverageRisk();
    return this.state;
  }

  async pause(reason?: string): Promise<void> {
    this.state.status = "paused";
    this.state.pauseReason = reason;
    await this.persist();
  }

  async resume(): Promise<void> {
    this.state.status = "running";
    this.state.pauseReason = undefined;
    await this.persist();
  }

  async setBudget(amountSol: number): Promise<void> {
    const used = this.state.openPositions.reduce((a, p) => a + p.amountSol, 0);
    this.config = { ...this.config, BUDGET_SOL: amountSol };
    this.state.budgetSol = amountSol;
    this.state.residualBudgetSol = Math.max(0, amountSol - used + this.state.realizedPnlSol);
    await this.persist();
  }

  async setRiskTolerance(tolerance: RiskTolerance): Promise<void> {
    this.state.riskTolerance = tolerance;
    this.engine.setRiskTolerance(tolerance);
    await this.persist();
  }

  async setMaxRiskPct(pct: number): Promise<void> {
    this.state.maxRiskPct = pct;
    this.engine.setMaxRiskPct(pct);
    await this.persist();
  }

  async applyLiveInstruction(instruction: string): Promise<void> {
    this.state.liveInstructions.unshift(`${nowIso()} — ${instruction}`);
    this.state.liveInstructions = this.state.liveInstructions.slice(0, 50);
    for (const a of this.alerts.pendingUpdates()) this.alerts.acknowledge(a.id);
    if (this.state.status === "awaiting_update") this.state.status = "running";
    await this.persist();
  }

  async persist(): Promise<void> {
    this.refreshAverageRisk();
    this.state.alerts = this.alerts.list();
    await this.store.save(this.state);
  }

  private refreshAverageRisk(): void {
    const open = this.state.openPositions;
    this.state.averageOpenRiskPct = open.length
      ? open.reduce((a, p) => a + (p.riskPct ?? 0), 0) / open.length
      : 0;
  }

  private canBuy(): boolean {
    if (this.state.status === "paused" || this.state.status === "awaiting_update") return false;
    if (this.state.status !== "running") return false;
    if (this.state.openPositions.length >= this.config.MAX_OPEN_POSITIONS) return false;
    if (this.dailyLossSol >= this.config.MAX_DAILY_LOSS_SOL) return false;
    if (this.state.residualBudgetSol < Math.min(0.01, this.config.MAX_POSITION_SOL)) return false;
    return true;
  }

  private async scanCycle(): Promise<void> {
    if (!this.running) return;
    const { candidates, trends } = await this.scanner.scan();
    this.state.lastScanAt = nowIso();

    // Ordina per profit potential grezzo (volume + social) prima della decisione
    const ranked = [...candidates].sort(
      (a, b) => (b.volume24hUsd || 0) - (a.volume24hUsd || 0),
    );

    for (const candidate of ranked) {
      if (!this.wallet.validateMint(candidate.mint)) continue;
      const decision = await this.engine.evaluate(candidate, trends);
      if (decision.decision === "reject") {
        await this.recordReject(decision);
        continue;
      }
      if (decision.decision === "buy") {
        await this.tryBuy(decision);
      }
    }
    await this.persist();
  }

  private async tryBuy(decision: DecisionResult): Promise<void> {
    if (!this.canBuy() || !decision.amountSol) return;
    if (this.state.openPositions.some((p) => p.mint === decision.candidate.mint)) return;

    const amountSol = Math.min(
      decision.amountSol,
      this.config.MAX_POSITION_SOL,
      this.state.residualBudgetSol,
    );
    if (amountSol <= 0) return;

    const slip = this.positions.dynamicSlippageBps(decision.candidate);
    const order = await this.router.buy(
      decision.candidate.mint,
      amountSol,
      decision.candidate.priceUsd,
      slip,
    );

    if (!order.ok) {
      await this.alerts.push({
        severity: "warning",
        title: "Buy fallito",
        message: order.error ?? "Ordine buy non eseguito",
        requiresUpdate: false,
        source: "execution",
      });
      return;
    }

    const position = this.positions.openFromFill(
      decision.candidate,
      order.filledAmountSol || amountSol,
      order.filledPriceUsd,
      order.filledTokenAmount,
      order.venue,
      decision.motivation,
      {
        riskPct: decision.assessment.risk.riskPct,
        riskBand: decision.assessment.risk.band,
        highProfitPotential: Boolean(decision.highProfitPotential),
      },
    );
    this.state.openPositions.push(position);
    this.state.residualBudgetSol = Math.max(0, this.state.residualBudgetSol - position.amountSol);
    await this.telegram.notifyBuy(decision, position);
    logger.info(
      {
        symbol: position.symbol,
        amountSol: position.amountSol,
        riskPct: position.riskPct,
        moonshot: position.highProfitPotential,
      },
      "Buy eseguito",
    );
  }

  private async recordReject(decision: DecisionResult): Promise<void> {
    const row: RejectedTrade = {
      at: nowIso(),
      candidate: decision.candidate,
      assessment: decision.assessment,
      label: decision.rejectedAs ?? "Trade Rifiutato - Filtri Risk/Strategy",
      motivation: decision.motivation,
    };
    this.state.rejectedTrades.unshift(row);
    this.state.rejectedTrades = this.state.rejectedTrades.slice(0, 100);
    if (decision.assessment.technical.profitPotentialScore >= 60) {
      await this.telegram.notifyReject(decision);
    }
  }

  private async positionCycle(): Promise<void> {
    if (!this.running) return;
    let unrealized = 0;

    for (const position of [...this.state.openPositions]) {
      const mark = (await this.scanner.fetchTokenPrice(position.mint)) ?? position.entryPriceUsd;
      this.positions.updatePeak(position, mark);
      const pnlPct = ((mark - position.entryPriceUsd) / position.entryPriceUsd) * 100;
      unrealized += position.amountSol * (pnlPct / 100);

      const signal = this.positions.exitSignal(position, mark);
      if (!signal) continue;

      const { trade, orderOk, error } = await this.positions.closePosition(position, mark, signal);
      if (!orderOk) {
        await this.alerts.push({
          severity: "critical",
          title: "Sell fallito",
          message: error ?? "Impossibile chiudere posizione",
          requiresUpdate: true,
          source: "execution",
        });
        continue;
      }

      this.state.openPositions = this.state.openPositions.filter((p) => p.id !== position.id);
      this.state.closedTrades.unshift(trade);
      this.state.closedTrades = this.state.closedTrades.slice(0, 200);
      this.state.realizedPnlSol += trade.pnlSol;
      this.state.residualBudgetSol += position.amountSol + trade.pnlSol;
      if (trade.pnlSol < 0) this.dailyLossSol += Math.abs(trade.pnlSol);
      await this.telegram.notifySell(trade);
    }

    this.state.unrealizedPnlSol = unrealized;
    await this.persist();
  }

  private async healthCycle(): Promise<void> {
    const rpcOk = await this.wallet.isHealthy();
    if (!rpcOk) {
      await this.alerts.push({
        severity: "warning",
        title: "Anomalia di rete / RPC",
        message: "RPC Solana non raggiungibile. Verifica SOLANA_RPC_URL.",
        requiresUpdate: false,
        source: "wallet",
      });
    }

    if (this.config.TRADING_MODE === "live" && !this.config.DRY_RUN) {
      const health = await this.router.healthAll();
      for (const h of health) {
        if (h.venue === "paper") continue;
        if (!h.ok) {
          await this.alerts.push({
            severity: "critical",
            title: `Problema API ${h.venue}`,
            message:
              h.message ??
              `Cambio API o endpoint non raggiungibile su ${h.venue}. Aggiorna istruzioni/keyword via Telegram.`,
            requiresUpdate: true,
            source: h.venue,
          });
        }
      }
    }
  }

  private async handleCommand(cmd: TelegramCommand, _chatId: string): Promise<string> {
    switch (cmd.type) {
      case "pause":
        await this.pause(cmd.reason);
        return `Bot in pausa.${cmd.reason ? ` Motivo: ${cmd.reason}` : ""}`;
      case "resume":
        await this.resume();
        return "Bot ripreso (H24 Max Profit running).";
      case "budget":
        await this.setBudget(cmd.amountSol);
        return `Budget aggiornato a ${cmd.amountSol} SOL. Residuo: ${this.state.residualBudgetSol.toFixed(4)} SOL`;
      case "risk_tolerance":
        await this.setRiskTolerance(cmd.tolerance);
        return `Tolleranza rischio impostata: ${cmd.tolerance}`;
      case "risk_max":
        await this.setMaxRiskPct(cmd.maxRiskPct);
        return `Rischio massimo impostato a ${cmd.maxRiskPct}%. Puoi regolare ulteriormente con /risk only_low | only_high.`;
      case "update":
        await this.applyLiveInstruction(cmd.instruction);
        return `Istruzione ricevuta:\n${cmd.instruction}`;
      case "status":
        this.refreshAverageRisk();
        return [
          `Stato: ${this.state.status}`,
          `Mode: ${this.state.tradingMode}${this.config.DRY_RUN ? " (dry-run)" : ""}`,
          `Budget: ${this.state.budgetSol} SOL`,
          `Residuo: ${this.state.residualBudgetSol.toFixed(4)} SOL`,
          `PnL: ${this.state.realizedPnlSol.toFixed(4)} SOL`,
          `Open: ${this.state.openPositions.length}`,
          `Risk tolerance: ${this.state.riskTolerance}`,
          `Max risk: ${this.state.maxRiskPct}%`,
          `Avg open risk: ${this.state.averageOpenRiskPct.toFixed(1)}%`,
        ].join("\n");
      case "start":
      case "dashboard":
        return ""; // gestito da TelegramService.openDashboard
      default:
        return "Comando non gestito";
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const controller = new BotController(config);
  await controller.init();

  const dashboard: Server = startDashboard(controller, config);
  await controller.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown in corso");
    await controller.stop();
    dashboard.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info(
    {
      mode: config.TRADING_MODE,
      dryRun: config.DRY_RUN,
      riskTolerance: config.RISK_TOLERANCE,
      maxRiskPct: config.MAX_RISK_PCT,
      venues: ["axiom", "anthem", "fomo", "pumpfun"],
      dashboard: `http://${config.DASHBOARD_HOST}:${config.DASHBOARD_PORT}`,
    },
    "Solana Meme Bot H24 Max Profit pronto",
  );
}

main().catch((err) => {
  logger.error({ err }, "Avvio fallito");
  process.exit(1);
});
