import type { BotRuntimeState, ClosedTrade, Position } from "../types/index.js";
import { formatPrice, fmtSol, fmtUsd } from "../lib/money.js";
import { formatUsername, type UserBotSettings } from "./user-settings.js";

export interface LivePositionRow {
  position: Position;
  livePriceUsd: number;
  liveMarketCapUsd: number;
  pnlPct: number;
  pnlSol: number;
}

export interface ProfitWindowStats {
  label: string;
  pnlSol: number;
  wins: number;
  losses: number;
  winRate: number;
}

export function formatOnboardingWelcome(settings: UserBotSettings): string {
  return [
    "👋 <b>Benvenuto su WEDOTHAT — FOMO Copy Trading</b>",
    "",
    "Configuriamo il bot in 2 step <b>obbligatori</b>:",
    "1️⃣ <b>Token sessione Fomo</b> (= chiave <code>privy:token</code> dal browser)",
    "2️⃣ <b>Budget fisso per trade</b> (SOL)",
    "",
    settings.onboarded
      ? `Stato attuale: budget <b>${settings.fixedTradeSol} SOL</b>/trade · target ${settings.fomoUsernames.map(formatUsername).join(", ")}`
      : "Sessione non attiva — setup richiesto.",
    "",
    "🔐 <b>Come copiare privy:token</b> (sei già loggato con Google su Fomo):",
    "1. Su <a href=\"https://fomo.family\">fomo.family</a> premi <b>F12</b> → scheda <b>Console</b>",
    "2. Incolla questo comando e premi Invio:",
    "<code>copy(JSON.parse(localStorage.getItem('privy:token')))</code>",
    "3. Il token è negli appunti → <b>incollalo qui</b> su Telegram",
    "",
    "⚠️ Non condividere il token (né password Google). Non chiederemo mai email/password.",
    "Oppure invia <code>demo</code> per paper senza sessione.",
  ].join("\n");
}

export function formatAskBudget(): string {
  return [
    "✅ Sessione Fomo collegata (<code>privy:token</code>).",
    "",
    "Ora invia il <b>budget fisso per ogni operazione</b> in SOL.",
    "Esempi: <code>0.15</code> · <code>0.25</code> · <code>1</code>",
    "",
    "Questo importo verrà usato su <b>ogni COPY BUY</b>, indipendentemente da quanto compra il target Fomo.",
  ].join("\n");
}

export function formatOnboardingDone(settings: UserBotSettings): string {
  return [
    "🎯 <b>Setup completato — sessione attiva</b>",
    `• Budget/trade: <b>${settings.fixedTradeSol} SOL</b> (~${fmtUsd(settings.fixedTradeSol * settings.solUsd)})`,
    `• Fomo: ${settings.fomoAuthenticated ? "autenticato" : "demo/paper"}`,
    `• Target: ${settings.fomoUsernames.map(formatUsername).join(", ") || "—"}`,
    "",
    "Usa i pulsanti sotto · /closeall · /profitall",
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
        { text: "📈 /profitall", callback_data: "dash_profitall" },
        { text: "🚨 /closeall", callback_data: "dash_closeall" },
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
      [{ text: "🚨 Close all + reset", callback_data: "dash_closeall" }],
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
      `<b>$${p.symbol}</b> • Entry Price: ${formatPrice(p.entryPriceUsd)} | Live Price: ${formatPrice(r.livePriceUsd)}`,
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
    `• Sessione corrente: <b>${fmtSol(state.sessionRealizedPnlSol)}</b>`,
    `• Unrealized (open): <b>${fmtSol(state.unrealizedPnlSol)}</b>`,
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
    return `• $${t.position.symbol} ${sign}${t.pnlPct.toFixed(1)}% · ${fmtSol(t.pnlSol)} · entry ${formatPrice(t.position.entryPriceUsd)} · ${t.reason}`;
  });
}

