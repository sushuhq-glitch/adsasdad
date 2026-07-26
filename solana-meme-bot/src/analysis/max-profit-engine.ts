import type { AppConfig } from "../config/schema.js";
import type {
  DecisionResult,
  RiskTolerance,
  SafetyAssessment,
  TechnicalBundle,
  TokenCandidate,
  TrendSignal,
} from "../types/index.js";
import { clamp } from "../lib/money.js";
import { ContractAnalyzer } from "../security/contract-analyzer.js";
import {
  positionSizeForRisk,
  scoreTradeRisk,
  toleranceAllows,
} from "../security/risk-scorer.js";
import { analyzeLiquidityGrowth } from "./liquidity-growth.js";
import { analyzeSmartMoney } from "./smart-money.js";
import { analyzeVolume } from "./volume.js";

/**
 * Motore Max Profit Strategy:
 * - Analisi volumi / smart money / mcap-liquidity / sentiment
 * - Può entrare in Moonshot/High Yield se tolleranza rischio lo consente
 * - Assegna % rischio esplicita per ogni opportunità
 */
export class MaxProfitEngine {
  private readonly contracts: ContractAnalyzer;
  private riskTolerance: RiskTolerance;
  private maxRiskPct: number;

  constructor(private readonly config: AppConfig) {
    this.contracts = new ContractAnalyzer(config.SOLANA_RPC_URL);
    this.riskTolerance = config.RISK_TOLERANCE;
    this.maxRiskPct = config.MAX_RISK_PCT;
  }

  getRiskTolerance(): RiskTolerance {
    return this.riskTolerance;
  }

  getMaxRiskPct(): number {
    return this.maxRiskPct;
  }

  setRiskTolerance(t: RiskTolerance): void {
    this.riskTolerance = t;
  }

  setMaxRiskPct(pct: number): void {
    this.maxRiskPct = clamp(pct, 5, 95);
  }

  async evaluate(candidate: TokenCandidate, trends: TrendSignal[] = []): Promise<DecisionResult> {
    const relatedTrends = trends.filter(
      (t) =>
        (t.mint && t.mint === candidate.mint) ||
        (t.symbol && t.symbol.toUpperCase() === candidate.symbol.toUpperCase()),
    );

    const technical = this.buildTechnical(candidate, relatedTrends);
    const contract = await this.contracts.analyze(candidate);
    const risk = scoreTradeRisk({ candidate, contract, technical, config: this.config });

    const confidenceScore = scoreConfidence(candidate, relatedTrends, technical);
    const safetyScore = risk.contractSafetyScore;

    const blockers: string[] = [];
    if (risk.hardBlock) blockers.push(risk.hardBlockReason ?? "Hard risk block");
    if (risk.riskPct > this.maxRiskPct) {
      blockers.push(`Rischio ${risk.riskPct}% > max consentito ${this.maxRiskPct}%`);
    }
    if (!toleranceAllows(this.riskTolerance, risk.band)) {
      blockers.push(`Band ${risk.band} esclusa dalla tolleranza ${this.riskTolerance}`);
    }
    if (technical.profitPotentialScore < this.config.MIN_PROFIT_POTENTIAL) {
      blockers.push(
        `Profit potential ${technical.profitPotentialScore} < ${this.config.MIN_PROFIT_POTENTIAL}`,
      );
    }
    if (relatedTrends.some((t) => t.conflicting) && technical.smartMoney.smartWalletInflows < 2) {
      blockers.push("Social contrastanti senza conferma smart money");
    }

    const assessment: SafetyAssessment = {
      safetyScore,
      confidenceScore,
      riskFlags: risk.flags,
      reasons: [
        ...technical.strategicReasons,
        risk.bandLabel,
        `Profit potential ${technical.profitPotentialScore}/100`,
      ],
      blockers,
      passedZeroDoubt: blockers.length === 0,
      risk,
      technical,
    };

    if (blockers.length) {
      return {
        decision: "reject",
        candidate,
        assessment,
        motivation: blockers.join(" | "),
        rejectedAs: "Trade Rifiutato - Filtri Risk/Strategy",
        highProfitPotential: technical.moonshot,
      };
    }

    const amountSol = positionSizeForRisk(
      Math.min(this.config.MAX_POSITION_SOL, this.config.BUDGET_SOL),
      risk.riskPct,
      technical.moonshot,
    );

    const motivation = buildMotivation(technical, relatedTrends, risk.riskPct);

    return {
      decision: "buy",
      candidate,
      assessment,
      amountSol,
      motivation,
      highProfitPotential: technical.moonshot || technical.profitPotentialScore >= 75,
    };
  }

