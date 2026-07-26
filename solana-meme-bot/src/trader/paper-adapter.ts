import type { OrderRequest, OrderResult } from "../types/index.js";
import type { ExecutionAdapter } from "./types.js";
import { uid } from "../lib/money.js";

/** Simulatore locale: nessun ordine on-chain. */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly venue = "paper" as const;

  constructor(private readonly solUsdEstimate = 150) {}

  async healthCheck() {
    return { ok: true, message: "Paper adapter OK" };
  }

  async placeOrder(req: OrderRequest, tokenPriceUsd: number): Promise<OrderResult> {
    if (!(tokenPriceUsd > 0) || !Number.isFinite(tokenPriceUsd)) {
      return {
        ok: false,
        venue: "paper",
        filledPriceUsd: 0,
        filledAmountSol: 0,
        filledTokenAmount: 0,
        simulated: true,
        error: "Prezzo mark non valido per paper order",
      };
    }

    const slip = req.slippageBps / 10_000;

    if (req.side === "buy") {
      // Entry leggermente peggiore dello spot (slippage)
      const fillPrice = tokenPriceUsd * (1 + slip / 2);
      const amountSol = req.amountSol ?? 0;
      const notionalUsd = amountSol * this.solUsdEstimate;
      const tokenAmount = fillPrice > 0 ? notionalUsd / fillPrice : 0;
      return {
        ok: true,
        venue: "paper",
        txSignature: uid("paper_tx"),
        filledPriceUsd: fillPrice,
        filledAmountSol: amountSol,
        filledTokenAmount: tokenAmount,
        simulated: true,
      };
    }

    // SELL: il filledPriceUsd è il mark di mercato (per PnL % reale).
    // Lo slippage riduce solo il notional SOL recuperato (fee di esecuzione).
    const fillPrice = tokenPriceUsd;
    const tokenAmount = req.tokenAmount ?? 0;
    const notionalUsd = fillPrice * tokenAmount * (1 - slip / 2);
    const amountSol = notionalUsd / this.solUsdEstimate;
    return {
      ok: true,
      venue: "paper",
      txSignature: uid("paper_tx"),
      filledPriceUsd: fillPrice,
      filledAmountSol: amountSol,
      filledTokenAmount: tokenAmount,
      simulated: true,
    };
  }
}
