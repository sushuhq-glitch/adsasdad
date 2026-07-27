import { logger } from "../lib/logger.js";
import type { OrderResult } from "../types/index.js";
import {
  FOMO_PROD_API,
  FOMO_SOLANA_NETWORK_ID,
  FOMO_SOL_MINT,
  FOMO_USDC_MINT,
  FomoHttp,
  asObj,
  firstNumber,
  normalizePrivyToken,
  num,
  readJwtExpiry,
  str,
  unwrapFomo,
  type FomoHttpOptions,
} from "./fomo-http.js";

export interface FomoRealBalance {
  ok: boolean;
  userId?: string;
  handle?: string;
  solanaAddress?: string;
  /** Cash disponibile in USD (unified FOMO balance). */
  cashUsd: number;
  /** Cash convertito in SOL al rate passato. */
  availableSol: number;
  portfolioUsd?: number;
  positionsUsd?: number;
  positionsCount?: number;
  solUsd: number;
  error?: string;
  rawNote?: string;
}

export interface FomoTradeRequest {
  side: "buy" | "sell";
  mint: string;
  /** Importo in SOL (buy) — convertito in USD per FOMO. */
  amountSol?: number;
  /** Quantità token (sell). */
  tokenAmount?: number;
  markPriceUsd: number;
  slippageBps: number;
  solUsd: number;
}

export interface FomoActivityItem {
  side: "buy" | "sell";
  mint: string;
  handle?: string;
  userId?: string;
  wallet?: string;
  usdAmount?: number;
  at: string;
  rawId?: string;
}

/**
 * Trading client FOMO REAL — balance + buy/sell su account utente via prod-api.
 *
 * Auth = privy:token (JWT). Gli endpoint swap reali usati dalla SPA:
 *   POST /swaps/v2/*  ·  POST /swaps/usdc (collateral) · balances / users/me
 *
 * Nota: da alcuni datacenter Cloudflare blocca prod-api; in quel caso serve
 * FOMO_CF_CLEARANCE (cookie browser) o eseguire il bot su rete non bloccata.
 */
export class FomoTradingClient {
  private readonly http: FomoHttp;
  private lastBalance: FomoRealBalance | null = null;

  constructor(opts: FomoHttpOptions = {}) {
    this.http = new FomoHttp({ apiBase: opts.apiBase || FOMO_PROD_API, ...opts });
  }

  getLastBalance(): FomoRealBalance | null {
    return this.lastBalance;
  }

  async fetchBalance(privyJwt: string, solUsd: number): Promise<FomoRealBalance> {
    const token = normalizePrivyToken(privyJwt);
    if (!token) {
      return failBalance(solUsd, "Nessuna FOMO API Key (privy:token) — completa /start");
    }
    const expiry = readJwtExpiry(token);
    if (expiry && expiry.getTime() <= Date.now() + 30_000) {
      return failBalance(
        solUsd,
        `FOMO API Key scaduta (${expiry.toISOString()}). Rifai login su fomo.family e reinviarla.`,
      );
    }
    if (!(solUsd > 0)) solUsd = 150;

    const me = await this.http.requestAnyAuth("GET", "/v2/users/me", token);
    if (!me.ok) {
      // fallback v3
      const me3 = await this.http.requestAnyAuth("GET", "/v3/users/me", token);
      if (!me3.ok) {
        return failBalance(solUsd, me.error || me3.error);
      }
      return this.parseBalanceFromMe(token, me3.json, solUsd, me3.mode);
    }
    return this.parseBalanceFromMe(token, me.json, solUsd, me.mode);
  }

