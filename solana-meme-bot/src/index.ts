import "dotenv/config";
import type { Server } from "node:http";
import { MaxProfitEngine } from "./analysis/max-profit-engine.js";
import type { AppConfig } from "./config/schema.js";
import { loadConfig } from "./config/schema.js";
import { FomoActivityFeed } from "./copy/fomo-activity-feed.js";
import { FomoDemoFeed } from "./copy/fomo-demo-feed.js";
import { FomoLeaderboardClient } from "./copy/fomo-leaderboard.js";
import { FomoTradingClient } from "./copy/fomo-trading.js";
import { MirrorEngine } from "./copy/mirror-engine.js";
import { SolanaWalletWatcher } from "./copy/solana-watcher.js";
import type { MirrorSignal } from "./copy/types.js";
import { WalletRegistry } from "./copy/wallet-registry.js";
import { AlertBus } from "./lib/alert-bus.js";
import { logger } from "./lib/logger.js";
import { nowIso } from "./lib/money.js";
import { createInitialState, StateStore } from "./lib/state-store.js";
import { MarketScanner } from "./scrapers/market-scanner.js";
import { TelegramService } from "./telegram/bot.js";
import type { TelegramCommand } from "./telegram/commands.js";
import { formatWalletsPanel } from "./telegram/dashboard.js";
import {
  formatCloseAllReport,
  formatProfitAllReport,
  formatBalanceReport,
  summarizeTrades,
} from "./telegram/reports.js";
import { FomoLiveExecutionAdapter } from "./trader/fomo-adapter.js";
import { PositionManager } from "./trader/position-manager.js";
import { buildExecutionRouter, type ExecutionRouter } from "./trader/venue-adapter.js";
import { WalletManager } from "./trader/wallet-manager.js";
import type {
  BotRuntimeState,
  DecisionResult,
  Position,
  RejectedTrade,
  RiskTolerance,
} from "./types/index.js";
import { startDashboard } from "./ui/server.js";

