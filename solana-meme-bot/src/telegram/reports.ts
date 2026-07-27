import type { BotRuntimeState, ClosedTrade, Position } from "../types/index.js";
import { fmtSol, fmtUsd } from "../lib/money.js";
import { formatUsername, type UserBotSettings } from "./user-settings.js";

export interface LivePositionRow {
  position: Position;
  livePriceUsd: number;
  liveMarketCapUsd: number;
  pnlPct: number;
  pnlSol: number;
}

export function formatOnboardingWelcome(settings: UserBotSettings): string {
  return [
    "👋 <b>Benvenuto su WEDOTHAT — FOMO Copy Trading</b>",
    "",
    "Configuriamo il bot in 2 step:",
    "1️⃣ <b>API Key / Token sessione Fomo</b>",
    "2️⃣ <b>Budget fisso per trade</b> (SOL) — usato SEMPRE, non l'amount del target",
    "",
    settings.onboarded
      ? `Stato attuale: budget <b>${settings.fixedTradeSol} SOL</b>/trade · target ${settings.fomoUsernames.map(formatUsername).join(", ")}`
      : "Non ancora configurato.",
    "",
    "Invia ora la tua <b>FOMO_API_KEY</b> (oppure <code>skip</code> per continuare in paper/demo).",
  ].join("\n");
}

export function formatAskBudget(): string {
  return [
    "✅ API Key salvata (o saltata).",
    "",
    "Ora invia il <b>budget fisso per ogni operazione</b> in SOL.",
    "Esempi: <code>0.15</code> · <code>0.25</code> · <code>1</code>",
    "",
    "Questo importo verrà usato su <b>ogni COPY BUY</b>, indipendentemente da quanto compra il target Fomo.",
  ].join("\n");
}

export function formatOnboardingDone(settings: UserBotSettings): string {
  return [
    "🎯 <b>Setup completato</b>",
    `• Budget/trade: <b>${settings.fixedTradeSol} SOL</b> (~${fmtUsd(settings.fixedTradeSol * settings.solUsd)})`,
    `• Fomo API: ${settings.fomoApiKey ? "configurata" : "non impostata (paper/demo)"}`,
    `• Target: ${settings.fomoUsernames.map(formatUsername).join(", ") || "—"}`,
    "",
    "Usa i pulsanti sotto per monitorare posizioni, stats e settings.",
  ].join("\n");
}

export function mainMenuKeyboard(onboarded: boolean): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  if (!onboarded) {
    return {
      inline_keyboard: [
        [{ text: "🚀 Completa setup", callback_data: "dash_onboard" }],
        [{ text: "❓ Help", callback_data: "dash_help" }],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "📊 Posizioni aperte", callback_data: "dash_live_positions" },
        { text: "📈 Win/Loss Stats", callback_data: "dash_stats" },
      ],
      [
        { text: "👛 Target Fomo", callback_data: "dash_wallets" },
        { text: "⚙️ Settings", callback_data: "dash_settings" },
      ],
      [
        { text: "⏸ Pausa", callback_data: "dash_pause" },
        { text: "▶️ Resume", callback_data: "dash_resume" },
        { text: "🔄 Refresh", callback_data: "dash_refresh" },
      ],
    ],
  };
}

export function settingsKeyboard(): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
} {
  return {
    inline_keyboard: [
      [{ text: "💰 Cambia budget/trade", callback_data: "dash_set_budget" }],
      [{ text: "🔑 Cambia FOMO API Key", callback_data: "dash_set_fomo_key" }],
      [{ text: "➕ Aggiungi @username", callback_data: "dash_add_username" }],
      [{ text: "⬅️ Menu", callback_data: "dash_refresh" }],
    ],
  };
}

export function formatLivePositionsReport(
  rows: LivePositionRow[],
  settings: UserBotSettings,
): string {
  if (!rows.length) {
    return [
      "📊 <b>POSIZIONI APERTE IN TEMPO REALE</b>",
      "Nessuna posizione aperta.",
      `Budget/trade: ${settings.fixedTradeSol} SOL`,
    ].join("\n");
  }

  const lines = rows.map((r) => {
    const p = r.position;
    const emoji = r.pnlPct >= 0 ? "🟢" : "🔴";
    const target = p.copyFromLabel ? escapeHtml(p.copyFromLabel) : "—";
    const sign = r.pnlPct >= 0 ? "+" : "";
    const pnlSign = r.pnlSol >= 0 ? "+" : "";
    return [
      `<b>$${p.symbol}</b> • Entry Price: ${fmtUsd(p.entryPriceUsd, 6)} | Live Price: ${fmtUsd(r.livePriceUsd, 6)}`,
      `• Market Cap Live: ${fmtUsd(r.liveMarketCapUsd, 0)}`,
      `• PnL Corrente: <b>${sign}${r.pnlPct.toFixed(2)}%</b> ${emoji} (${pnlSign}${Math.abs(r.pnlSol).toFixed(4)} SOL)`,
      `• Target Copiato: ${target}`,
    ].join("\n");
  });

  return ["📊 <b>POSIZIONI APERTE IN TEMPO REALE</b>", ...lines].join("\n\n");
}

export function formatWinLossStats(state: BotRuntimeState, settings: UserBotSettings): string {
  const closed = state.closedTrades;
  const wins = closed.filter((t) => t.pnlSol > 0).length;
  const losses = closed.filter((t) => t.pnlSol <= 0).length;
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  return [
    "📈 <b>WIN/LOSS STATS GLOBALI</b>",
    `• Win Rate Totale: <b>${winRate.toFixed(0)}%</b> (${wins} Win / ${losses} Loss)`,
    `• PnL Netto Totale: <b>${fmtSol(state.realizedPnlSol)}</b>`,
    `• Unrealized (open): <b>${fmtSol(state.unrealizedPnlSol)}</b>`,
    `• Mirror BUY/SELL: ${state.mirrorBuys}/${state.mirrorSells}`,
    `• Budget fisso/trade: <b>${settings.fixedTradeSol} SOL</b> (~${fmtUsd(settings.fixedTradeSol * settings.solUsd)})`,
    "",
    "<b>Ultime uscite</b>",
    ...formatRecentExits(closed.slice(0, 8)),
  ].join("\n");
}

function formatRecentExits(trades: ClosedTrade[]): string[] {
  if (!trades.length) return ["• Nessuna chiusura ancora"];
  return trades.map((t) => {
    const sign = t.pnlPct >= 0 ? "+" : "";
    return `• $${t.position.symbol} ${sign}${t.pnlPct.toFixed(1)}% · ${fmtSol(t.pnlSol)} · ${t.reason}`;
  });
}

export function formatSettingsPanel(settings: UserBotSettings, state: BotRuntimeState): string {
  return [
    "⚙️ <b>SETTINGS</b>",
    `• Stato bot: <b>${state.status}</b>`,
    `• Budget/trade: <b>${settings.fixedTradeSol} SOL</b>`,
    `• SOL/USD ref: ${settings.solUsd}`,
    `• FOMO API Key: ${settings.fomoApiKey ? "••••" + settings.fomoApiKey.slice(-4) : "non impostata"}`,
    `• Target usernames: ${settings.fomoUsernames.map(formatUsername).join(", ") || "—"}`,
    "",
    "Usa i pulsanti per modificare budget, API key o lista @username.",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
