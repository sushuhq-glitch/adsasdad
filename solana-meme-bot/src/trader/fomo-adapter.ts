import type { OrderRequest, OrderResult } from "../types/index.js";
import type { ExecutionAdapter } from "./types.js";
import { FomoTradingClient } from "../copy/fomo-trading.js";
import { logger } from "../lib/logger.js";

/**
 * Adapter di esecuzione REAL su account FOMO.
 * Non dirotta mai su paper: se l'API fallisce, l'ordine fallisce.
 */
export class FomoLiveExecutionAdapter implements ExecutionAdapter {
  readonly venue = "fomo" as const;

  constructor(
    private readonly client: FomoTradingClient,
    private readonly getApiKey: () => string,
    private readonly getSolUsd: () => number,
  ) {}

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    const key = this.getApiKey();
    if (!key) return { ok: false, message: "fomo: API Key (privy:token) mancante" };
    const bal = await this.client.fetchBalance(key, this.getSolUsd());
    if (!bal.ok) return { ok: false, message: bal.error || "fomo balance fail" };
    return {
      ok: true,
      message: `fomo REAL OK · @${bal.handle || "?"} · ${bal.availableSol.toFixed(4)} SOL`,
    };
  }

  async placeOrder(req: OrderRequest, markPriceUsd: number): Promise<OrderResult> {
    const key = this.getApiKey();
    if (!key) {
      return {
        ok: false,
        venue: "fomo",
        filledPriceUsd: 0,
        filledAmountSol: 0,
        filledTokenAmount: 0,
        simulated: false,
        error: "FOMO API Key assente — impossibile eseguire REAL trade",
      };
    }

    logger.info(
      { side: req.side, mint: req.mint, amountSol: req.amountSol, tokenAmount: req.tokenAmount },
      "FOMO LIVE placeOrder",
    );

    return this.client.placeTrade(key, {
      side: req.side,
      mint: req.mint,
      amountSol: req.amountSol,
      tokenAmount: req.tokenAmount,
      markPriceUsd,
      slippageBps: req.slippageBps,
      solUsd: this.getSolUsd(),
    });
  }
}
