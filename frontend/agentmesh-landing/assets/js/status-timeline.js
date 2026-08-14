/* status-timeline.js — renders the live session status timeline (ES module).
   Spec §5.9. Ordered steps: created → validating → discovered →
   capability → running → verified/failed. Icons per state. */

import { SESSION_STATE } from "./api-client.js";
import { t } from "./i18n.js";

const ORDER = [
  SESSION_STATE.CREATED,
  SESSION_STATE.AGENT_CARD_VALIDATING,
  SESSION_STATE.DISCOVERED,
  SESSION_STATE.CAPABILITY_CHECKED,
  SESSION_STATE.TASK_RUNNING,
  SESSION_STATE.VERIFIED,
  SESSION_STATE.FAILED,
];

const LABELS = {
  [SESSION_STATE.CREATED]: () => t("tl.created"),
  [SESSION_STATE.AGENT_CARD_VALIDATING]: () => t("tl.validating"),
  [SESSION_STATE.DISCOVERED]: () => t("tl.discovered"),
  [SESSION_STATE.CAPABILITY_CHECKED]: () => t("tl.capability"),
  [SESSION_STATE.TASK_RUNNING]: () => t("tl.running"),
  [SESSION_STATE.VERIFIED]: () => t("tl.verified"),
  [SESSION_STATE.FAILED]: () => t("tl.failed"),
};

function iconFor(state) {
  switch (state) {
    case SESSION_STATE.CREATED: return '<path d="M12 2v20M2 12h20"/>';
    case SESSION_STATE.AGENT_CARD_VALIDATING: return '<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/><path d="M12 16v-4M12 8h.01"/>';
    case SESSION_STATE.DISCOVERED: return '<circle cx="12" cy="12" r="3"/><path d="M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M12 2v3M12 19v3"/>';
    case SESSION_STATE.CAPABILITY_CHECKED: return '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>';
    case SESSION_STATE.TASK_RUNNING: return '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>';
    case SESSION_STATE.VERIFIED: return '<path d="M20 6 9 17l-5-5"/>';
    case SESSION_STATE.FAILED: return '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>';
    default: return '<circle cx="12" cy="12" r="9"/>';
  }
}

export function renderTimeline(container, session) {
  if (!container) return;
  const current = session?.state || SESSION_STATE.CREATED;
  const currentIdx = ORDER.indexOf(current);

  const steps = ORDER.map((state, i) => {
    let cls = "pending";
    if (state === current) cls = "active";
    else if (currentIdx >= 0 && i < currentIdx) cls = "done";
    if (current === SESSION_STATE.FAILED && state === SESSION_STATE.FAILED) cls = "failed";
    if (current === SESSION_STATE.REVOKED) cls = i <= currentIdx ? "done" : "pending";
    return `
      <li class="${cls}">
        <span class="status-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconFor(state)}</svg></span>
        <div class="status-body">
          <div class="st-title">${LABELS[state] ? LABELS[state]() : ""}</div>
          ${state === current && session?.steps ? `<div class="st-msg">${esc(session.steps[session.steps.length - 1]?.msg || "")}</div>` : ""}
        </div>
      </li>`;
  }).join("");

  container.innerHTML = `<ol class="status-timeline">${steps}</ol>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
