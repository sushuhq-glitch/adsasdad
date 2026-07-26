import TelegramBot from "node-telegram-bot-api";
import type { AppConfig } from "../config/schema.js";
import type { ClosedTrade, DecisionResult, Position, SystemAlert } from "../types/index.js";
import { logger } from "../lib/logger.js";
import { HELP_TEXT, parseTelegramCommand, type TelegramCommand } from "./commands.js";
import {
  formatBuyMessage,
  formatRejectMessage,
  formatSellMessage,
  formatStatus,
  formatSystemAlert,
} from "./formatter.js";

export type CommandHandler = (cmd: TelegramCommand, chatId: string) => Promise<string | void>;

export class TelegramService {
  private bot: TelegramBot | null = null;
  private handler: CommandHandler | null = null;

  constructor(private readonly config: AppConfig) {}

  start(handler: CommandHandler): void {
    this.handler = handler;
    if (!this.config.TELEGRAM_BOT_TOKEN) {
      logger.warn("TELEGRAM_BOT_TOKEN assente: notifiche disabilitate (solo console)");
      return;
    }

    this.bot = new TelegramBot(this.config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.bot.on("message", async (msg) => {
      const chatId = String(msg.chat.id);
      const text = msg.text?.trim();
      if (!text) return;

      if (!this.isAllowed(chatId)) {
        logger.warn({ chatId }, "Chat Telegram non autorizzata");
        return;
      }

      const cmd = parseTelegramCommand(text);
      try {
        if (cmd.type === "help" || cmd.type === "unknown") {
          await this.send(chatId, cmd.type === "help" ? HELP_TEXT : `Comando non riconosciuto.\n${HELP_TEXT}`);
          return;
        }
        const reply = await this.handler?.(cmd, chatId);
        if (reply) await this.send(chatId, reply);
      } catch (err) {
        logger.error({ err }, "Errore gestione comando Telegram");
        await this.send(chatId, "Errore interno durante l'esecuzione del comando.");
      }
    });

    logger.info("Telegram bot avviato (polling)");
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
    }
  }

  private isAllowed(chatId: string): boolean {
    if (this.config.allowedChatIds.length === 0) return true;
    return this.config.allowedChatIds.includes(chatId);
  }

  async send(chatId: string | undefined, html: string): Promise<void> {
    const target = chatId || this.config.TELEGRAM_CHAT_ID;
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
    const html = formatSystemAlert(alert);
    await this.send(undefined, html);
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
