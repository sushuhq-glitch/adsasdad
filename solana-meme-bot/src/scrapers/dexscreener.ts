import type { TokenCandidate } from "../types/index.js";
import { logger } from "../lib/logger.js";

interface DexPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  pairCreatedAt?: number;
  url?: string;
}

/**
 * Fetch continuo candidate da DexScreener (Solana).
 * Endpoint pubblico; in caso di errore restituisce lista vuota senza crashare il loop H24.
 */
export class DexScreenerClient {
  constructor(private readonly baseUrl: string) {}

  async fetchSolanaBoosts(): Promise<TokenCandidate[]> {
    const urls = [
      `${this.baseUrl}/token-boosts/top/v1`,
      `${this.baseUrl}/token-profiles/latest/v1`,
    ];

    const mints = new Set<string>();
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) {
          logger.warn({ url, status: res.status }, "DexScreener endpoint non OK");
          continue;
        }
        const data = (await res.json()) as Array<{ tokenAddress?: string; chainId?: string }>;
        for (const row of data ?? []) {
          if (row.chainId === "solana" && row.tokenAddress) mints.add(row.tokenAddress);
        }
      } catch (err) {
        logger.warn({ err, url }, "Errore fetch DexScreener");
      }
    }

    const candidates: TokenCandidate[] = [];
    for (const mint of [...mints].slice(0, 12)) {
      const c = await this.fetchToken(mint);
      if (c) candidates.push(c);
    }
    return candidates;
  }

  async fetchToken(mint: string): Promise<TokenCandidate | null> {
    try {
      const bust = Date.now();
      const res = await fetch(`${this.baseUrl}/latest/dex/tokens/${mint}?t=${bust}`, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { pairs?: DexPair[] };
      const pairs = (json.pairs ?? [])
        .filter((p) => p.chainId === "solana" && Number(p.priceUsd) > 0)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const pair = pairs[0];
      if (!pair?.baseToken?.address) return null;

      const created = pair.pairCreatedAt ? Number(pair.pairCreatedAt) : Date.now();
      const ageMinutes = Math.max(0, (Date.now() - created) / 60_000);

      return {
        mint: pair.baseToken.address,
        symbol: pair.baseToken.symbol ?? "UNKNOWN",
        name: pair.baseToken.name ?? "Unknown",
        marketCapUsd: Number(pair.marketCap ?? pair.fdv ?? 0),
        liquidityUsd: Number(pair.liquidity?.usd ?? 0),
        priceUsd: Number(pair.priceUsd ?? 0),
        volume24hUsd: Number(pair.volume?.h24 ?? 0),
        ageMinutes,
        source: "dexscreener",
        narrative: "Boost/profile DexScreener Solana",
        raw: pair as unknown as Record<string, unknown>,
      };
    } catch (err) {
      logger.debug({ err, mint }, "fetchToken failed");
      return null;
    }
  }
}
