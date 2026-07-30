/** OpsHub drop-in client (per fleet convention): error logs + heartbeat.
 * Never throws into the host app; buffers to a local file when OpsHub is down. */
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";

interface LogEntry {
  service: string;
  level: "error" | "critical";
  event: string;
  message: string;
  traceback?: string;
  request_id?: string;
  meta?: Record<string, unknown>;
}

const URL_BASE = process.env.OPSHUB_URL ?? "";
const KEY = process.env.OPSHUB_KEY ?? "";
const SERVICE = process.env.OPSHUB_SERVICE ?? "pdf-demo";
const BUFFER_FILE = "/tmp/opshub-buffer.ndjson";
const enabled = URL_BASE !== "";

let lastHeartbeat = 0;

async function post(path: string, body: unknown): Promise<boolean> {
  if (!enabled) return true;
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-opshub-key": KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function opshubRegister(): Promise<void> {
  await post("/api/register", { service: SERVICE, container_name: SERVICE, url_health: "/health" });
  await flushBuffer();
}

export function opshubError(event: string, err: unknown, meta?: Record<string, unknown>): void {
  const entry: LogEntry = {
    service: SERVICE,
    level: "error",
    event,
    message: String((err as Error)?.message ?? err).slice(0, 2000),
    traceback: (err as Error)?.stack?.slice(0, 8000),
    meta
  };
  void post("/api/log", [entry]).then(ok => {
    if (!ok) {
      try { appendFileSync(BUFFER_FILE, JSON.stringify(entry) + "\n"); } catch { /* never throw */ }
    }
  });
}

/** Call from a request hook; throttled to 1/min so每 request stays cheap. */
export function opshubHeartbeat(): void {
  const now = Date.now();
  if (now - lastHeartbeat < 60_000) return;
  lastHeartbeat = now;
  void post("/api/heartbeat", { service: SERVICE });
}

async function flushBuffer(): Promise<void> {
  if (!existsSync(BUFFER_FILE)) return;
  try {
    const lines = readFileSync(BUFFER_FILE, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
    if (lines.length && (await post("/api/log", lines))) rmSync(BUFFER_FILE);
  } catch { /* best effort */ }
}