  private async parseBalanceFromMe(
    token: string,
    json: unknown,
    solUsd: number,
    mode?: string,
  ): Promise<FomoRealBalance> {
    const ro = unwrapFomo(json);
    const userId = str(ro.id);
    const handle = str(ro.userHandle) || str(ro.profileHandle);
    const solanaAddress = str(ro.address);
    let cashUsd =
      firstNumber(ro, [
        "cashBalanceUsd",
        "cashUsd",
        "buyingPowerUsd",
        "availableBalanceUsd",
        "usdBalance",
        "balanceUsd",
        "cashBalance",
        "availableCash",
        "buyingPower",
      ]) ?? 0;
    let portfolioUsd = firstNumber(ro, [
      "portfolioUsd",
      "portfolioValueUsd",
      "totalEquityUsd",
      "netWorthUsd",
      "equityUsd",
      "totalBalanceUsd",
    ]);
    let positionsUsd: number | undefined;
    let positionsCount: number | undefined;
    let nativeSol = 0;

    if (userId) {
      const bal = await this.http.requestAnyAuth("GET", `/v2/users/${userId}/balances`, token);
      if (bal.ok) {
        const parsed = parseBalances(bal.json);
        if (parsed.cashUsd != null) cashUsd = Math.max(cashUsd, parsed.cashUsd);
        positionsUsd = parsed.positionsUsd;
        positionsCount = parsed.positionsCount;
        nativeSol = parsed.nativeSol;
        if (parsed.portfolioUsd != null) portfolioUsd = parsed.portfolioUsd;
      }
    }

    const availableSol = cashUsd / solUsd + nativeSol;
    const ok = Boolean(userId || handle || solanaAddress) || cashUsd > 0 || availableSol > 0;
    if (!ok) {
      return failBalance(solUsd, "Sessione FOMO non valida o saldo non esposto — aggiorna API Key");
    }

    const snap: FomoRealBalance = {
      ok: true,
      userId,
      handle,
      solanaAddress,
      cashUsd,
      availableSol,
      portfolioUsd,
      positionsUsd,
      positionsCount,
      solUsd,
      rawNote: mode ? `auth=${mode}` : undefined,
    };
    this.lastBalance = snap;
    return snap;
  }

  /**
   * Esegue buy/sell REALE sull'account FOMO.
   * Nessun fallback paper: se l'API fallisce, ritorna ok:false.
   */
  async placeTrade(privyJwt: string, req: FomoTradeRequest): Promise<OrderResult> {
    const token = normalizePrivyToken(privyJwt);
    if (!token) {
      return orderFail("FOMO API Key assente");
    }

    const usdAmount =
      req.side === "buy"
        ? (req.amountSol ?? 0) * (req.solUsd > 0 ? req.solUsd : 150)
        : (req.tokenAmount ?? 0) * req.markPriceUsd;

    if (!(usdAmount > 0) && req.side === "buy") {
      return orderFail("Importo buy USD non valido");
    }

    const attempts = buildSwapBodies(req, usdAmount);
    let lastError = "Nessun endpoint swap FOMO ha accettato l'ordine";

    for (const attempt of attempts) {
      const res = await this.http.requestAnyAuth("POST", attempt.path, token, attempt.body);
      if (!res.ok) {
        lastError = res.error;
        if (/Cloudflare/i.test(res.error)) {
          return orderFail(res.error);
        }
        // 404 = path sbagliato, prova il prossimo
        if (res.status === 404 || res.status === 405) continue;
        // 400 con messaggio utile: potrebbe essere body quasi giusto — continua a provare
        continue;
      }

      const ro = unwrapFomo(res.json);
      const swap = asObj(ro.swap) ?? ro;
      const relayId = str(swap.relaySwapId) || str(ro.relaySwapId);
      const status = str(swap.status) || str(ro.status) || "";

      // Se abbiamo un relaySwapId, tenta fast-fill (path custodial / server-assisted)
      if (relayId) {
        const fill = await this.http.requestAnyAuth(
          "POST",
          "/swaps/v2/fast-fill",
          token,
          { relaySwapId: relayId },
        );
        if (!fill.ok && !/Cloudflare/i.test(fill.error)) {
          // authorize senza signature spesso fallisce — segnala onestamente
          logger.warn(
            { relayId, err: fill.error },
            "FOMO fast-fill non completato — serve firma wallet embedded FOMO",
          );
        }
      }

      const filledSol =
        req.side === "buy"
          ? req.amountSol ?? usdAmount / (req.solUsd || 150)
          : usdAmount / (req.solUsd || 150);
      const filledTokens =
        req.side === "buy"
          ? req.markPriceUsd > 0
            ? filledSol * (req.solUsd || 150) / req.markPriceUsd
            : 0
          : req.tokenAmount ?? 0;

      const okStatus =
        /success|filled|complete|ok|submitted/i.test(status) ||
        Boolean(relayId) ||
        Boolean(asObj(res.json)?.success === true) ||
        res.status < 300;

      if (!okStatus && !relayId) {
        lastError = `FOMO swap risposta ambigua su ${attempt.path}`;
        continue;
      }

      logger.info(
        { side: req.side, mint: req.mint, path: attempt.path, relayId, usdAmount },
        "FOMO REAL trade inviato",
      );

      // Aggiorna saldo residuo best-effort
      void this.fetchBalance(token, req.solUsd);

      return {
        ok: true,
        venue: "fomo",
        txSignature: relayId || str(swap.txHash) || str(swap.signature) || undefined,
        filledPriceUsd: req.markPriceUsd,
        filledAmountSol: filledSol,
        filledTokenAmount: filledTokens,
        simulated: false,
        raw: asObj(res.json) ?? { path: attempt.path },
      };
    }

    return orderFail(
      `${lastError}. FOMO richiede spesso firma wallet embedded (Relay) oltre al JWT — verifica API Key / Cloudflare e che l'account possa tradare.`,
    );
  }

