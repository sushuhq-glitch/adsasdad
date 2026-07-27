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

type AuthMode =
  | "bearer"
  | "privy-token-header"
  | "cookie-privy-token"
  | "bearer-plus-app-id";

/**
 * Client account FOMO (prod-api) autenticato con Privy JWT (`privy:token`).
 * Prova più schemi di auth perché FOMO web usa spesso cookie di sessione browser.
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

    const expiry = readJwtExpiry(token);
    if (expiry && expiry.getTime() <= Date.now() + 30_000) {
      return {
        ok: false,
        error: `privy:token scaduto (${expiry.toISOString()}). Rifai login su fomo.family e copia un token fresco.`,
      };
    }

    const appId = readJwtAudience(token);
    const modes: AuthMode[] = [
      "bearer",
      "bearer-plus-app-id",
      "privy-token-header",
      "cookie-privy-token",
    ];

    let lastError = "Impossibile raggiungere FOMO API";
    for (const mode of modes) {
      for (const path of ["/v2/users/me", "/v3/users/me"] as const) {
        const me = await this.getJson(path, token, mode, appId);
        if (me.ok) {
          logger.info({ mode, path }, "FOMO /users/me OK");
          return this.fromUserAndBalances(token, me.json, mode, appId);
        }
        lastError = me.error;
        if (/Cloudflare/i.test(me.error)) {
          return { ok: false, error: me.error };
        }
      }
    }

    return {
      ok: false,
      error: explainFomoAuthError(lastError, expiry),
    };
  }

  private async fromUserAndBalances(
    token: string,
    meJson: unknown,
    mode: AuthMode,
    appId?: string,
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
      "buyingPower",
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
      const bal = await this.getJson(`/v2/users/${userId}/balances`, token, mode, appId);
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
      rawNote: `auth=${mode}`,
    };
  }

  private async getJson(
    path: string,
    token: string,
    mode: AuthMode,
    appId?: string,
  ): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
    const url = `${this.apiBase.replace(/\/$/, "")}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      accept: "application/json",
      origin: "https://fomo.family",
      referer: "https://fomo.family/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };

    if (mode === "bearer" || mode === "bearer-plus-app-id") {
      headers.authorization = `Bearer ${token}`;
    }
    if (mode === "privy-token-header") {
      headers["privy-token"] = token;
      headers.authorization = `Bearer ${token}`;
    }
    if (mode === "cookie-privy-token") {
      headers.cookie = `privy-token=${token}`;
      headers.authorization = `Bearer ${token}`;
    }
    if ((mode === "bearer-plus-app-id" || mode === "privy-token-header") && appId) {
      headers["privy-app-id"] = appId;
    }

    try {
      const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers });
      const text = await res.text();
      if (!res.ok) {
        const blocked = /cloudflare|just a moment|cf-ray/i.test(text);
        let detail = "";
        try {
          const j = JSON.parse(text) as Json;
          detail = str(j.message) || str(j.error) || str(j.msg) || "";
        } catch {
          detail = text.slice(0, 120).replace(/\s+/g, " ");
        }
        const err = blocked
          ? `FOMO API bloccata da Cloudflare (${res.status})`
          : detail
            ? `FOMO API ${res.status}: ${detail}`
            : `FOMO API ${res.status}`;
        logger.warn({ path, status: res.status, mode, detail: detail.slice(0, 160) }, "FOMO account fetch failed");
        return { ok: false, error: err };
      }
      try {
        return { ok: true, json: JSON.parse(text) as unknown };
      } catch {
        return { ok: false, error: "Risposta FOMO non JSON" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ path, mode, err: msg }, "FOMO account network error");
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

function explainFomoAuthError(lastError: string, expiry: Date | null): string {
  if (/scaduto|expired/i.test(lastError)) return lastError;
  if (expiry) {
    const mins = Math.round((expiry.getTime() - Date.now()) / 60_000);
    if (mins < 0) {
      return `privy:token scaduto. Su fomo.family rifai login → Console → copy(JSON.parse(localStorage.getItem('privy:token')))`;
    }
  }
  if (/400/.test(lastError)) {
    return [
      "FOMO ha rifiutato il token (HTTP 400).",
      "Di solito: token scaduto/incompleto, oppure FOMO vuole la sessione browser (cookie), non solo privy:token.",
      "Soluzione: esci/rientra su fomo.family, copia un privy:token fresco e reinviarlo con /start.",
      "Intanto puoi vedere il SOL on-chain da Settings → Imposta wallet Solana.",
    ].join(" ");
  }
  return lastError;
}

function readJwtExpiry(token: string): Date | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof json.exp === "number" ? new Date(json.exp * 1000) : null;
  } catch {
    return null;
  }
}

function readJwtAudience(token: string): string | undefined {
  try {
    const payload = token.split(".")[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      aud?: string | string[];
    };
    if (typeof json.aud === "string") return json.aud;
    if (Array.isArray(json.aud) && typeof json.aud[0] === "string") return json.aud[0];
    return undefined;
  } catch {
    return undefined;
  }
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
