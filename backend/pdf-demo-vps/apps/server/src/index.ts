import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import { mkdirSync, readdirSync, statSync, rmSync, createReadStream, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG, type JobStatus, type PageFormat } from "@demo/report-schema";
import { connectSheet } from "@demo/sheet-connector";
import { generatePdf } from "@demo/pdf-engine";
import { sendReportEmail } from "@demo/email-sender";
import { issueToken, checkToken } from "@demo/access-token";
import { perToken, perIp, emailsPerDay } from "@demo/rate-limit";
import { Store } from "./store.ts";
import { JobQueue } from "./queue.ts";
import { isUrlAllowed } from "./ssrf.ts";
import { opshubRegister, opshubError, opshubHeartbeat } from "../clients/opshub-client.ts";

const cfg = DEFAULT_CONFIG;
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? "https://solutions.dpdns.org";
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const WEB_DIST = process.env.WEB_DIST ?? resolve(import.meta.dirname, "../../web/dist");
const PORT = Number(process.env.PORT ?? 8080);
const ATTACHMENT_LIMIT = 20 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

mkdirSync(join(DATA_DIR, "up"), { recursive: true });
mkdirSync(join(DATA_DIR, "pdf"), { recursive: true });
const store = new Store(join(DATA_DIR, "app.db"));
const queue = new JobQueue(Number(process.env.RENDER_CONCURRENCY ?? 2));

const app = Fastify({ logger: true, bodyLimit: cfg.maxImageBytes + 1024 });
await app.register(cors);
app.addContentTypeParser(["image/png", "image/jpeg", "image/webp"], { parseAs: "buffer" }, (_req, body, done) => done(null, body));

app.addHook("onRequest", async () => { opshubHeartbeat(); });

const clientIp = (req: { headers: Record<string, unknown>; ip: string }): string =>
  String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip;

async function requireToken(req: { headers: Record<string, unknown> }): Promise<string | null> {
  const token = (req.headers["x-demo-token"] as string) ?? null;
  const { valid } = await checkToken(store, token);
  return valid ? token : null;
}

/* ---------- Token ---------- */
app.post("/api/token", async (req, reply) => {
  const ipCheck = await perIp(store, clientIp(req), cfg.rateLimit.perIpPerHour);
  if (!ipCheck.allowed) return reply.code(429).send({ error: "rate_limited", resetsInSeconds: ipCheck.resetsInSeconds });
  return issueToken(store, cfg.tokenTtlSeconds);
});

app.get("/api/token", async (req, reply) => {
  const r = await checkToken(store, (req.headers["x-demo-token"] as string) ?? null);
  return reply.code(r.valid ? 200 : 401).send(r);
});

/* ---------- Validation ---------- */
app.post("/api/validate", async (req, reply) => {
  const token = await requireToken(req);
  if (!token) return reply.code(401).send({ error: "token_expired" });
  const body = req.body as { sheetUrl?: string; pageFormat?: PageFormat };
  if (!body?.sheetUrl) return reply.code(400).send({ error: "sheetUrl required" });
  const { validation } = await connectSheet({
    sheetUrl: body.sheetUrl, config: cfg, pageFormat: body.pageFormat ?? "A4",
    probeImages: true, uploadedImages: listUploads(token)
  });
  return validation;
});

/* ---------- Image upload (flow B) ---------- */
app.post("/api/upload/:row", async (req, reply) => {
  const token = await requireToken(req);
  if (!token) return reply.code(401).send({ error: "token_expired" });
  const row = Number((req.params as { row: string }).row);
  if (!Number.isInteger(row) || row < 0 || row >= cfg.rowLimit) return reply.code(400).send({ error: "bad row index" });

  const ct = String(req.headers["content-type"] ?? "");
  const extByCt: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const ext = extByCt[ct];
  if (!ext) return reply.code(415).send({ error: "unsupported type, use png/jpg/webp" });

  const buf = req.body as Buffer;
  if (!buf?.length || buf.length > cfg.maxImageBytes) return reply.code(413).send({ error: "file must be 1B..5MB" });
  if (!magicOk(buf, ext)) return reply.code(415).send({ error: "file content does not match its type" });

  mkdirSync(join(DATA_DIR, "up", token), { recursive: true });
  writeFileSync(join(DATA_DIR, "up", token, `${row}.${ext}`), buf);
  return { ok: true, url: `${PUBLIC_BASE_URL}/api/file/up/${token}/${row}.${ext}` };
});

app.get("/api/file/*", async (req, reply) => {
  const rel = (req.params as { "*": string })["*"];
  if (!/^(up|pdf)\//.test(rel) || rel.includes("..")) return reply.code(404).send("not found");
  const path = join(DATA_DIR, rel);
  if (!existsSync(path)) return reply.code(404).send("not found");
  const ext = rel.split(".").pop() ?? "";
  const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };
  reply.header("content-type", types[ext] ?? "application/octet-stream");
  reply.header("cache-control", "private, max-age=3600");
  return reply.send(createReadStream(path));
});

/* ---------- Image proxy (flow A, SSRF-guarded with DNS resolve) ---------- */
app.get("/api/img-proxy", async (req, reply) => {
  const url = (req.query as { url?: string }).url ?? "";
  if (!(await isUrlAllowed(url))) return reply.code(403).send("blocked");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res || !res.ok || !res.body) return reply.code(502).send("upstream error");
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > cfg.maxImageBytes) return reply.code(413).send("too large");
  reply.header("content-type", res.headers.get("content-type") ?? "application/octet-stream");
  reply.header("cache-control", "public, max-age=3600");
  return reply.send(res.body);
});

