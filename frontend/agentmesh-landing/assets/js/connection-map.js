/* connection-map.js — renders the connection path diagram (ES module).
   Spec §5.3 / hero. Nodes: Your agent → AgentMesh → Hermes.
   In live mode a latency pulse is animated between nodes. */

import { SESSION_STATE } from "./api-client.js";

export function renderConnectionMap(container, state) {
  if (!container) return;
  const states = Array.isArray(state) ? state : [state];

  let linkState = "idle";
  const st = states[states.length - 1];
  if (st) {
    if (st.state === SESSION_STATE.DISCOVERED || st.state === SESSION_STATE.CAPABILITY_CHECKED ||
        st.state === SESSION_STATE.TASK_RUNNING || st.state === SESSION_STATE.VERIFIED) {
      linkState = "active";
    }
    if (st.state === SESSION_STATE.FAILED || st.state === SESSION_STATE.REVOKED) linkState = "idle";
  }

  container.innerHTML = `
    <div class="conn-map" role="img" aria-label="Connection path: your agent to AgentMesh to Hermes">
      <div class="conn-node">
        <svg class="node-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>
        <div class="node-name">Your agent</div>
        <div class="node-sub">ACP · A2A</div>
      </div>
      <div class="conn-link ${linkState === "active" ? "live" : ""}">
        <div class="link-line">A2A / ACP</div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </div>
      <div class="conn-node">
        <svg class="node-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="3"/><path d="M8 21h8M12 17v4"/></svg>
        <div class="node-name">AgentMesh</div>
        <div class="node-sub">session · tokens</div>
      </div>
      <div class="conn-link">
        <div class="link-line">isolated</div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </div>
      <div class="conn-node">
        <svg class="node-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>
        <div class="node-name">Hermes</div>
        <div class="node-sub">verification</div>
      </div>
    </div>`;
}
