import type { ClosedTrade, DecisionResult, Position, SystemAlert } from "../types/index.js";
import { formatPrice, fmtSol, fmtUsd } from "../lib/money.js";
import { formatUsername } from "./user-settings.js";

export function formatBuyMessage(decision: DecisionResult, position: Position): string {
  const c = decision.candidate;
  const risk = decision.assessment.risk;
  const header = decision.highProfitPotential
    ? "🚀 <b>NUOVA OPERAZIONE ESEGUITA (HIGH PROFIT POTENTIAL)</b>"
    : "🚀 <b>NUOVA OPERAZIONE ESEGUITA</b>";

  return [
    header,
    `• Token: $${c.symbol} (Solana)`,
    `• Nome: ${c.name}`,
    `• Market Cap: ${fmtUsd(c.marketCapUsd, 0)}`,
    `• Importo Investito: ${position.amountSol.toFixed(4)} SOL`,
    `• Prezzo d'Ingresso (Entry Price): ${formatPrice(position.entryPriceUsd)}`,
    `• 🔥 LIVELLO DI RISCHIO TRADE: ${risk.riskPct}% (${risk.bandLabel})`,
    `• Motivazione Strategica: ${escapeHtml(decision.motivation)}`,
  ].join("\n");
}

export function formatSellMessage(trade: ClosedTrade): string {
  if (trade.reason === "copy_sell") {
    return formatCopySellMessage(trade);
  }
  const sign = trade.pnlSol >= 0 ? "📈" : "📉";
  const reasonLabel: Record<ClosedTrade["reason"], string> = {
    take_profit: "Take Profit di emergenza",
    stop_loss: "Stop Loss di emergenza",
    trailing_stop: "Trailing Stop",
    manual: "Vendita manuale",
    risk_exit: "Uscita per rischio",
    copy_sell: "Copy sell",
  };
  const entry = trade.position.entryPriceUsd;
  const movePct = entry > 0 ? ((trade.sellPriceUsd - entry) / entry) * 100 : trade.pnlPct;
  return [
    `${sign} <b>AGGIORNAMENTO CHIUSURA POSIZIONE / PnL</b>`,
    `• Token: $${trade.position.symbol}`,
    `• Entry Price: ${formatPrice(entry)}`,
    `• Prezzo di Uscita (Sell Price): ${formatPrice(trade.sellPriceUsd)}`,
    `• Variazione prezzo: <b>${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}%</b>`,
    `• ${reasonLabel[trade.reason]}: ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`,
    `• Profit/Loss Netto: <b>${fmtSol(trade.pnlSol)}</b> (${trade.pnlUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(trade.pnlUsd))})`,
  ].join("\n");
}

export function formatCopyBuyMessage(params: {
  symbol: string;
  name: string;
  marketCapUsd: number;
  amountSol: number;
  entryPriceUsd: number;
  riskPct: number;
  riskLabel: string;
  walletLabel: string;
  walletAddress: string;
  username?: string;
  rank?: number;
  solUsd: number;
}): string {
  const target =
    params.username || params.walletLabel
      ? `${formatUsername(params.username || params.walletLabel)}${params.rank ? ` (Rank #${params.rank})` : ""}`
      : params.walletLabel;
  return [
    "🚀 <b>ACQUISTO AUTOMATICO ESEGUITO</b>",
    `• Token: $${params.symbol} (Solana)`,
    `• Market Cap (Entry): ${fmtUsd(params.marketCapUsd, 0)}`,
    `• Target Fomo: ${escapeHtml(target)}`,
    `• Budget Allocato: <b>${params.amountSol.toFixed(4)} SOL</b> (~${fmtUsd(params.amountSol * params.solUsd)})`,
    `• Entry Price: ${formatPrice(params.entryPriceUsd)}`,
  ].join("\n");
}

export function formatCopySellMessage(trade: ClosedTrade): string {
  const wallet = trade.position.copyFromLabel || "Wallet tracciato";
  const entry = trade.position.entryPriceUsd;
  const exit = trade.sellPriceUsd;
  const movePct = entry > 0 ? ((exit - entry) / entry) * 100 : trade.pnlPct;
  const sign = trade.pnlSol >= 0 ? "📈" : "📉";
  return [
    "⚡ <b>VENDITA IMMEDIATA ESEGUITA (COPY SELL)</b>",
    `• Token: $${trade.position.symbol} (Solana)`,
    `• Target Fomo: ${escapeHtml(wallet)}`,
    `• Entry Price: ${formatPrice(entry)}`,
    `• Sell Price: ${formatPrice(exit)}`,
    `• Variazione prezzo: <b>${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}%</b>`,
    `• Motivo: 🚨 Vendita del target Fomo — mirror immediato`,
    `${sign} Profit/Loss Netto: <b>${fmtSol(trade.pnlSol)}</b> (${trade.pnlUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(trade.pnlUsd))}) [<b>${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%</b>]`,
    trade.copyLatencyNote ? `• ${escapeHtml(trade.copyLatencyNote)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatRejectMessage(decision: DecisionResult): string {
  return [
    "🛡 <b>Trade Rifiutato</b>",
    `• Token: $${decision.candidate.symbol}`,
    `• Market Cap: ${fmtUsd(decision.candidate.marketCapUsd, 0)}`,
    `• Motivo: ${escapeHtml(decision.motivation)}`,
  ].join("\n");
}

export function formatSystemAlert(alert: SystemAlert): string {
  const icon = alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";
  const lines = [
    `${icon} <b>NOTIFICA SISTEMA</b>`,
    `• ${escapeHtml(alert.title)}`,
    `• ${escapeHtml(alert.message)}`,
  ];
  if (alert.requiresUpdate) {
    lines.push("• Usa /start → ⚙️ Settings oppure /update &lt;istruzione&gt;.");
  }
  return lines.join("\n");
}

export function formatStatus(params: {
  status: string;
  budget: number;
  residual: number;
  pnl: number;
  open: number;
  mode: string;
  riskTolerance: string;
  maxRiskPct: number;
  avgRisk: number;
}): string {
  return [
    "🤖 <b>STATUS BOT</b>",
    `• Stato: ${params.status}`,
    `• Mode: ${params.mode}`,
    `• Budget residuo: ${params.residual.toFixed(4)} SOL`,
    `• PnL realizzato: ${fmtSol(params.pnl)}`,
    `• Posizioni aperte: ${params.open}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
