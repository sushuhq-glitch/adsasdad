const els = {
  token: document.getElementById("token"),
  saveToken: document.getElementById("saveToken"),
  botStatus: document.getElementById("botStatus"),
  pnl: document.getElementById("pnl"),
  residual: document.getElementById("residual"),
  avgRisk: document.getElementById("avgRisk"),
  positions: document.getElementById("positions"),
  alerts: document.getElementById("alerts"),
  wallets: document.getElementById("wallets"),
  closed: document.getElementById("closed"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  budgetInput: document.getElementById("budgetInput"),
  budgetBtn: document.getElementById("budgetBtn"),
  riskTolerance: document.getElementById("riskTolerance"),
  maxRiskInput: document.getElementById("maxRiskInput"),
  riskBtn: document.getElementById("riskBtn"),
};

const params = new URLSearchParams(location.search);
els.token.value = localStorage.getItem("dashboardToken") || params.get("token") || "";

function token() {
  return els.token.value.trim();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-auth-token": token(),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

function renderList(node, items, mapper) {
  if (!items?.length) {
    node.classList.add("empty");
    node.textContent = "—";
    return;
  }
  node.classList.remove("empty");
  node.innerHTML = items.map(mapper).join("");
}

function render(state) {
  els.botStatus.textContent = state.status;
  els.pnl.textContent = `${Number(state.realizedPnlSol || 0).toFixed(4)} SOL`;
  els.residual.textContent = `${Number(state.residualBudgetSol || 0).toFixed(4)} SOL`;
  els.avgRisk.textContent = `${Number(state.averageOpenRiskPct || 0).toFixed(1)}%`;
  els.budgetInput.value = state.budgetSol ?? "";
  els.riskTolerance.value = state.riskTolerance || "all";
  els.maxRiskInput.value = state.maxRiskPct ?? 85;

  renderList(els.positions, state.openPositions, (p) => `
    <div class="item">
      <strong>$${p.symbol} · ${p.amountSol.toFixed(4)} SOL · Risk ${p.riskPct ?? "?"}%</strong>
      Entry ${p.entryPriceUsd} · MC ${Math.round(p.marketCapAtEntry)} · TP ${p.takeProfitPct}%
      ${p.copyFromLabel ? `<span class="badge">COPY ${p.copyFromLabel}</span>` : ""}
      ${p.listeningForCopySell ? '<span class="badge warn">LISTEN SELL</span>' : ""}
      <div>${p.motivation}</div>
    </div>
  `);

  const alerts = state.pendingAlerts?.length ? state.pendingAlerts : state.alerts?.slice(0, 12);
  renderList(els.alerts, alerts, (a) => `
    <div class="item">
      <strong>
        <span class="badge ${a.severity === "critical" ? "danger" : a.severity === "warning" ? "warn" : ""}">${a.severity}</span>
        ${a.title}
      </strong>
      <div>${a.message}</div>
      <div>${a.at}${a.requiresUpdate ? " · UPDATERISCHIO / KEYWORD" : ""}</div>
      ${a.requiresUpdate && !a.acknowledged ? `<button data-ack="${a.id}" type="button">Ack</button>` : ""}
    </div>
  `);

  renderList(els.closed, state.closedTrades?.slice(0, 12), (t) => `
    <div class="item">
      <strong>$${t.position.symbol} · ${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%</strong>
      Sell ${t.sellPriceUsd} · PnL ${t.pnlSol.toFixed(4)} SOL · risk in ${t.position.riskPct ?? "?"}%
    </div>
  `);

  renderList(els.wallets, state.trackedWallets?.slice(0, 30), (w) => `
    <div class="item">
      <strong>${w.enabled ? "🟢" : "⚪"} ${w.label} · #${w.rank ?? "?"}</strong>
      <div>${w.address.slice(0, 4)}…${w.address.slice(-4)} · rel ${w.reliabilityScore}${w.realizedPnlUsd != null ? ` · PnL $${Math.round(w.realizedPnlUsd)}` : ""} · ${w.source}</div>
    </div>
  `);

  els.alerts.querySelectorAll("[data-ack]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/alerts/${btn.getAttribute("data-ack")}/ack`, { method: "POST", body: "{}" });
      await refresh();
    });
  });
}

async function refresh() {
  if (!token()) return;
  const state = await api("/api/state");
  render(state);
}

els.saveToken.addEventListener("click", async () => {
  localStorage.setItem("dashboardToken", token());
  await refresh();
});

els.pauseBtn.addEventListener("click", async () => {
  await api("/api/pause", { method: "POST", body: JSON.stringify({ reason: "Dashboard UI" }) });
  await refresh();
});

els.resumeBtn.addEventListener("click", async () => {
  await api("/api/resume", { method: "POST", body: "{}" });
  await refresh();
});

els.budgetBtn.addEventListener("click", async () => {
  await api("/api/budget", {
    method: "POST",
    body: JSON.stringify({ amountSol: Number(els.budgetInput.value) }),
  });
  await refresh();
});

els.riskBtn.addEventListener("click", async () => {
  await api("/api/risk", {
    method: "POST",
    body: JSON.stringify({
      tolerance: els.riskTolerance.value,
      maxRiskPct: Number(els.maxRiskInput.value),
    }),
  });
  await refresh();
});

if (token()) {
  refresh().catch(console.error);
  setInterval(() => refresh().catch(console.error), 5000);
}