/**
 * Controller H24 — Mirror Trading (FOMO Top 50 PnL) + emergency TP/SL.
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
  readonly registry = new WalletRegistry();
  private readonly fomo: FomoLeaderboardClient;
  private readonly fomoTrading: FomoTradingClient;
  private watcher: SolanaWalletWatcher | null = null;
  private demoFeed: FomoDemoFeed | null = null;
  private activityFeed: FomoActivityFeed | null = null;
  private mirror: MirrorEngine | null = null;
  private readonly store = new StateStore();

  private scanTimer: NodeJS.Timeout | null = null;
  private positionTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private leaderboardTimer: NodeJS.Timeout | null = null;
  private running = false;
  private dailyLossSol = 0;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.state = createInitialState(
      config.BUDGET_SOL,
      config.TRADING_MODE,
      config.RISK_TOLERANCE,
      config.MAX_RISK_PCT,
      config.COPY_TRADING_ENABLED,
    );
    this.telegram = new TelegramService(config);
    this.wallet = new WalletManager(config);
    this.scanner = new MarketScanner(config);
    this.engine = new MaxProfitEngine(config);
    this.fomoTrading = new FomoTradingClient({
      apiBase: config.FOMO_API_BASE,
      cfClearance: config.FOMO_CF_CLEARANCE,
      cfBm: config.FOMO_CF_BM,
    });
    this.router = buildExecutionRouter(config, {
      fomoClient: this.fomoTrading,
      getFomoApiKey: () => this.config.FOMO_API_KEY || this.telegram.getSettings().fomoApiKey,
      getSolUsd: () => this.telegram.getSettings().solUsd || 150,
    });
    this.positions = new PositionManager(config, this.router);
    this.fomo = new FomoLeaderboardClient(config);

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
      copyTradingEnabled: this.config.COPY_TRADING_ENABLED,
    });
    if (!Number.isFinite(this.state.residualBudgetSol)) {
      this.state.residualBudgetSol = this.config.BUDGET_SOL;
    }
    this.state.riskTolerance = this.state.riskTolerance ?? this.config.RISK_TOLERANCE;
    this.state.maxRiskPct = this.state.maxRiskPct ?? this.config.MAX_RISK_PCT;
    this.engine.setRiskTolerance(this.state.riskTolerance);
    this.engine.setMaxRiskPct(this.state.maxRiskPct);

    const userSettings = await this.telegram.loadSettings();
    this.applyUserSettings(userSettings);

    await this.registry.load();
    this.syncTrackedView();

    this.mirror = new MirrorEngine(this.config, this.state, this.router, this.positions, {
      onCopyBuy: async (position, risk, signal, token) => {
        this.state.mirrorBuys += 1;
        this.state.lastMirrorAt = nowIso();
        await this.syncFomoResidualBudget();
        await this.telegram.notifyCopyBuy(position, risk, signal, token);
      },
      onCopySell: async (trade, _signal, latencyNote) => {
        this.state.mirrorSells += 1;
        this.state.lastMirrorAt = nowIso();
        this.state.sessionRealizedPnlSol += trade.pnlSol;
        trade.copyLatencyNote = latencyNote;
        await this.syncFomoResidualBudget();
        await this.telegram.notifySell(trade);
        await this.alerts.push({
          severity: "info",
          title: "Copy sell REAL eseguito",
          message: latencyNote,
          requiresUpdate: false,
          source: "mirror",
        });
      },
      onSkip: async (reason, signal) => {
        logger.debug({ reason, side: signal.side, mint: signal.mint }, "Mirror skip");
      },
      persist: async () => this.persist(),
    });

    this.telegram.start(async (cmd, chatId) => this.handleCommand(cmd, chatId), {
      stateProvider: () => this.getState(),
      modeLabel: () => {
        const real = this.state.tradingMode === "live" && !this.config.DRY_RUN;
        return `COPY/FOMO ${this.state.tradingMode}${real ? " REAL 🔴" : this.config.DRY_RUN ? " dry-run" : ""}${this.state.tradingMode === "paper" ? " 🧪" : ""}`;
      },
      livePositionsProvider: () => this.getLivePositionRows(),
      onSettingsChanged: async (settings) => {
        this.applyUserSettings(settings);
        this.activityFeed?.setTargetUsernames(settings.fomoUsernames);
        this.demoFeed?.setTargetUsernames(settings.fomoUsernames);
        this.registry.enableOnlyUsernames(settings.fomoUsernames);
        await this.watcher?.resubscribeAll();
        this.mirror?.reindex();
        await this.persist();
      },
      onRealSessionReady: async (settings) => {
        await this.activateRealSession(settings);
      },
    });
  }

  /** Wipe demo + attiva REAL trading FOMO. */
  async activateRealSession(settings: {
    fixedTradeSol: number;
    fomoApiKey: string;
    fomoUsernames: string[];
    solUsd: number;
    lastKnownAvailableSol?: number | null;
  }): Promise<void> {
    // 1) Elimina progresso demo
    this.state.openPositions = [];
    this.state.closedTrades = [];
    this.state.rejectedTrades = [];
    this.state.realizedPnlSol = 0;
    this.state.unrealizedPnlSol = 0;
    this.state.sessionRealizedPnlSol = 0;
    this.state.mirrorBuys = 0;
    this.state.mirrorSells = 0;
    this.state.sessionStartedAt = nowIso();
    this.mirror?.reindex();
    this.demoFeed?.stop();

    // 2) Forza live REAL
    this.config.TRADING_MODE = "live";
    this.config.DRY_RUN = false;
    this.config.COPY_DEMO_FOMO_FEED = false;
    this.config.PREFERRED_EXECUTION_VENUE = "fomo";
    this.config.FOMO_API_KEY = settings.fomoApiKey;
    this.config.COPY_TRADE_SOL = settings.fixedTradeSol;
    process.env.FOMO_API_KEY = settings.fomoApiKey;
    this.state.tradingMode = "live";

    this.router.setAdapter(
      "fomo",
      new FomoLiveExecutionAdapter(
        this.fomoTrading,
        () => this.config.FOMO_API_KEY || this.telegram.getSettings().fomoApiKey,
        () => this.telegram.getSettings().solUsd || 150,
      ),
    );

    const available =
      settings.lastKnownAvailableSol ??
      (await this.fomoTrading.fetchBalance(settings.fomoApiKey, settings.solUsd || 150)).availableSol;
    this.state.budgetSol = available;
    this.state.residualBudgetSol = available;
    this.state.copySessionActive = true;
    this.state.status = "running";
    this.state.pauseReason = undefined;

    this.activityFeed?.setTargetUsernames(settings.fomoUsernames);
    this.activityFeed?.start(async (signal) => {
      try {
        await this.mirror?.handleSignal(signal);
      } catch (err) {
        logger.error({ err }, "Errore activity signal");
      }
    });
    this.registry.enableOnlyUsernames(settings.fomoUsernames);
    await this.refreshLeaderboard();
    await this.persist();
    logger.info(
      { availableSol: available, budget: settings.fixedTradeSol, targets: settings.fomoUsernames },
      "Sessione FOMO REAL attivata — demo wipe completato",
    );
  }

  /** Applica budget fisso / API key / target usernames dalle settings Telegram */
  applyUserSettings(settings: {
    fixedTradeSol: number;
    fomoApiKey: string;
    fomoUsernames: string[];
    solUsd: number;
    onboarded?: boolean;
    fomoAuthenticated?: boolean;
    solvent?: boolean;
    sessionStartedAt?: string | null;
    lastKnownAvailableSol?: number | null;
  }): void {
    this.config.COPY_TRADE_SOL = settings.fixedTradeSol;
    if (settings.fomoApiKey) {
      this.config.FOMO_API_KEY = settings.fomoApiKey;
      process.env.FOMO_API_KEY = settings.fomoApiKey;
    } else {
      this.config.FOMO_API_KEY = "";
    }
    const realReady = Boolean(
      settings.onboarded && settings.fomoAuthenticated && settings.solvent !== false && settings.fomoApiKey,
    );
    this.state.copySessionActive = realReady;
    if (realReady) {
      // REAL di default quando autenticato
      if (this.config.TRADING_MODE !== "paper") {
        this.config.TRADING_MODE = "live";
        this.config.DRY_RUN = false;
        this.state.tradingMode = "live";
      }
      const started = settings.sessionStartedAt ?? this.state.sessionStartedAt ?? nowIso();
      if (!this.state.sessionStartedAt) {
        this.state.sessionStartedAt = started;
      } else if (settings.sessionStartedAt && settings.sessionStartedAt !== this.state.sessionStartedAt) {
        this.state.sessionStartedAt = settings.sessionStartedAt;
        this.state.sessionRealizedPnlSol = 0;
      }
      if (settings.lastKnownAvailableSol != null && Number.isFinite(settings.lastKnownAvailableSol)) {
        this.state.budgetSol = settings.lastKnownAvailableSol;
        const openSol = this.state.openPositions.reduce((a, p) => a + p.amountSol, 0);
        this.state.residualBudgetSol = Math.max(0, settings.lastKnownAvailableSol - openSol);
      }
    } else {
      this.state.copySessionActive = false;
    }
    this.registry.enableOnlyUsernames(settings.fomoUsernames);
    this.demoFeed?.setTargetUsernames(settings.fomoUsernames);
    this.activityFeed?.setTargetUsernames(settings.fomoUsernames);
    logger.info(
      {
        tradeSol: settings.fixedTradeSol,
        targets: settings.fomoUsernames,
        session: this.state.copySessionActive,
        hasApiKey: Boolean(settings.fomoApiKey),
        mode: this.state.tradingMode,
      },
      "User settings applicate al controller",
    );
  }

  async syncFomoResidualBudget(): Promise<void> {
    const settings = this.telegram.getSettings();
    if (!settings.fomoApiKey) return;
    const bal = await this.fomoTrading.fetchBalance(settings.fomoApiKey, settings.solUsd || 150);
    if (!bal.ok) return;
    const openSol = this.state.openPositions.reduce((a, p) => a + p.amountSol, 0);
    this.state.budgetSol = bal.availableSol + openSol;
    this.state.residualBudgetSol = Math.max(0, bal.availableSol);
    await this.telegram.settingsStore.save({
      lastKnownAvailableSol: bal.availableSol,
      solvent: bal.availableSol + 1e-9 >= settings.fixedTradeSol,
      solanaAddress: bal.solanaAddress || settings.solanaAddress,
    });
  }

  async getLivePositionRows(): Promise<
    Array<{
      position: Position;
      livePriceUsd: number;
      liveMarketCapUsd: number;
      pnlPct: number;
      pnlSol: number;
    }>
  > {
    const rows = [];
    for (const position of this.state.openPositions) {
      const quote = await this.positions.getOracle().getLivePriceUsd(position.mint, {
        bypassCache: true,
      });
      const livePriceUsd = quote.priceUsd > 0 ? quote.priceUsd : position.entryPriceUsd;
      const liveMarketCapUsd =
        quote.marketCapUsd && quote.marketCapUsd > 0
          ? quote.marketCapUsd
          : position.marketCapAtEntry > 0 && position.entryPriceUsd > 0
            ? position.marketCapAtEntry * (livePriceUsd / position.entryPriceUsd)
            : 0;
      const pnlPct =
        position.entryPriceUsd > 0
          ? ((livePriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100
          : 0;
      const pnlSol = position.amountSol * (pnlPct / 100);
      rows.push({ position, livePriceUsd, liveMarketCapUsd, pnlPct, pnlSol });
    }
    return rows;
  }

  /** Liquida tutte le posizioni al prezzo live e resetta la sessione Fomo. */
  async closeAllAndReset(): Promise<string> {
    const settings = this.telegram.getSettings();
    const solUsd = settings.solUsd || 150;
    const symbols: string[] = [];
    let liquidationPnl = 0;

    for (const position of [...this.state.openPositions]) {
      const lockedEntry = position.entryPriceUsd;
      const { trade, orderOk, error } = await this.positions.closePosition(
        position,
        undefined,
        "manual",
        solUsd,
      );
      // Garantisce che l'entry nello storico sia quello originale bloccato
      trade.position.entryPriceUsd = lockedEntry;
      if (!orderOk) {
        logger.warn({ mint: position.mint, error }, "closeall: sell fallito");
        continue;
      }
      symbols.push(position.symbol);
      liquidationPnl += trade.pnlSol;
      this.state.closedTrades.unshift(trade);
      this.state.realizedPnlSol += trade.pnlSol;
      this.state.sessionRealizedPnlSol += trade.pnlSol;
      this.state.residualBudgetSol += position.amountSol + trade.pnlSol;
    }

    this.state.openPositions = [];
    const sessionPnlBeforeReset = this.state.sessionRealizedPnlSol;
    this.state.closedTrades = [];
    this.state.unrealizedPnlSol = 0;
    this.state.sessionRealizedPnlSol = 0;
    this.mirror?.reindex();
    this.activityFeed?.stop();
    this.demoFeed?.stop();

    const sessionPnl = sessionPnlBeforeReset;
    await this.telegram.settingsStore.resetSession();
    this.state.copySessionActive = false;
    this.state.sessionStartedAt = null;
    this.state.status = "paused";
    this.state.pauseReason = "Sessione resettata con /closeall — invia /start";
    this.config.FOMO_API_KEY = "";
    process.env.FOMO_API_KEY = "";
    await this.persist();

    logger.info(
      { symbols, liquidationPnl, sessionPnl },
      "closeall: liquidazione e reset sessione REAL",
    );
    return formatCloseAllReport({
      symbols,
      pnlSol: sessionPnl,
      solUsd,
    });
  }

  /** Report PnL sessione + finestre 24h / 3d / 7d / 30d — solo trade REALI */
  buildProfitAllReport(): string {
    const settings = this.telegram.getSettings();
    const solUsd = settings.solUsd || 150;
    const sessionStart = this.state.sessionStartedAt
      ? Date.parse(this.state.sessionStartedAt)
      : Date.now();
    // Solo trade non simulati (dopo wipe demo non dovrebbero esserci paper)
    const realClosed = this.state.closedTrades.filter((t) => t.position.venue !== "paper");
    const sessionTrades = realClosed.filter((t) => Date.parse(t.closedAt) >= sessionStart);
    const session = summarizeTrades(sessionTrades);
    const sessionPnlSol =
      this.state.copySessionActive && this.state.sessionRealizedPnlSol !== 0
        ? this.state.sessionRealizedPnlSol
        : session.pnlSol;

    const now = Date.now();
    const windows = [
      { label: "⏱️ 24 Ore", ms: 24 * 3_600_000 },
      { label: "🗓️ 3 Giorni", ms: 3 * 24 * 3_600_000 },
      { label: "📅 1 Settimana", ms: 7 * 24 * 3_600_000 },
      { label: "🗓️ 1 Mese", ms: 30 * 24 * 3_600_000 },
    ].map((w) => {
      const trades = realClosed.filter((t) => now - Date.parse(t.closedAt) <= w.ms);
      const s = summarizeTrades(trades);
      return {
        label: w.label,
        pnlSol: s.pnlSol,
        wins: s.wins,
        losses: s.losses,
        winRate: s.winRate,
      };
    });

    return formatProfitAllReport({
      sessionPnlSol,
      sessionWins: session.wins,
      sessionLosses: session.losses,
      sessionWinRate: session.winRate,
      windows,
      solUsd,
      realFomoBalanceSol: settings.lastKnownAvailableSol,
    });
  }

  async buildBalanceReport(): Promise<string> {
    const settings = this.telegram.getSettings();
    const solUsd = settings.solUsd || 150;
    const openPositionsSol = this.state.openPositions.reduce((a, p) => a + p.amountSol, 0);

    let fomoSnap: {
      ok: boolean;
      handle?: string;
      cashUsd?: number;
      availableSol?: number;
      portfolioUsd?: number;
      positionsUsd?: number;
      positionsCount?: number;
      solanaAddress?: string;
      error?: string;
    } | null = null;

    if (settings.fomoApiKey) {
      const bal = await this.fomoTrading.fetchBalance(settings.fomoApiKey, solUsd);
      if (bal.ok) {
        fomoSnap = {
          ok: true,
          handle: bal.handle,
          cashUsd: bal.cashUsd,
          availableSol: bal.availableSol,
          portfolioUsd: bal.portfolioUsd,
          positionsUsd: bal.positionsUsd,
          positionsCount: bal.positionsCount,
          solanaAddress: bal.solanaAddress,
        };
        await this.telegram.settingsStore.save({
          lastKnownAvailableSol: bal.availableSol,
          solanaAddress: bal.solanaAddress || settings.solanaAddress,
          solvent: bal.availableSol + 1e-9 >= settings.fixedTradeSol,
        });
        this.state.residualBudgetSol = Math.max(0, bal.availableSol);
        this.state.budgetSol = bal.availableSol + openPositionsSol;
      } else {
        fomoSnap = { ok: false, error: bal.error };
      }
    } else {
      fomoSnap = { ok: false, error: "Nessuna FOMO API Key — /start e incolla privy:token" };
    }

    const refreshed = this.telegram.getSettings();
    const addr =
      refreshed.solanaAddress ||
      fomoSnap?.solanaAddress ||
      this.wallet.getPublicKey() ||
      null;
    let onChainSol: number | null = null;
    if (addr) {
      onChainSol = await this.wallet.getSolBalanceForAddress(addr);
    }

    const mode =
      this.state.tradingMode === "live" && !this.config.DRY_RUN
        ? "live REAL FOMO"
        : `${this.state.tradingMode}${this.config.DRY_RUN ? " dry-run" : ""}`;
    return formatBalanceReport({
      mode,
      budgetSol: settings.fixedTradeSol,
      residualSol: this.state.residualBudgetSol,
      openPositionsSol,
      unrealizedPnlSol: this.state.unrealizedPnlSol,
      realizedPnlSol: this.state.realizedPnlSol,
      sessionPnlSol: this.state.sessionRealizedPnlSol,
      openCount: this.state.openPositions.length,
      solUsd,
      onChainSol,
      walletAddress: addr,
      fomo: fomoSnap,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.state.status = "running";
    this.state.startedAt = this.state.startedAt ?? nowIso();
    await this.persist();
    logger.info("Controller H24 Mirror/FOMO avviato");

    if (this.config.COPY_TRADING_ENABLED) {
      await this.refreshLeaderboard();
      const onSignal = async (signal: MirrorSignal) => {
        try {
          await this.mirror?.handleSignal(signal);
        } catch (err) {
          logger.error({ err }, "Errore mirror signal");
        }
      };
      this.watcher = new SolanaWalletWatcher(this.config, this.registry);
      await this.watcher.start(onSignal);

      this.activityFeed = new FomoActivityFeed(
        this.config,
        this.fomoTrading,
        this.registry,
        () => this.config.FOMO_API_KEY || this.telegram.getSettings().fomoApiKey,
      );
      const settings = this.telegram.getSettings();
      this.activityFeed.setTargetUsernames(settings.fomoUsernames);
      if (settings.onboarded && settings.fomoAuthenticated && settings.fomoApiKey) {
        this.activityFeed.start(onSignal);
      }

      // Demo feed solo se esplicitamente abilitato (paper)
      this.demoFeed = new FomoDemoFeed(this.config, this.registry);
      this.demoFeed.setTargetUsernames(settings.fomoUsernames);
      if (this.config.TRADING_MODE === "paper" && this.config.COPY_DEMO_FOMO_FEED) {
        this.demoFeed.ensureDemoWallets();
        this.demoFeed.start(onSignal);
      }
      this.syncTrackedView();
      await this.persist();
      this.leaderboardTimer = setInterval(
        () => void this.refreshLeaderboard(),
        this.config.COPY_LEADERBOARD_REFRESH_MS,
      );
    }

    const tickScan = async () => {
      if (!this.config.MAX_PROFIT_SCAN_ENABLED) return;
      try {
        await this.scanCycle();
      } catch (err) {
        logger.error({ err }, "Errore scanCycle");
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
    if (this.leaderboardTimer) clearInterval(this.leaderboardTimer);
    await this.watcher?.stop();
    this.demoFeed?.stop();
    this.activityFeed?.stop();
    await this.telegram.stop();
    await this.persist();
  }

  getState(): BotRuntimeState {
    this.refreshAverageRisk();
    this.syncTrackedView();
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
    this.syncTrackedView();
    this.state.alerts = this.alerts.list();
    await this.store.save(this.state);
    await this.registry.save();
  }

  private syncTrackedView(): void {
    this.state.trackedWallets = this.registry.list().map((w) => ({
      address: w.address,
      label: w.username ? `@${w.username}` : w.label,
      rank: w.rank,
      realizedPnlUsd: w.realizedPnlUsd,
      reliabilityScore: w.reliabilityScore,
      source: w.source,
      enabled: w.enabled,
      lastSeenAt: w.lastSeenAt,
    }));
  }

  private refreshAverageRisk(): void {
    const open = this.state.openPositions;
    this.state.averageOpenRiskPct = open.length
      ? open.reduce((a, p) => a + (p.riskPct ?? 0), 0) / open.length
      : 0;
  }

  private async refreshLeaderboard(): Promise<void> {
    try {
      const settings = this.telegram.getSettings();
      const targets = new Set(settings.fomoUsernames.map((u) => u.replace(/^@/, "").toLowerCase()));
      const top = await this.fomo.fetchTop50();

      if (top.length) {
        // Preferisci match per username target; resta il resto disabilitato
        const matched = top.filter(
          (w) => w.username && targets.has(w.username.replace(/^@/, "").toLowerCase()),
        );
        if (matched.length) {
          this.registry.upsertMany(matched, { preserveManual: true });
        } else {
          this.registry.upsertMany(top.slice(0, this.config.COPY_MAX_WALLETS), {
            preserveManual: true,
          });
        }
      } else {
        await this.alerts.push({
          severity: "warning",
          title: "FOMO Top PnL API non disponibile",
          message:
            "Leaderboard FOMO non raggiungibile. Uso activity feed / wallet risolti da @username. Verifica FOMO API Key e Cloudflare.",
          requiresUpdate: false,
          source: "fomo",
        });
        if (this.state.status === "awaiting_update") this.state.status = "running";
      }

      this.registry.enableOnlyUsernames(settings.fomoUsernames);
      this.syncTrackedView();
      await this.registry.save();
      await this.watcher?.resubscribeAll();
      this.mirror?.reindex();
      logger.info(
        {
          wallets: this.registry.list(true).length,
          targets: settings.fomoUsernames,
          tradeSol: this.config.COPY_TRADE_SOL,
        },
        "Leaderboard FOMO / target usernames sincronizzata",
      );
      await this.persist();
    } catch (err) {
      logger.error({ err }, "refreshLeaderboard fallita");
    }
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
    for (const candidate of candidates) {
      if (!this.wallet.validateMint(candidate.mint)) continue;
      const decision = await this.engine.evaluate(candidate, trends);
      if (decision.decision === "reject") {
        await this.recordReject(decision);
        continue;
      }
      if (decision.decision === "buy" && this.canBuy()) {
        await this.tryScanBuy(decision);
      }
    }
    await this.persist();
  }

  private async tryScanBuy(decision: DecisionResult): Promise<void> {
    if (!decision.amountSol) return;
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
    if (!order.ok) return;
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
        solUsd: this.telegram.getSettings().solUsd || 150,
      },
    );
    this.state.openPositions.push(position);
    this.state.residualBudgetSol = Math.max(0, this.state.residualBudgetSol - position.amountSol);
    await this.telegram.notifyBuy(decision, position);
  }

  private async recordReject(decision: DecisionResult): Promise<void> {
    const row: RejectedTrade = {
      at: nowIso(),
      candidate: decision.candidate,
      assessment: decision.assessment,
      label: decision.rejectedAs ?? "Rifiutato",
      motivation: decision.motivation,
    };
    this.state.rejectedTrades.unshift(row);
    this.state.rejectedTrades = this.state.rejectedTrades.slice(0, 100);
  }

  /** Emergency TP/SL only — copy sell ha priorità quando arriva il segnale */
  private async positionCycle(): Promise<void> {
    if (!this.running) return;
    let unrealized = 0;

    for (const position of [...this.state.openPositions]) {
      const quote = await this.positions.getOracle().getLivePriceUsd(position.mint, {
        bypassCache: true,
      });
      const mark = quote.priceUsd > 0 ? quote.priceUsd : undefined;
      if (mark) this.positions.updatePeak(position, mark);
      const markForPnl = mark ?? position.peakPriceUsd ?? position.entryPriceUsd;
      const pnlPct =
        position.entryPriceUsd > 0
          ? ((markForPnl - position.entryPriceUsd) / position.entryPriceUsd) * 100
          : 0;
      unrealized += position.amountSol * (pnlPct / 100);

      if (!mark) continue;
      const signal = this.positions.exitSignal(position, mark);
      if (!signal) continue;

      const { trade, orderOk, error } = await this.positions.closePosition(position, mark, signal);
      if (!orderOk) {
        await this.alerts.push({
          severity: "critical",
          title: "Emergency sell fallito",
          message: error ?? "Impossibile chiudere",
          requiresUpdate: true,
          source: "execution",
        });
        continue;
      }

      this.state.openPositions = this.state.openPositions.filter((p) => p.id !== position.id);
      this.mirror?.reindex();
      this.state.closedTrades.unshift(trade);
      this.state.closedTrades = this.state.closedTrades.slice(0, 200);
      this.state.realizedPnlSol += trade.pnlSol;
      this.state.sessionRealizedPnlSol += trade.pnlSol;
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
        title: "Anomalia rete / RPC Solana",
        message: "RPC non raggiungibile — riconnessione watcher in corso.",
        requiresUpdate: false,
        source: "wallet",
      });
      await this.watcher?.resubscribeAll();
    }
  }

  private async handleCommand(cmd: TelegramCommand, _chatId: string): Promise<string> {
    switch (cmd.type) {
      case "pause":
        await this.pause(cmd.reason);
        return `Bot in pausa.${cmd.reason ? ` Motivo: ${cmd.reason}` : ""}`;
      case "resume":
        await this.resume();
        return "Bot ripreso (Mirror H24).";
      case "budget":
        await this.setBudget(cmd.amountSol);
        return `Budget aggiornato a ${cmd.amountSol} SOL`;
      case "risk_tolerance":
        await this.setRiskTolerance(cmd.tolerance);
        return `Tolleranza rischio: ${cmd.tolerance}`;
      case "risk_max":
        await this.setMaxRiskPct(cmd.maxRiskPct);
        return `Max risk ${cmd.maxRiskPct}%`;
      case "update":
        await this.applyLiveInstruction(cmd.instruction);
        return `Istruzione: ${cmd.instruction}`;
      case "wallet_list":
        this.syncTrackedView();
        return formatWalletsPanel(this.state);
      case "wallet_add": {
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cmd.address)) {
          return "Address Solana non valido";
        }
        const w = this.registry.addManual(cmd.address, cmd.label);
        await this.watcher?.resubscribeAll();
        await this.persist();
        return `Wallet aggiunto: ${w.label} (${w.address})`;
      }
      case "wallet_remove": {
        const ok = this.registry.remove(cmd.address);
        await this.watcher?.resubscribeAll();
        await this.persist();
        return ok ? `Wallet rimosso: ${cmd.address}` : "Wallet non trovato";
      }
      case "wallet_refresh":
        await this.refreshLeaderboard();
        return `Top FOMO PnL aggiornata: ${this.registry.list(true).length} wallet attivi`;
      case "closeall":
        return this.closeAllAndReset();
      case "profitall":
        return this.buildProfitAllReport();
      case "balance":
        return this.buildBalanceReport();
      case "status":
        this.refreshAverageRisk();
        return [
          `Stato: ${this.state.status}`,
          `Sessione: ${this.state.copySessionActive ? "attiva" : "inattiva"}`,
          `Copy: ${this.state.copyTradingEnabled ? "ON" : "OFF"}`,
          `Wallets: ${this.registry.list(true).length}`,
          `Mirror BUY/SELL: ${this.state.mirrorBuys}/${this.state.mirrorSells}`,
          `Budget: ${this.state.budgetSol} SOL · Residuo ${this.state.residualBudgetSol.toFixed(4)}`,
          `PnL: ${this.state.realizedPnlSol.toFixed(4)} SOL · Sessione ${this.state.sessionRealizedPnlSol.toFixed(4)}`,
          `Open: ${this.state.openPositions.length}`,
          `Max risk: ${this.state.maxRiskPct}%`,
        ].join("\n");
      case "start":
      case "dashboard":
        return "";
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
      copyTrading: config.COPY_TRADING_ENABLED,
      preferredVenue: config.PREFERRED_EXECUTION_VENUE,
      maxWallets: config.COPY_MAX_WALLETS,
      dashboard: `http://${config.DASHBOARD_HOST}:${config.DASHBOARD_PORT}`,
    },
    "Solana Mirror Bot H24 (FOMO Top PnL) pronto",
  );
}

main().catch((err) => {
  logger.error({ err }, "Avvio fallito");
  process.exit(1);
});
