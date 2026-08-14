/* demo-wizard.js — the sandbox wizard state machine (ES module).
   Spec §5. Steps:
     1. Choose your role (bundled demo / public A2A sandbox / guided ACP test)
     2. Choose sync or async
     3. Add your Agent Card URL (optional, bundled demo skips)
     4. Review sandbox boundaries
     5. Run live check → status timeline → Hermes verdict → compatibility report
   Falls back to a deterministic mock timeline when the backend is absent
   (see api-client.js). Mock mode is clearly flagged in the UI. */

import { api, mock, isLive, getMode, SESSION_STATE } from "./api-client.js";
import * as store from "./session-store.js";
import { subscribeStatus } from "./sse-client.js";
import { renderTimeline } from "./status-timeline.js";
import { renderHermesPanel } from "./hermes-panel.js";
import { renderReport } from "./report-panel.js";

const ROLES = {
  bundled: { label: "Bundled demo", desc: "Hermes connects to a built-in demo agent with a fixed synthetic case. No endpoint needed." },
  a2a: { label: "Public A2A sandbox", desc: "Bring your own A2A agent. Temporary credentials, synthetic payload, strict quota and TTL." },
  acp: { label: "Guided ACP test", desc: "Walk through an ACP-style connection with a guided review. Requires coordination." },
};

let current = {
  step: 1,
  role: null,
  mode: null,          // sync | async
  agentCardUrl: "",
  sessionId: null,
  unsubscribe: null,
  ttlTimer: null,
};

export function initDemoWizard() {
  document.querySelectorAll("[data-wizard-open]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.preventDefault(); openWizard(); });
  });

  const modal = document.getElementById("demo-wizard");
  if (!modal) return;

  // role step
  bindOptions("wizard-role");
  // mode step
  bindOptions("wizard-mode");

  // next / back
  modal.querySelector('[data-wizard="next"]')?.addEventListener("click", onNext);
  modal.querySelector('[data-wizard="back"]')?.addEventListener("click", onBack);

  // url continue (validate + store)
  const urlContinue = modal.querySelector('[data-wizard="url-continue"]');
  if (urlContinue) urlContinue.addEventListener("click", () => {
    const urlInput = document.getElementById("wizard-url");
    const val = urlInput?.value.trim() || "";
    if (current.role !== "bundled") {
      if (!val) { flashError("wizard-url"); return; }
      try { new URL(val); } catch { flashError("wizard-url"); return; }
    }
    current.agentCardUrl = val;
    go(4);
  });

  // boundaries → run
  modal.querySelector('[data-wizard="run"]')?.addEventListener("click", onRun);

  // revoke (rendered by report)
  modal.addEventListener("click", async (e) => {
    if (e.target.closest("[data-revoke]")) {
      await doRevoke();
    }
  });

  modal.querySelector('[data-wizard="rerun"]')?.addEventListener("click", () => {
    resetToStep(4);
  });

  // close resets
  const overlay = modal.closest(".modal-overlay");
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeAndReset();
  });
  modal.querySelector(".modal-close")?.addEventListener("click", closeAndReset);
}

function openWizard() {
  const modal = document.getElementById("demo-wizard");
  if (!modal) return;
  resetToStep(1);
  applyDeepLink();
  modal.closest(".modal-overlay").classList.add("open");
  document.body.style.overflow = "hidden";
  updateModeBadge();
}

/* Spec §6.2: /demo/?mode=built-in|a2a preselects the role.
   Never reads session id, token or Agent Card URL from query params. */
function applyDeepLink() {
  if (location.pathname.replace(/\/+$/, "") !== "/demo") return;
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  const map = { "built-in": "bundled", a2a: "a2a" };
  const role = map[mode];
  if (!role) return;
  current.role = role;
  const group = document.getElementById("wizard-role");
  if (!group) return;
  group.querySelectorAll(".option").forEach((o) => {
    o.classList.toggle("selected", o.getAttribute("data-value") === role);
  });
}

function closeAndReset() {
  const modal = document.getElementById("demo-wizard");
  const overlay = modal?.closest(".modal-overlay");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
  stopTimers();
  cleanupSession();
}

