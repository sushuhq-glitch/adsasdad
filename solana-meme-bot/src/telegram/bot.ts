import { promises as fs } from "node:fs";
import path from "node:path";
import TelegramBot from "node-telegram-bot-api";
import type { AppConfig } from "../config/schema.js";
import type { BotRuntimeState, ClosedTrade, DecisionResult, Position, SystemAlert } from "../types/index.js";
import { logger } from "../lib/logger.js";
import { HELP_TEXT, parseTelegramCommand, type TelegramCommand } from "./commands.js";
import {
  dashboardKeyboard,
  formatAlertsPanel,
  formatClosedPanel,
  formatDashboard,
  formatPositionsPanel,
  type DashAction,
} from "./dashboard.js";
import {
  formatBuyMessage,
  formatRejectMessage,
  formatSellMessage,
  formatStatus,
  formatSystemAlert,
} from "./formatter.js";

export type CommandHandler = (cmd: TelegramCommand, chatId: string) => Promise<string | void>;
export type StateProvider = () => BotRuntimeState;
export type ModeLabelProvider = () => string;

const CHAT_FILE = path.resolve("data/telegram-chat.json");

export class TelegramService {
  private bot: TelegramBot | null = null;
  private handler: CommandHandler | null = null;
  private stateProvider: StateProvider | null = null;
  private modeLabel: ModeLabelProvider = () => "paper";
  private boundChatId: string | null = null;
  /** chatId -> last dashboard message id for edit-in-place */
  private dashMsg = new Map<string, number>();

  constructor(private config: AppConfig) {
    if (config.TELEGRAM_CHAT_ID) this.boundChatId = config.TELEGRAM_CHAT_ID;
  }

