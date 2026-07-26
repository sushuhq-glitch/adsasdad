import type { ClosedTrade, DecisionResult, Position, SystemAlert } from "../types/index.js";
import { fmtSol, fmtUsd } from "../lib/money.js";

export function formatBuyMessage(decision: DecisionResult, position: Position): string {
  const c = decision.candidate;
  return [
    "🚀 <b>NUOVA OPERAZIONE ESEGUITA</b>",
    `• Token: $${c.symbol} (Solana)`,
    `• Nome: ${c.name}`,
    `• Market Cap: ${fmtUsd(c.marketCapUsd, 0)}`,
    `• Importo Investito: ${position.amountSol.toFixed(4)} SOL`,
    `• Entry Price: ${fmtUsd(position.entryPriceUsd, 6)}`,
    `• Motivazione: ${escapeHtml(decision.motivation)}`,
    `• Safety: ${decision.assessment.safetyScore}/100 | Confidence: ${decision.assessment.confidenceScore}/100`,
  ].join("\n");
}

export function formatSellMessage(trade: ClosedTrade): string {
  const sign = trade.pnlSol >= 0 ? "📈" : "📉";
  const reasonLabel: Record<ClosedTrade["reason"], string> = {
    take_profit: "Take Profit",
    stop_loss: "Stop Loss scattato",
    trailing_stop: "Trailing Stop",
    manual: "Vendita manuale",
    risk_exit: "Uscita per rischio",
  };
  return [
    `${sign} <b>AGGIORNAMENTO VENDITA / PnL</b>`,
    `• Token: $${trade.position.symbol}`,
    `• Sell Price: ${fmtUsd(trade.sellPriceUsd, 6)}`,
    `• Motivo: ${reasonLabel[trade.reason]}`,
    `• ${reasonLabel[trade.reason] === "Take Profit" ? "Take Profit" : "Variazione"}: ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`,
    `• Net Profit/Loss: ${fmtSol(trade.pnlSol)} (${trade.pnlUsd >= 0 ? "+" : ""}${fmtUsd(Math.abs(trade.pnlUsd))})`,
  ].join("\n");
}

export function formatRejectMessage(decision: DecisionResult): string {
  return [
    "🛡 <b>Trade Rifiutato - Rischio Rilevato</b>",
    `• Token: $${decision.candidate.symbol}`,
    `• Market Cap: ${fmtUsd(decision.candidate.marketCapUsd, 0)}`,
    `• Safety: ${decision.assessment.safetyScore}/100 | Confidence: ${decision.assessment.confidenceScore}/100`,
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
    lines.push(
      '• Rispondi con: <code>/update &lt;istruzione&gt;</code> oppure aggiorna la configurazione `.env`.',
    );
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
}): string {
  return [
    "🤖 <b>STATUS BOT</b>",
    `• Stato: ${params.status}`,
    `• Mode: ${params.mode}`,
    `• Budget: ${params.budget.toFixed(4)} SOL`,
    `• Residuo: ${params.residual.toFixed(4)} SOL`,
    `• PnL realizzato: ${fmtSol(params.pnl)}`,
    `• Posizioni aperte: ${params.open}`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
