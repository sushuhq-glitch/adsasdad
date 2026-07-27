import { promises as fs } from "node:fs";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import type { AppConfig } from "../config/schema.js";
import type { CopyRiskProfile, MirrorSignal } from "../copy/types.js";
import { logger } from "../lib/logger.js";
import type {
  BotRuntimeState,
  ClosedTrade,
  DecisionResult,
  Position,
  SystemAlert,
  TokenCandidate,
} from "../types/index.js";
import { HELP_TEXT, parseTelegramCommand, type TelegramCommand } from "./commands.js";
import { formatWalletsPanel } from "./dashboard.js";
import {
  formatBuyMessage,
  formatCopyBuyMessage,
  formatRejectMessage,
  formatSellMessage,
  formatStatus,
  formatSystemAlert,
} from "./formatter.js";
import {
  formatAskBudget,
  formatLivePositionsReport,
  formatOnboardingDone,
  formatOnboardingWelcome,
  formatSettingsPanel,
  formatWinLossStats,
  mainMenuKeyboard,
  settingsKeyboard,
  type LivePositionRow,
} from "./reports.js";
import {
  normalizeUsername,
  UserSettingsStore,
  type UserBotSettings,
} from "./user-settings.js";

export type CommandHandler = (cmd: TelegramCommand, chatId: string) => Promise<string | void>;
export type StateProvider = () => BotRuntimeState;
export type ModeLabelProvider = () => string;
export type LivePositionsProvider = () => Promise<LivePositionRow[]>;
export type SettingsChangedHandler = (settings: UserBotSettings) => Promise<void> | void;

type PendingStep =
  | "await_fomo_key"
  | "await_budget"
  | "edit_fomo_key"
  | "edit_budget"
  | "add_username";

const CHAT_FILE = path.resolve("data/telegram-chat.json");

export class TelegramService {
  private bot: TelegramBot | null = null;
  private handler: CommandHandler | null = null;
  private stateProvider: StateProvider | null = null;
  private livePositionsProvider: LivePositionsProvider | null = null;
  private onSettingsChanged: SettingsChangedHandler | null = null;
  private modeLabel: ModeLabelProvider = () => "paper";
  private boundChatId: string | null = null;
  private readonly explicitAllowlist: string[];
  private dashMsg = new Map<string, number>();
  private pending = new Map<string, PendingStep>();
  readonly settingsStore = new UserSettingsStore();

  constructor(private config: AppConfig) {
    this.explicitAllowlist = [...config.allowedChatIds];
    if (config.TELEGRAM_CHAT_ID) this.boundChatId = config.TELEGRAM_CHAT_ID;
  }

  async loadSettings(): Promise<UserBotSettings> {
    return this.settingsStore.load(this.config.COPY_TRADE_SOL);
  }

  getSettings(): UserBotSettings {
    return this.settingsStore.get();
  }

