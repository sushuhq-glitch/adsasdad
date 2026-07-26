import express from "express";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../config/schema.js";
import type { AlertBus } from "../lib/alert-bus.js";
import { logger } from "../lib/logger.js";
import type { WalletManager } from "../trader/wallet-manager.js";
import type { BotRuntimeState } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Contratto minimo usato dalla dashboard (evita import circolari con index.ts). */
export interface DashboardController {
  alerts: AlertBus;
  wallet: WalletManager;
  getState(): BotRuntimeState;
  pause(reason?: string): Promise<void>;
  resume(): Promise<void>;
  setBudget(amountSol: number): Promise<void>;
  persist(): Promise<void>;
}

function resolvePublicDir(): string {
  const candidates = [
    path.join(__dirname, "public"),
    path.resolve("src/ui/public"),
    path.resolve("dist/ui/public"),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? path.join(__dirname, "public");
}

export function startDashboard(controller: DashboardController, config: AppConfig): Server {
  const app = express();
  app.use(express.json());
  app.use(express.static(resolvePublicDir()));

  const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const token = req.header("x-auth-token") || (req.query.token as string | undefined);
    if (token !== config.DASHBOARD_AUTH_TOKEN) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/state", auth, (_req, res) => {
    const state = controller.getState();
    res.json({
      ...state,
      pendingAlerts: controller.alerts.pendingUpdates(),
      thresholds: {
        minConfidence: config.MIN_CONFIDENCE_SCORE,
        minSafety: config.MIN_SAFETY_SCORE,
        zeroDoubt: config.ZERO_DOUBT_MODE,
      },
      wallet: controller.wallet.getPublicKey(),
    });
  });

  app.post("/api/pause", auth, async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "Dashboard";
    await controller.pause(reason);
    res.json({ ok: true, status: controller.getState().status });
  });

  app.post("/api/resume", auth, async (_req, res) => {
    await controller.resume();
    res.json({ ok: true, status: controller.getState().status });
  });

  app.post("/api/budget", auth, async (req, res) => {
    const amount = Number(req.body?.amountSol);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "amountSol non valido" });
      return;
    }
    await controller.setBudget(amount);
    const state = controller.getState();
    res.json({ ok: true, budgetSol: state.budgetSol, residualBudgetSol: state.residualBudgetSol });
  });

  app.post("/api/alerts/:id/ack", auth, async (req, res) => {
    const id = String(req.params.id);
    const ok = controller.alerts.acknowledge(id);
    await controller.persist();
    res.json({ ok });
  });

  const server = app.listen(config.DASHBOARD_PORT, config.DASHBOARD_HOST, () => {
    logger.info(
      { host: config.DASHBOARD_HOST, port: config.DASHBOARD_PORT },
      "Dashboard in ascolto",
    );
  });

  return server;
}
