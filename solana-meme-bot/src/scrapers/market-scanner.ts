import type { AppConfig } from "../config/schema.js";
import type { TokenCandidate, TrendSignal } from "../types/index.js";
import { logger } from "../lib/logger.js";
import { DexScreenerClient } from "./dexscreener.js";
import { PumpFunScanner } from "./pumpfun.js";
import { SocialTrendScanner } from "./social-scanner.js";

export class MarketScanner {
  private readonly dex: DexScreenerClient;
  private readonly pump: PumpFunScanner;
  private readonly social: SocialTrendScanner;

  constructor(private readonly config: AppConfig) {
    this.dex = new DexScreenerClient(config.DEXSCREENER_BASE);
    this.pump = new PumpFunScanner(config.PUMPFUN_API_BASE);
    this.social = new SocialTrendScanner();
  }

  async scan(): Promise<{ candidates: TokenCandidate[]; trends: TrendSignal[] }> {
    const [dexCandidates, pumpCandidates] = await Promise.all([
      this.dex.fetchSolanaBoosts().catch((err) => {
        logger.error({ err }, "Market scan DexScreener fallita");
        return [] as TokenCandidate[];
      }),
      this.pump.fetchEmerging().catch((err) => {
        logger.error({ err }, "Market scan Pump.fun fallita");
        return [] as TokenCandidate[];
      }),
    ]);

    const map = new Map<string, TokenCandidate>();
    for (const c of [...pumpCandidates, ...dexCandidates]) map.set(c.mint, c);
    const candidates = [...map.values()];

    const trends = await this.social.scan(candidates);
    for (const c of candidates) {
      const t = trends.find((x) => x.mint === c.mint && x.source === "narrative");
      if (t) {
        c.socialMentionsDeltaPct = t.mentionsDeltaPct;
        c.narrative = t.summary;
      }
    }

    logger.info(
      { candidates: candidates.length, trends: trends.length, pump: pumpCandidates.length },
      "Scan mercato completata",
    );
    return { candidates, trends };
  }

  getLatestTrends(): TrendSignal[] {
    return this.social.getSignals();
  }

  async fetchTokenPrice(mint: string): Promise<number | null> {
    const token = await this.dex.fetchToken(mint);
    return token?.priceUsd ?? null;
  }
}
