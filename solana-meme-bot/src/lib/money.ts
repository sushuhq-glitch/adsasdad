export function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  if (n === 0) return "$0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  // Market-cap / large USD amounts: locale grouping, no scientific notation
  if (abs >= 1_000) {
    return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
  }
  if (abs >= 1) {
    const body = abs.toFixed(4).replace(/\.?0+$/, "");
    return `${sign}$${body}`;
  }

  // Sub-$1 token prices: fixed decimals, never toExponential / e-notation
  let decimals = 6;
  if (abs < 0.0001) decimals = 10;
  else if (abs < 0.01) decimals = 8;
  else if (abs < 0.1) decimals = 7;

  let body = abs.toFixed(decimals);
  // trim trailing zeros but keep at least one digit after decimal when meaningful
  body = body.replace(/(\.\d*?[1-9])0+$/u, "$1");
  if (body.endsWith(".")) body = body.slice(0, -1);
  // avoid "$0" for tiny non-zero
  if (body === "0" || /^0\.0+$/.test(body)) {
    body = abs.toFixed(12).replace(/0+$/u, "").replace(/\.$/u, "");
    if (!body.includes(".")) body = "0";
  }
  return `${sign}$${body}`;
}

export function fmtUsd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "n/a";
  // Small token-like values → transparent decimal (no scientific notation)
  if (Math.abs(n) > 0 && Math.abs(n) < 1) {
    return formatPrice(n);
  }
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtSol(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} SOL`;
}

/** Entry price USD = (SOL investiti × SOL/USD) / token ricevuti, fallback al mark live. */
export function computeEntryPriceUsd(
  amountSol: number,
  tokenAmount: number,
  solUsd: number,
  fallbackMarkUsd: number,
): number {
  if (tokenAmount > 0 && amountSol > 0 && solUsd > 0) {
    const fromFill = (amountSol * solUsd) / tokenAmount;
    if (Number.isFinite(fromFill) && fromFill > 0) return fromFill;
  }
  if (fallbackMarkUsd > 0 && Number.isFinite(fallbackMarkUsd)) return fallbackMarkUsd;
  return 0;
}

export function pctChange(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