function bindOptions(groupId) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll(".option").forEach((opt) => {
    opt.addEventListener("click", () => {
      group.querySelectorAll(".option").forEach((o) => o.classList.remove("selected"));
      opt.classList.add("selected");
      const val = opt.getAttribute("data-value");
      if (groupId === "wizard-role") current.role = val;
      if (groupId === "wizard-mode") current.mode = val;
    });
  });
}

function go(n) {
  current.step = n;
  document.querySelectorAll(".wizard-step").forEach((s) => {
    s.classList.toggle("active", s.getAttribute("data-step") === String(n));
  });
  renderProgress();
  renderNav();
}

function renderProgress() {
  const bar = document.querySelector("#demo-wizard .wizard-progress");
  if (!bar) return;
  bar.innerHTML = "";
  const total = 5;
  for (let i = 1; i <= total; i++) {
    const d = document.createElement("div");
    d.className = "dot" + (i < current.step ? " done" : "") + (i === current.step ? " current" : "");
    bar.appendChild(d);
  }
}

function renderNav() {
  const back = document.querySelector("#demo-wizard [data-wizard='back']");
  const next = document.querySelector("#demo-wizard [data-wizard='next']");
  const foot = document.querySelector("#demo-wizard .modal-foot");
  if (back) back.style.visibility = current.step > 1 && current.step <= 3 ? "visible" : "hidden";
  if (next) next.style.display = current.step === 1 || current.step === 2 ? "" : "none";
  if (foot) {
    const status = foot.querySelector(".foot-status");
    if (status) {
      status.textContent = isLive()
        ? "Live sandbox — real connection"
        : "Sandbox preview — backend not reachable, deterministic mock";
    }
  }
}

function onNext() {
  if (current.step === 1) {
    if (!current.role) { flashError("wizard-role"); return; }
    go(2);
  } else if (current.step === 2) {
    if (!current.mode) { flashError("wizard-mode"); return; }
    // bundled demo skips the URL step
    go(current.role === "bundled" ? 4 : 3);
  }
}

function onBack() {
  if (current.step === 3) go(2);
  else if (current.step === 4) go(current.role === "bundled" ? 2 : 3);
}

function flashError(targetId) {
  const el = document.getElementById(targetId) || document.querySelector(targetId.startsWith("#") ? targetId : `#${targetId}`);
  if (!el) return;
  el.closest(".wizard-step, .field, .modal-body")?.classList.remove("shake");
  void el.closest(".wizard-step, .field")?.offsetWidth;
  el.closest(".wizard-step, .field")?.classList.add("shake");
  const msg = document.createElement("p");
  msg.className = "form-error";
  msg.textContent = "Select an option to continue.";
  if (targetId === "wizard-url") msg.textContent = "Enter a valid Agent Card URL.";
  const anchor = el.closest(".field") || el;
  anchor.after(msg);
  setTimeout(() => msg.remove(), 2600);
}

function resetToStep(n) {
  stopTimers();
  cleanupSession();
  current.step = n;
  current.sessionId = null;
  const urlInput = document.getElementById("wizard-url");
  if (urlInput) urlInput.value = current.agentCardUrl;
  go(n);
  renderNav();
}

/* ---------- run ---------- */

async function onRun() {
  const runBtn = document.querySelector("#demo-wizard [data-wizard='run']");
  if (runBtn) { runBtn.disabled = true; }

  const liveView = document.getElementById("wizard-live");
  const reportView = document.getElementById("wizard-report");
  if (liveView) liveView.classList.remove("hidden");
  if (reportView) reportView.classList.add("hidden");
  go(5);

  const payload = {
    role: current.role,
    mode: current.mode,
    transport: "a2a",
    agent_card_url: current.agentCardUrl || null,
    ttl_seconds: 900,
  };

  try {
    let session;
    if (isLive()) {
      session = await api.createSession(payload);
    } else {
      session = await mock.createSession(payload);
    }
    current.sessionId = session.id;
    store.put(session.id, session);

    showSessionMeta(session);
    startTtl(session.ttl_seconds || 900);

    current.unsubscribe = subscribeStatus(session.id, (ev) => {
      const s = store.get(ev.session_id);
      if (s) {
        s.state = ev.state;
        if (ev.message) s.lastMsg = ev.message;
        if (ev.detail) Object.assign(s, ev.detail);
        store.put(ev.session_id, s);
      }
      renderLive(s);
      if (ev.state === SESSION_STATE.VERIFIED || ev.state === SESSION_STATE.FAILED) {
        stopTtl();
        setTimeout(() => showReport(store.get(ev.session_id)), 350);
      }
    });
  } catch (err) {
    renderLiveError(err.message);
    if (runBtn) runBtn.disabled = false;
  }
}

