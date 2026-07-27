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
    "👋 <b>WEDOTHAT — FOMO REAL COPY TRADING</b>",
    "",
    "Il bot opera in <b>REAL TRADING</b> direttamente sul tuo account Fomo.",
    "Setup obbligatorio in 2 step:",
    "1️⃣ <b>FOMO API Key</b> (= <code>privy:token</code> dal browser, già loggato)",
    "2️⃣ <b>Budget fisso per trade</b> (SOL) — verificato contro il saldo reale",
    "",
    settings.onboarded
      ? `Sessione attiva: budget <b>${settings.fixedTradeSol} SOL</b>/trade · target ${settings.fomoUsernames.map(formatUsername).join(", ")}`
      : "Sessione non attiva — setup richiesto.",
    "",
    "🔐 <b>Come copiare la FOMO API Key</b>:",
    "1. Su <a href=\"https://fomo.family\">fomo.family</a> premi <b>F12</b> → <b>Console</b>",
    "2. Incolla e Invio:",
    "<code>copy(JSON.parse(localStorage.getItem('privy:token')))</code>",
    "3. Incolla qui su Telegram il token (<code>eyJ...</code>)",
    "",
    "⚠️ Non condividere il token. La modalità demo è disabilitata.",
  ].join("\n");
}

export function formatAskBudget(availableSol?: number, solUsd = 150): string {
  const lines = [
    "✅ FOMO API Key ricevuta — recupero saldo reale…",
    "",
  ];
  if (availableSol != null && Number.isFinite(availableSol)) {
    lines.push(
      `💳 <b>Saldo disponibile reale:</b> ${availableSol.toFixed(4)} SOL (~${fmtUsd(availableSol * solUsd)})`,
      "",
    );
  }
  lines.push(
    "Ora invia il <b>budget fisso per ogni operazione</b> in SOL.",
    "Esempi: <code>0.15</code> · <code>0.25</code> · <code>1</code>",
    "",
    "Questo importo verrà usato su <b>ogni COPY BUY REALE</b> sul tuo account Fomo.",
    "Se il budget &gt; saldo disponibile, l'operatività verrà bloccata.",
  );
  return lines.join("\n");
}

export function formatRealConnected(params: {
  availableSol: number;
  budgetSol: number;
  solUsd: number;
  handle?: string;
}): string {
  const trades =
    params.budgetSol > 0 ? Math.floor(params.availableSol / params.budgetSol + 1e-9) : 0;
  const ok = params.availableSol + 1e-9 >= params.budgetSol;
  return [
    "✅ <b>CONNESSO A FOMO (REAL TRADING ACCOUNT)</b>",
    params.handle ? `• Handle: <b>@${escapeHtml(params.handle)}</b>` : "",
    `💳 Saldo Disponibile Reale: <b>${params.availableSol.toFixed(4)} SOL</b> (~${fmtUsd(params.availableSol * params.solUsd)})`,
    `⚙️ Budget Impostato per Trade: <b>${params.budgetSol.toFixed(4)} SOL</b>`,
    ok
      ? `Status Solvibilità: OK 🟢 (Copertura per ${trades} trade)`
      : "Status Solvibilità: BLOCCATO 🔴 (budget &gt; saldo)",
    "",
    "⚠️ NOTA: I dati della modalità Demo sono stati eliminati.",
    "Il bot è ora in ascolto sulla Leaderboard Fomo ed eseguirà <b>TRANSAZIONI REALI</b> sul tuo account.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatOnboardingDone(settings: UserBotSettings): string {
  return formatRealConnected({
    availableSol: settings.lastKnownAvailableSol ?? 0,
    budgetSol: settings.fixedTradeSol,
    solUsd: settings.solUsd,
  });
}

export function formatInsolvent(budgetSol: number, availableSol: number, solUsd: number): string {
  return [
    "🛑 <b>OPERATIVITÀ BLOCCATA — SALDO INSUFFICIENTE</b>",
    `• Budget richiesto: <b>${budgetSol.toFixed(4)} SOL</b> (~${fmtUsd(budgetSol * solUsd)})`,
    `• Saldo Fomo reale: <b>${availableSol.toFixed(4)} SOL</b> (~${fmtUsd(availableSol * solUsd)})`,
    "",
    "Riduci il budget oppure deposita fondi su Fomo, poi reinviarlo qui.",
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
        { text: "💰 Balance", callback_data: "dash_balance" },
        { text: "📊 Posizioni aperte", callback_data: "dash_live_positions" },
      ],
      [
        { text: "📈 Win/Loss Stats", callback_data: "dash_stats" },
        { text: "📈 /profitall", callback_data: "dash_profitall" },
      ],
      [
        { text: "🚨 /closeall", callback_data: "dash_closeall" },
        { text: "👛 Target Fomo", callback_data: "dash_wallets" },
      ],
      [
        { text: "⚙️ Settings", callback_data: "dash_settings" },
        { text: "🔄 Refresh", callback_data: "dash_refresh" },
      ],
      [
        { text: "⏸ Pausa", callback_data: "dash_pause" },
        { text: "▶️ Resume", callback_data: "dash_resume" },
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
      [{ text: "🏦 Imposta wallet Solana", callback_data: "dash_set_wallet" }],
      [{ text: "➕ Aggiungi @username", callback_data: "dash_add_username" }],
      [{ text: "🚨 Close all + reset", callback_data: "dash_closeall" }],
      [{ text: "⬅️ Menu", callback_data: "dash_refresh" }],
    ],
  };
}