  private buildTechnical(candidate: TokenCandidate, trends: TrendSignal[]): TechnicalBundle {
    const volume = analyzeVolume(candidate);
    const smartMoney = analyzeSmartMoney(candidate);
    const liquidity = analyzeLiquidityGrowth(candidate);

    const socialBoost = trends.some((t) => t.sentiment === "bullish" && !t.conflicting) ? 12 : 0;
    const tiktok = trends.find((t) => t.source === "tiktok");
    const mentions = candidate.socialMentionsDeltaPct ?? tiktok?.mentionsDeltaPct ?? 0;

    let profitPotentialScore = clamp(
      Math.round(
        volume.volumeProfileScore * 0.28 +
          smartMoney.score * 0.32 +
          liquidity.mcapVelocityScore * 0.22 +
          Math.min(25, mentions / 12) +
          socialBoost,
      ),
      0,
      100,
    );

    const moonshot =
      (volume.spikeAnomaly && smartMoney.smartWalletInflows >= 2 && profitPotentialScore >= 70) ||
      (liquidity.mcapVelocityScore >= 70 && smartMoney.smartWalletInflows >= 3);

    if (moonshot) profitPotentialScore = clamp(profitPotentialScore + 8, 0, 100);

    const strategicReasons: string[] = [];
    if (volume.spikeAnomaly) {
      strategicReasons.push(`Spike di volume (strength ${volume.spikeStrength}/100)`);
    }
    if (smartMoney.smartWalletInflows >= 2) {
      strategicReasons.push(`Accumulo di ${smartMoney.smartWalletInflows} Smart Wallet`);
    }
    if (tiktok && tiktok.mentionsDeltaPct >= 100) {
      strategicReasons.push(`Trend TikTok in forte crescita (+${tiktok.mentionsDeltaPct}%)`);
    } else if (mentions >= 100) {
      strategicReasons.push(`Narrative social +${mentions}%`);
    }
    strategicReasons.push(
      `Mcap/Liq ${liquidity.mcapLiquidityRatio.toFixed(1)}x · velocity ${liquidity.mcapVelocityScore}/100`,
    );
    if (moonshot) strategicReasons.push("Classificato Moonshot / High Yield");

    return {
      volume,
      smartMoney,
      liquidity,
      profitPotentialScore,
      moonshot,
      strategicReasons,
    };
  }
}

function scoreConfidence(
  c: TokenCandidate,
  trends: TrendSignal[],
  technical: TechnicalBundle,
): number {
  let score = 45 + technical.profitPotentialScore * 0.35;
  if (technical.smartMoney.smartWalletInflows >= 3) score += 12;
  if (trends.some((t) => t.sentiment === "bullish")) score += 8;
  if (technical.volume.volumeToLiquidity > 35) score -= 15;
  if (c.liquidityUsd >= 40_000) score += 5;
  return clamp(Math.round(score), 0, 100);
}

function buildMotivation(
  technical: TechnicalBundle,
  trends: TrendSignal[],
  riskPct: number,
): string {
  const parts = [...technical.strategicReasons];
  const yt = trends.find((t) => t.source === "youtube" && t.sentiment === "bullish");
  if (yt) parts.push("YouTube sentiment bullish");
  return `${parts.slice(0, 3).join(" + ")} · Risk ${riskPct}%`;
}
