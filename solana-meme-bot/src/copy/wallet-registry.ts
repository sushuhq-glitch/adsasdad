import { promises as fs } from "node:fs";
import path from "node:path";
import { nowIso } from "../lib/money.js";
import { logger } from "../lib/logger.js";
import type { TrackedWallet } from "./types.js";

const FILE = path.resolve("data/tracked-wallets.json");

export class WalletRegistry {
  private wallets = new Map<string, TrackedWallet>();

  list(enabledOnly = false): TrackedWallet[] {
    const all = [...this.wallets.values()].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    return enabledOnly ? all.filter((w) => w.enabled) : all;
  }

  get(address: string): TrackedWallet | undefined {
    return this.wallets.get(address);
  }

  has(address: string): boolean {
    return this.wallets.has(address);
  }

  findByUsername(username: string): TrackedWallet | undefined {
    const key = username.replace(/^@/, "").toLowerCase();
    return this.list().find((w) => w.username?.toLowerCase() === key);
  }

  /** Abilita solo wallet il cui username è nella lista target Fomo */
  enableOnlyUsernames(usernames: string[]): void {
    const set = new Set(usernames.map((u) => u.replace(/^@/, "").toLowerCase()));
    for (const w of this.wallets.values()) {
      if (!w.username) {
        // seed/manual senza username restano come erano se lista vuota
        if (set.size > 0 && w.source !== "manual") w.enabled = false;
        continue;
      }
      w.enabled = set.has(w.username.toLowerCase());
    }
  }

  upsertMany(rows: TrackedWallet[], opts?: { preserveManual?: boolean }): void {
    for (const row of rows) {
      const prev = this.wallets.get(row.address);
      if (opts?.preserveManual && prev?.source === "manual") {
        this.wallets.set(row.address, {
          ...prev,
          realizedPnlUsd: row.realizedPnlUsd ?? prev.realizedPnlUsd,
          winRatePct: row.winRatePct ?? prev.winRatePct,
          reliabilityScore: Math.max(prev.reliabilityScore, row.reliabilityScore),
          rank: prev.rank ?? row.rank,
        });
        continue;
      }
      this.wallets.set(row.address, {
        ...row,
        enabled: prev?.enabled ?? row.enabled,
        addedAt: prev?.addedAt ?? row.addedAt,
        lastSeenAt: prev?.lastSeenAt,
        lastTxSignature: prev?.lastTxSignature,
      });
    }
  }

  addManual(address: string, label?: string): TrackedWallet {
    const wallet: TrackedWallet = {
      address,
      label: label || `Manual ${address.slice(0, 4)}…${address.slice(-4)}`,
      source: "manual",
      reliabilityScore: 60,
      enabled: true,
      addedAt: nowIso(),
    };
    this.wallets.set(address, wallet);
    return wallet;
  }

  remove(address: string): boolean {
    return this.wallets.delete(address);
  }

  setEnabled(address: string, enabled: boolean): boolean {
    const w = this.wallets.get(address);
    if (!w) return false;
    w.enabled = enabled;
    return true;
  }

  touch(address: string, signature?: string): void {
    const w = this.wallets.get(address);
    if (!w) return;
    w.lastSeenAt = nowIso();
    if (signature) w.lastTxSignature = signature;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(FILE, "utf8");
      const rows = JSON.parse(raw) as TrackedWallet[];
      this.wallets.clear();
      for (const r of rows) this.wallets.set(r.address, r);
      logger.info({ count: this.wallets.size }, "Tracked wallets caricati");
    } catch {
      /* first run */
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(this.list(), null, 2), "utf8");
  }
}
