import type { SmartMoneyAnalysis, TokenCandidate } from "../types/index.js";
import { clamp } from "../lib/money.js";

/**
 * Smart Money Tracking (euristico).
 * Senza indexer holder dedicato, stima inflow da proxy: liquidità crescente,
 * volume organico e cluster di attività tipici di top trader / early wallets.
 * In produzione collegare un feed wallet (birdeye/helius/custom watchlist).
 */
export function analyzeSmartMoney(candidate: TokenCandidate): SmartMoneyAnalysis {
  const volLiq = candidate.liquidityUsd > 0 ? candidate.volume24hUsd / candidate.liquidityUsd : 0;
  const ageFactor = candidate.ageMinutes < 90 ? 1.2 : candidate.ageMinutes < 360 ? 1 : 0.7;

  // Stima "smart wallet inflows" 0-6
  let smartWalletInflows = 0;
  if (candidate.liquidityUsd >= 20_000 && volLiq >= 2) smartWalletInflows += 1;
  if (candidate.liquidityUsd >= 40_000 && volLiq >= 3) smartWalletInflows += 1;
  if ((candidate.socialMentionsDeltaPct ?? 0) >= 100 && volLiq >= 2) smartWalletInflows += 1;
  if (candidate.marketCapUsd > 0 && candidate.liquidityUsd / candidate.marketCapUsd >= 0.08) {
    smartWalletInflows += 1;
  }
  if (candidate.source === "pumpfun" && candidate.ageMinutes < 60 && volLiq >= 3) {
    smartWalletInflows += 1;
  }
  if (volLiq >= 6 && volLiq <= 20) smartWalletInflows += 1;
  smartWalletInflows = Math.min(6, Math.round(smartWalletInflows * ageFactor));

  const developerActivityScore = clamp(
    Math.round(
      (candidate.ageMinutes < 30 ? 70 : candidate.ageMinutes < 180 ? 55 : 35) +
        (candidate.name && candidate.symbol ? 10 : 0) -
        (volLiq > 40 ? 25 : 0),
    ),
    0,
    100,
  );

  const topTraderOverlap = clamp(
    Math.round(smartWalletInflows * 14 + Math.min(30, volLiq * 2)),
    0,
    100,
  );

  const score = clamp(
    Math.round(smartWalletInflows * 12 + topTraderOverlap * 0.35 + developerActivityScore * 0.25),
    0,
    100,
  );

  const notes = [
    `Smart wallet inflow stimati: ${smartWalletInflows}`,
    `Top trader overlap ${topTraderOverlap}/100`,
    `Dev activity ${developerActivityScore}/100`,
  ];

  return {
    smartWalletInflows,
    developerActivityScore,
    topTraderOverlap,
    score,
    notes,
  };
}
