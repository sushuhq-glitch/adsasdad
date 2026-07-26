import type { TokenCandidate } from "../types/index.js";
import { clamp } from "../lib/money.js";
import type { CopyRiskProfile, TrackedWallet } from "./types.js";

/** Risk % copy-trading: Low≈20 / Medium≈55 / High≈85. */
export function scoreCopyRisk(wallet: TrackedWallet, token: TokenCandidate | null): CopyRiskProfile {
  let riskPct = 55;
  const notes: string[] = [];

  // Affidabilità wallet (PnL rank / winrate)
  const rel = wallet.reliabilityScore ?? 50;
  riskPct -= (rel - 50) * 0.35;
  notes.push(`Wallet reliability ${rel}/100`);

  if ((wallet.rank ?? 99) <= 10) {
    riskPct -= 8;
    notes.push("Top 10 PnL FOMO");
  } else if ((wallet.rank ?? 99) <= 50) {
    riskPct -= 3;
  }

  const liq = token?.liquidityUsd ?? 0;
  if (liq < 15_000) {
    riskPct += 20;
    notes.push("Liquidità bassa");
  } else if (liq < 40_000) {
    riskPct += 10;
  } else if (liq >= 100_000) {
    riskPct -= 8;
  }

  // proxy rug: token molto nuovo + liq sottile
  let rugRiskScore = 40;
  if ((token?.ageMinutes ?? 999) < 20) rugRiskScore += 25;
  if (liq < 25_000) rugRiskScore += 20;
  if ((token?.marketCapUsd ?? 0) > 0 && liq > 0 && token!.marketCapUsd / liq > 40) {
    rugRiskScore += 15;
  }
  rugRiskScore = clamp(rugRiskScore, 5, 95);
  riskPct += (rugRiskScore - 40) * 0.25;
  notes.push(`Rug proxy ${rugRiskScore}/100`);

  riskPct = clamp(Math.round(riskPct), 10, 92);

  let band: CopyRiskProfile["band"] = "medium";
  if (riskPct <= 35) {
    band = "low";
    riskPct = Math.round(20 * 0.55 + riskPct * 0.45);
  } else if (riskPct >= 70) {
    band = "high";
    riskPct = Math.round(85 * 0.55 + riskPct * 0.45);
  } else {
    riskPct = Math.round(55 * 0.55 + riskPct * 0.45);
  }
  riskPct = clamp(riskPct, 15, 90);

  const bandLabel =
    band === "low"
      ? `Rischio Basso (${riskPct}%)`
      : band === "high"
        ? `Rischio Alto (${riskPct}%)`
        : riskPct >= 60
          ? `Rischio Medio (${riskPct}%)`
          : `Rischio Medio (${riskPct}%)`;

  return {
    riskPct,
    band,
    bandLabel,
    walletReliability: rel,
    liquidityUsd: liq,
    rugRiskScore,
    notes,
  };
}
