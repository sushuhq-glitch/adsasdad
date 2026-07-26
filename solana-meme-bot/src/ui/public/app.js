const els = {
  token: document.getElementById("token"),
  saveToken: document.getElementById("saveToken"),
  botStatus: document.getElementById("botStatus"),
  pnl: document.getElementById("pnl"),
  residual: document.getElementById("residual"),
  openCount: document.getElementById("openCount"),
  positions: document.getElementById("positions"),
  alerts: document.getElementById("alerts"),
  rejects: document.getElementById("rejects"),
  instructions: document.getElementById("instructions"),
  pauseBtn: document.getElementById("pauseBtn"),
  resumeBtn: document.getElementById("resumeBtn"),
  budgetInput: document.getElementById("budgetInput"),
  budgetBtn: document.getElementById("budgetBtn"),
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
  els.openCount.textContent = String(state.openPositions?.length ?? 0);
  els.budgetInput.value = state.budgetSol ?? "";

  renderList(els.positions, state.openPositions, (p) => `
    <div class="item">
      <strong>$${p.symbol} · ${p.amountSol.toFixed(4)} SOL</strong>
      Entry ${p.entryPriceUsd} · MC ${Math.round(p.marketCapAtEntry)} · ${p.venue}
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
      <div>${a.at}${a.requiresUpdate ? " · richiede AGGIORNAMENTO" : ""}</div>
      ${a.requiresUpdate && !a.acknowledged ? `<button data-ack="${a.id}" type="button">Ack</button>` : ""}
    </div>
  `);

  renderList(els.rejects, state.rejectedTrades?.slice(0, 12), (r) => `
    <div class="item">
      <strong>$${r.candidate.symbol} · ${r.label}</strong>
      <div>Safety ${r.assessment.safetyScore} / Confidence ${r.assessment.confidenceScore}</div>
      <div>${r.motivation}</div>
    </div>
  `);

  renderList(els.instructions, state.liveInstructions?.slice(0, 12), (i) => `
    <div class="item"><strong>Istruzione</strong><div>${i}</div></div>
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

if (token()) {
  refresh().catch(console.error);
  setInterval(() => refresh().catch(console.error), 5000);
}
