/* report-panel.js — compatibility report view (ES module). Spec §5.11.
   Shows: verdict, protocol, capability check, latency, session id, TTL,
   scope, role_relevant (heuristic, non-blocking). Never shows raw tokens,
   internal hostnames, or other sessions' data. */

import { SESSION_STATE } from "./api-client.js?v=2b4b02e423";
import { t } from "./i18n.js?v=8324134a3b";

function verdictFor(state) {
  switch (state) {
    case SESSION_STATE.VERIFIED: return { cls: "verdict--ok", ico: "ok", title: t("rp.verdict.ok"), sub: t("rp.verdict.ok.sub") };
    case SESSION_STATE.FAILED: return { cls: "verdict--fail", ico: "x", title: t("rp.verdict.fail"), sub: t("rp.verdict.fail.sub") };
    default: return { cls: "verdict--warn", ico: "pending", title: t("rp.verdict.pending"), sub: t("rp.verdict.pending.sub") };
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
        <div class="report-row"><span class="r-key">${esc(t("rp.protocol"))}</span><span class="r-val">${esc(discovered.protocol || "A2A")}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.endpoint"))}</span><span class="r-val">${esc(discovered.endpoint || "—")}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.capability"))}</span><span class="r-val ${session?.capability_check === "passed" ? "ok" : "warn"}">${esc(session?.capability_check === "passed" ? t("rp.passed") : t("rp.pending"))}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.capabilities"))}</span><span class="r-val">${caps.map(esc).join(" · ") || "—"}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.latency"))}</span><span class="r-val">${session?.response_latency_ms ? session.response_latency_ms + " ms" : "—"}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.session"))}</span><span class="r-val">${esc(session?.id || "—")}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.scope"))}</span><span class="r-val">${(session?.scope || []).map(esc).join(" · ")}</span></div>
        <div class="report-row"><span class="r-key">${esc(t("rp.role"))}</span><span class="r-val warn">${esc(t("rp.role.value"))}</span></div>
      </div>
      <p class="report-note">${esc(t("rp.note"))}</p>
      <div class="report-actions">
        <button class="btn btn--danger btn--sm" data-revoke>${esc(t("wizard.revoke"))}</button>
        <a class="btn btn--secondary btn--sm" href="#contact">${esc(t("wizard.review"))}</a>
      </div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