  start(
    handler: CommandHandler,
    opts?: {
      stateProvider?: StateProvider;
      modeLabel?: ModeLabelProvider;
      livePositionsProvider?: LivePositionsProvider;
      onSettingsChanged?: SettingsChangedHandler;
    },
  ): void {
    this.handler = handler;
    this.stateProvider = opts?.stateProvider ?? null;
    this.livePositionsProvider = opts?.livePositionsProvider ?? null;
    this.onSettingsChanged = opts?.onSettingsChanged ?? null;
    if (opts?.modeLabel) this.modeLabel = opts.modeLabel;

    if (!this.config.TELEGRAM_BOT_TOKEN) {
      logger.warn("TELEGRAM_BOT_TOKEN assente: notifiche disabilitate (solo console)");
      return;
    }

    void this.loadBoundChat();

    this.bot = new TelegramBot(this.config.TELEGRAM_BOT_TOKEN, { polling: true });

    void this.bot.setMyCommands([
      { command: "start", description: "Onboarding / menu FOMO Mirror" },
      { command: "setup", description: "Rifai setup API Key + budget" },
      { command: "menu", description: "Menu principale" },
      { command: "profitall", description: "Report PnL sessione + 24h/3d/7d/30d" },
      { command: "closeall", description: "Liquida tutto e reset sessione Fomo" },
      { command: "wallets", description: "Lista target Fomo" },
      { command: "status", description: "Stato rapido" },
      { command: "pause", description: "Pausa acquisti" },
      { command: "resume", description: "Riprendi bot" },
      { command: "help", description: "Aiuto comandi" },
    ]);

    this.bot.on("message", async (msg) => {
      const chatId = String(msg.chat.id);
      const text = msg.text?.trim();
      if (!text) return;

      if (!this.isAllowed(chatId, msg.chat.type)) {
        logger.warn({ chatId }, "Chat Telegram non autorizzata");
        try {
          await this.bot?.sendMessage(
            chatId,
            "⛔ Chat non autorizzata. Aggiungi il chat_id in TELEGRAM_ALLOWED_CHAT_IDS oppure lascia la lista vuota.",
          );
        } catch {
          /* ignore */
        }
        return;
      }

      if (text.startsWith("/start") || text.toLowerCase() === "start") {
        await this.bindNotifyChat(chatId, msg.chat.type, true);
        await this.handleStart(chatId);
        return;
      }

      if (text.startsWith("/setup") || text.toLowerCase() === "setup") {
        await this.bindNotifyChat(chatId, msg.chat.type, true);
        await this.beginOnboarding(chatId);
        return;
      }

      if (text.startsWith("/menu") || text.toLowerCase() === "menu") {
        await this.bindNotifyChat(chatId, msg.chat.type, false);
        await this.openMainMenu(chatId);
        return;
      }

      const pending = this.pending.get(chatId);
      if (pending && !text.startsWith("/")) {
        await this.handlePendingInput(chatId, text, pending);
        return;
      }

      await this.bindNotifyChat(chatId, msg.chat.type, false);
      const cmd = parseTelegramCommand(text);

      try {
        if (cmd.type === "dashboard") {
          await this.openMainMenu(chatId);
          return;
        }
        if (cmd.type === "help") {
          await this.send(chatId, HELP_TEXT);
          return;
        }
        if (cmd.type === "unknown") {
          await this.send(chatId, `Comando non riconosciuto.\n${HELP_TEXT}`);
          return;
        }
        const reply = await this.handler?.(cmd, chatId);
        if (reply) await this.send(chatId, reply);
      } catch (err) {
        logger.error({ err }, "Errore gestione comando Telegram");
        await this.send(chatId, "Errore interno durante l'esecuzione del comando.");
      }
    });

    this.bot.on("callback_query", async (q) => {
      const chatId = String(q.message?.chat.id ?? "");
      const data = q.data ?? "";
      if (!chatId || !q.id) return;
      const chatType = q.message?.chat.type ?? "private";

      if (!this.isAllowed(chatId, chatType)) {
        await this.bot?.answerCallbackQuery(q.id, { text: "Non autorizzato", show_alert: true });
        return;
      }
      await this.bindNotifyChat(chatId, chatType, false);

      try {
        await this.handleDashAction(chatId, data);
        await this.bot?.answerCallbackQuery(q.id, { text: "OK" });
      } catch (err) {
        logger.error({ err, data }, "callback dashboard fallita");
        await this.bot?.answerCallbackQuery(q.id, { text: "Errore", show_alert: true });
      }
    });

    logger.info({ bot: "WEDOTHATBOT" }, "Telegram FOMO Mirror bot avviato (polling)");
  }

  /** Entry point /start — onboarding guidato o menu inline */
  async handleStart(chatId: string): Promise<void> {
    const settings = this.settingsStore.get();
    if (!settings.onboarded) {
      await this.beginOnboarding(chatId);
      return;
    }
    await this.openMainMenu(chatId);
  }

