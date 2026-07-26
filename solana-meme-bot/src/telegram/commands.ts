export type TelegramCommand =
  | { type: "pause"; reason?: string }
  | { type: "resume" }
  | { type: "status" }
  | { type: "budget"; amountSol: number }
  | { type: "update"; instruction: string }
  | { type: "help" }
  | { type: "unknown"; raw: string };

export function parseTelegramCommand(text: string): TelegramCommand {
  const raw = text.trim();
  const [cmd, ...rest] = raw.split(/\s+/);
  const body = rest.join(" ").trim();
  const c = (cmd ?? "").toLowerCase();

  if (c === "/pause" || c === "pause") return { type: "pause", reason: body || undefined };
  if (c === "/resume" || c === "resume") return { type: "resume" };
  if (c === "/status" || c === "status") return { type: "status" };
  if (c === "/help" || c === "help") return { type: "help" };
  if (c === "/budget" || c === "budget") {
    const amountSol = Number(body);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return { type: "unknown", raw };
    }
    return { type: "budget", amountSol };
  }
  if (c === "/update" || c === "update") {
    if (!body) return { type: "unknown", raw };
    return { type: "update", instruction: body };
  }
  return { type: "unknown", raw };
}

export const HELP_TEXT = [
  "Comandi disponibili:",
  "/status — stato bot, budget, PnL",
  "/pause [motivo] — mette in pausa gli acquisti",
  "/resume — riprende il ciclo H24",
  "/budget <SOL> — aggiorna budget operativo",
  "/update <istruzione> — nuova istruzione live al motore",
  "/help — questo messaggio",
].join("\n");