/* ---------- Jobs ---------- */
app.post("/api/jobs", async (req, reply) => {
  const token = await requireToken(req);
  if (!token) return reply.code(401).send({ error: "token_expired" });

  const t = await perToken(store, token, cfg.rateLimit.perTokenPerHour);
  if (!t.allowed) return reply.code(429).send({ error: "rate_limited", scope: "token", resetsInSeconds: t.resetsInSeconds });
  const ip = await perIp(store, clientIp(req), cfg.rateLimit.perIpPerHour);
  if (!ip.allowed) return reply.code(429).send({ error: "rate_limited", scope: "ip", resetsInSeconds: ip.resetsInSeconds });

  const body = req.body as { sheetUrl?: string; email?: string; pageFormat?: PageFormat };
  if (!body?.sheetUrl || !body?.email) return reply.code(400).send({ error: "sheetUrl and email required" });
  if (!EMAIL_RE.test(body.email)) return reply.code(400).send({ error: "invalid email" });
  const domain = body.email.split("@")[1].toLowerCase();
  if (cfg.disposableDomains.includes(domain)) return reply.code(400).send({ error: "disposable email domains are not allowed" });

  const mail = await emailsPerDay(store, cfg.rateLimit.emailsPerDay);
  if (!mail.allowed) return reply.code(429).send({ error: "daily email quota reached, try tomorrow" });

  const job: JobStatus = {
    id: crypto.randomUUID(), stage: "pending", email: body.email,
    pageFormat: body.pageFormat ?? "A4", sheetUrl: body.sheetUrl,
    createdAt: Date.now(), updatedAt: Date.now()
  };
  store.saveJob(job);
  queue.enqueue(() => processJob(job, token));
  return { jobId: job.id };
});

app.get("/api/jobs/:id", async (req, reply) => {
  const job = store.getJob((req.params as { id: string }).id);
  if (!job) return reply.code(404).send({ error: "not found" });
  return job;
});

/* ---------- Job processor (isolated: BullMQ-swappable) ---------- */
async function processJob(job: JobStatus, token: string): Promise<void> {
  const step = (stage: JobStatus["stage"]) => { job.stage = stage; job.updatedAt = Date.now(); store.saveJob(job); };
  const fail = (stage: Exclude<JobStatus["stage"], "done">, message: string, err?: unknown) => {
    job.stage = "error"; job.error = { stage, message }; job.updatedAt = Date.now(); store.saveJob(job);
    opshubError(`job_${stage}_failed`, err ?? message, { jobId: job.id });
  };
  try {
    step("validating");
    const { validation, report } = await connectSheet({
      sheetUrl: job.sheetUrl, config: cfg, pageFormat: job.pageFormat,
      probeImages: false, uploadedImages: listUploads(token)
    });
    if (!validation.ok || !report) { fail("validating", validation.errors.map(e => e.message).join(" ")); return; }

    step("rendering");
    const imgProxy = (u: string) => u.startsWith(PUBLIC_BASE_URL) || u.startsWith("http://localhost")
      ? u.replace(PUBLIC_BASE_URL, `http://127.0.0.1:${PORT}`)
      : `http://127.0.0.1:${PORT}/api/img-proxy?url=${encodeURIComponent(u)}`;
    const pdf = await generatePdf(report, { template: "template-1", imgProxy });

    step("sending");
    const filename = `${report.meta.reportNumber}.pdf`;
    let result;
    if (pdf.bytes.byteLength > ATTACHMENT_LIMIT) {
      mkdirSync(join(DATA_DIR, "pdf", job.id), { recursive: true });
      writeFileSync(join(DATA_DIR, "pdf", job.id, filename), pdf.bytes);
      result = await sendReportEmail({
        apiKey: RESEND_API_KEY, to: job.email!, vars: { reportNumber: report.meta.reportNumber },
        downloadUrl: `${PUBLIC_BASE_URL}/api/file/pdf/${job.id}/${filename}`
      });
    } else {
      result = await sendReportEmail({
        apiKey: RESEND_API_KEY, to: job.email!, vars: { reportNumber: report.meta.reportNumber },
        attachment: { filename, bytes: pdf.bytes }
      });
    }
    if (!result.ok) { fail("sending", result.error ?? "email failed"); return; }
    step("done");
  } catch (e) {
    fail(job.stage === "done" ? "sending" : (job.stage as Exclude<JobStatus["stage"], "done">), String((e as Error)?.message ?? e), e);
  }
}

/* ---------- helpers ---------- */
function listUploads(token: string): Record<number, string> {
  const dir = join(DATA_DIR, "up", token);
  const out: Record<number, string> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(\d+)\.\w+$/);
    if (m) out[Number(m[1])] = `http://127.0.0.1:${PORT}/api/file/up/${token}/${f}`;
  }
  return out;
}

function magicOk(b: Buffer, ext: string): boolean {
  if (ext === "png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === "jpg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "webp") return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57;
  return false;
}

/* ---------- housekeeping: 24h TTL for /data, hourly sweep ---------- */
function sweep(): void {
  const cutoff = Date.now() - cfg.jobTtlSeconds * 1000;
  for (const sub of ["up", "pdf"]) {
    const base = join(DATA_DIR, sub);
    for (const entry of readdirSync(base)) {
      const p = join(base, entry);
      try { if (statSync(p).mtimeMs < cutoff) rmSync(p, { recursive: true, force: true }); } catch { /* skip */ }
    }
  }
  store.cleanup(cfg.jobTtlSeconds);
}
setInterval(sweep, 3600_000).unref();

/* ---------- health & static ---------- */
app.get("/health", async () => ({ ok: true, queue: queue.queueLength }));

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.type("text/html").send(readFileSync(join(WEB_DIST, "index.html")));
  });
}

await opshubRegister();
await app.listen({ port: PORT, host: "0.0.0.0" });
