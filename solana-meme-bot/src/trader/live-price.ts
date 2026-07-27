import { logger } from "../lib/logger.js";

export interface LiveQuote {
  priceUsd: number;
  source: "dexscreener" | "jupiter" | "pumpfun" | "cache" | "none";
  liquidityUsd?: number;
  marketCapUsd?: number;
  fetchedAt: number;
}

/**
 * Oracle prezzo live multi-source per buy/sell (paper e live).
 * Non ritorna mai l'entry price come default silenzioso.
 */
export class LivePriceOracle {
  private cache = new Map<string, LiveQuote>();

  constructor(
    private readonly dexBase = "https://api.dexscreener.com",
    private readonly jupiterPriceUrl = "https://api.jup.ag/price/v2",
    private readonly pumpBase = "https://frontend-api.pump.fun",
  ) {}

  getCached(mint: string): LiveQuote | null {
    const hit = this.cache.get(mint);
    if (!hit) return null;
    if (Date.now() - hit.fetchedAt > 15_000) return null;
    return hit;
  }

  async getLivePriceUsd(mint: string, opts?: { bypassCache?: boolean }): Promise<LiveQuote> {
    if (!opts?.bypassCache) {
      const cached = this.getCached(mint);
      if (cached && cached.priceUsd > 0) return cached;
    }

    const sources = [
      () => this.fromDexScreener(mint),
      () => this.fromJupiter(mint),
      () => this.fromPumpFun(mint),
    ];

    for (const src of sources) {
      try {
        const q = await src();
        if (q && q.priceUsd > 0 && Number.isFinite(q.priceUsd)) {
          this.cache.set(mint, q);
          return q;
        }
      } catch (err) {
        logger.debug({ err, mint }, "live price source failed");
      }
    }

    const stale = this.cache.get(mint);
    if (stale && stale.priceUsd > 0) {
      return { ...stale, source: "cache", fetchedAt: Date.now() };
    }

    return { priceUsd: 0, source: "none", fetchedAt: Date.now() };
  }

  private async fromDexScreener(mint: string): Promise<LiveQuote | null> {
    const bust = Date.now();
    const res = await fetch(`${this.dexBase}/latest/dex/tokens/${mint}?t=${bust}`, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      pairs?: Array<{
        chainId?: string;
        priceUsd?: string;
        liquidity?: { usd?: number };
        marketCap?: number;
        fdv?: number;
        pairCreatedAt?: number;
      }>;
    };
    const pairs = (json.pairs ?? []).filter((p) => p.chainId === "solana" && Number(p.priceUsd) > 0);
    if (!pairs.length) return null;
    // Preferisci pair con più liquidità
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = pairs[0]!;
    return {
      priceUsd: Number(best.priceUsd),
      source: "dexscreener",
      liquidityUsd: Number(best.liquidity?.usd ?? 0),
      marketCapUsd: Number(best.marketCap ?? best.fdv ?? 0),
      fetchedAt: Date.now(),
    };
  }

  private async fromJupiter(mint: string): Promise<LiveQuote | null> {
    const urls = [
      `${this.jupiterPriceUrl}?ids=${mint}`,
      `https://price.jup.ag/v6/price?ids=${mint}`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { accept: "application/json", "cache-control": "no-cache" },
        });
        if (!res.ok) continue;
        const json = (await res.json()) as {
          data?: Record<string, { price?: number | string }>;
        };
        const row = json.data?.[mint];
        const price = Number(row?.price ?? 0);
        if (price > 0) {
          return { priceUsd: price, source: "jupiter", fetchedAt: Date.now() };
        }
      } catch {
        /* try next */
      }
    }
    return null;
  }

  private async fromPumpFun(mint: string): Promise<LiveQuote | null> {
    try {
      const res = await fetch(`${this.pumpBase}/coins/${mint}`, {
        headers: { accept: "application/json", "cache-control": "no-cache" },
      });
      if (!res.ok) return null;
      const row = (await res.json()) as {
        usd_market_cap?: number;
        market_cap?: number;
        virtual_sol_reserves?: number;
        virtual_token_reserves?: number;
        total_supply?: number;
      };
      const solReserves = Number(row.virtual_sol_reserves ?? 0) / 1e9;
      const tokenReserves = Number(row.virtual_token_reserves ?? 0);
      // prezzo grezzo da bonding curve (SOL/token) * stima SOL/USD
      let priceUsd = 0;
      if (tokenReserves > 0 && solReserves > 0) {
        const solUsd = 150;
        // virtual_token_reserves spesso in raw units ~1e6 decimals
        priceUsd = (solReserves * solUsd) / (tokenReserves / 1e6);
      }
      const mcap = Number(row.usd_market_cap ?? row.market_cap ?? 0);
      if ((!priceUsd || !Number.isFinite(priceUsd)) && mcap > 0) {
        // fallback mcap / supply tipica 1e9
        priceUsd = mcap / 1e9;
      }
      if (!(priceUsd > 0)) return null;
      return {
        priceUsd,
        source: "pumpfun",
        marketCapUsd: mcap || undefined,
        liquidityUsd: solReserves > 0 ? solReserves * 150 : undefined,
        fetchedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }
}

/** Simula movimento di mercato realistico per DEMO paper (non usato su wallet reali). */
export function simulateDemoExitPrice(entryUsd: number, heldMs: number): number {
  if (!(entryUsd > 0)) return 0;
  // Momentum tipico meme: -25% .. +180% in funzione del tempo + jitter
  const tFactor = Math.min(1, heldMs / 60_000);
  const baseMove = -0.1 + Math.random() * 1.4; // -10% .. +130%
  const timeBoost = tFactor * (Math.random() * 0.5);
  const move = baseMove + timeBoost;
  return entryUsd * (1 + move);
}