function renderLive(session) {
  const timeline = document.getElementById("wizard-timeline");
  const hermes = document.getElementById("wizard-hermes");
  if (timeline) renderTimeline(timeline, session);
  if (hermes) renderHermesPanel(hermes, session);
  updateMetrics(session);
}

function updateMetrics(session) {
  const el = (id) => document.getElementById(id);
  const modeEl = el("wizard-metric-mode");
  const stateEl = el("wizard-metric-state");
  const ttlEl = el("wizard-metric-ttl");
  if (modeEl) modeEl.textContent = session?.mode || "—";
  if (stateEl) stateEl.textContent = session?.state || "—";
  if (ttlEl) ttlEl.textContent = formatTtl(session?._ttlRemaining);
}

function renderLiveError(msg) {
  const timeline = document.getElementById("wizard-timeline");
  const hermes = document.getElementById("wizard-hermes");
  if (timeline) timeline.innerHTML = `<p class="form-error">${escapeHtml(msg)}</p>`;
  if (hermes) renderHermesPanel(hermes, { state: SESSION_STATE.FAILED });
}

function showReport(session) {
  const liveView = document.getElementById("wizard-live");
  const reportView = document.getElementById("wizard-report");
  if (liveView) liveView.classList.add("hidden");
  if (reportView) reportView.classList.remove("hidden");
  renderReport(reportView, session);
}

function showSessionMeta(session) {
  const el = document.getElementById("wizard-session-id");
  if (el) el.textContent = session.id;
  updateModeBadge();
}

function updateModeBadge() {
  const badge = document.getElementById("wizard-mode-badge");
  if (badge) {
    const isMock = getMode() === "mock";
    badge.textContent = isMock ? "SIMULATED" : "LIVE";
    badge.className = "pill " + (isMock ? "pill--warn" : "pill--ok");
  }
}

/* ---------- ttl ---------- */

function startTtl(seconds) {
  const holder = document.getElementById("wizard-ttl");
  if (!holder) return;
  let left = seconds;
  const tick = () => {
    left -= 1;
    const s = store.get(current.sessionId);
    if (s) { s._ttlRemaining = Math.max(0, left); store.put(s.id, s); }
    if (holder) holder.textContent = formatTtl(Math.max(0, left));
    if (left <= 0) { stopTtl(); }
  };
  holder.textContent = formatTtl(seconds);
  current.ttlTimer = setInterval(tick, 1000);
}

function stopTtl() {
  if (current.ttlTimer) { clearInterval(current.ttlTimer); current.ttlTimer = null; }
}

function formatTtl(sec) {
  if (sec === null || sec === undefined) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ---------- revoke / cleanup ---------- */

async function doRevoke() {
  if (!current.sessionId) return;
  try {
    if (isLive()) await api.revokeSession(current.sessionId);
    else await mock.revokeSession(current.sessionId);
    current.unsubscribe?.();
    current.unsubscribe = null;
    stopTtl();
    const s = store.get(current.sessionId);
    if (s) s.state = SESSION_STATE.REVOKED;
    renderLive(s);
  } catch (e) {
    /* ignore — session TTL will expire anyway */
  }
}

function stopTimers() {
  stopTtl();
  if (current.unsubscribe) { current.unsubscribe(); current.unsubscribe = null; }
}

function cleanupSession() {
  if (current.sessionId) {
    const s = store.get(current.sessionId);
    if (s && s.state === SESSION_STATE.REVOKED) store.remove(current.sessionId);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