  private async beginOnboarding(chatId: string): Promise<void> {
    this.pending.set(chatId, "await_fomo_key");
    await this.send(chatId, formatOnboardingWelcome(this.settingsStore.get()));
  }

  private async finishOnboarding(chatId: string): Promise<void> {
    this.pending.delete(chatId);
    const now = new Date().toISOString();
    const settings = await this.settingsStore.save({
      onboarded: true,
      sessionStartedAt: now,
    });
    this.applyConfigFromSettings(settings);
    await this.onSettingsChanged?.(settings);
    await this.sendMenu(chatId, formatOnboardingDone(settings), mainMenuKeyboard(true));
  }

  private applyConfigFromSettings(settings: UserBotSettings): void {
    this.config.COPY_TRADE_SOL = settings.fixedTradeSol;
    if (settings.fomoApiKey) {
      this.config.FOMO_API_KEY = settings.fomoApiKey;
      process.env.FOMO_API_KEY = settings.fomoApiKey;
    } else {
      this.config.FOMO_API_KEY = "";
    }
  }

  private async handlePendingInput(chatId: string, text: string, step: PendingStep): Promise<void> {
    if (step === "await_fomo_key" || step === "edit_fomo_key") {
      const raw = text.trim();
      const lower = raw.toLowerCase();
      const isDemo = lower === "demo" || lower === "skip" || lower === "-";
      if (!isDemo && !raw) {
        await this.send(chatId, "API Key obbligatoria (oppure invia <code>demo</code> per paper).");
        return;
      }
      const key = isDemo ? "" : raw;
      const settings = await this.settingsStore.save({
        fomoApiKey: key,
        fomoAuthenticated: Boolean(key),
      });
      this.applyConfigFromSettings(settings);
      if (step === "await_fomo_key") {
        this.pending.set(chatId, "await_budget");
        await this.send(chatId, formatAskBudget());
      } else {
        this.pending.delete(chatId);
        await this.onSettingsChanged?.(settings);
        await this.sendMenu(
          chatId,
          key ? "✅ FOMO API Key aggiornata." : "✅ Modalità demo/paper senza API Key.",
          settingsKeyboard(),
        );
      }
      return;
    }

    if (step === "await_budget" || step === "edit_budget") {
      const n = Number(text.replace(",", ".").replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n) || n <= 0) {
        await this.send(chatId, "Valore non valido. Invia un numero &gt; 0 (es. <code>0.15</code>).");
        return;
      }
      const settings = await this.settingsStore.save({ fixedTradeSol: n });
      this.applyConfigFromSettings(settings);
      if (step === "await_budget") {
        await this.finishOnboarding(chatId);
      } else {
        this.pending.delete(chatId);
        await this.onSettingsChanged?.(settings);
        await this.sendMenu(
          chatId,
          `✅ Budget fisso aggiornato: <b>${n} SOL</b> per ogni COPY BUY.`,
          settingsKeyboard(),
        );
      }
      return;
    }

