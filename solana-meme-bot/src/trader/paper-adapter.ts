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
    const slip = req.slippageBps / 10_000;
    const fillPrice =
      req.side === "buy" ? tokenPriceUsd * (1 + slip / 2) : tokenPriceUsd * (1 - slip / 2);

    if (req.side === "buy") {
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

    const tokenAmount = req.tokenAmount ?? 0;
    const notionalUsd = fillPrice * tokenAmount;
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
