import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/money.js";
import { DexScreenerClient } from "../scrapers/dexscreener.js";
import type { MirrorSignal, TrackedWallet } from "./types.js";
import type { WalletRegistry } from "./wallet-registry.js";

/** Username Fomo di default (DEMO) se la lista utente è vuota */
const DEFAULT_DEMO_TARGETS = [
  { username: "PoorGoat_", rank: 1 },
  { username: "unipcs", rank: 2 },
  { username: "lc1cle___", rank: 3 },
];

/**
 * Feed dimostrativo FOMO (solo paper): simula buy/sell dei target username
 * usando token caldi DexScreener, finché non hai API FOMO o wallet reali.
 */
export class FomoDemoFeed {
  private timer: NodeJS.Timeout | null = null;
  private i = 0;
  private openDemo = new Map<string, { mint: string; wallet: TrackedWallet }>();
  private readonly dex: DexScreenerClient;
  private targetUsernames: string[] = DEFAULT_DEMO_TARGETS.map((t) => t.username);

  constructor(
    private readonly config: AppConfig,
    private readonly registry: WalletRegistry,
  ) {
    this.dex = new DexScreenerClient(config.DEXSCREENER_BASE);
  }

  setTargetUsernames(usernames: string[]): void {
    this.targetUsernames = usernames.length
      ? usernames.map((u) => u.replace(/^@/, ""))
      : DEFAULT_DEMO_TARGETS.map((t) => t.username);
  }

  start(onSignal: (s: MirrorSignal) => void | Promise<void>): void {
    if (this.config.TRADING_MODE !== "paper" || !this.config.COPY_DEMO_FOMO_FEED) return;
    this.ensureDemoWallets();
    this.timer = setInterval(() => void this.tick(onSignal), this.config.COPY_DEMO_INTERVAL_MS);
    logger.info(
      { targets: this.targetUsernames },
      "FOMO DEMO feed attivo (paper) — target usernames",
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Crea wallet DEMO solo per gli username target (non Top 50 generici) */
  ensureDemoWallets(): void {
    const now = nowIso();
    const targets = this.targetUsernames.length
      ? this.targetUsernames
      : DEFAULT_DEMO_TARGETS.map((t) => t.username);

    for (const [idx, username] of targets.entries()) {
      const existing = this.registry.findByUsername(username);
      if (existing) continue;
      const meta = DEFAULT_DEMO_TARGETS.find(
        (t) => t.username.toLowerCase() === username.toLowerCase(),
      );
      const rank = meta?.rank ?? idx + 1;
      this.registry.upsertMany([
        {
          address: fakeAddress(rank + 100),
          label: `@${username}`,
          username,
          rank,
          realizedPnlUsd: 250_000 - rank * 12_000,
          winRatePct: 62 - rank,
          source: "fomo",
          reliabilityScore: 88 - rank,
          enabled: true,
          addedAt: now,
        },
      ]);
    }

    // Disabilita wallet non nella lista target
    this.registry.enableOnlyUsernames(targets);
  }

  private openedAt = new Map<string, number>();

  private async tick(onSignal: (s: MirrorSignal) => void | Promise<void>): Promise<void> {
    try {
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
      const wallets = this.registry
        .list(true)
        .filter((w) => w.username && this.targetUsernames.some((u) => u.toLowerCase() === w.username!.toLowerCase()));
      if (!wallets.length) {
        this.ensureDemoWallets();
        return;
      }
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
        // amount del target IGNORATO dal mirror — solo stima display
        amountSolEstimate: 1.5 + Math.random() * 3,
        latencyMs: 60 + Math.floor(Math.random() * 100),
      });
    } catch (err) {
      logger.debug({ err }, "demo feed tick failed");
    }
  }
}

function fakeAddress(n: number): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "Fomo";
  let x = n * 9973 + 42;
  while (s.length < 44) {
    s += alphabet[x % alphabet.length];
    x = Math.imul(x, 1664525) + 1013904223;
  }
  return s.slice(0, 44);
}