    if (step === "add_username") {
      const u = normalizeUsername(text);
      if (!u) {
        await this.send(chatId, "Username non valido. Esempio: <code>@PoorGoat_</code>");
        return;
      }
      const cur = this.settingsStore.get();
      const next = [...new Set([...cur.fomoUsernames.map((x) => x.toLowerCase()), u.toLowerCase()])];
      // preserve original casing of new one
      const merged = [
        ...cur.fomoUsernames.filter((x) => x.toLowerCase() !== u.toLowerCase()),
        u,
      ];
      void next;
      const settings = await this.settingsStore.save({ fomoUsernames: merged });
      this.pending.delete(chatId);
      await this.onSettingsChanged?.(settings);
      await this.sendMenu(chatId, `✅ Aggiunto <b>@${u}</b> ai target Fomo.`, settingsKeyboard());
    }
  }

  private async handleDashAction(chatId: string, action: string): Promise<void> {
    const settings = this.settingsStore.get();
    const state = this.requireState();

    switch (action) {
      case "dash_onboard":
        await this.beginOnboarding(chatId);
        return;
      case "dash_refresh":
      case "dash_back":
        await this.openMainMenu(chatId);
        return;
      case "dash_pause":
        await this.handler?.({ type: "pause", reason: "Telegram dashboard" }, chatId);
        await this.openMainMenu(chatId);
        return;
      case "dash_resume":
        await this.handler?.({ type: "resume" }, chatId);
        await this.openMainMenu(chatId);
        return;
      case "dash_live_positions": {
        const rows = this.livePositionsProvider
          ? await this.livePositionsProvider()
          : [];
        await this.sendMenu(chatId, formatLivePositionsReport(rows, settings), mainMenuKeyboard(true));
        return;
      }
      case "dash_stats":
        await this.sendMenu(chatId, formatWinLossStats(state, settings), mainMenuKeyboard(true));
        return;
      case "dash_profitall": {
        const reply = await this.handler?.({ type: "profitall" }, chatId);
        if (reply) await this.sendMenu(chatId, reply, mainMenuKeyboard(settings.onboarded));
        return;
      }
      case "dash_closeall": {
        const reply = await this.handler?.({ type: "closeall" }, chatId);
        if (reply) await this.send(chatId, reply);
        await this.openMainMenu(chatId);
        return;
      }
      case "dash_settings":
        await this.sendMenu(chatId, formatSettingsPanel(settings, state), settingsKeyboard());
        return;
      case "dash_set_budget":
        this.pending.set(chatId, "edit_budget");
        await this.send(
          chatId,
          "💰 Invia il nuovo <b>budget fisso in SOL</b> per ogni trade (es. <code>0.15</code>):",
        );
        return;
      case "dash_set_fomo_key":
        this.pending.set(chatId, "edit_fomo_key");
        await this.send(chatId, "🔑 Invia la nuova <b>FOMO API Key / session token</b> (o <code>skip</code>):");
        return;
      case "dash_add_username":
        this.pending.set(chatId, "add_username");
        await this.send(
          chatId,
          "👤 Invia lo <b>username Fomo</b> da tracciare (es. <code>@PoorGoat_</code>):",
        );
        return;
      case "dash_wallets":
        await this.sendMenu(
          chatId,
          [
            formatWalletsPanel(state),
            "",
            `<b>Target usernames:</b> ${settings.fomoUsernames.map((u) => `@${u}`).join(", ") || "—"}`,
          ].join("\n"),
          settingsKeyboard(),
        );
        return;
      case "dash_help":
        await this.send(chatId, HELP_TEXT);
        return;
      default:
        await this.openMainMenu(chatId);
    }
  }

  async openMainMenu(chatId: string): Promise<void> {
    const settings = this.settingsStore.get();
    const state = this.requireState();
    const html = [
      "📟 <b>FOMO MIRROR — Menu</b>",
      `• Stato: <b>${state.status}</b> · ${this.modeLabel()}`,
      `• Budget/trade fisso: <b>${settings.fixedTradeSol} SOL</b>`,
      `• Target: ${settings.fomoUsernames.map((u) => `@${u}`).join(", ") || "—"}`,
      `• Open: <b>${state.openPositions.length}</b> · PnL netto: <b>${state.realizedPnlSol.toFixed(4)} SOL</b>`,
      "",
      "Scegli un'azione:",
    ].join("\n");
    await this.sendMenu(chatId, html, mainMenuKeyboard(settings.onboarded));
  }

  private requireState(): BotRuntimeState {
    if (!this.stateProvider) throw new Error("stateProvider assente");
    return this.stateProvider();
  }

  private async sendMenu(
    chatId: string,
    html: string,
    keyboard: TelegramBot.InlineKeyboardMarkup,
  ): Promise<void> {
    const existing = this.dashMsg.get(chatId);
    if (existing && this.bot) {
      try {
        await this.bot.editMessageText(html, {
          chat_id: chatId,
          message_id: existing,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: keyboard,
        });
        return;
      } catch {
        /* fallback send new */
      }
    }
    if (!this.bot) return;
    const msg = await this.bot.sendMessage(chatId, html, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: keyboard,
    });
    this.dashMsg.set(chatId, msg.message_id);
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
  }

  private async loadBoundChat(): Promise<void> {
    try {
      const raw = await fs.readFile(CHAT_FILE, "utf8");
      const parsed = JSON.parse(raw) as { chatId?: string };
      if (parsed.chatId) {
        this.boundChatId = parsed.chatId;
        this.config.TELEGRAM_CHAT_ID = parsed.chatId;
        logger.info({ chatId: parsed.chatId }, "Chat notifiche Telegram ripristinata");
      }
    } catch {
      /* no file yet */
    }
  }

  private async bindNotifyChat(chatId: string, chatType: string, force: boolean): Promise<void> {
    if (chatType !== "private" && chatType !== "group" && chatType !== "supergroup") return;
    if (!force && this.boundChatId) return;
    if (this.boundChatId === chatId) return;

    this.boundChatId = chatId;
    this.config.TELEGRAM_CHAT_ID = chatId;
    await fs.mkdir(path.dirname(CHAT_FILE), { recursive: true });
    await fs.writeFile(CHAT_FILE, JSON.stringify({ chatId }, null, 2), "utf8");
    logger.info({ chatId, force }, "Chat notifiche Telegram aggiornata");
  }

  private isAllowed(chatId: string, chatType: string): boolean {
    if (this.explicitAllowlist.length > 0) {
      return this.explicitAllowlist.includes(chatId);
    }
    return chatType === "private" || chatType === "group" || chatType === "supergroup";
  }

  async send(chatId: string | undefined, html: string): Promise<void> {
    const target = chatId || this.boundChatId || this.config.TELEGRAM_CHAT_ID;
    logger.info({ target, preview: html.slice(0, 120) }, "Telegram/console notify");
    if (!this.bot || !target) return;
    try {
      await this.bot.sendMessage(target, html, { parse_mode: "HTML", disable_web_page_preview: true });
    } catch (err) {
      logger.error({ err }, "Invio Telegram fallito");
    }
  }

  async notifyBuy(decision: DecisionResult, position: Position): Promise<void> {
    await this.send(undefined, formatBuyMessage(decision, position));
  }

  async notifyCopyBuy(
    position: Position,
    risk: CopyRiskProfile,
    signal: MirrorSignal,
    token: TokenCandidate,
  ): Promise<void> {
    const settings = this.settingsStore.get();
    const username = signal.wallet.username || signal.wallet.label.replace(/\s*\(.*?\)\s*/g, "");
    await this.send(
      undefined,
      formatCopyBuyMessage({
        symbol: position.symbol,
        name: position.name || token.name,
        marketCapUsd: token.marketCapUsd || position.marketCapAtEntry,
        amountSol: position.amountSol,
        entryPriceUsd: position.entryPriceUsd,
        riskPct: risk.riskPct,
        riskLabel: risk.bandLabel,
        walletLabel: signal.wallet.label,
        walletAddress: signal.wallet.address,
        username,
        rank: signal.wallet.rank,
        solUsd: settings.solUsd,
      }),
    );
  }

  async notifySell(trade: ClosedTrade): Promise<void> {
    await this.send(undefined, formatSellMessage(trade));
  }

  async notifyReject(decision: DecisionResult): Promise<void> {
    await this.send(undefined, formatRejectMessage(decision));
  }

  async notifyAlert(alert: SystemAlert): Promise<void> {
    await this.send(undefined, formatSystemAlert(alert));
  }

  async notifyStatus(params: {
    status: string;
    budget: number;
    residual: number;
    pnl: number;
    open: number;
    mode: string;
    riskTolerance: string;
    maxRiskPct: number;
    avgRisk: number;
  }): Promise<void> {
    await this.send(undefined, formatStatus(params));
  }
}
