import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/money.js";
import type { MirrorSignal } from "./types.js";
import { FomoTradingClient } from "./fomo-trading.js";
import type { WalletRegistry } from "./wallet-registry.js";

/**
 * Feed REAL di attività FOMO (tradingActivity + activity per username target).
 * Sostituisce il demo feed quando la sessione è REAL.
 */
export class FomoActivityFeed {
  private timer: NodeJS.Timeout | null = null;
  private seen = new Set<string>();
  private targetUsernames: string[] = [];
  private handleToUserId = new Map<string, string>();

  constructor(
    private readonly config: AppConfig,
    private readonly client: FomoTradingClient,
    private readonly registry: WalletRegistry,
    private readonly getApiKey: () => string,
  ) {}

  setTargetUsernames(usernames: string[]): void {
    this.targetUsernames = usernames.map((u) => u.replace(/^@/, ""));
  }

  start(onSignal: (s: MirrorSignal) => void | Promise<void>): void {
    if (this.timer) return;
    const interval = Math.max(5_000, this.config.COPY_POLL_INTERVAL_MS);
    this.timer = setInterval(() => void this.tick(onSignal), interval);
    void this.tick(onSignal);
    logger.info({ targets: this.targetUsernames }, "FOMO REAL activity feed avviato");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(onSignal: (s: MirrorSignal) => void | Promise<void>): Promise<void> {
    const key = this.getApiKey();
    if (!key) return;
    const targets = new Set(this.targetUsernames.map((u) => u.toLowerCase()));
    if (!targets.size) return;

    try {
      // Risolvi handle → userId / wallet on-chain
      for (const u of this.targetUsernames) {
        const lk = u.toLowerCase();
        if (this.handleToUserId.has(lk)) continue;
        const resolved = await this.client.resolveHandle(key, u);
        if (resolved?.userId) this.handleToUserId.set(lk, resolved.userId);
        if (resolved?.solanaAddress) {
          this.registry.upsertMany([
            {
              address: resolved.solanaAddress,
              label: `@${resolved.handle || u}`,
              username: resolved.handle || u,
              source: "fomo",
              reliabilityScore: 90,
              enabled: true,
              addedAt: nowIso(),
            },
          ]);
        }
      }

      const feed = await this.client.fetchTradingActivity(key, 80);
      for (const item of feed) {
        const handle = (item.handle || "").replace(/^@/, "").toLowerCase();
        if (!handle || !targets.has(handle)) continue;
        await this.emit(item, onSignal);
      }

      for (const [handle, userId] of this.handleToUserId) {
        if (!targets.has(handle)) continue;
        const acts = await this.client.fetchUserActivity(key, userId, 20);
        for (const item of acts) {
          await this.emit({ ...item, handle: item.handle || handle }, onSignal);
        }
      }
    } catch (err) {
      logger.warn({ err }, "FOMO activity feed tick failed");
    }
  }

  private async emit(
    item: {
      side: "buy" | "sell";
      mint: string;
      handle?: string;
      wallet?: string;
      rawId?: string;
      at: string;
    },
    onSignal: (s: MirrorSignal) => void | Promise<void>,
  ): Promise<void> {
    const id = item.rawId || `${item.handle}:${item.mint}:${item.side}:${item.at}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    if (this.seen.size > 2_000) {
      const keep = [...this.seen].slice(-1_000);
      this.seen = new Set(keep);
    }

    const handle = (item.handle || "unknown").replace(/^@/, "");
    const wallet =
      this.registry.findByUsername(handle) ||
      (item.wallet
        ? {
            address: item.wallet,
            label: `@${handle}`,
            username: handle,
            source: "fomo" as const,
            reliabilityScore: 85,
            enabled: true,
            addedAt: nowIso(),
          }
        : null);
    if (!wallet) return;

    const signal: MirrorSignal = {
      side: item.side,
      mint: item.mint,
      signature: id.slice(0, 64),
      slot: Date.now(),
      detectedAt: item.at || nowIso(),
      wallet,
      sellFraction: item.side === "sell" ? 1 : undefined,
    };
    await onSignal(signal);
  }
}
