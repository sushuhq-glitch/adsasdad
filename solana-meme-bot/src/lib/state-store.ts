import { promises as fs } from "node:fs";
import path from "node:path";
import type { BotRuntimeState, RiskTolerance } from "../types/index.js";
import { nowIso } from "./money.js";

const DEFAULT_STATE_PATH = path.resolve("data/runtime-state.json");

export function createInitialState(
  budgetSol: number,
  tradingMode: "paper" | "live",
  riskTolerance: RiskTolerance = "all",
  maxRiskPct = 85,
  copyTradingEnabled = true,
): BotRuntimeState {
  return {
    status: "stopped",
    startedAt: null,
    lastScanAt: null,
    tradingMode,
    budgetSol,
    residualBudgetSol: budgetSol,
    realizedPnlSol: 0,
    unrealizedPnlSol: 0,
    openPositions: [],
    closedTrades: [],
    rejectedTrades: [],
    alerts: [],
    liveInstructions: [],
    riskTolerance,
    maxRiskPct,
    averageOpenRiskPct: 0,
    copyTradingEnabled,
    trackedWallets: [],
    lastMirrorAt: null,
    mirrorBuys: 0,
    mirrorSells: 0,
    copySessionActive: false,
    sessionStartedAt: null,
    sessionRealizedPnlSol: 0,
  };
}

export class StateStore {
  constructor(private readonly filePath = DEFAULT_STATE_PATH) {}

  async load(fallback: BotRuntimeState): Promise<BotRuntimeState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return { ...fallback, ...JSON.parse(raw) } as BotRuntimeState;
    } catch {
      return fallback;
    }
  }

  async save(state: BotRuntimeState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  markScan(state: BotRuntimeState): void {
    state.lastScanAt = nowIso();
  }
}
