import type { TokenCandidate, VolumeAnalysis } from "../types/index.js";
import { clamp } from "../lib/money.js";

/** Volume Profile + Spike Anomaly per memecoin emergenti. */
export function analyzeVolume(candidate: TokenCandidate): VolumeAnalysis {
  const volumeToLiquidity =
    candidate.liquidityUsd > 0 ? candidate.volume24hUsd / candidate.liquidityUsd : 0;

  // Spike: volume/liq molto alto su token giovane = anomaly (può essere moonshot o wash)
  const spikeAnomaly = volumeToLiquidity >= 8 || (candidate.ageMinutes < 40 && volumeToLiquidity >= 4);
  const spikeStrength = clamp(Math.round(volumeToLiquidity * 10), 0, 100);

  let volumeProfileScore = 40;
  if (volumeToLiquidity >= 1 && volumeToLiquidity <= 12) volumeProfileScore += 25;
  if (volumeToLiquidity > 12 && volumeToLiquidity <= 30) volumeProfileScore += 15; // aggressivo ma usabile
  if (volumeToLiquidity > 30) volumeProfileScore -= 10; // wash sospetto
  if (candidate.volume24hUsd >= 50_000) volumeProfileScore += 15;
  if (candidate.volume24hUsd >= 200_000) volumeProfileScore += 10;
  volumeProfileScore = clamp(volumeProfileScore, 0, 100);

  const notes: string[] = [
    `Vol/Liq ${volumeToLiquidity.toFixed(2)}x`,
    `Volume 24h $${Math.round(candidate.volume24hUsd).toLocaleString("en-US")}`,
  ];
  if (spikeAnomaly) notes.push(`Spike anomaly strength ${spikeStrength}/100`);

  return {
    volumeProfileScore,
    spikeAnomaly,
    spikeStrength,
    volumeToLiquidity,
    notes,
  };
}
