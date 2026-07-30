import { Hono } from "hono";
import { cors } from "hono/cors";
import { DEFAULT_CONFIG, type JobStatus, type PageFormat } from "@demo/report-schema";
import { connectSheet } from "@demo/sheet-connector";
import { generatePdf } from "@demo/pdf-engine";
import { sendReportEmail } from "@demo/email-sender";
import { issueToken, checkToken } from "@demo/access-token";
import { perToken, perIp, emailsPerDay } from "@demo/rate-limit";
import { isUrlAllowed } from "./ssrf.ts";
import type { Env } from "./env.ts";

const cfg = DEFAULT_CONFIG;
const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", cors());

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ATTACHMENT_LIMIT = 20 * 1024 * 1024;

function clientIp(c: { req: { header: (h: string) => string | undefined } }): string {
  return c.req.header("cf-connecting-ip") ?? "0.0.0.0";
}

async function requireToken(c: any): Promise<string | null> {
  const token = c.req.header("x-demo-token") ?? null;
  const { valid } = await checkToken(c.env.KV, token);
  return valid ? token : null;
}

/* ---------- Token ---------- */
app.post("/api/token", async (c) => {
  const ipCheck = await perIp(c.env.KV, clientIp(c), cfg.rateLimit.perIpPerHour);
  if (!ipCheck.allowed) return c.json({ error: "rate_limited", resetsInSeconds: ipCheck.resetsInSeconds }, 429);
  const info = await issueToken(c.env.KV, cfg.tokenTtlSeconds);
  return c.json(info);
});

app.get("/api/token", async (c) => {
  const token = c.req.header("x-demo-token") ?? null;
  const r = await checkToken(c.env.KV, token);
  return c.json(r, r.valid ? 200 : 401);
});

/* ---------- Validation ---------- */
app.post("/api/validate", async (c) => {
  const token = await requireToken(c);
  if (!token) return c.json({ error: "token_expired" }, 401);
  const body = await c.req.json<{ sheetUrl?: string; pageFormat?: PageFormat }>().catch(() => ({} as any));
  if (!body.sheetUrl) return c.json({ error: "sheetUrl required" }, 400);

  const uploaded = await listUploads(c.env.R2, token);
  const { validation } = await connectSheet({
    sheetUrl: body.sheetUrl,
    config: cfg,
    pageFormat: body.pageFormat ?? "A4",
    probeImages: true,
    uploadedImages: uploaded
  });
  return c.json(validation);
});

/* ---------- Image upload (flow B) ---------- */
app.post("/api/upload/:row", async (c) => {
  const token = await requireToken(c);
  if (!token) return c.json({ error: "token_expired" }, 401);
  const row = Number(c.req.param("row"));
  if (!Number.isInteger(row) || row < 0 || row >= cfg.rowLimit) return c.json({ error: "bad row index" }, 400);

  const ct = c.req.header("content-type") ?? "";
  const extByCt: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const ext = extByCt[ct];
  if (!ext) return c.json({ error: "unsupported type, use png/jpg/webp" }, 415);

  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > cfg.maxImageBytes) return c.json({ error: "file must be 1B..5MB" }, 413);
  if (!magicOk(new Uint8Array(buf), ext)) return c.json({ error: "file content does not match its type" }, 415);

  const key = `up/${token}/${row}.${ext}`;
  await c.env.R2.put(key, buf, { httpMetadata: { contentType: ct } });
  return c.json({ ok: true, url: `${c.env.PUBLIC_BASE_URL}/api/file/${encodeURIComponent(key)}` });
});

app.get("/api/file/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  if (!key.startsWith("up/") && !key.startsWith("pdf/")) return c.text("not found", 404);
  const obj = await c.env.R2.get(key);
  if (!obj) return c.text("not found", 404);
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
});

/* ---------- Image proxy (flow A, SSRF-guarded) ---------- */
app.get("/api/img-proxy", async (c) => {
  const url = c.req.query("url") ?? "";
  if (!isUrlAllowed(url)) return c.text("blocked", 403);
  const res = await fetch(url, { redirect: "follow", cf: { cacheTtl: 3600 } as any }).catch(() => null);
  if (!res || !res.ok) return c.text("upstream error", 502);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > cfg.maxImageBytes) return c.text("too large", 413);
  const ct = res.headers.get("content-type") ?? "application/octet-stream";
  return new Response(res.body, { headers: { "content-type": ct, "cache-control": "public, max-age=3600" } });
});

