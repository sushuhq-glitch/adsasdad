import type { TokenCandidate } from "../types/index.js";
import { logger } from "../lib/logger.js";

interface PumpCoin {
  mint?: string;
  name?: string;
  symbol?: string;
  market_cap?: number;
  usd_market_cap?: number;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  created_timestamp?: number;
  reply_count?: number;
}

/**
 * Fetch candidate emergenti da Pump.fun (frontend API pubblica).
 * In caso di drift/API down restituisce [] senza interrompere il loop H24.
 */
export class PumpFunScanner {
  constructor(private readonly baseUrl: string) {}

  async fetchEmerging(limit = 12): Promise<TokenCandidate[]> {
    const urls = [
      `${this.baseUrl}/coins/king-of-the-hill?includeNsfw=false`,
      `${this.baseUrl}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`,
    ];

    const out: TokenCandidate[] = [];
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) {
          logger.warn({ url, status: res.status }, "Pump.fun endpoint non OK");
          continue;
        }
        const data = (await res.json()) as PumpCoin[] | PumpCoin;
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
          const c = this.mapCoin(row);
          if (c) out.push(c);
        }
      } catch (err) {
        logger.warn({ err, url }, "Errore fetch Pump.fun");
      }
    }

    const map = new Map<string, TokenCandidate>();
    for (const c of out) map.set(c.mint, c);
    return [...map.values()].slice(0, limit);
  }

  private mapCoin(row: PumpCoin): TokenCandidate | null {
    if (!row.mint) return null;
    const created = row.created_timestamp ? Number(row.created_timestamp) : Date.now();
    const ageMinutes = Math.max(0, (Date.now() - created) / 60_000);
    const solReserves = Number(row.virtual_sol_reserves ?? 0) / 1e9;
    const tokenReserves = Number(row.virtual_token_reserves ?? 0);
    const priceUsd = tokenReserves > 0 ? (solReserves * 150) / (tokenReserves / 1e6) : 0;
    const marketCapUsd = Number(row.usd_market_cap ?? row.market_cap ?? 0);

    return {
      mint: row.mint,
      symbol: row.symbol ?? "UNKNOWN",
      name: row.name ?? "Unknown",
      marketCapUsd,
      liquidityUsd: solReserves * 150,
      priceUsd,
      volume24hUsd: Math.max(0, (row.reply_count ?? 0) * 50),
      ageMinutes,
      source: "pumpfun",
      narrative: "Pump.fun emerging / king-of-the-hill",
      socialMentionsDeltaPct: Math.min(500, (row.reply_count ?? 0) * 5),
      raw: row as unknown as Record<string, unknown>,
    };
  }
}
