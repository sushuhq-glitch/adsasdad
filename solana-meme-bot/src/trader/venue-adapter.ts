import type { AppConfig } from "../config/schema.js";
import type { ExecutionVenue, OrderRequest, OrderResult } from "../types/index.js";
import { logger } from "../lib/logger.js";
import type { ExecutionAdapter } from "./types.js";
import { PaperExecutionAdapter } from "./paper-adapter.js";
import { FomoLiveExecutionAdapter } from "./fomo-adapter.js";
import { FomoTradingClient } from "../copy/fomo-trading.js";

/**
 * Adapter HTTP generico per Axiom / Anthem / Pump.fun.
 * FOMO live usa FomoLiveExecutionAdapter (nessun fallback paper).
 */
export class HttpVenueAdapter implements ExecutionAdapter {
  constructor(
    readonly venue: Exclude<ExecutionVenue, "paper">,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly dryRun: boolean,
    private readonly paper: PaperExecutionAdapter,
    private readonly allowPaperFallback: boolean,
  ) {}

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    if (this.venue !== "pumpfun" && !this.apiKey) {
      return { ok: false, message: `${this.venue}: API key mancante` };
    }
    try {
      const healthPath = this.venue === "pumpfun" ? "/coins/king-of-the-hill" : "/health";
      const headers: Record<string, string> = { accept: "application/json" };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      const res = await fetch(`${this.baseUrl}${healthPath}`, { headers });
      if (res.ok) return { ok: true, message: `${this.venue} health OK` };
      if (res.status === 404) {
        return {
          ok: false,
          message: `${this.venue}: endpoint non trovato — possibile cambio API`,
        };
      }
      return { ok: false, message: `${this.venue}: HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        message: `${this.venue}: unreachable (${err instanceof Error ? err.message : "error"})`,
      };
    }
  }

  async placeOrder(req: OrderRequest, markPriceUsd: number): Promise<OrderResult> {
    if (this.dryRun || (this.venue !== "pumpfun" && !this.apiKey)) {
      if (!this.allowPaperFallback) {
        return {
          ok: false,
          venue: this.venue,
          filledPriceUsd: 0,
          filledAmountSol: 0,
          filledTokenAmount: 0,
          simulated: false,
          error: `${this.venue}: dry-run/key mancante — paper fallback disabilitato in REAL mode`,
        };
      }
      logger.warn({ venue: this.venue }, "Ordine dirottato su paper (dry-run o key mancante)");
      return this.paper.placeOrder({ ...req, venue: "paper" }, markPriceUsd);
    }

    try {
      const path = this.venue === "pumpfun" ? "/trade" : "/orders";
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
      };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          side: req.side,
          mint: req.mint,
          amountSol: req.amountSol,
          tokenAmount: req.tokenAmount,
          slippageBps: req.slippageBps,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false,
          venue: this.venue,
          filledPriceUsd: 0,
          filledAmountSol: 0,
          filledTokenAmount: 0,
          simulated: false,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as Record<string, unknown>;
      return {
        ok: true,
        venue: this.venue,
        txSignature: String(json.txSignature ?? json.signature ?? ""),
        filledPriceUsd: Number(json.filledPriceUsd ?? markPriceUsd),
        filledAmountSol: Number(json.filledAmountSol ?? req.amountSol ?? 0),
        filledTokenAmount: Number(json.filledTokenAmount ?? req.tokenAmount ?? 0),
        simulated: false,
        raw: json,
      };
    } catch (err) {
      return {
        ok: false,
        venue: this.venue,
        filledPriceUsd: 0,
        filledAmountSol: 0,
        filledTokenAmount: 0,
        simulated: false,
        error: err instanceof Error ? err.message : "order failed",
      };
    }
  }
}

export function buildExecutionRouter(
  config: AppConfig,
  opts?: {
    fomoClient?: FomoTradingClient;
    getFomoApiKey?: () => string;
    getSolUsd?: () => number;
  },
): ExecutionRouter {
  const paper = new PaperExecutionAdapter();
  const isPaper = config.TRADING_MODE === "paper" || config.DRY_RUN;
  const fomoClient = opts?.fomoClient ?? new FomoTradingClient({ apiBase: config.FOMO_API_BASE });
  const getKey = opts?.getFomoApiKey ?? (() => config.FOMO_API_KEY);
  const getSolUsd = opts?.getSolUsd ?? (() => 150);

  const fomoAdapter: ExecutionAdapter = isPaper
    ? new HttpVenueAdapter("fomo", config.FOMO_API_BASE, config.FOMO_API_KEY, true, paper, true)
    : new FomoLiveExecutionAdapter(fomoClient, getKey, getSolUsd);

  return new ExecutionRouter(config, paper, {
    axiom: new HttpVenueAdapter("axiom", config.AXIOM_API_BASE, config.AXIOM_API_KEY, isPaper, paper, isPaper),
    anthem: new HttpVenueAdapter(
      "anthem",
      config.ANTHEM_API_BASE,
      config.ANTHEM_API_KEY,
      isPaper,
      paper,
      isPaper,
    ),
    fomo: fomoAdapter,
    pumpfun: new HttpVenueAdapter(
      "pumpfun",
      config.PUMPFUN_API_BASE,
      config.PUMPFUN_API_KEY,
      isPaper,
      paper,
      isPaper,
    ),
    paper,
  });
}

export class ExecutionRouter {
  constructor(
    private readonly config: AppConfig,
    private readonly paper: PaperExecutionAdapter,
    private readonly adapters: Record<ExecutionVenue, ExecutionAdapter>,
  ) {}

  /** Aggiorna adapter FOMO live (dopo onboarding REAL). */
  setAdapter(venue: ExecutionVenue, adapter: ExecutionAdapter): void {
    this.adapters[venue] = adapter;
  }

  preferred(): ExecutionAdapter {
    if (this.config.TRADING_MODE === "paper" || this.config.DRY_RUN) return this.paper;
    return this.adapters[this.config.PREFERRED_EXECUTION_VENUE] ?? this.adapters.fomo;
  }

  async healthAll() {
    const entries = await Promise.all(
      (Object.keys(this.adapters) as ExecutionVenue[]).map(async (v) => {
        const h = await this.adapters[v].healthCheck();
        return { venue: v, ...h };
      }),
    );
    return entries;
  }

  async buy(mint: string, amountSol: number, markPriceUsd: number, slippageBps: number) {
    const adapter = this.preferred();
    return adapter.placeOrder(
      { side: "buy", mint, amountSol, slippageBps, venue: adapter.venue },
      markPriceUsd,
    );
  }

  async sell(mint: string, tokenAmount: number, markPriceUsd: number, slippageBps: number) {
    const adapter = this.preferred();
    return adapter.placeOrder(
      { side: "sell", mint, tokenAmount, slippageBps, venue: adapter.venue },
      markPriceUsd,
    );
  }
}
