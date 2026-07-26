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
  "📟 <b>Comandi Dashboard Telegram</b>",
  "/start o /dashboard — apre il pannello con pulsanti",
  "/status — stato rapido",
  "/pause [motivo] · /resume",
  "/budget &lt;SOL&gt;",
  "/risk only_low | only_high | all",
  "/risk max &lt;%&gt;",
  "/update &lt;istruzione&gt;",
  "/help",
].join("\n");