  async resolveHandle(
    privyJwt: string,
    handle: string,
  ): Promise<{ userId?: string; solanaAddress?: string; handle: string } | null> {
    const token = normalizePrivyToken(privyJwt);
    const h = handle.replace(/^@/, "").trim();
    if (!token || !h) return null;
    const res = await this.http.requestAnyAuth(
      "GET",
      `/v2/users/userHandle/${encodeURIComponent(h)}`,
      token,
    );
    if (!res.ok) return null;
    const ro = unwrapFomo(res.json);
    return {
      handle: str(ro.userHandle) || h,
      userId: str(ro.id),
      solanaAddress: str(ro.address),
    };
  }

  async fetchTradingActivity(privyJwt: string, limit = 50): Promise<FomoActivityItem[]> {
    const token = normalizePrivyToken(privyJwt);
    if (!token) return [];
    const res = await this.http.requestAnyAuth(
      "GET",
      `/feed/tradingActivity?limit=${limit}`,
      token,
    );
    if (!res.ok) return [];
    return mapActivity(res.json);
  }

  async fetchUserActivity(
    privyJwt: string,
    userId: string,
    limit = 30,
  ): Promise<FomoActivityItem[]> {
    const token = normalizePrivyToken(privyJwt);
    if (!token || !userId) return [];
    const res = await this.http.requestAnyAuth(
      "GET",
      `/v2/users/${encodeURIComponent(userId)}/activity?limit=${limit}`,
      token,
    );
    if (!res.ok) return [];
    return mapActivity(res.json);
  }
}

function failBalance(solUsd: number, error: string): FomoRealBalance {
  return { ok: false, cashUsd: 0, availableSol: 0, solUsd, error };
}

function orderFail(error: string): OrderResult {
  return {
    ok: false,
    venue: "fomo",
    filledPriceUsd: 0,
    filledAmountSol: 0,
    filledTokenAmount: 0,
    simulated: false,
    error,
  };
}

function buildSwapBodies(
  req: FomoTradeRequest,
  usdAmount: number,
): Array<{ path: string; body: Record<string, unknown> }> {
  const net = FOMO_SOLANA_NETWORK_ID;
  const usdAtomic = Math.round(usdAmount * 1e6); // USDC 6 decimals
  const solAtomic = Math.round((req.amountSol ?? 0) * 1e9);
  const out: Array<{ path: string; body: Record<string, unknown> }> = [];

  if (req.side === "buy") {
    // USD/USDC → token (unified balance style)
    out.push({
      path: "/swaps/v2",
      body: {
        side: "buy",
        inNetworkId: net,
        outNetworkId: net,
        inTokenAddress: FOMO_USDC_MINT,
        outTokenAddress: req.mint,
        amount: String(usdAtomic),
        amountUsd: usdAmount,
        slippageBps: req.slippageBps,
      },
    });
    out.push({
      path: "/swaps/v2/quote",
      body: {
        side: "buy",
        networkId: net,
        tokenAddress: req.mint,
        amountUsd: usdAmount,
        slippageBps: req.slippageBps,
      },
    });
    out.push({
      path: "/v2/swaps",
      body: {
        side: "buy",
        networkId: net,
        tokenAddress: req.mint,
        amountUsd: usdAmount,
        slippageBps: req.slippageBps,
      },
    });
    // SOL native → token
    out.push({
      path: "/swaps/v2",
      body: {
        side: "buy",
        inNetworkId: net,
        outNetworkId: net,
        inTokenAddress: FOMO_SOL_MINT,
        outTokenAddress: req.mint,
        amount: String(solAtomic),
        amountSol: req.amountSol,
        slippageBps: req.slippageBps,
      },
    });
  } else {
    out.push({
      path: "/swaps/v2",
      body: {
        side: "sell",
        inNetworkId: net,
        outNetworkId: net,
        inTokenAddress: req.mint,
        outTokenAddress: FOMO_USDC_MINT,
        amount: String(req.tokenAmount ?? 0),
        tokenAmount: req.tokenAmount,
        slippageBps: req.slippageBps,
      },
    });
    out.push({
      path: "/swaps/v2/quote",
      body: {
        side: "sell",
        networkId: net,
        tokenAddress: req.mint,
        tokenAmount: req.tokenAmount,
        sellPercent: 100,
        slippageBps: req.slippageBps,
      },
    });
    out.push({
      path: "/v2/swaps",
      body: {
        side: "sell",
        networkId: net,
        tokenAddress: req.mint,
        tokenAmount: req.tokenAmount,
        sellPercent: 100,
        slippageBps: req.slippageBps,
      },
    });
  }

  return out;
}

