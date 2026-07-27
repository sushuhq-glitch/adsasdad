export type MirrorSide = "buy" | "sell";

export interface TrackedWallet {
  address: string;
  label: string;
  /** Username Fomo (senza @), es. PoorGoat_ */
  username?: string;
  rank?: number;
  realizedPnlUsd?: number;
  winRatePct?: number;
  source: "fomo" | "manual" | "seed";
  reliabilityScore: number; // 0-100
  enabled: boolean;
  addedAt: string;
  lastSeenAt?: string;
  lastTxSignature?: string;
}

export interface MirrorSignal {
  side: MirrorSide;
  wallet: TrackedWallet;
  mint: string;
  signature: string;
  slot?: number;
  detectedAt: string;
  /** frazione venduta 0-1 se sell */
  sellFraction?: number;
  amountSolEstimate?: number;
  latencyMs?: number;
}

export interface CopyRiskProfile {
  riskPct: number;
  band: "low" | "medium" | "high";
  bandLabel: string;
  walletReliability: number;
  liquidityUsd: number;
  rugRiskScore: number;
  notes: string[];
}
