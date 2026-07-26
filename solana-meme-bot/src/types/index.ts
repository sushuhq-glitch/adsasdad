export type TradingMode = "paper" | "live";
export type ExecutionVenue = "axiom" | "anthem" | "pumpfun" | "paper";
export type BotStatus = "running" | "paused" | "stopped" | "error" | "awaiting_update";
export type AlertSeverity = "info" | "warning" | "critical";
export type TradeDecision = "buy" | "reject" | "hold" | "sell";

export interface RiskFlags {
  rugPullRisk: boolean;
  suspiciousLiquidity: boolean;
  inorganicVolume: boolean;
  conflictingSocialSignals: boolean;
  highWalletConcentration: boolean;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  apiDriftDetected: boolean;
  unknownContractRisk: boolean;
}

export interface TokenCandidate {
  mint: string;
  symbol: string;
  name: string;
  marketCapUsd: number;
  liquidityUsd: number;
  priceUsd: number;
  volume24hUsd: number;
  ageMinutes: number;
  source: string;
  narrative?: string;
  socialMentionsDeltaPct?: number;
  raw?: Record<string, unknown>;
}

export interface SafetyAssessment {
  safetyScore: number;
  confidenceScore: number;
  riskFlags: RiskFlags;
  reasons: string[];
  blockers: string[];
  passedZeroDoubt: boolean;
}

export interface DecisionResult {
  decision: TradeDecision;
  candidate: TokenCandidate;
  assessment: SafetyAssessment;
  motivation: string;
  amountSol?: number;
  rejectedAs?: string;
}

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  venue: ExecutionVenue;
  entryPriceUsd: number;
  amountSol: number;
  tokenAmount: number;
  marketCapAtEntry: number;
  openedAt: string;
  motivation: string;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct: number;
  peakPriceUsd: number;
  status: "open" | "closed";
}

export interface ClosedTrade {
  position: Position;
  sellPriceUsd: number;
  closedAt: string;
  reason: "take_profit" | "stop_loss" | "trailing_stop" | "manual" | "risk_exit";
  pnlSol: number;
  pnlUsd: number;
  pnlPct: number;
}

export interface RejectedTrade {
  at: string;
  candidate: TokenCandidate;
  assessment: SafetyAssessment;
  label: "Trade Rifiutato - Rischio Rilevato";
  motivation: string;
}

export interface SystemAlert {
  id: string;
  at: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  requiresUpdate: boolean;
  acknowledged: boolean;
  source: string;
}

export interface BotRuntimeState {
  status: BotStatus;
  startedAt: string | null;
  lastScanAt: string | null;
  tradingMode: TradingMode;
  budgetSol: number;
  residualBudgetSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  openPositions: Position[];
  closedTrades: ClosedTrade[];
  rejectedTrades: RejectedTrade[];
  alerts: SystemAlert[];
  liveInstructions: string[];
  pauseReason?: string;
}

export interface OrderRequest {
  side: "buy" | "sell";
  mint: string;
  amountSol?: number;
  tokenAmount?: number;
  slippageBps: number;
  venue: ExecutionVenue;
}

export interface OrderResult {
  ok: boolean;
  venue: ExecutionVenue;
  txSignature?: string;
  filledPriceUsd: number;
  filledAmountSol: number;
  filledTokenAmount: number;
  simulated: boolean;
  error?: string;
  raw?: Record<string, unknown>;
}

export interface TrendSignal {
  source: "dexscreener" | "youtube" | "tiktok" | "narrative" | "pumpfun";
  symbol?: string;
  mint?: string;
  score: number;
  organicSearchScore: number;
  sentiment: "bullish" | "neutral" | "bearish" | "mixed";
  mentionsDeltaPct: number;
  summary: string;
  conflicting: boolean;
  at: string;
}
