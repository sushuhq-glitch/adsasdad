import { logger } from "../lib/logger.js";

export type FomoAuthMode =
  | "bearer"
  | "privy-token-header"
  | "cookie-privy-token"
  | "bearer-plus-app-id";

export const FOMO_PROD_API = "https://prod-api.fomo.family";
/** Solana networkId usato da FOMO (Codex / GeckoTerminal style). */
export const FOMO_SOLANA_NETWORK_ID = 1_399_811_149;
export const FOMO_SOL_MINT = "So11111111111111111111111111111111111111112";
export const FOMO_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export interface FomoHttpOptions {
  apiBase?: string;
  timeoutMs?: number;
  /** Cloudflare clearance cookie (opzionale, da browser). */
  cfClearance?: string;
  cfBm?: string;
  extraCookie?: string;
}

export function normalizePrivyToken(raw: string): string {
  return raw
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']|["']$/g, "");
}

export function readJwtExpiry(token: string): Date | null {
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

export function readJwtAudience(token: string): string | undefined {
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

export type FomoJsonResult =
  | { ok: true; status: number; json: unknown; text: string }
  | { ok: false; status: number; error: string; text: string };

/**
 * HTTP client autenticato verso prod-api.fomo.family.
 * Prova più schemi auth (Bearer / privy-token / cookie) + cookie Cloudflare opzionali.
 */
export class FomoHttp {
  readonly apiBase: string;
  private readonly timeoutMs: number;
  private readonly cfClearance: string;
  private readonly cfBm: string;
  private readonly extraCookie: string;

  constructor(opts: FomoHttpOptions = {}) {
    this.apiBase = (opts.apiBase || FOMO_PROD_API).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.cfClearance = opts.cfClearance || process.env.FOMO_CF_CLEARANCE || "";
    this.cfBm = opts.cfBm || process.env.FOMO_CF_BM || "";
    this.extraCookie = opts.extraCookie || process.env.FOMO_EXTRA_COOKIE || "";
  }

  async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    token: string,
    mode: FomoAuthMode,
    body?: unknown,
  ): Promise<FomoJsonResult> {
    const url = path.startsWith("http") ? path : `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    const appId = readJwtAudience(token);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      accept: "application/json",
      origin: "https://fomo.family",
      referer: "https://fomo.family/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    if (mode === "bearer" || mode === "bearer-plus-app-id") {
      headers.authorization = `Bearer ${token}`;
    }
    if (mode === "privy-token-header") {
      headers["privy-token"] = token;
      headers.authorization = `Bearer ${token}`;
    }
    if (mode === "cookie-privy-token") {
      headers.authorization = `Bearer ${token}`;
    }
    if ((mode === "bearer-plus-app-id" || mode === "privy-token-header") && appId) {
      headers["privy-app-id"] = appId;
    }

    const cookies: string[] = [];
    if (mode === "cookie-privy-token") cookies.push(`privy-token=${token}`);
    if (this.cfClearance) cookies.push(`cf_clearance=${this.cfClearance}`);
    if (this.cfBm) cookies.push(`__cf_bm=${this.cfBm}`);
    if (this.extraCookie) cookies.push(this.extraCookie);
    if (cookies.length) headers.cookie = cookies.join("; ");

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const blocked = /cloudflare|just a moment|cf-ray|attention required/i.test(text);
      if (!res.ok) {
        let detail = "";
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          detail = String(j.message ?? j.error ?? j.msg ?? "");
        } catch {
          detail = text.slice(0, 160).replace(/\s+/g, " ");
        }
        const error = blocked
          ? `FOMO API bloccata da Cloudflare (${res.status}). Imposta FOMO_CF_CLEARANCE dal browser oppure esegui il bot fuori da questo datacenter.`
          : detail
            ? `FOMO API ${res.status}: ${detail}`
            : `FOMO API ${res.status}`;
        logger.warn({ path, status: res.status, mode, method }, "FOMO HTTP failed");
        return { ok: false, status: res.status, error, text };
      }
      try {
        return { ok: true, status: res.status, json: JSON.parse(text) as unknown, text };
      } catch {
        return { ok: false, status: res.status, error: "Risposta FOMO non JSON", text };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 0, error: msg, text: "" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Prova i mode auth in sequenza finché uno risponde 2xx. */
  async requestAnyAuth(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    token: string,
    body?: unknown,
  ): Promise<FomoJsonResult & { mode?: FomoAuthMode }> {
    const modes: FomoAuthMode[] = [
      "bearer-plus-app-id",
      "bearer",
      "privy-token-header",
      "cookie-privy-token",
    ];
    let last: FomoJsonResult = { ok: false, status: 0, error: "Nessun tentativo", text: "" };
    for (const mode of modes) {
      const res = await this.request(method, path, token, mode, body);
      if (res.ok) return { ...res, mode };
      last = res;
      if (/Cloudflare/i.test(res.error)) return { ...res, mode };
      if (res.status === 401 || res.status === 403) continue;
      // 404/405 = endpoint sbagliato, continua; 400 spesso body errato ma auth ok
      if (res.status === 400) return { ...res, mode };
    }
    return { ...last };
  }
}

export function unwrapFomo(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== "object") return {};
  const root = json as Record<string, unknown>;
  const ro = root.responseObject;
  if (ro && typeof ro === "object" && !Array.isArray(ro)) return ro as Record<string, unknown>;
  return root;
}

export function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function firstNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const n = num(obj[k]);
    if (n != null) return n;
  }
  return undefined;
}
