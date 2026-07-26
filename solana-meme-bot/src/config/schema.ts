import { z } from "zod";

const csvIds = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  MIN_CONFIDENCE_SCORE: z.coerce.number().min(0).max(100).default(90),
  MIN_SAFETY_SCORE: z.coerce.number().min(0).max(100).default(90),
  ZERO_DOUBT_MODE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  BUDGET_SOL: z.coerce.number().positive().default(1),
  MAX_POSITION_SOL: z.coerce.number().positive().default(0.25),
  MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(3),
  MAX_DAILY_LOSS_SOL: z.coerce.number().positive().default(0.5),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().positive().default(150),
  TAKE_PROFIT_PCT: z.coerce.number().positive().default(100),
  STOP_LOSS_PCT: z.coerce.number().positive().default(25),
  TRAILING_STOP_PCT: z.coerce.number().positive().default(15),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  WALLET_PRIVATE_KEY: z.string().optional().default(""),
  AXIOM_API_KEY: z.string().optional().default(""),
  AXIOM_API_BASE: z.string().default("https://api.axiom.example/v1"),
  ANTHEM_API_KEY: z.string().optional().default(""),
  ANTHEM_API_BASE: z.string().default("https://api.anthem.example/v1"),
  PUMPFUN_API_KEY: z.string().optional().default(""),
  PUMPFUN_API_BASE: z.string().default("https://frontend-api.pump.fun"),
  PREFERRED_EXECUTION_VENUE: z.enum(["axiom", "anthem", "pumpfun"]).default("axiom"),
  DEXSCREENER_BASE: z.string().url().default("https://api.dexscreener.com"),
  TREND_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(45_000),
  POSITION_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
  TELEGRAM_ALLOWED_CHAT_IDS: csvIds,
  DASHBOARD_HOST: z.string().default("0.0.0.0"),
  DASHBOARD_PORT: z.coerce.number().int().positive().default(3847),
  DASHBOARD_AUTH_TOKEN: z.string().default("change-me-dashboard-token"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  allowedChatIds: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configurazione non valida: ${details}`);
  }

  const data = parsed.data;
  const allowed = new Set(data.TELEGRAM_ALLOWED_CHAT_IDS);
  if (data.TELEGRAM_CHAT_ID) allowed.add(data.TELEGRAM_CHAT_ID);

  if (data.TRADING_MODE === "live" && !data.WALLET_PRIVATE_KEY) {
    throw new Error("TRADING_MODE=live richiede WALLET_PRIVATE_KEY");
  }

  return {
    ...data,
    allowedChatIds: [...allowed],
  };
}