/* ---------- Jobs ---------- */
app.post("/api/jobs", async (c) => {
  const token = await requireToken(c);
  if (!token) return c.json({ error: "token_expired" }, 401);

  const t = await perToken(c.env.KV, token, cfg.rateLimit.perTokenPerHour);
  if (!t.allowed) return c.json({ error: "rate_limited", scope: "token", resetsInSeconds: t.resetsInSeconds }, 429);
  const ip = await perIp(c.env.KV, clientIp(c), cfg.rateLimit.perIpPerHour);
  if (!ip.allowed) return c.json({ error: "rate_limited", scope: "ip", resetsInSeconds: ip.resetsInSeconds }, 429);

  const body = await c.req.json<{ sheetUrl?: string; email?: string; pageFormat?: PageFormat }>().catch(() => ({} as any));
  if (!body.sheetUrl || !body.email) return c.json({ error: "sheetUrl and email required" }, 400);
  if (!EMAIL_RE.test(body.email)) return c.json({ error: "invalid email" }, 400);
  const domain = body.email.split("@")[1].toLowerCase();
  if (cfg.disposableDomains.includes(domain)) return c.json({ error: "disposable email domains are not allowed" }, 400);

  const mail = await emailsPerDay(c.env.KV, cfg.rateLimit.emailsPerDay);
  if (!mail.allowed) return c.json({ error: "daily email quota reached, try tomorrow" }, 429);

  const job: JobStatus = {
    id: crypto.randomUUID(),
    stage: "pending",
    email: body.email,
    pageFormat: body.pageFormat ?? "A4",
    sheetUrl: body.sheetUrl,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await saveJob(c.env.KV, job);

  // Free plan: no Queues. Process after responding via waitUntil (~30s wall time budget).
  // TODO(paid plan): move processJob into a Cloudflare Queues consumer — no other code changes needed.
  c.executionCtx.waitUntil(processJob(c.env, job, token));

  return c.json({ jobId: job.id });
});

app.get("/api/jobs/:id", async (c) => {
  const raw = await c.env.KV.get(`job:${c.req.param("id")}`);
  if (!raw) return c.json({ error: "not found" }, 404);
  return c.json(JSON.parse(raw));
});

/* ---------- Job processor (isolated: future Queues consumer) ---------- */
async function processJob(env: Env, job: JobStatus, token: string): Promise<void> {
  const step = async (stage: JobStatus["stage"]) => { job.stage = stage; job.updatedAt = Date.now(); await saveJob(env.KV, job); };
  const fail = async (stage: Exclude<JobStatus["stage"], "done">, message: string) => {
    job.stage = "error"; job.error = { stage, message }; job.updatedAt = Date.now(); await saveJob(env.KV, job);
  };
  try {
    await step("validating");
    const uploaded = await listUploads(env.R2, token);
    const { validation, report } = await connectSheet({
      sheetUrl: job.sheetUrl, config: cfg, pageFormat: job.pageFormat,
      probeImages: false, uploadedImages: uploaded
    });
    if (!validation.ok || !report) {
      await fail("validating", validation.errors.map(e => e.message).join(" "));
      return;
    }

    await step("rendering");
    const imgProxy = (u: string) => u.startsWith(env.PUBLIC_BASE_URL)
      ? u
      : `${env.PUBLIC_BASE_URL}/api/img-proxy?url=${encodeURIComponent(u)}`;
    const pdf = await generatePdf(report, { browser: env.MYBROWSER, template: "template-1", imgProxy });
    job.simplifiedRendering = pdf.simplified;

    await step("sending");
    const filename = `${report.meta.reportNumber}.pdf`;
    let result;
    if (pdf.bytes.byteLength > ATTACHMENT_LIMIT) {
      const key = `pdf/${job.id}/${filename}`;
      await env.R2.put(key, pdf.bytes, { httpMetadata: { contentType: "application/pdf" } });
      result = await sendReportEmail({
        apiKey: env.RESEND_API_KEY, to: job.email!,
        vars: { reportNumber: report.meta.reportNumber },
        downloadUrl: `${env.PUBLIC_BASE_URL}/api/file/${encodeURIComponent(key)}`
      });
    } else {
      result = await sendReportEmail({
        apiKey: env.RESEND_API_KEY, to: job.email!,
        vars: { reportNumber: report.meta.reportNumber },
        attachment: { filename, bytes: pdf.bytes }
      });
    }
    if (!result.ok) { await fail("sending", result.error ?? "email failed"); return; }

    await step("done");
  } catch (e) {
    await fail(job.stage === "done" ? "sending" : (job.stage as any), String((e as Error)?.message ?? e));
  }
}

/* ---------- helpers ---------- */
async function saveJob(kv: KVNamespace, job: JobStatus): Promise<void> {
  await kv.put(`job:${job.id}`, JSON.stringify(job), { expirationTtl: cfg.jobTtlSeconds });
}

async function listUploads(r2: R2Bucket, token: string): Promise<Record<number, string>> {
  const out: Record<number, string> = {};
  const list = await r2.list({ prefix: `up/${token}/` });
  for (const obj of list.objects) {
    const m = obj.key.match(/\/(\d+)\.\w+$/);
    if (m) out[Number(m[1])] = `/api/file/${encodeURIComponent(obj.key)}`;
  }
  return out;
}

function magicOk(b: Uint8Array, ext: string): boolean {
  if (ext === "png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === "jpg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === "webp") return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57;
  return false;
}

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
