/* session-store.js — in-memory session registry for the demo (ES module).
   Spec §5.2. In mock mode it holds local scripted sessions; in live mode
   it mirrors the active session object so the wizard can re-read state.
   Nothing sensitive is persisted to localStorage. */

const store = new Map();

export function put(id, session) {
  store.set(id, session);
  return session;
}

export function get(id) {
  return store.get(id) || null;
}

export function remove(id) {
  store.delete(id);
}

export function list() {
  return Array.from(store.values());
}

export function clear() {
  store.clear();
}

export function has(id) {
  return store.has(id);
}
