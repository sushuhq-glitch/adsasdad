import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../lib/logger.js";
import type { MirrorSide } from "./types.js";

const WSOL = "So11111111111111111111111111111111111111112";

export interface DecodedMirrorTrade {
  side: MirrorSide;
  mint: string;
  sellFraction?: number;
  amountSolEstimate?: number;
}

/**
 * Decodifica BUY/SELL da una tx Solana del wallet target.
 * Euristica robusta su delta token accounts (pre/post balances).
 */
export async function decodeWalletTrade(
  connection: Connection,
  signature: string,
  walletAddress: string,
): Promise<DecodedMirrorTrade | null> {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx?.meta || tx.meta.err) return null;

    const owner = walletAddress;
    const pre = tx.meta.preTokenBalances ?? [];
    const post = tx.meta.postTokenBalances ?? [];

    type Agg = { mint: string; pre: number; post: number };
    const map = new Map<string, Agg>();

    for (const b of pre) {
      if (b.owner !== owner) continue;
      const mint = b.mint;
      const amount = Number(b.uiTokenAmount.uiAmount ?? 0);
      map.set(mint, { mint, pre: amount, post: 0 });
    }
    for (const b of post) {
      if (b.owner !== owner) continue;
      const mint = b.mint;
      const amount = Number(b.uiTokenAmount.uiAmount ?? 0);
      const prev = map.get(mint) ?? { mint, pre: 0, post: 0 };
      prev.post = amount;
      map.set(mint, prev);
    }

    // Preferisci mint non-WSOL con delta maggiore
    let best: { mint: string; delta: number; pre: number; post: number } | null = null;
    for (const row of map.values()) {
      if (row.mint === WSOL) continue;
      const delta = row.post - row.pre;
      if (!best || Math.abs(delta) > Math.abs(best.delta)) {
        best = { mint: row.mint, delta, pre: row.pre, post: row.post };
      }
    }
    if (!best || Math.abs(best.delta) < 1e-9) return null;

    // SOL spent/received approx from native lamports
    const idx = tx.transaction.message.accountKeys.findIndex((k) => {
      if (typeof k === "string") return k === owner;
      if ("pubkey" in k) return k.pubkey.toBase58() === owner;
      try {
        return new PublicKey(k as unknown as string).toBase58() === owner;
      } catch {
        return false;
      }
    });
    let amountSolEstimate: number | undefined;
    if (idx >= 0 && tx.meta.preBalances[idx] != null && tx.meta.postBalances[idx] != null) {
      amountSolEstimate = Math.abs(tx.meta.preBalances[idx]! - tx.meta.postBalances[idx]!) / 1e9;
    }

    if (best.delta > 0) {
      return { side: "buy", mint: best.mint, amountSolEstimate };
    }

    const sellFraction =
      best.pre > 0 ? Math.min(1, Math.max(0, (best.pre - best.post) / best.pre)) : 1;
    return {
      side: "sell",
      mint: best.mint,
      sellFraction,
      amountSolEstimate,
    };
  } catch (err) {
    logger.debug({ err, signature }, "decodeWalletTrade failed");
    return null;
  }
}