  start(
    handler: CommandHandler,
    opts?: { stateProvider?: StateProvider; modeLabel?: ModeLabelProvider },
  ): void {
    this.handler = handler;
    this.stateProvider = opts?.stateProvider ?? null;
    if (opts?.modeLabel) this.modeLabel = opts.modeLabel;

    if (!this.config.TELEGRAM_BOT_TOKEN) {
      logger.warn("TELEGRAM_BOT_TOKEN assente: notifiche disabilitate (solo console)");
      return;
    }

    void this.loadBoundChat();

    this.bot = new TelegramBot(this.config.TELEGRAM_BOT_TOKEN, { polling: true });

    void this.bot.setMyCommands([
      { command: "start", description: "Apri dashboard Telegram" },
      { command: "dashboard", description: "Pannello controllo H24" },
      { command: "status", description: "Stato rapido" },
      { command: "pause", description: "Pausa acquisti" },
      { command: "resume", description: "Riprendi bot" },
      { command: "budget", description: "Cambia budget SOL" },
      { command: "risk", description: "Tolleranza / max risk %" },
      { command: "help", description: "Aiuto comandi" },
    ]);

    this.bot.on("message", async (msg) => {
      const chatId = String(msg.chat.id);
      const text = msg.text?.trim();
      if (!text) return;

      await this.maybeBindChat(chatId, msg.chat.type);

      if (!this.isAllowed(chatId)) {
        logger.warn({ chatId }, "Chat Telegram non autorizzata");
        await this.send(chatId, "⛔ Chat non autorizzata. Contatta l'owner del bot.");
        return;
      }

      const cmd = parseTelegramCommand(text);
      try {
        if (cmd.type === "start" || cmd.type === "dashboard") {
          await this.openDashboard(chatId);
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
        // dopo azioni utili, aggiorna/riapri dashboard
        if (["pause", "resume", "budget", "risk_tolerance", "risk_max", "status"].includes(cmd.type)) {
          await this.openDashboard(chatId);
        }
      } catch (err) {
        logger.error({ err }, "Errore gestione comando Telegram");
        await this.send(chatId, "Errore interno durante l'esecuzione del comando.");
      }
    });

    this.bot.on("callback_query", async (q) => {
      const chatId = String(q.message?.chat.id ?? "");
      const data = (q.data ?? "") as DashAction;
      if (!chatId || !q.id) return;

      await this.maybeBindChat(chatId, q.message?.chat.type ?? "private");
      if (!this.isAllowed(chatId)) {
        await this.bot?.answerCallbackQuery(q.id, { text: "Non autorizzato", show_alert: true });
        return;
      }

      try {
        await this.handleDashAction(chatId, data);
        await this.bot?.answerCallbackQuery(q.id, { text: "OK" });
      } catch (err) {
        logger.error({ err, data }, "callback dashboard fallita");
        await this.bot?.answerCallbackQuery(q.id, { text: "Errore", show_alert: true });
      }
    });

    logger.info({ bot: "WEDOTHATBOT" }, "Telegram bot + dashboard avviato (polling)");
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
        if (!this.config.allowedChatIds.includes(parsed.chatId)) {
          this.config.allowedChatIds.push(parsed.chatId);
        }
        logger.info({ chatId: parsed.chatId }, "Chat Telegram ripristinata");
      }
    } catch {
      /* no file yet */
    }
  }

  private async maybeBindChat(chatId: string, chatType: string): Promise<void> {
    if (this.boundChatId) return;
    if (chatType !== "private" && chatType !== "group" && chatType !== "supergroup") return;
    // Prima chat che scrive diventa owner se non c'è chat configurata
    this.boundChatId = chatId;
    this.config.TELEGRAM_CHAT_ID = chatId;
    if (!this.config.allowedChatIds.includes(chatId)) this.config.allowedChatIds.push(chatId);
    await fs.mkdir(path.dirname(CHAT_FILE), { recursive: true });
    await fs.writeFile(CHAT_FILE, JSON.stringify({ chatId }, null, 2), "utf8");
    logger.info({ chatId }, "Chat Telegram associata automaticamente");
  }

  private isAllowed(chatId: string): boolean {
    // Se non abbiamo ancora unbound owner, accetta il primo (binding in corso)
    if (!this.boundChatId && this.config.allowedChatIds.length === 0) return true;
    if (this.config.allowedChatIds.length === 0) {
      return !this.boundChatId || this.boundChatId === chatId;
    }
    return this.config.allowedChatIds.includes(chatId);
  }

  private async handleDashAction(chatId: string, action: DashAction): Promise<void> {
    switch (action) {
      case "dash_refresh":
        await this.openDashboard(chatId);
        return;
      case "dash_pause":
        await this.handler?.({ type: "pause", reason: "Telegram dashboard" }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_resume":
        await this.handler?.({ type: "resume" }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_positions":
        await this.sendPanel(chatId, formatPositionsPanel(this.requireState()), true);
        return;
      case "dash_closed":
        await this.sendPanel(chatId, formatClosedPanel(this.requireState()), true);
        return;
      case "dash_alerts":
        await this.sendPanel(chatId, formatAlertsPanel(this.requireState()), true);
        return;
      case "dash_risk_menu":
        await this.openDashboard(chatId, true);
        return;
      case "dash_risk_all":
        await this.handler?.({ type: "risk_tolerance", tolerance: "all" }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_risk_low":
        await this.handler?.({ type: "risk_tolerance", tolerance: "only_low" }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_risk_high":
        await this.handler?.({ type: "risk_tolerance", tolerance: "only_high" }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_risk_max70":
        await this.handler?.({ type: "risk_max", maxRiskPct: 70 }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_risk_max85":
        await this.handler?.({ type: "risk_max", maxRiskPct: 85 }, chatId);
        await this.openDashboard(chatId);
        return;
      case "dash_help":
        await this.send(chatId, HELP_TEXT);
        return;
      default:
        await this.openDashboard(chatId);
    }
  }

  private requireState(): BotRuntimeState {
    if (!this.stateProvider) throw new Error("stateProvider assente");
    return this.stateProvider();
  }

  async openDashboard(chatId: string, riskMenu = false): Promise<void> {
    const html = formatDashboard(this.requireState(), this.modeLabel());
    const keyboard = dashboardKeyboard(riskMenu);
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

  private async sendPanel(chatId: string, html: string, withBack = false): Promise<void> {
    await this.bot?.sendMessage(chatId, html, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: withBack
        ? { inline_keyboard: [[{ text: "⬅️ Dashboard", callback_data: "dash_refresh" }]] }
        : undefined,
    });
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
