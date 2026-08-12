/** OpsHub drop-in client (fleet convention): error logs + heartbeat.
 *  Never throws into the host app; buffers to a local file when OpsHub is down.
 *  JS port of backend/opshub/clients/opshub-client.ts — keep both in sync. */
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';

const URL_BASE = process.env.OPSHUB_URL ?? '';
const KEY = process.env.OPSHUB_KEY ?? '';
const SERVICE = process.env.OPSHUB_SERVICE ?? 'dispatcher';
const CONTAINER = process.env.OPSHUB_CONTAINER ?? 'dispatcher-api'; // real docker name (compose)
const BUFFER_FILE = '/tmp/opshub-buffer.ndjson';
const enabled = URL_BASE !== '';

async function post(path, body) {
  if (!enabled) return true;
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-opshub-key': KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function flushBuffer() {
  if (!existsSync(BUFFER_FILE)) return;
  try {
    const lines = readFileSync(BUFFER_FILE, 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (lines.length && (await post('/api/log', lines))) rmSync(BUFFER_FILE);
  } catch { /* best effort */ }
}

export async function opshubRegister() {
  await post('/api/register', {
    service: SERVICE, container_name: CONTAINER, url_health: '/health'
  });
  await flushBuffer();
}

export function opshubError(event, err, meta) {
  const entry = {
    service: SERVICE,
    level: 'error',
    event,
    message: String(err?.message ?? err).slice(0, 2000),
    traceback: err?.stack?.slice(0, 8000),
    meta
  };
  void post('/api/log', [entry]).then((ok) => {
    if (!ok) {
      try { appendFileSync(BUFFER_FILE, JSON.stringify(entry) + '\n'); } catch { /* never throw */ }
    }
  });
}

/** Periodic heartbeat. Unlike the TS client (request-hook driven) the dispatcher
 *  can sit idle for long stretches, so it pushes on a timer instead. */
export function startHeartbeat() {
  if (!enabled) return;
  void opshubRegister();
  const timer = setInterval(() => { void post('/api/heartbeat', { service: SERVICE }); }, 60_000);
  timer.unref();
}