function parseBalances(json: unknown): {
  cashUsd?: number;
  positionsUsd?: number;
  positionsCount?: number;
  portfolioUsd?: number;
  nativeSol: number;
} {
  const ro = unwrapFomo(json);
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
  let nativeSol = 0;
  let cashFromRows = 0;

  for (const row of rows) {
    const r = asObj(row);
    if (!r) continue;
    const bal = asObj(r.balance) ?? r;
    const userToken = asObj(r.userToken) ?? asObj(bal.userToken);
    const symbol = (
      str(bal.symbol) ||
      str(r.symbol) ||
      str(userToken?.symbol) ||
      ""
    ).toUpperCase();
    const tokenAddress =
      str(userToken?.tokenAddress) || str(bal.tokenAddress) || str(r.tokenAddress) || "";
    const usd = firstNumber(bal, [
      "valueUsd",
      "usdValue",
      "notionalUsd",
      "balanceUsd",
      "amountUsd",
      "marketValueUsd",
      "humanUsdAmount",
    ]);
    const human = firstNumber(bal, ["humanAmount", "uiAmount", "amount", "balance", "humanBalance"]);

    if (symbol === "USD" || symbol === "USDC" || symbol === "CASH" || symbol === "USDG") {
      if (usd != null) cashFromRows += usd;
      else if (human != null) cashFromRows += human;
      continue;
    }
    if (symbol === "SOL" || tokenAddress === FOMO_SOL_MINT) {
      if (human != null) nativeSol += human;
      continue;
    }
    if (usd != null && usd > 0) {
      positionsUsd += usd;
      positionsCount += 1;
    }
  }

  return {
    cashUsd: cashUsd ?? (cashFromRows > 0 ? cashFromRows : undefined),
    positionsUsd: positionsCount > 0 ? positionsUsd : undefined,
    positionsCount: positionsCount > 0 ? positionsCount : undefined,
    portfolioUsd: firstNumber(ro, ["portfolioUsd", "totalEquityUsd"]),
    nativeSol,
  };
}

function mapActivity(json: unknown): FomoActivityItem[] {
  const ro = unwrapFomo(json);
  const rows = Array.isArray(ro)
    ? ro
    : Array.isArray(ro.activity)
      ? (ro.activity as unknown[])
      : Array.isArray(ro.items)
        ? (ro.items as unknown[])
        : Array.isArray(ro.feed)
          ? (ro.feed as unknown[])
          : Array.isArray(ro.trades)
            ? (ro.trades as unknown[])
            : [];

  const out: FomoActivityItem[] = [];
  for (const row of rows) {
    const r = asObj(row);
    if (!r) continue;
    const type = String(r.type ?? r.eventType ?? r.side ?? r.action ?? "").toLowerCase();
    let side: "buy" | "sell" | null = null;
    if (type.includes("buy") || type === "swap_buy") side = "buy";
    if (type.includes("sell") || type === "swap_sell") side = "sell";
    if (!side) {
      const s = String(r.side ?? "").toLowerCase();
      if (s === "buy" || s === "sell") side = s;
    }
    const mint =
      str(r.tokenAddress) ||
      str(r.mint) ||
      str(asObj(r.token)?.address) ||
      str(asObj(r.tokenMetadata)?.address) ||
      "";
    if (!side || !mint) continue;
    const user = asObj(r.user) ?? asObj(r.trader) ?? {};
    out.push({
      side,
      mint,
      handle: str(user.userHandle) || str(r.userHandle) || str(r.handle),
      userId: str(user.id) || str(r.userId),
      wallet: str(user.address) || str(r.address) || str(r.wallet),
      usdAmount: num(r.usdAmount) ?? num(r.amountUsd) ?? num(r.humanUsdAmount),
      at: str(r.createdAt) || str(r.timestamp) || new Date().toISOString(),
      rawId: str(r.id) || str(r.feedId) || str(r.tradeId),
    });
  }
  return out;
}
