import { Connection, PublicKey } from "@solana/web3.js";
import type { AppConfig } from "../config/schema.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/money.js";
import { decodeWalletTrade } from "./trade-decoder.js";
import type { MirrorSignal, TrackedWallet } from "./types.js";
import type { WalletRegistry } from "./wallet-registry.js";

export type MirrorHandler = (signal: MirrorSignal) => void | Promise<void>;

/**
 * Ascolto ad alta velocità:
 * - WebSocket logsSubscribe per ogni wallet target
 * - Polling signatures come backup + auto-riconnessione
 */
export class SolanaWalletWatcher {
  private connection: Connection;
  private subs = new Map<string, number>();
  private pollTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private seenSigs = new Set<string>();
  private running = false;
  private handler: MirrorHandler | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly registry: WalletRegistry,
  ) {
    this.connection = new Connection(this.rpcHttp(), {
      wsEndpoint: this.rpcWs(),
      commitment: "confirmed",
    });
  }

  private rpcHttp(): string {
    return this.config.SOLANA_RPC_URL;
  }

  private rpcWs(): string {
    if (this.config.SOLANA_WS_URL) return this.config.SOLANA_WS_URL;
    return this.config.SOLANA_RPC_URL.replace("https://", "wss://").replace("http://", "ws://");
  }

  async start(handler: MirrorHandler): Promise<void> {
    this.handler = handler;
    this.running = true;
    await this.resubscribeAll();
    this.pollTimer = setInterval(() => void this.pollOnce(), this.config.COPY_POLL_INTERVAL_MS);
    logger.info(
      { wallets: this.registry.list(true).length, ws: this.rpcWs() },
      "Solana wallet watcher avviato",
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const id of this.subs.values()) {
      try {
        await this.connection.removeOnLogsListener(id);
      } catch {
        /* ignore */
      }
    }
    this.subs.clear();
  }

  async resubscribeAll(): Promise<void> {
    for (const id of this.subs.values()) {
      try {
        await this.connection.removeOnLogsListener(id);
      } catch {
        /* ignore */
      }
    }
    this.subs.clear();

    for (const wallet of this.registry.list(true).slice(0, this.config.COPY_MAX_WALLETS)) {
      await this.subscribeWallet(wallet);
    }
  }

  private async subscribeWallet(wallet: TrackedWallet): Promise<void> {
    if (wallet.label.includes("(DEMO)")) return; // gestiti dal demo feed
    try {
      const pk = new PublicKey(wallet.address);
      const subId = this.connection.onLogs(
        pk,
        (logs) => {
          if (logs.err) return;
          void this.handleSignature(wallet, logs.signature, Date.now());
        },
        "confirmed",
      );
      this.subs.set(wallet.address, subId);
    } catch (err) {
      logger.warn({ err, wallet: wallet.address }, "Subscribe wallet fallita — userò polling");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.running) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.resubscribeAll().catch((err) => {
        logger.error({ err }, "Riconnessione watcher fallita");
        this.scheduleReconnect();
      });
    }, this.config.COPY_RECONNECT_MS);
  }

  private async pollOnce(): Promise<void> {
    if (!this.running) return;
    const wallets = this.registry
      .list(true)
      .filter((w) => !w.label.includes("(DEMO)"))
      .slice(0, this.config.COPY_MAX_WALLETS);
    if (!wallets.length) return;
    for (const wallet of wallets) {
      try {
        const sigs = await this.connection.getSignaturesForAddress(new PublicKey(wallet.address), {
          limit: 8,
        });
        for (const s of sigs) {
          if (s.err) continue;
          await this.handleSignature(wallet, s.signature, Date.now());
        }
      } catch (err) {
        logger.debug({ err, wallet: wallet.address }, "poll signatures failed");
        this.scheduleReconnect();
      }
    }
  }

  private async handleSignature(
    wallet: TrackedWallet,
    signature: string,
    t0: number,
  ): Promise<void> {
    if (this.seenSigs.has(signature)) return;
    this.seenSigs.add(signature);
    if (this.seenSigs.size > 5_000) {
      const trim = [...this.seenSigs].slice(-2_500);
      this.seenSigs = new Set(trim);
    }

    const decoded = await decodeWalletTrade(this.connection, signature, wallet.address);
    if (!decoded) return;

    this.registry.touch(wallet.address, signature);
    const signal: MirrorSignal = {
      side: decoded.side,
      wallet,
      mint: decoded.mint,
      signature,
      detectedAt: nowIso(),
      sellFraction: decoded.sellFraction,
      amountSolEstimate: decoded.amountSolEstimate,
      latencyMs: Date.now() - t0,
    };
    logger.info(
      {
        side: signal.side,
        mint: signal.mint,
        wallet: wallet.label,
        sig: signature.slice(0, 8),
      },
      "Mirror signal rilevato",
    );
    await this.handler?.(signal);
  }
}
