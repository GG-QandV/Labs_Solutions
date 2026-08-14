/* hermes-panel.js — Hermes verdict / commentary panel (ES module).
   Spec §5.8. Hermes acts as a bounded demo guide: it validates the
   response format and session boundary and gives a non-blocking,
   heuristic compatibility signal. */

import { SESSION_STATE } from "./api-client.js?v=2b4b02e423";
import { t } from "./i18n.js?v=8324134a3b";

const MESSAGES = {
  [SESSION_STATE.CREATED]: () => t("hm.created"),
  [SESSION_STATE.AGENT_CARD_VALIDATING]: () => t("hm.validating"),
  [SESSION_STATE.DISCOVERED]: () => t("hm.discovered"),
  [SESSION_STATE.CAPABILITY_CHECKED]: () => t("hm.capability"),
  [SESSION_STATE.TASK_RUNNING]: () => t("hm.running"),
  [SESSION_STATE.VERIFIED]: () => t("hm.verified"),
  [SESSION_STATE.FAILED]: () => t("hm.failed"),
  [SESSION_STATE.REVOKED]: () => t("hm.revoked"),
};

export function renderHermesPanel(container, session) {
  if (!container) return;
  const state = session?.state || SESSION_STATE.CREATED;
  container.innerHTML = `
    <div class="hermes-panel">
      <div class="hermes-panel-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2H3v16h5v4l6-4h7V2zM8 10h.01M12 10h.01M16 10h.01"/></svg>
        ${esc(t("hm.title"))}
        <span class="hermes-status"><span class="live-dot"></span> ${esc(t("hm.listening"))}</span>
      </div>
      <div class="hermes-panel-body"><span class="caret">▸</span> ${esc((MESSAGES[state] ? MESSAGES[state]() : ""))}</div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
