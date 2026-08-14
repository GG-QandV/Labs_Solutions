/* hermes-panel.js — Hermes verdict / commentary panel (ES module).
   Spec §5.8. Hermes acts as a bounded demo guide: it validates the
   response format and session boundary and gives a non-blocking,
   heuristic compatibility signal. */

import { SESSION_STATE } from "./api-client.js";

const MESSAGES = {
  [SESSION_STATE.CREATED]: "Session boundary established. Waiting for the agent to connect…",
  [SESSION_STATE.AGENT_CARD_VALIDATING]: "Hermes is checking the agent card and temporary credentials.",
  [SESSION_STATE.DISCOVERED]: "Endpoint discovered. Hermes is negotiating the A2A protocol.",
  [SESSION_STATE.CAPABILITY_CHECKED]: "Capability check passed. Sync and async channels available.",
  [SESSION_STATE.TASK_RUNNING]: "Hermes is validating the response format and session boundary.",
  [SESSION_STATE.VERIFIED]: "Compatible. The response matches the expected schema and stayed inside the session boundary.",
  [SESSION_STATE.FAILED]: "Compatibility check did not pass. Review the report below.",
  [SESSION_STATE.REVOKED]: "Session revoked. Temporary credentials were invalidated.",
};

export function renderHermesPanel(container, session) {
  if (!container) return;
  const state = session?.state || SESSION_STATE.CREATED;
  container.innerHTML = `
    <div class="hermes-panel">
      <div class="hermes-panel-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2H3v16h5v4l6-4h7V2zM8 10h.01M12 10h.01M16 10h.01"/></svg>
        Hermes · demo guide
        <span class="hermes-status"><span class="live-dot"></span> listening</span>
      </div>
      <div class="hermes-panel-body"><span class="caret">▸</span> ${esc(MESSAGES[state] || "")}</div>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
