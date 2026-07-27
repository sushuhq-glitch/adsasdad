import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger.js";

export interface UserBotSettings {
  fomoApiKey: string;
  /** Budget fisso per ogni COPY BUY (SOL) */
  fixedTradeSol: number;
  solUsd: number;
  /** Username Fomo da tracciare (senza @) */
  fomoUsernames: string[];
  onboarded: boolean;
  updatedAt: string;
}

const FILE = path.resolve("data/user-settings.json");

const DEFAULT_USERNAMES = ["lc1cle___", "PoorGoat_", "unipcs"];

export function defaultSettings(): UserBotSettings {
  return {
    fomoApiKey: "",
    fixedTradeSol: 0.15,
    solUsd: 150,
    fomoUsernames: [...DEFAULT_USERNAMES],
    onboarded: false,
    updatedAt: new Date().toISOString(),
  };
}

export class UserSettingsStore {
  private settings: UserBotSettings = defaultSettings();

  get(): UserBotSettings {
    return { ...this.settings, fomoUsernames: [...this.settings.fomoUsernames] };
  }

  async load(fallbackTradeSol = 0.15): Promise<UserBotSettings> {
    try {
      const raw = await fs.readFile(FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<UserBotSettings>;
      this.settings = {
        ...defaultSettings(),
        ...parsed,
        fixedTradeSol: Number(parsed.fixedTradeSol ?? fallbackTradeSol) || fallbackTradeSol,
        fomoUsernames:
          Array.isArray(parsed.fomoUsernames) && parsed.fomoUsernames.length
            ? parsed.fomoUsernames.map(normalizeUsername)
            : [...DEFAULT_USERNAMES],
      };
      logger.info(
        {
          onboarded: this.settings.onboarded,
          tradeSol: this.settings.fixedTradeSol,
          targets: this.settings.fomoUsernames.length,
        },
        "User settings caricati",
      );
    } catch {
      this.settings = { ...defaultSettings(), fixedTradeSol: fallbackTradeSol };
    }
    return this.get();
  }

  async save(patch: Partial<UserBotSettings>): Promise<UserBotSettings> {
    this.settings = {
      ...this.settings,
      ...patch,
      fomoUsernames: (patch.fomoUsernames ?? this.settings.fomoUsernames).map(normalizeUsername),
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(this.settings, null, 2), "utf8");
    return this.get();
  }
}

export function normalizeUsername(u: string): string {
  return u.trim().replace(/^@/, "");
}

export function formatUsername(u: string): string {
  const n = normalizeUsername(u);
  return n ? `@${n}` : "@unknown";
}
