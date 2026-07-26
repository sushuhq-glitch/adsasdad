export type TradingMode = "paper" | "live";
export type ExecutionVenue = "axiom" | "anthem" | "fomo" | "pumpfun" | "paper";
export type BotStatus = "running" | "paused" | "stopped" | "error" | "awaiting_update";
export type AlertSeverity = "info" | "warning" | "critical";
export type TradeDecision = "buy" | "reject" | "hold" | "sell";

/** Tolleranza rischio runtime (Telegram / config). */
export type RiskTolerance =
  | "all"
  | "only_low"
  | "only_medium"
  | "only_high"
  | "low_medium"
  | "medium_high";

export type RiskBand = "low" | "medium" | "high";

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

export interface VolumeAnalysis {
  volumeProfileScore: number;
  spikeAnomaly: boolean;
  spikeStrength: number;
  volumeToLiquidity: number;
  notes: string[];
}

export interface SmartMoneyAnalysis {
  smartWalletInflows: number;
  developerActivityScore: number;
  topTraderOverlap: number;
  score: number;
  notes: string[];
}

export interface LiquidityGrowthAnalysis {
  mcapLiquidityRatio: number;
  liquidityStabilityScore: number;
  mcapVelocityScore: number;
  notes: string[];
}

export interface TechnicalBundle {
  volume: VolumeAnalysis;
  smartMoney: SmartMoneyAnalysis;
  liquidity: LiquidityGrowthAnalysis;
  profitPotentialScore: number;
  moonshot: boolean;
  strategicReasons: string[];
}

export interface RiskAssessment {
  /** Percentuale rischio esplicita 0-100 (es. 15 / 45 / 80). */
  riskPct: number;
  band: RiskBand;
  bandLabel: string;
  contractSafetyScore: number;
  holderConcentrationPct: number;
  liquidityStabilityScore: number;
  flags: RiskFlags;
  notes: string[];
  hardBlock: boolean;
  hardBlockReason?: string;
}

export interface SafetyAssessment {
  safetyScore: number;
  confidenceScore: number;
  riskFlags: RiskFlags;
  reasons: string[];
  blockers: string[];
  passedZeroDoubt: boolean;
  risk: RiskAssessment;
  technical: TechnicalBundle;
}

export interface DecisionResult {
  decision: TradeDecision;
  candidate: TokenCandidate;
  assessment: SafetyAssessment;
  motivation: string;
  amountSol?: number;
  rejectedAs?: string;
  highProfitPotential?: boolean;
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
  riskPct: number;
  riskBand: RiskBand;
  highProfitPotential: boolean;
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
  label: string;
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
  riskTolerance: RiskTolerance;
  maxRiskPct: number;
  averageOpenRiskPct: number;
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
