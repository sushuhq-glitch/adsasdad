import type { LiquidityGrowthAnalysis, TokenCandidate } from "../types/index.js";
import { clamp } from "../lib/money.js";

/** Mcap/Liquidity ratio + velocità di crescita market cap. */
export function analyzeLiquidityGrowth(candidate: TokenCandidate): LiquidityGrowthAnalysis {
  const mcapLiquidityRatio =
    candidate.liquidityUsd > 0 ? candidate.marketCapUsd / candidate.liquidityUsd : Infinity;

  // Ratio sano tipico early meme: 3x-25x. Troppo alto = fragile; troppo basso = poco heat.
  let liquidityStabilityScore = 50;
  if (mcapLiquidityRatio >= 3 && mcapLiquidityRatio <= 18) liquidityStabilityScore = 80;
  else if (mcapLiquidityRatio > 18 && mcapLiquidityRatio <= 40) liquidityStabilityScore = 55;
  else if (mcapLiquidityRatio > 40) liquidityStabilityScore = 25;
  else if (mcapLiquidityRatio < 3) liquidityStabilityScore = 60;

  if (candidate.liquidityUsd < 15_000) liquidityStabilityScore -= 25;
  if (candidate.liquidityUsd >= 80_000) liquidityStabilityScore += 10;
  liquidityStabilityScore = clamp(liquidityStabilityScore, 0, 100);

  // Velocity: mcap alto in poco tempo = momentum (moonshot) ma rischio
  const mcapPerMinute =
    candidate.ageMinutes > 0 ? candidate.marketCapUsd / Math.max(candidate.ageMinutes, 1) : 0;
  let mcapVelocityScore = clamp(Math.round(Math.log10(Math.max(1, mcapPerMinute)) * 18), 0, 100);
  if (candidate.ageMinutes < 20 && candidate.marketCapUsd >= 80_000) mcapVelocityScore += 15;
  mcapVelocityScore = clamp(mcapVelocityScore, 0, 100);

  const notes = [
    `Mcap/Liq ratio ${Number.isFinite(mcapLiquidityRatio) ? mcapLiquidityRatio.toFixed(2) : "∞"}x`,
    `Liquidity stability ${liquidityStabilityScore}/100`,
    `Mcap velocity ${mcapVelocityScore}/100`,
  ];

  return {
    mcapLiquidityRatio: Number.isFinite(mcapLiquidityRatio) ? mcapLiquidityRatio : 999,
    liquidityStabilityScore,
    mcapVelocityScore,
    notes,
  };
}