export function formatBalanceReport(params: {
  mode: string;
  budgetSol: number;
  residualSol: number;
  openPositionsSol: number;
  unrealizedPnlSol: number;
  realizedPnlSol: number;
  sessionPnlSol: number;
  openCount: number;
  solUsd: number;
  onChainSol: number | null;
  walletAddress: string | null;
  fomo?: {
    ok: boolean;
    handle?: string;
    cashUsd?: number;
    availableSol?: number;
    portfolioUsd?: number;
    positionsUsd?: number;
    positionsCount?: number;
    solanaAddress?: string;
    error?: string;
  } | null;
}): string {
  const lines: string[] = [
    "💰 <b>BALANCE — REAL FOMO</b>",
    `• Mode: <b>${escapeHtml(params.mode)}</b>`,
    "",
  ];

  lines.push("🟣 <b>Real Fomo Balance</b>");
  if (params.fomo?.ok) {
    if (params.fomo.handle) lines.push(`• Handle: <b>@${escapeHtml(params.fomo.handle)}</b>`);
    if (params.fomo.availableSol != null) {
      lines.push(
        `• Disponibile: <b>${params.fomo.availableSol.toFixed(4)} SOL</b> (~${fmtUsd(params.fomo.availableSol * params.solUsd)})`,
      );
    }
    if (params.fomo.cashUsd != null) {
      lines.push(`• Cash USD: <b>${fmtUsd(params.fomo.cashUsd)}</b>`);
    }
    if (params.fomo.positionsUsd != null) {
      lines.push(
        `• Posizioni token: <b>${fmtUsd(params.fomo.positionsUsd)}</b>${
          params.fomo.positionsCount != null ? ` (${params.fomo.positionsCount})` : ""
        }`,
      );
    }
    if (params.fomo.portfolioUsd != null) {
      lines.push(`• Portfolio totale: <b>${fmtUsd(params.fomo.portfolioUsd)}</b>`);
    }
    if (params.fomo.solanaAddress) {
      const a = params.fomo.solanaAddress;
      lines.push(`• Wallet FOMO Solana: <code>${escapeHtml(a.slice(0, 4))}…${escapeHtml(a.slice(-4))}</code>`);
    }
  } else {
    lines.push(
      `• ${escapeHtml(params.fomo?.error || "Sessione FOMO non disponibile")}`,
      "• Aggiorna FOMO API Key da /start se scaduta.",
    );
  }

  lines.push(
    "",
    "<b>Sessione copy REAL</b>",
    `• Budget/trade: <b>${params.budgetSol.toFixed(4)} SOL</b>`,
    `• Residuo sessione: <b>${params.residualSol.toFixed(4)} SOL</b>`,
    `• In posizioni aperte: <b>${params.openPositionsSol.toFixed(4)} SOL</b> (${params.openCount})`,
    `• Unrealized PnL: <b>${fmtSol(params.unrealizedPnlSol)}</b>`,
    `• PnL realizzato sessione: <b>${fmtSol(params.sessionPnlSol)}</b>`,
    `• PnL realizzato totale: <b>${fmtSol(params.realizedPnlSol)}</b>`,
  );

  if (params.walletAddress && params.onChainSol != null) {
    lines.push(
      "",
      "<b>On-chain Solana (lettura)</b>",
      `• Wallet: <code>${escapeHtml(params.walletAddress.slice(0, 4))}…${escapeHtml(params.walletAddress.slice(-4))}</code>`,
      `• Balance: <b>${params.onChainSol.toFixed(4)} SOL</b>`,
    );
  }
  return lines.join("\n");
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
    `• Wallet Solana: ${settings.solanaAddress ? settings.solanaAddress.slice(0, 4) + "…" + settings.solanaAddress.slice(-4) : "non impostato"}`,
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
  realFomoBalanceSol?: number | null;
}): string {
  const sUsd = params.sessionPnlSol * params.solUsd;
  const sUsdSign = sUsd >= 0 ? "+" : "-";
  const lines = [
    "📈 <b>REPORT COMPLETO — DATI REALI FOMO (/profitall)</b>",
    "",
  ];
  if (params.realFomoBalanceSol != null) {
    lines.push(
      "💳 <b>REAL FOMO BALANCE</b>",
      `• Estratto in live: <b>${params.realFomoBalanceSol.toFixed(4)} SOL</b> (~${fmtUsd(params.realFomoBalanceSol * params.solUsd)})`,
      "",
    );
  }
  lines.push(
    "💰 <b>PNL SESSIONE CORRENTE (trade REALI)</b>",
    `• Profit/Loss Netto: <b>${fmtSol(params.sessionPnlSol)}</b> (${sUsdSign}${fmtUsd(Math.abs(sUsd))})`,
    `• Win Rate Sessione: <b>${params.sessionWinRate.toFixed(0)}%</b> (${params.sessionWins} Win / ${params.sessionLosses} Loss)`,
    "",
    "🌐 <b>PNL STORICO TRADE REALI</b>",
  );
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
