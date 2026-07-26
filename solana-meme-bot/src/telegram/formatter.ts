import type { ClosedTrade, DecisionResult, Position, SystemAlert } from "../types/index.js";
import { fmtSol, fmtUsd } from "../lib/money.js";

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
    `• Prezzo d'Ingresso (Entry Price): ${fmtUsd(position.entryPriceUsd, 6)}`,
    `• 🔥 LIVELLO DI RISCHIO TRADE: ${risk.riskPct}% (${risk.bandLabel})`,
    `• Motivazione Strategica: ${escapeHtml(decision.motivation)}`,
    `• Profit potential: ${decision.assessment.technical.profitPotentialScore}/100`,
  ].join("\n");
}

export function formatSellMessage(trade: ClosedTrade): string {
  const sign = trade.pnlSol >= 0 ? "📈" : "📉";
  const reasonLabel: Record<ClosedTrade["reason"], string> = {
    take_profit: "Take Profit Raggiunto",
    stop_loss: "Stop Loss scattato",
    trailing_stop: "Trailing Stop",
    manual: "Vendita manuale",
    risk_exit: "Uscita per rischio",
  };
  return [
    `${sign} <b>AGGIORNAMENTO CHIUSURA POSIZIONE / PnL</b>`,
    `• Token: $${trade.position.symbol}`,
    `• Prezzo di Uscita (Sell Price): ${fmtUsd(trade.sellPriceUsd, 6)}`,
    `• ${reasonLabel[trade.reason]}: ${trade.pnlPct >= 0 ? "+" : ""}${trade.pnlPct.toFixed(2)}%`,
    `• Rischio Trade in ingresso: ${trade.position.riskPct}%`,
    `• Profit/Loss Netto: ${fmtSol(trade.pnlSol)} (${trade.pnlUsd >= 0 ? "+" : "-"}${fmtUsd(Math.abs(trade.pnlUsd))})`,
  ].join("\n");
}

export function formatRejectMessage(decision: DecisionResult): string {
  return [
    "🛡 <b>Trade Rifiutato - Filtri Risk/Strategy</b>",
    `• Token: $${decision.candidate.symbol}`,
    `• Market Cap: ${fmtUsd(decision.candidate.marketCapUsd, 0)}`,
    `• Rischio stimato: ${decision.assessment.risk.riskPct}% (${decision.assessment.risk.bandLabel})`,
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
      '• Modifica rischio max: <code>/risk max 70</code> · tolleranza: <code>/risk only_high</code> · oppure <code>/update &lt;istruzione&gt;</code>.',
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
  riskTolerance: string;
  maxRiskPct: number;
  avgRisk: number;
}): string {
  return [
    "🤖 <b>STATUS BOT (Max Profit H24)</b>",
    `• Stato: ${params.status}`,
    `• Mode: ${params.mode}`,
    `• Budget: ${params.budget.toFixed(4)} SOL`,
    `• Residuo: ${params.residual.toFixed(4)} SOL`,
    `• PnL realizzato: ${fmtSol(params.pnl)}`,
    `• Posizioni aperte: ${params.open}`,
    `• Tolleranza rischio: ${params.riskTolerance}`,
    `• Max risk %: ${params.maxRiskPct}%`,
    `• Rischio medio open: ${params.avgRisk.toFixed(1)}%`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
