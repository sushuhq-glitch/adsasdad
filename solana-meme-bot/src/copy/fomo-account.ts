import { logger } from "../lib/logger.js";

export interface FomoAccountSnapshot {
  ok: boolean;
  userId?: string;
  handle?: string;
  solanaAddress?: string;
  evmAddress?: string;
  /** Cash / buying power in USD if exposed by API */
  cashUsd?: number;
  /** Portfolio / equity USD if exposed */
  portfolioUsd?: number;
  /** Sum of open token notionals in USD when API returns balances */
  positionsUsd?: number;
  positionsCount?: number;
  rawNote?: string;
  error?: string;
}

type Json = Record<string, unknown>;

/**
 * Client account FOMO (prod-api) autenticato con Privy JWT (`privy:token`).
 * Endpoint tipici (come usati da fomo.family / estensioni):
 *   GET /v2/users/me
 *   GET /v2/users/{id}/balances
 */
export class FomoAccountClient {
  constructor(
    private readonly apiBase = "https://prod-api.fomo.family",
    private readonly timeoutMs = 12_000,
  ) {}

  async fetchSnapshot(privyJwt: string): Promise<FomoAccountSnapshot> {
    const token = normalizePrivyToken(privyJwt);
    if (!token) {
      return { ok: false, error: "Nessun privy:token — completa /start" };
    }

    const me = await this.getJson("/v2/users/me", token);
    if (!me.ok) {
      // fallback: some builds use /v3
      const me3 = await this.getJson("/v3/users/me", token);
      if (!me3.ok) {
        return {
          ok: false,
          error: me.error || me3.error || "Impossibile raggiungere FOMO API",
        };
      }
      return this.fromUserAndBalances(token, me3.json);
    }
    return this.fromUserAndBalances(token, me.json);
  }

  private async fromUserAndBalances(
    token: string,
    meJson: unknown,
  ): Promise<FomoAccountSnapshot> {
    const root = asObj(meJson) ?? {};
    const ro = asObj(root.responseObject) ?? root;
    const userId = str(ro.id);
    const handle = str(ro.userHandle) || str(ro.profileHandle);
    const solanaAddress = str(ro.address);
    const evmAddress = str(ro.evmAddress);

    const cashUsd = firstNumber(ro, [
      "cashBalanceUsd",
      "cashUsd",
      "buyingPowerUsd",
      "availableBalanceUsd",
      "usdBalance",
      "balanceUsd",
      "cashBalance",
      "availableCash",
    ]);
    const portfolioUsd = firstNumber(ro, [
      "portfolioUsd",
      "portfolioValueUsd",
      "totalEquityUsd",
      "netWorthUsd",
      "equityUsd",
      "totalBalanceUsd",
    ]);

    let positionsUsd: number | undefined;
    let positionsCount: number | undefined;
    let balCash: number | undefined;

    if (userId) {
      const bal = await this.getJson(`/v2/users/${userId}/balances`, token);
      if (bal.ok) {
        const parsed = parseBalancesPayload(bal.json);
        positionsUsd = parsed.positionsUsd;
        positionsCount = parsed.positionsCount;
        balCash = parsed.cashUsd;
      }
    }

    const cash = cashUsd ?? balCash;
    const ok =
      Boolean(userId || handle || solanaAddress) ||
      cash != null ||
      portfolioUsd != null ||
      positionsUsd != null;

    if (!ok) {
      return {
        ok: false,
        error: "Sessione FOMO non valida o payload vuoto — aggiorna privy:token",
      };
    }

    return {
      ok: true,
      userId,
      handle,
      solanaAddress,
      evmAddress,
      cashUsd: cash,
      portfolioUsd,
      positionsUsd,
      positionsCount,
    };
  }

  private async getJson(
    path: string,
    token: string,
  ): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
    const url = `${this.apiBase.replace(/\/$/, "")}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          origin: "https://fomo.family",
          referer: "https://fomo.family/",
          "user-agent":
            "Mozilla/5.0 (compatible; WEDOTHATBot/1.0; +https://fomo.family)",
        },
      });
      const text = await res.text();
      if (!res.ok) {
        const blocked = /cloudflare|just a moment|cf-ray/i.test(text);
        const err = blocked
          ? `FOMO API bloccata da Cloudflare (${res.status})`
          : `FOMO API ${res.status}`;
        logger.warn({ path, status: res.status, blocked }, "FOMO account fetch failed");
        return { ok: false, error: err };
      }
      try {
        return { ok: true, json: JSON.parse(text) as unknown };
      } catch {
        return { ok: false, error: "Risposta FOMO non JSON" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ path, err: msg }, "FOMO account network error");
      return { ok: false, error: msg };
    } finally {
      clearTimeout(t);
    }
  }
}

export function normalizePrivyToken(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");
}

function parseBalancesPayload(json: unknown): {
  cashUsd?: number;
  positionsUsd?: number;
  positionsCount?: number;
} {
  const root = asObj(json) ?? {};
  const ro = asObj(root.responseObject) ?? root;
  const cashUsd = firstNumber(ro, [
    "cashBalanceUsd",
    "cashUsd",
    "buyingPowerUsd",
    "availableBalanceUsd",
    "usdBalance",
  ]);

  const rows = Array.isArray(ro.balances)
    ? (ro.balances as unknown[])
    : Array.isArray(ro.positions)
      ? (ro.positions as unknown[])
      : Array.isArray(ro.tokens)
        ? (ro.tokens as unknown[])
        : [];

  let positionsUsd = 0;
  let positionsCount = 0;
  for (const row of rows) {
    const r = asObj(row);
    if (!r) continue;
    const bal = asObj(r.balance) ?? r;
    const usd = firstNumber(bal, [
      "valueUsd",
      "usdValue",
      "notionalUsd",
      "balanceUsd",
      "amountUsd",
      "marketValueUsd",
    ]);
    const symbol = (str(bal.symbol) || str(r.symbol) || "").toUpperCase();
    if (symbol === "USD" || symbol === "USDC" || symbol === "CASH") {
      continue;
    }
    if (usd != null && usd > 0) {
      positionsUsd += usd;
      positionsCount += 1;
    }
  }

  return {
    cashUsd,
    positionsUsd: positionsCount > 0 ? positionsUsd : undefined,
    positionsCount: positionsCount > 0 ? positionsCount : undefined,
  };
}

function asObj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function firstNumber(obj: Json, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  // nested balance object
  const nested = asObj(obj.balance);
  if (nested) {
    for (const k of keys) {
      const v = nested[k];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}
