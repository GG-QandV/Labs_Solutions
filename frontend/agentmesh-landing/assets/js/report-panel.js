/* report-panel.js — compatibility report view (ES module). Spec §5.11.
   Shows: verdict, protocol, capability check, latency, session id, TTL,
   scope, role_relevant (heuristic, non-blocking). Never shows raw tokens,
   internal hostnames, or other sessions' data. */

import { SESSION_STATE } from "./api-client.js";

function verdictFor(state) {
  switch (state) {
    case SESSION_STATE.VERIFIED: return { cls: "verdict--ok", ico: "ok", title: "Compatible", sub: "Response validated against the expected schema and session boundary." };
    case SESSION_STATE.FAILED: return { cls: "verdict--fail", ico: "x", title: "Check did not pass", sub: "Review the details below or rerun the check." };
    default: return { cls: "verdict--warn", ico: "pending", title: "In progress", sub: "Hermes is still validating the session." };
  }
}

const ICONS = {
  ok: '<path d="M20 6 9 17l-5-5"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  pending: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};

export function renderReport(container, session) {
  if (!container) return;
  const state = session?.state || SESSION_STATE.CREATED;
  const v = verdictFor(state);
  const discovered = session?.discovered || {};
  const caps = session?.capabilities || [];

  container.innerHTML = `
    <div class="report">
      <div class="report-verdict ${v.cls}">
        <div class="v-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[v.ico]}</svg></div>
        <div><div class="v-title">${v.title}</div><div class="v-sub">${v.sub}</div></div>
      </div>
      <div class="report-grid">
        <div class="report-row"><span class="r-key">Protocol</span><span class="r-val">${esc(discovered.protocol || "A2A")}</span></div>
        <div class="report-row"><span class="r-key">Agent endpoint</span><span class="r-val">${esc(discovered.endpoint || "—")}</span></div>
        <div class="report-row"><span class="r-key">Capability check</span><span class="r-val ${session?.capability_check === "passed" ? "ok" : "warn"}">${esc(session?.capability_check || "pending")}</span></div>
        <div class="report-row"><span class="r-key">Capabilities</span><span class="r-val">${caps.map(esc).join(" · ") || "—"}</span></div>
        <div class="report-row"><span class="r-key">Response latency</span><span class="r-val">${session?.response_latency_ms ? session.response_latency_ms + " ms" : "—"}</span></div>
        <div class="report-row"><span class="r-key">Session</span><span class="r-val">${esc(session?.id || "—")}</span></div>
        <div class="report-row"><span class="r-key">Scope</span><span class="r-val">${(session?.scope || []).map(esc).join(" · ")}</span></div>
        <div class="report-row"><span class="r-key">Role relevance</span><span class="r-val warn">heuristic — non-blocking</span></div>
      </div>
      <p class="report-note">The role-relevance signal is a heuristic estimate and never blocks a verdict. No internal hostnames, credentials, or other sessions are shown.</p>
      <div class="report-actions">
        <button class="btn btn--danger btn--sm" data-revoke>Revoke access now</button>
        <a class="btn btn--secondary btn--sm" href="#contact">Request guided review</a>
      </div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
