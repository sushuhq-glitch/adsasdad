import type { RiskFlags } from "../types/index.js";

export function emptyRiskFlags(): RiskFlags {
  return {
    rugPullRisk: false,
    suspiciousLiquidity: false,
    inorganicVolume: false,
    conflictingSocialSignals: false,
    highWalletConcentration: false,
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    apiDriftDetected: false,
    unknownContractRisk: false,
  };
}

export function anyDoubt(flags: RiskFlags): boolean {
  return Object.values(flags).some(Boolean);
}

export function flagLabels(flags: RiskFlags): string[] {
  const map: Record<keyof RiskFlags, string> = {
    rugPullRisk: "Rugpull risk",
    suspiciousLiquidity: "Liquidità sospetta",
    inorganicVolume: "Volumi anomali non organici",
    conflictingSocialSignals: "Informazioni contrastanti dai social",
    highWalletConcentration: "Concentrazione wallet elevata",
    mintAuthorityActive: "Mint authority attiva",
    freezeAuthorityActive: "Freeze authority attiva",
    apiDriftDetected: "Drift/API non affidabile",
    unknownContractRisk: "Rischio contratto sconosciuto",
  };
  return (Object.keys(flags) as (keyof RiskFlags)[])
    .filter((k) => flags[k])
    .map((k) => map[k]);
}
