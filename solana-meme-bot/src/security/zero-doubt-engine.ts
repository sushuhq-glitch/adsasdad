import type { AppConfig } from "../config/schema.js";
import type {
  DecisionResult,
  RiskFlags,
  SafetyAssessment,
  TokenCandidate,
  TrendSignal,
} from "../types/index.js";
import { clamp } from "../lib/money.js";
import { ContractAnalyzer } from "./contract-analyzer.js";
import { anyDoubt, emptyRiskFlags, flagLabels } from "./risk-flags.js";

/**
 * Motore "Zero Dubbi":
 * - Acquista SOLO se safety + confidence >= soglie
 * - Qualsiasi flag di rischio => reject ("Trade Rifiutato - Rischio Rilevato")
 */
export class ZeroDoubtEngine {
  private readonly contracts: ContractAnalyzer;

  constructor(private readonly config: AppConfig) {
    this.contracts = new ContractAnalyzer(config.SOLANA_RPC_URL);
  }

  async evaluate(candidate: TokenCandidate, trends: TrendSignal[] = []): Promise<DecisionResult> {
    const contract = await this.contracts.analyze(candidate);
    const riskFlags: RiskFlags = {
      ...emptyRiskFlags(),
      ...this.contracts.toRiskFlags(contract),
    };

    const relatedTrends = trends.filter(
      (t) =>
        (t.mint && t.mint === candidate.mint) ||
        (t.symbol && t.symbol.toUpperCase() === candidate.symbol.toUpperCase()),
    );

    if (relatedTrends.some((t) => t.conflicting || t.sentiment === "mixed")) {
      riskFlags.conflictingSocialSignals = true;
    }
    if (relatedTrends.some((t) => t.organicSearchScore < 40 && t.mentionsDeltaPct > 200)) {
      riskFlags.inorganicVolume = true;
    }

    // Volumi sospetti rispetto a liquidità
    if (candidate.liquidityUsd > 0 && candidate.volume24hUsd / candidate.liquidityUsd > 25) {
      riskFlags.inorganicVolume = true;
    }
    if (candidate.liquidityUsd < 30_000) {
      riskFlags.suspiciousLiquidity = true;
    }
    if (candidate.marketCapUsd > 0 && candidate.liquidityUsd / candidate.marketCapUsd < 0.05) {
      riskFlags.suspiciousLiquidity = true;
    }

    const safetyScore = scoreSafety(candidate, riskFlags, contract.topHolderPct);
    const confidenceScore = scoreConfidence(candidate, relatedTrends, riskFlags);

    const blockers = [
      ...flagLabels(riskFlags),
      ...contract.notes.filter((n) => /rischio|sospett|non verific|honeypot|autorit/i.test(n)),
    ];

    if (safetyScore < this.config.MIN_SAFETY_SCORE) {
      blockers.push(`Safety score ${safetyScore} < soglia ${this.config.MIN_SAFETY_SCORE}`);
    }
    if (confidenceScore < this.config.MIN_CONFIDENCE_SCORE) {
      blockers.push(`Confidence score ${confidenceScore} < soglia ${this.config.MIN_CONFIDENCE_SCORE}`);
    }

    const doubt = this.config.ZERO_DOUBT_MODE && anyDoubt(riskFlags);
    const passedZeroDoubt =
      !doubt &&
      safetyScore >= this.config.MIN_SAFETY_SCORE &&
      confidenceScore >= this.config.MIN_CONFIDENCE_SCORE &&
      blockers.length === 0;

    const assessment: SafetyAssessment = {
      safetyScore,
      confidenceScore,
      riskFlags,
      reasons: buildReasons(candidate, relatedTrends, safetyScore, confidenceScore),
      blockers: [...new Set(blockers)],
      passedZeroDoubt,
    };

    if (!passedZeroDoubt) {
      return {
        decision: "reject",
        candidate,
        assessment,
        motivation: assessment.blockers.join(" | ") || "Dubbio residuo sul trade",
        rejectedAs: "Trade Rifiutato - Rischio Rilevato",
      };
    }

    const amountSol = Math.min(this.config.MAX_POSITION_SOL, this.config.BUDGET_SOL);
    const trendBit =
      relatedTrends[0]?.summary ??
      candidate.narrative ??
      `Narrative emergente da ${candidate.source}`;

    return {
      decision: "buy",
      candidate,
      assessment,
      amountSol,
      motivation: `${trendBit} + Audit contratto superato (rug risk filtrato). Safety ${safetyScore}/100, Confidence ${confidenceScore}/100.`,
    };
  }
}

function scoreSafety(c: TokenCandidate, flags: RiskFlags, topHolderPct: number): number {
  let score = 100;
  if (flags.rugPullRisk) score -= 45;
  if (flags.mintAuthorityActive) score -= 25;
  if (flags.freezeAuthorityActive) score -= 20;
  if (flags.suspiciousLiquidity) score -= 20;
  if (flags.highWalletConcentration) score -= 15;
  if (flags.inorganicVolume) score -= 15;
  if (flags.conflictingSocialSignals) score -= 20;
  if (flags.unknownContractRisk) score -= 25;
  if (flags.apiDriftDetected) score -= 30;

  if (c.liquidityUsd >= 100_000) score += 5;
  if (c.ageMinutes >= 60) score += 5;
  if (topHolderPct < 20) score += 5;
  if (c.marketCapUsd < 50_000 || c.marketCapUsd > 5_000_000) score -= 10;

  return clamp(Math.round(score), 0, 100);
}

function scoreConfidence(c: TokenCandidate, trends: TrendSignal[], flags: RiskFlags): number {
  let score = 55;
  const organic = trends.reduce((acc, t) => acc + t.organicSearchScore, 0) / Math.max(1, trends.length);
  const mentions = c.socialMentionsDeltaPct ?? trends[0]?.mentionsDeltaPct ?? 0;

  score += Math.min(25, organic / 4);
  if (mentions >= 80 && mentions <= 400) score += 15;
  if (mentions > 400) score -= 10; // spike eccessivo = sospetto
  if (trends.some((t) => t.sentiment === "bullish") && !flags.conflictingSocialSignals) score += 10;
  if (c.liquidityUsd >= 50_000 && c.volume24hUsd >= 20_000) score += 10;
  if (anyDoubt(flags)) score -= 35;

  return clamp(Math.round(score), 0, 100);
}

function buildReasons(
  c: TokenCandidate,
  trends: TrendSignal[],
  safety: number,
  confidence: number,
): string[] {
  const reasons = [
    `Market cap ${Math.round(c.marketCapUsd)} USD`,
    `Liquidità ${Math.round(c.liquidityUsd)} USD`,
    `Safety ${safety}/100`,
    `Confidence ${confidence}/100`,
  ];
  for (const t of trends.slice(0, 2)) reasons.push(`${t.source}: ${t.summary}`);
  return reasons;
}