export function formatSettingsPanel(settings: UserBotSettings, state: BotRuntimeState): string {
  return [
    "⚙️ <b>SETTINGS</b>",
    `• Stato bot: <b>${state.status}</b>`,
    `• Sessione: <b>${state.copySessionActive ? "attiva" : "inattiva"}</b>`,
    `• Budget/trade: <b>${settings.fixedTradeSol} SOL</b>`,
    `• SOL/USD ref: ${settings.solUsd}`,
    `• FOMO API: ${settings.fomoAuthenticated ? "••••" + (settings.fomoApiKey.slice(-4) || "demo") : "non autenticata"}`,
    `• Target usernames: ${settings.fomoUsernames.map(formatUsername).join(", ") || "—"}`,
    "",
    "Usa i pulsanti per modificare budget, API key o lista @username.",
  ].join("\n");
}

export function formatCloseAllReport(params: {
  symbols: string[];
  pnlSol: number;
  solUsd: number;
}): string {
  const list =
    params.symbols.length > 0
      ? params.symbols.map((s) => `$${s}`).join(", ")
      : "nessuna";
  const usd = params.pnlSol * params.solUsd;
  const usdSign = usd >= 0 ? "+" : "-";
  return [
    "🚨 <b>CHIUSURA TOTALE POSIZIONI ESEGUITA (/closeall)</b>",
    `• Posizioni Chiuse: <b>${params.symbols.length}</b> token (${escapeHtml(list)})`,
    "• Esito Vendite: Liquidation eseguita al prezzo live.",
    `• PnL Totale Sessione: <b>${fmtSol(params.pnlSol)}</b> (${usdSign}${fmtUsd(Math.abs(usd))})`,
    "",
    "🔒 <b>SISTEMA RESETTATO</b>",
    "• Sessione Fomo terminata. Invia /start per ripartire.",
  ].join("\n");
}

export function formatProfitAllReport(params: {
  sessionPnlSol: number;
  sessionWins: number;
  sessionLosses: number;
  sessionWinRate: number;
  windows: ProfitWindowStats[];
  solUsd: number;
}): string {
  const sUsd = params.sessionPnlSol * params.solUsd;
  const sUsdSign = sUsd >= 0 ? "+" : "-";
  const lines = [
    "📈 <b>REPORT COMPLETO PROFIT &amp; LOSS (/profitall)</b>",
    "",
    "💰 <b>PNL SESSIONE CORRENTE</b>",
    `• Profit/Loss Netto: <b>${fmtSol(params.sessionPnlSol)}</b> (${sUsdSign}${fmtUsd(Math.abs(sUsd))})`,
    `• Win Rate Sessione: <b>${params.sessionWinRate.toFixed(0)}%</b> (${params.sessionWins} Win / ${params.sessionLosses} Loss)`,
    "",
    "🌐 <b>PNL STORICO ACCOUNT (TOTALE GLOBAL)</b>",
  ];
  for (const w of params.windows) {
    const usd = w.pnlSol * params.solUsd;
    const usdSign = usd >= 0 ? "+" : "-";
    lines.push(
      `• ${w.label}: <b>${fmtSol(w.pnlSol)}</b> (${usdSign}${fmtUsd(Math.abs(usd))}) | Win Rate: <b>${w.winRate.toFixed(0)}%</b>`,
    );
  }
  return lines.join("\n");
}

export function summarizeTrades(trades: ClosedTrade[]): {
  pnlSol: number;
  wins: number;
  losses: number;
  winRate: number;
} {
  const wins = trades.filter((t) => t.pnlSol > 0).length;
  const losses = trades.filter((t) => t.pnlSol <= 0).length;
  const total = wins + losses;
  const pnlSol = trades.reduce((a, t) => a + t.pnlSol, 0);
  return {
    pnlSol,
    wins,
    losses,
    winRate: total > 0 ? (wins / total) * 100 : 0,
  };
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
