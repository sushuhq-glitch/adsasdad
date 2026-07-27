import type TelegramBot from "node-telegram-bot-api";
import type { BotRuntimeState } from "../types/index.js";
import { fmtSol, fmtUsd } from "../lib/money.js";

export type DashAction =
  | "dash_refresh"
  | "dash_pause"
  | "dash_resume"
  | "dash_positions"
  | "dash_closed"
  | "dash_alerts"
  | "dash_wallets"
  | "dash_risk_menu"
  | "dash_risk_all"
  | "dash_risk_low"
  | "dash_risk_high"
  | "dash_risk_max70"
  | "dash_risk_max85"
  | "dash_help";

export function dashboardKeyboard(riskMenu = false): TelegramBot.InlineKeyboardMarkup {
  if (riskMenu) {
    return {
      inline_keyboard: [
        [
          { text: "🟢 Solo Low", callback_data: "dash_risk_low" },
          { text: "🔥 Solo High", callback_data: "dash_risk_high" },
          { text: "♾ All", callback_data: "dash_risk_all" },
        ],
        [
          { text: "Max 70%", callback_data: "dash_risk_max70" },
          { text: "Max 85%", callback_data: "dash_risk_max85" },
        ],
        [{ text: "⬅️ Torna alla Dashboard", callback_data: "dash_refresh" }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        { text: "🔄 Refresh", callback_data: "dash_refresh" },
        { text: "⏸ Pausa", callback_data: "dash_pause" },
        { text: "▶️ Resume", callback_data: "dash_resume" },
      ],
      [
        { text: "📈 Posizioni", callback_data: "dash_positions" },
        { text: "💰 Chiuse / PnL", callback_data: "dash_closed" },
        { text: "⚠️ Avvisi", callback_data: "dash_alerts" },
      ],
      [
        { text: "👛 Wallets FOMO", callback_data: "dash_wallets" },
        { text: "🎚 Risk mode", callback_data: "dash_risk_menu" },
        { text: "❓ Help", callback_data: "dash_help" },
      ],
    ],
  };
}

export function formatDashboard(state: BotRuntimeState, modeLabel: string): string {
  const statusIcon =
    state.status === "running" ? "🟢" : state.status === "paused" ? "🟡" : state.status === "awaiting_update" ? "🟠" : "🔴";

  const openLines = state.openPositions.slice(0, 5).map((p) => {
    const tag = p.highProfitPotential ? "🚀" : "•";
    return `${tag} <b>$${p.symbol}</b> ${p.amountSol.toFixed(3)} SOL · risk ${p.riskPct}% · TP ${p.takeProfitPct}%`;
  });

  return [
    "📟 <b>DASHBOARD TELEGRAM — Max Profit H24</b>",
    `${statusIcon} Stato: <b>${state.status}</b> · Mode: ${modeLabel}`,
    `💼 Budget: <b>${state.budgetSol.toFixed(3)} SOL</b> · Residuo: <b>${state.residualBudgetSol.toFixed(3)} SOL</b>`,
    `📊 PnL realizzato: <b>${fmtSol(state.realizedPnlSol)}</b> · Non realizzato: <b>${fmtSol(state.unrealizedPnlSol)}</b>`,
    `🎯 Risk: <b>${state.riskTolerance}</b> · Max <b>${state.maxRiskPct}%</b> · Medio open <b>${state.averageOpenRiskPct.toFixed(1)}%</b>`,
    `📂 Posizioni aperte: <b>${state.openPositions.length}</b> · Chiuse: <b>${state.closedTrades.length}</b>`,
    `🛡 Rifiuti recenti: <b>${state.rejectedTrades.length}</b> · Alert aperti: <b>${state.alerts.filter((a) => a.requiresUpdate && !a.acknowledged).length}</b>`,
    state.lastScanAt ? `⏱ Ultimo scan: ${state.lastScanAt}` : "⏱ Nessuno scan ancora",
    "",
    "<b>Trade attivi (mirror)</b>",
    ...(openLines.length ? openLines : ["• Nessuna posizione aperta"]),
    "",
    `<b>FOMO Top wallets tracciati:</b> ${state.trackedWallets.filter((w) => w.enabled).length}/${state.trackedWallets.length}`,
    `🪞 Mirror BUY: <b>${state.mirrorBuys}</b> · SELL: <b>${state.mirrorSells}</b>`,
    state.lastMirrorAt ? `⏱ Ultimo mirror: ${state.lastMirrorAt}` : "⏱ In ascolto WebSocket/poll…",
    "",
    "Usa i pulsanti sotto · /wallets list · /wallets refresh",
  ].join("\n");
}

export function formatWalletsPanel(state: BotRuntimeState): string {
  const rows = state.trackedWallets.slice(0, 20);
  if (!rows.length) return "👛 <b>Wallet tracciati</b>\nNessun wallet. Usa /wallets refresh";
  return [
    "👛 <b>TOP WALLET FOMO / COPY LIST</b>",
    ...rows.map((w, i) => {
      const short = `${w.address.slice(0, 4)}…${w.address.slice(-4)}`;
      const pnl =
        w.realizedPnlUsd != null ? ` · PnL $${Math.round(w.realizedPnlUsd).toLocaleString("en-US")}` : "";
      return `${w.enabled ? "🟢" : "⚪"} ${i + 1}. <b>${escapeHtml(w.label)}</b> (${short})${pnl} · rel ${w.reliabilityScore}`;
    }),
  ].join("\n");
}

export function formatPositionsPanel(state: BotRuntimeState): string {
  if (!state.openPositions.length) return "📈 <b>Posizioni</b>\nNessuna posizione aperta.";
  const lines = state.openPositions.map((p, i) => {
    return [
      `${i + 1}. <b>$${p.symbol}</b> (${p.name})`,
      `   Entry ${fmtUsd(p.entryPriceUsd, 6)} · ${p.amountSol.toFixed(4)} SOL`,
      `   Risk ${p.riskPct}% (${p.riskBand}) · ${p.highProfitPotential ? "MOONSHOT" : "standard"}`,
      `   ${escapeHtml(p.motivation.slice(0, 140))}`,
    ].join("\n");
  });
  return ["📈 <b>POSIZIONI APERTE</b>", ...lines].join("\n\n");
}

export function formatClosedPanel(state: BotRuntimeState): string {
  const rows = state.closedTrades.slice(0, 8);
  if (!rows.length) return "💰 <b>Storico</b>\nNessuna chiusura ancora.";
  const lines = rows.map((t) => {
    const sign = t.pnlSol >= 0 ? "+" : "";
    return `• <b>$${t.position.symbol}</b> ${sign}${t.pnlPct.toFixed(1)}% · ${fmtSol(t.pnlSol)} (${t.pnlUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(t.pnlUsd))}) · ${t.reason}`;
  });
  return [
    "💰 <b>CHIUSURE / PnL</b>",
    `Totale realizzato: <b>${fmtSol(state.realizedPnlSol)}</b>`,
    ...lines,
  ].join("\n");
}

export function formatAlertsPanel(state: BotRuntimeState): string {
  const rows = state.alerts.slice(0, 8);
  if (!rows.length) return "⚠️ <b>Avvisi</b>\nNessun avviso.";
  return [
    "⚠️ <b>AVVISI & AGGIORNAMENTI</b>",
    ...rows.map((a) => {
      const flag = a.requiresUpdate && !a.acknowledged ? "🔔" : "•";
      return `${flag} <b>${escapeHtml(a.title)}</b>\n   ${escapeHtml(a.message.slice(0, 160))}`;
    }),
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
