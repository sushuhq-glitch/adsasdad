import type { OrderRequest, OrderResult } from "../types/index.js";
import type { ExecutionAdapter } from "./types.js";
import { uid } from "../lib/money.js";

/**
 * Paper adapter: fill al mark price live.
 * Nessuna fee fittizia sul prezzo — PnL % = variazione di mercato reale.
 */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly venue = "paper" as const;
  private solUsdEstimate: number;

  constructor(solUsdEstimate = 150) {
    this.solUsdEstimate = solUsdEstimate;
  }

  setSolUsd(n: number): void {
    if (n > 0) this.solUsdEstimate = n;
  }

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

    // Fill esatto al mark: niente slip artificiale sul prezzo
    const fillPrice = tokenPriceUsd;

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
