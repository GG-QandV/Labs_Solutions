/* sse-client.js — subscribes to session status events (ES module).
   Live mode: EventSource over the backend SSE endpoint.
   Mock mode: drives the local scripted timeline via api-client.mock.runScript.
   Spec §5.9 (status timeline), §8. */
import { api, mock, isLive } from "./api-client.js";

export function subscribeStatus(sessionId, onEvent) {
  if (isLive()) {
    return api.subscribeStatus(sessionId, onEvent);
  }
  const runner = mock.runScript(sessionId, onEvent);
  return () => {
    mock.cancelSession(sessionId);
    runner.catch(() => {});
  };
}
