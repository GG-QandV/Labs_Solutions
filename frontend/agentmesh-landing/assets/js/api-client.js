/* api-client.js — typed client for the AgentMesh sandbox API (ES module).
   Spec §5.2 / §11. Backend (agentmesh-api) may be absent → this module
   probes the availability endpoint and falls back to a deterministic
   local mock state machine so the wizard stays functional during dev.

   CONFIG
     window.AML_API_BASE   — override API origin, default same-origin
     ?mock=1|0             — force mock / force live (dev override)
*/

import * as sessionStore from "./session-store.js";

const BASE = window.AML_API_BASE || "";
export const API_BASE = BASE;

export const MODE = {
  LIVE: "live",
  MOCK: "mock",
};

let mode = null;
export function getMode() { return mode; }
export function isLive() { return mode === MODE.LIVE; }

export const SESSION_STATE = {
  CREATED: "created",
  AGENT_CARD_VALIDATING: "agent_card_validating",
  DISCOVERED: "discovered",
  CAPABILITY_CHECKED: "capability_checked",
  TASK_RUNNING: "task_running",
  VERIFIED: "verified",
  FAILED: "failed",
  REVOKED: "revoked",
  EXPIRED: "expired",
};

async function jsonFetch(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.detail = body;
    throw err;
  }
  return body;
}

/* ---------- availability probe ---------- */

export async function probeBackend() {
  const forced = new URLSearchParams(location.search).get("mock");
  if (forced === "1") { mode = MODE.MOCK; return mode; }
  if (forced === "0") { mode = MODE.LIVE; return mode; }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(BASE + "/api/v1/agentmesh/availability", { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) { mode = MODE.LIVE; return mode; }
    mode = MODE.MOCK;
  } catch (e) {
    mode = MODE.MOCK;
  }
  return mode;
}

/* ---------- live endpoints (used when LIVE) ---------- */

export const api = {
  async createSession(payload) {
    return jsonFetch("/api/v1/agentmesh/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getSession(sessionId) {
    return jsonFetch(`/api/v1/agentmesh/sessions/${sessionId}`);
  },

  async revokeSession(sessionId) {
    return jsonFetch(`/api/v1/agentmesh/sessions/${sessionId}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  subscribeStatus(sessionId, onEvent) {
    const es = new EventSource(`${BASE}/api/v1/agentmesh/sessions/${sessionId}/events`);
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) {} };
    es.onerror = () => { /* reconnect handled by EventSource */ };
    return () => es.close();
  },
};

/* ---------- mock backend (deterministic, dev) ---------- */

const MOCK_TASKS = [
  { id: "sync-ping", kind: "sync", label: "ping / synchronous", payload: '{"action":"ping","message":"AgentMesh connectivity check"}' },
  { id: "async-report", kind: "async", label: "short task / asynchronous", payload: '{"action":"summarize","max_tokens":128}' },
];

function makeMockSessionId() {
  return "sess_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export const mock = {
  async createSession(payload) {
    const id = makeMockSessionId();
    const state = {
      id,
      role: payload.role,
      transport: payload.transport,
      mode: payload.mode,
      created_at: new Date().toISOString(),
      ttl_seconds: payload.ttl_seconds || 900,
      state: SESSION_STATE.CREATED,
      steps: [],
      scope: ["agent-card:read", "task:receive", "task:respond", "status:read"],
      agent_card_url: payload.agent_card_url || null,
    };
    sessionStore.put(id, state);
    return state;
  },

  async revokeSession(sessionId) {
    const s = sessionStore.get(sessionId);
    if (s) { s.state = SESSION_STATE.REVOKED; s.revoked_at = new Date().toISOString(); sessionStore.put(sessionId, s); }
    return { ok: true };
  },

  // drive the deterministic scripted timeline for a session
  async runScript(sessionId, onEvent) {
    const s = sessionStore.get(sessionId);
    if (!s) throw new Error("mock session not found");

    const emit = (state, msg, extra = {}) => {
      const cur = sessionStore.get(sessionId);
      if (!cur || cur._cancelled) return;
      cur.state = state;
      cur.steps.push({ state, at: new Date().toISOString(), msg });
      Object.assign(cur, extra);
      sessionStore.put(sessionId, cur);
      onEvent({ type: "status", session_id: sessionId, state, message: msg, ts: new Date().toISOString() });
    };

    const wait = (ms) =>
      new Promise((r) =>
        setTimeout(() => {
          const cur = sessionStore.get(sessionId);
          if (cur && cur._cancelled) return r();
          r();
        }, ms)
      );

    emit(SESSION_STATE.AGENT_CARD_VALIDATING, "Validating agent card and temporary credentials…");
    await wait(700);

    emit(SESSION_STATE.DISCOVERED, "Agent endpoint discovered", {
      discovered: { protocol: "A2A", endpoint: "https://agentmesh-labs.mnemostroma.com/agents/claurst-a/rpc", latency_ms: 84 },
    });
    await wait(800);

    emit(SESSION_STATE.CAPABILITY_CHECKED, "Capability check passed — sync messages and async tasks", {
      capabilities: ["message.send", "task.run", "task.status", "status.get"],
    });
    await wait(900);

    const task = MOCK_TASKS.find((t) => t.kind === s.mode) || MOCK_TASKS[0];
    emit(SESSION_STATE.TASK_RUNNING, "Running synthetic test task…", { task });
    await wait(1600);

    emit(SESSION_STATE.VERIFIED, "Hermes validated the response format and session boundary.", {
      verified: true,
      protocol: "A2A",
      capability_check: "passed",
      response_latency_ms: 342,
      role_relevant: "heuristic — non-blocking",
    });
    return s;
  },

  cancelSession(sessionId) {
    const s = sessionStore.get(sessionId);
    if (s) { s._cancelled = true; sessionStore.put(sessionId, s); }
  },
};
