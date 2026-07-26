import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/money.js";
import { DexScreenerClient } from "../scrapers/dexscreener.js";
import type { MirrorSignal, TrackedWallet } from "./types.js";
import type { WalletRegistry } from "./wallet-registry.js";

/**
 * Feed dimostrativo FOMO (solo paper): simula buy/sell dei Top PnL
 * usando token caldi DexScreener, finché non hai API FOMO o wallet reali.
 * I segnali sono etichettati "FOMO Top PnL #N (DEMO)".
 */
export class FomoDemoFeed {
  private timer: NodeJS.Timeout | null = null;
  private i = 0;
  private openDemo = new Map<string, { mint: string; wallet: TrackedWallet }>();
  private readonly dex: DexScreenerClient;

  constructor(
    private readonly config: AppConfig,
    private readonly registry: WalletRegistry,
  ) {
    this.dex = new DexScreenerClient(config.DEXSCREENER_BASE);
  }

  start(onSignal: (s: MirrorSignal) => void | Promise<void>): void {
    if (this.config.TRADING_MODE !== "paper" || !this.config.COPY_DEMO_FOMO_FEED) return;
    this.ensureDemoWallets();
    this.timer = setInterval(() => void this.tick(onSignal), this.config.COPY_DEMO_INTERVAL_MS);
    logger.info("FOMO DEMO feed attivo (paper) — sostituisci con wallet reali ASAP");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private ensureDemoWallets(): void {
    if (this.registry.list().length) return;
    const now = nowIso();
    const demo: TrackedWallet[] = Array.from({ length: 10 }, (_, idx) => ({
      address: `DemoFomoWallet${String(idx + 1).padStart(2, "0")}111111111111111111111`,
      // invalid sol addresses on purpose — demo feed doesn't hit chain for these
      label: `FOMO Top PnL #${idx + 1} (DEMO)`,
      rank: idx + 1,
      realizedPnlUsd: 250_000 - idx * 12_000,
      winRatePct: 62 - idx,
      source: "fomo",
      reliabilityScore: 88 - idx,
      enabled: true,
      addedAt: now,
    }));
    // Use placeholder base58-looking unique strings that won't pass chain subscribe
    // Replace with deterministic fake keys derived from index for registry display only
    const fixed = demo.map((d, idx) => ({
      ...d,
      address: fakeAddress(idx + 1),
    }));
    this.registry.upsertMany(fixed);
  }

  private openedAt = new Map<string, number>();

  private async tick(onSignal: (s: MirrorSignal) => void | Promise<void>): Promise<void> {
    try {
      // Chiudi posizioni demo solo dopo un hold minimo (evita sell≈entry)
      const minHoldMs = 20_000;
      for (const [mint, row] of [...this.openDemo.entries()]) {
        const held = Date.now() - (this.openedAt.get(mint) ?? 0);
        if (held < minHoldMs) continue;
        if (Math.random() > 0.55) continue;
        this.openDemo.delete(mint);
        this.openedAt.delete(mint);
        await onSignal({
          side: "sell",
          wallet: row.wallet,
          mint,
          signature: `demo_sell_${Date.now()}`,
          detectedAt: nowIso(),
          sellFraction: 1,
          latencyMs: 80 + Math.floor(Math.random() * 120),
        });
      }

      const candidates = await this.dex.fetchSolanaBoosts();
      if (!candidates.length) return;
      const wallets = this.registry.list(true).filter((w) => w.label.includes("DEMO"));
      if (!wallets.length) return;
      const wallet = wallets[this.i % wallets.length]!;
      this.i += 1;
      const token = candidates[this.i % candidates.length]!;
      if (this.openDemo.has(token.mint)) return;

      this.openDemo.set(token.mint, { mint: token.mint, wallet });
      this.openedAt.set(token.mint, Date.now());
      await onSignal({
        side: "buy",
        wallet,
        mint: token.mint,
        signature: `demo_buy_${Date.now()}`,
        detectedAt: nowIso(),
        amountSolEstimate: this.config.COPY_TRADE_SOL,
        latencyMs: 60 + Math.floor(Math.random() * 100),
      });
    } catch (err) {
      logger.debug({ err }, "demo feed tick failed");
    }
  }
}

function fakeAddress(n: number): string {
  // Valid-looking base58 length; not used on-chain in demo path
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "Fomo";
  let x = n * 9973 + 42;
  while (s.length < 44) {
    s += alphabet[x % alphabet.length];
    x = Math.imul(x, 1664525) + 1013904223;
  }
  return s.slice(0, 44);
}
