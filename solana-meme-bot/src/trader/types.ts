import type { OrderRequest, OrderResult } from "../types/index.js";

export interface ExecutionAdapter {
  readonly venue: OrderRequest["venue"];
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
  placeOrder(req: OrderRequest, markPriceUsd: number): Promise<OrderResult>;
}
