import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/money.js";
import type { TrackedWallet } from "./types.js";

/**
 * Scarica Top 50 PnL da FOMO (e fallback) per il mirror trading.
 * Gli endpoint pubblici FOMO possono cambiare: in caso di drift usa seed + alert.
 */
export class FomoLeaderboardClient {
  constructor(private readonly config: AppConfig) {}

  async fetchTop50(): Promise<TrackedWallet[]> {
    const fromFomo = await this.tryFomoEndpoints();
    if (fromFomo.length) {
      logger.info({ count: fromFomo.length }, "FOMO top PnL caricato");
      return fromFomo.slice(0, 50);
    }

    const fromTracker = await this.trySolanaTracker();
    if (fromTracker.length) {
      logger.info({ count: fromTracker.length }, "Top PnL da Solana Tracker (fallback)");
      return fromTracker.slice(0, 50);
    }

    logger.warn("FOMO/Tracker top PnL non disponibili — uso seed wallets configurati");
    return this.seedWallets();
  }

  private async tryFomoEndpoints(): Promise<TrackedWallet[]> {
    const bases = [
      this.config.FOMO_API_BASE.replace(/\/$/, ""),
      "https://api.fomo.family",
      "https://api.fomo.family/v1",
    ];
    const paths = [
      "/leaderboard?limit=50&chain=solana&window=7d",
      "/traders/top?limit=50&chain=solana",
      "/v1/leaderboard/solana?limit=50",
      "/social/leaderboard?limit=50",
    ];

    for (const base of bases) {
      for (const path of paths) {
        try {
          const headers: Record<string, string> = { accept: "application/json" };
          if (this.config.FOMO_API_KEY) headers.authorization = `Bearer ${this.config.FOMO_API_KEY}`;
          const res = await fetch(`${base}${path}`, { headers });
          if (!res.ok) continue;
          const json = (await res.json()) as unknown;
          const mapped = this.mapLeaderboardPayload(json, "fomo");
          if (mapped.length) return mapped;
        } catch (err) {
          logger.debug({ err, base, path }, "FOMO leaderboard attempt failed");
        }
      }
    }
    return [];
  }

  private async trySolanaTracker(): Promise<TrackedWallet[]> {
    const key = this.config.SOLANA_TRACKER_API_KEY;
    if (!key) return [];
    try {
      const url =
        "https://data.solanatracker.io/v2/pnl/leaderboard/top?sort=realized&days=7&limit=50&minTrades=20";
      const res = await fetch(url, {
        headers: { accept: "application/json", "x-api-key": key },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as unknown;
      return this.mapLeaderboardPayload(json, "fomo");
    } catch (err) {
      logger.warn({ err }, "Solana Tracker leaderboard fallita");
      return [];
    }
  }

  private mapLeaderboardPayload(json: unknown, source: TrackedWallet["source"]): TrackedWallet[] {
    const rows = extractRows(json);
    const out: TrackedWallet[] = [];
    let rank = 1;
    for (const row of rows) {
      const address = String(
        row.address ?? row.wallet ?? row.traderAddress ?? row.pubkey ?? row.publicKey ?? "",
      );
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) continue;
      const pnl = Number(row.realizedPnlUsd ?? row.pnlUsd ?? row.pnl ?? row.realized ?? 0);
      const win = Number(row.winRatePct ?? row.win_percentage ?? row.winRate ?? 50);
      const usernameRaw = String(row.username ?? row.handle ?? row.name ?? row.label ?? "");
      const username = usernameRaw.replace(/^@/, "").trim() || undefined;
      const label = username
        ? `@${username}`
        : String(row.label ?? row.name ?? `Top PnL #${rank}`) || `Top PnL #${rank}`;
      out.push({
        address,
        label: source === "fomo" && !username ? `${label} (FOMO)` : label,
        username,
        rank,
        realizedPnlUsd: Number.isFinite(pnl) ? pnl : undefined,
        winRatePct: Number.isFinite(win) ? win : undefined,
        source,
        reliabilityScore: scoreReliability(pnl, win, rank),
        enabled: true,
        addedAt: nowIso(),
      });
      rank += 1;
      if (out.length >= 50) break;
    }
    return out;
  }

  private seedWallets(): TrackedWallet[] {
    const raw = this.config.COPY_WALLET_SEEDS;
    const now = nowIso();
    const out: TrackedWallet[] = [];
    for (const [i, entry] of raw.entries()) {
      const [address, label] = entry.split(":").map((s) => s.trim());
      if (!address || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) continue;
      out.push({
        address,
        label: label || `Seed Top #${i + 1}`,
        rank: i + 1,
        source: "seed",
        reliabilityScore: Math.max(40, 90 - i),
        enabled: true,
        addedAt: now,
      });
    }
    return out.slice(0, 50);
  }
}

function extractRows(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  if (!json || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;
  for (const key of ["data", "traders", "leaderboard", "results", "items", "rows"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    if (v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items)) {
      return (v as { items: Array<Record<string, unknown>> }).items;
    }
  }
  return [];
}

function scoreReliability(pnl: number, win: number, rank: number): number {
  let score = 55;
  if (pnl > 10_000) score += 15;
  if (pnl > 50_000) score += 10;
  if (win >= 55) score += 10;
  if (win >= 65) score += 5;
  score += Math.max(0, 15 - rank);
  return Math.max(10, Math.min(98, Math.round(score)));
}
