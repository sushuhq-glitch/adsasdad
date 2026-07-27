import type { TokenCandidate } from "../types/index.js";
import { emptyRiskFlags } from "./risk-flags.js";
import { logger } from "../lib/logger.js";

export interface ContractAnalysis {
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  topHolderPct: number;
  lpLockedOrBurned: boolean;
  honeypotHeuristic: boolean;
  verifiedMetadata: boolean;
  notes: string[];
}

/**
 * Analisi prudente on-chain / euristica.
 * In assenza di RPC dedicato o indexer, applica filtri conservativi
 * e segnala rischio sconosciuto invece di "approvare" per mancanza di dati.
 */
export class ContractAnalyzer {
  constructor(private readonly rpcUrl: string) {}

  async analyze(candidate: TokenCandidate): Promise<ContractAnalysis> {
    // Tentativo soft di validare mint length/format Solana base58 (~32-44 chars)
    const looksLikeMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate.mint);
    const notes: string[] = [];

    if (!looksLikeMint) {
      notes.push("Mint address non conforme al formato Solana atteso");
    }

    // Euristiche conservative basate su metriche pubbliche del candidato.
    // Non sostituiscono un audit reale: in dubbio alzano il rischio.
    const topHolderPct = estimateConcentration(candidate);
    const lpThin = candidate.liquidityUsd < 25_000;
    const tooNew = candidate.ageMinutes < 20;
    const volumeVsLiq =
      candidate.liquidityUsd > 0 ? candidate.volume24hUsd / candidate.liquidityUsd : Infinity;

    const mintAuthorityActive = tooNew; // conservativo: token molto nuovi = rischio mint ancora attivo
    const freezeAuthorityActive = tooNew;
    const honeypotHeuristic = volumeVsLiq > 40 && candidate.liquidityUsd < 40_000;
    const lpLockedOrBurned = candidate.liquidityUsd >= 80_000 && candidate.ageMinutes > 60;
    const verifiedMetadata = Boolean(candidate.name && candidate.symbol && looksLikeMint);

    if (lpThin) notes.push("Liquidità inferiore a soglia prudenziale ($25k)");
    if (tooNew) notes.push("Token troppo recente (<20 min): autorità potenzialmente attive");
    if (honeypotHeuristic) notes.push("Pattern volume/liquidità tipico di wash o honeypot");
    if (topHolderPct >= 35) notes.push(`Concentrazione stimata top holder ~${topHolderPct.toFixed(0)}%`);
    if (!lpLockedOrBurned) notes.push("LP lock/burn non verificato con confidenza alta");

    logger.debug({ mint: candidate.mint, notes, rpcUrl: this.rpcUrl }, "Contract analysis");

    return {
      mintAuthorityActive,
      freezeAuthorityActive,
      topHolderPct,
      lpLockedOrBurned,
      honeypotHeuristic,
      verifiedMetadata,
      notes,
    };
  }

  toRiskFlags(analysis: ContractAnalysis) {
    const flags = emptyRiskFlags();
    flags.mintAuthorityActive = analysis.mintAuthorityActive;
    flags.freezeAuthorityActive = analysis.freezeAuthorityActive;
    flags.highWalletConcentration = analysis.topHolderPct >= 35;
    flags.rugPullRisk =
      analysis.honeypotHeuristic ||
      analysis.mintAuthorityActive ||
      analysis.freezeAuthorityActive ||
      !analysis.lpLockedOrBurned;
    flags.suspiciousLiquidity = !analysis.lpLockedOrBurned || analysis.notes.some((n) => n.includes("Liquidità"));
    flags.unknownContractRisk = !analysis.verifiedMetadata;
    return flags;
  }
}

function estimateConcentration(c: TokenCandidate): number {
  // Senza holder API: stima inversamente proporzionale a liquidità/età.
  const base = 55;
  const liqRelief = Math.min(30, c.liquidityUsd / 10_000);
  const ageRelief = Math.min(15, c.ageMinutes / 20);
  return Math.max(10, base - liqRelief - ageRelief);
}
