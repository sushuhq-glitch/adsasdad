import type { RiskTolerance } from "../types/index.js";

export type TelegramCommand =
  | { type: "pause"; reason?: string }
  | { type: "resume" }
  | { type: "status" }
  | { type: "dashboard" }
  | { type: "budget"; amountSol: number }
  | { type: "update"; instruction: string }
  | { type: "risk_tolerance"; tolerance: RiskTolerance }
  | { type: "risk_max"; maxRiskPct: number }
  | { type: "wallet_add"; address: string; label?: string }
  | { type: "wallet_remove"; address: string }
  | { type: "wallet_list" }
  | { type: "wallet_refresh" }
  | { type: "closeall" }
  | { type: "profitall" }
  | { type: "balance" }
  | { type: "help" }
  | { type: "start" }
  | { type: "unknown"; raw: string };

const TOLERANCE_ALIASES: Record<string, RiskTolerance> = {
  all: "all",
  only_low: "only_low",
  low: "only_low",
  "solo-low": "only_low",
  solo_low: "only_low",
  only_medium: "only_medium",
  medium: "only_medium",
  only_high: "only_high",
  high: "only_high",
  "solo-high": "only_high",
  solo_high: "only_high",
  low_medium: "low_medium",
  medium_high: "medium_high",
};

export function parseTelegramCommand(text: string): TelegramCommand {
  const raw = text.trim();
  const [cmd, ...rest] = raw.split(/\s+/);
  const body = rest.join(" ").trim();
  const c = (cmd ?? "").toLowerCase().split("@")[0] ?? "";

  if (c === "/start" || c === "start") return { type: "start" };
  if (c === "/dashboard" || c === "dashboard" || c === "/panel" || c === "panel") {
    return { type: "dashboard" };
  }
  if (c === "/closeall" || c === "closeall") return { type: "closeall" };
  if (c === "/profitall" || c === "profitall") return { type: "profitall" };
  if (c === "/balance" || c === "balance" || c === "/bal" || c === "bal") return { type: "balance" };
  if (c === "/pause" || c === "pause") return { type: "pause", reason: body || undefined };
  if (c === "/resume" || c === "resume") return { type: "resume" };
  if (c === "/status" || c === "status") return { type: "status" };
  if (c === "/help" || c === "help") return { type: "help" };
  if (c === "/budget" || c === "budget") {
    const amountSol = Number(body);
    if (!Number.isFinite(amountSol) || amountSol <= 0) return { type: "unknown", raw };
    return { type: "budget", amountSol };
  }
  if (c === "/update" || c === "update") {
    if (!body) return { type: "unknown", raw };
    return { type: "update", instruction: body };
  }
  if (c === "/wallets" || c === "wallets" || c === "/wallet" || c === "wallet") {
    const [a, b, ...more] = body.split(/\s+/);
    if (!a || a === "list") return { type: "wallet_list" };
    if (a === "refresh") return { type: "wallet_refresh" };
    if (a === "add" && b) {
      return { type: "wallet_add", address: b, label: more.join(" ") || undefined };
    }
    if ((a === "remove" || a === "del" || a === "rm") && b) {
      return { type: "wallet_remove", address: b };
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
      return { type: "wallet_add", address: a, label: [b, ...more].filter(Boolean).join(" ") || undefined };
    }
    return { type: "unknown", raw };
  }
  if (c === "/risk" || c === "risk") {
    const [a, b] = body.toLowerCase().split(/\s+/);
    if (a === "max" && b) {
      const maxRiskPct = Number(b);
      if (!Number.isFinite(maxRiskPct)) return { type: "unknown", raw };
      return { type: "risk_max", maxRiskPct };
    }
    const key = (a ?? "").replaceAll("-", "_");
    const tolerance = TOLERANCE_ALIASES[key];
    if (tolerance) return { type: "risk_tolerance", tolerance };
    return { type: "unknown", raw };
  }
  return { type: "unknown", raw };
}

export const HELP_TEXT = [
  "📟 <b>FOMO Mirror Copy Trading</b>",
  "/start — onboarding obbligatorio (API Key + budget)",
  "/setup — rifai setup",
  "/menu — posizioni live · stats · settings",
  "/profitall — PnL sessione + 24h / 3d / 7d / 30d",
  "/balance — cash, posizioni, equity e SOL on-chain",
  "/closeall — liquida tutto + reset sessione Fomo",
  "/wallets list · /wallets refresh",
  "/pause · /resume · /budget &lt;SOL&gt;",
  "/help",
].join("\n");
