import type { AppConfig } from "../config/schema.js";
import type {
  RiskAssessment,
  RiskBand,
  RiskFlags,
  RiskTolerance,
  TechnicalBundle,
  TokenCandidate,
} from "../types/index.js";
import { clamp } from "../lib/money.js";
import type { ContractAnalysis } from "./contract-analyzer.js";
import { emptyRiskFlags } from "./risk-flags.js";

const BAND_ANCHORS: Record<RiskBand, number> = {
  low: 15,
  medium: 45,
  high: 80,
};

export function bandLabel(band: RiskBand, riskPct: number): string {
  if (band === "low") return `Rischio Basso (${riskPct}%)`;
  if (band === "medium") {
    if (riskPct >= 55) return `Rischio Medio-Alto (${riskPct}%)`;
    return `Rischio Medio (${riskPct}%)`;
  }
  return `Rischio Alto / Moonshot (${riskPct}%)`;
}

export function bandFromPct(riskPct: number): RiskBand {
  if (riskPct <= 30) return "low";
  if (riskPct <= 60) return "medium";
  return "high";
}

export function toleranceAllows(tolerance: RiskTolerance, band: RiskBand): boolean {
  switch (tolerance) {
    case "all":
      return true;
    case "only_low":
      return band === "low";
    case "only_medium":
      return band === "medium";
    case "only_high":
      return band === "high";
    case "low_medium":
      return band === "low" || band === "medium";
    case "medium_high":
      return band === "medium" || band === "high";
    default:
      return true;
  }
}

/**
 * Calcola % rischio esplicita da contratto, concentrazione holder e stabilità liquidità.
 * Ancora i valori tipici: Low≈15, Medium≈45, High≈80.
 */
export function scoreTradeRisk(params: {
  candidate: TokenCandidate;
  contract: ContractAnalysis;
  technical: TechnicalBundle;
  config: AppConfig;
}): RiskAssessment {
  const { candidate, contract, technical } = params;
  const flags: RiskFlags = emptyRiskFlags();

  flags.mintAuthorityActive = contract.mintAuthorityActive;
  flags.freezeAuthorityActive = contract.freezeAuthorityActive;
  flags.highWalletConcentration = contract.topHolderPct >= 35;
  flags.rugPullRisk =
    contract.honeypotHeuristic ||
    contract.mintAuthorityActive ||
    (!contract.lpLockedOrBurned && candidate.liquidityUsd < 40_000);
  flags.suspiciousLiquidity = technical.liquidity.liquidityStabilityScore < 40;
  flags.unknownContractRisk = !contract.verifiedMetadata;
  flags.inorganicVolume =
    technical.volume.volumeToLiquidity > 35 ||
    (technical.volume.spikeAnomaly && technical.smartMoney.smartWalletInflows < 2);

  // Base risk from anchors + continuous adjustments
  let riskPct = 45;
  riskPct += (contract.topHolderPct - 25) * 0.7;
  riskPct += (50 - technical.liquidity.liquidityStabilityScore) * 0.35;
  riskPct += contract.mintAuthorityActive ? 18 : -5;
  riskPct += contract.freezeAuthorityActive ? 12 : 0;
  riskPct += contract.honeypotHeuristic ? 25 : 0;
  riskPct += !contract.lpLockedOrBurned ? 10 : -8;
  riskPct += technical.moonshot ? 15 : 0;
  riskPct -= Math.min(12, technical.smartMoney.smartWalletInflows * 3);
  riskPct = clamp(Math.round(riskPct), 5, 95);

  // Snap verso ancore tipiche per leggibilità report
  const band = bandFromPct(riskPct);
  const anchored = Math.round(BAND_ANCHORS[band] * 0.65 + riskPct * 0.35);
  riskPct = clamp(anchored, band === "low" ? 10 : band === "medium" ? 35 : 65, band === "low" ? 30 : band === "medium" ? 60 : 92);

  const contractSafetyScore = clamp(
    100 -
      (contract.mintAuthorityActive ? 25 : 0) -
      (contract.freezeAuthorityActive ? 20 : 0) -
      (contract.honeypotHeuristic ? 35 : 0) -
      (!contract.lpLockedOrBurned ? 15 : 0) -
      (contract.topHolderPct >= 40 ? 15 : 0),
    0,
    100,
  );

  let hardBlock = false;
  let hardBlockReason: string | undefined;
  if (candidate.liquidityUsd < 5_000) {
    hardBlock = true;
    hardBlockReason = "Liquidità insufficiente (<$5k)";
  } else if (contract.honeypotHeuristic && technical.smartMoney.smartWalletInflows === 0) {
    hardBlock = true;
    hardBlockReason = "Pattern honeypot senza smart money confirmation";
  } else if (candidate.priceUsd <= 0) {
    hardBlock = true;
    hardBlockReason = "Prezzo non disponibile";
  }

  return {
    riskPct,
    band,
    bandLabel: bandLabel(band, riskPct),
    contractSafetyScore,
    holderConcentrationPct: contract.topHolderPct,
    liquidityStabilityScore: technical.liquidity.liquidityStabilityScore,
    flags,
    notes: [
      ...contract.notes.slice(0, 3),
      `Holder concentration ~${contract.topHolderPct.toFixed(0)}%`,
      `Contract safety ${contractSafetyScore}/100`,
    ],
    hardBlock,
    hardBlockReason,
  };
}

export function positionSizeForRisk(
  maxPositionSol: number,
  riskPct: number,
  moonshot: boolean,
): number {
  // Più rischio → size più piccola; moonshot ulteriormente ridotto
  const factor = clamp(1.15 - riskPct / 100, 0.25, 1);
  const moon = moonshot ? 0.65 : 1;
  return Number((maxPositionSol * factor * moon).toFixed(4));
}
