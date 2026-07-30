import { useCallback, useEffect, useRef, useState } from "react";
import type { JobStatus, PageFormat, ValidationResult } from "@demo/report-schema";
import { t } from "@demo/i18n";

const lang = "en";
const api = (path: string) => `/api${path}`;

type Phase = "idle" | "validated" | "generating" | "sent" | "failed";

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [now, setNow] = useState(Date.now());
  const [sheetUrl, setSheetUrl] = useState("");
  const [email, setEmail] = useState("");
  const [pageFormat, setPageFormat] = useState<PageFormat>("A4");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<JobStatus | null>(null);
  const [flash, setFlash] = useState<string>("");
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const tokenAlive = token !== null && expiresAt > now;
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mmss = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  const headers = useCallback((): HeadersInit =>
    token ? { "x-demo-token": token, "content-type": "application/json" } : { "content-type": "application/json" },
  [token]);

  async function startSession() {
    setFlash("");
    const res = await fetch(api("/token"), { method: "POST" });
    if (!res.ok) { setFlash("Too many sessions from your address. Try again later."); return; }
    const info = await res.json();
    setToken(info.token);
    setExpiresAt(info.expiresAt);
  }

  async function validate() {
    if (!tokenAlive) { setFlash(t(lang, "token.expired")); return; }
    setBusy(true); setFlash(""); setValidation(null); setPhase("idle");
    try {
      const res = await fetch(api("/validate"), {
        method: "POST", headers: headers(),
        body: JSON.stringify({ sheetUrl, pageFormat })
      });
      if (res.status === 401) { setToken(null); setFlash(t(lang, "token.expired")); return; }
      const v: ValidationResult = await res.json();
      setValidation(v);
      if (v.ok) setPhase("validated");
    } finally { setBusy(false); }
  }

  async function uploadFor(row: number, file: File) {
    const res = await fetch(api(`/upload/${row}`), {
      method: "POST",
      headers: { "x-demo-token": token ?? "", "content-type": file.type },
      body: file
    });
    if (res.ok) {
      setFlash(`Image for row ${row + 1} uploaded — it will replace the broken link.`);
      await validate();
    } else {
      const e = await res.json().catch(() => ({ error: "upload failed" }));
      setFlash(`Upload failed: ${e.error}`);
    }
  }

  async function generate() {
    if (!tokenAlive) { setFlash(t(lang, "token.expired")); return; }
    setBusy(true); setFlash(""); setPhase("generating"); setJob(null);
    try {
      const res = await fetch(api("/jobs"), {
        method: "POST", headers: headers(),
        body: JSON.stringify({ sheetUrl, email, pageFormat })
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase("failed");
        setFlash(data.error === "rate_limited"
          ? `Rate limit reached (${data.scope ?? "daily"}). Resets in ~${Math.ceil((data.resetsInSeconds ?? 3600) / 60)} min.`
          : String(data.error ?? "Request failed"));
        return;
      }
      poll(data.jobId);
    } finally { setBusy(false); }
  }

  function poll(jobId: string) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const res = await fetch(api(`/jobs/${jobId}`));
      if (!res.ok) return;
      const j: JobStatus = await res.json();
      setJob(j);
      if (j.stage === "done") { setPhase("sent"); window.clearInterval(pollRef.current!); }
      if (j.stage === "error") { setPhase("failed"); window.clearInterval(pollRef.current!); }
    }, 2000);
  }

  const stageLabel = (j: JobStatus | null): string => {
    if (!j) return t(lang, "status.pending");
    if (j.stage === "error") return t(lang, "error.stage", { stage: j.error?.stage ?? "?" }) + ` — ${j.error?.message ?? ""}`;
    if (j.stage === "done") return t(lang, "status.done", { email: j.email ?? "" });
    return t(lang, `status.${j.stage}`);
  };

  const brokenRows = (validation?.warnings ?? [])
    .filter(w => w.code === "BROKEN_IMAGE")
    .map(w => (w.details as { row: number }).row);

  return (
    <main className="shell">
      <header className="mast">
        <div className="mark">PDF<span>/</span>demo</div>
        <div className="langs" aria-label="Language">
          <button className="lang on">EN</button>
          <button className="lang" disabled title="More languages coming">RU</button>
        </div>
      </header>

      <section className="hero">
        <h1>{t(lang, "app.title")}</h1>
        <p className="tagline">{t(lang, "app.tagline")}</p>
      </section>

      {/* Pipeline rail — the signature element: sheet → checks → PDF → mail */}
      <ol className="rail" aria-hidden="true">
        <li className={token ? "done" : phase !== "idle" ? "" : "on"}>sheet</li>
        <li className={validation?.ok ? "done" : validation ? "warn" : ""}>checks</li>
        <li className={phase === "sent" ? "done" : phase === "generating" ? "on" : ""}>pdf</li>
        <li className={phase === "sent" ? "done" : ""}>mail</li>
      </ol>

      <section className="panel">
        {!tokenAlive ? (
          <div className="session">
            {token && <p className="note">{t(lang, "token.expired")}</p>}
            <button className="primary" onClick={startSession}>{t(lang, "token.request")}</button>
          </div>
        ) : (
          <>
            <div className="timer" role="status">{t(lang, "token.remaining")} <b>{mmss}</b></div>

            <label className="field">
              <span>{t(lang, "input.sheetLabel")}</span>
              <input
                type="url" placeholder="https://docs.google.com/spreadsheets/d/…"
                value={sheetUrl} onChange={e => setSheetUrl(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy || !sheetUrl} onClick={validate}>
              {t(lang, "input.checkAccess")}
            </button>

            {validation && (
              <div className="report">
                <h2>{t(lang, "validation.title")}</h2>
                <ul className="issues">
                  {validation.errors.map((e, i) => <li key={`e${i}`} className="err"><code>{e.code}</code> {e.message}</li>)}
                  {validation.warnings.map((w, i) => <li key={`w${i}`} className="warn"><code>{w.code}</code> {w.message}</li>)}
                  {validation.ok && validation.warnings.length === 0 && <li className="ok">{t(lang, "validation.ok")}</li>}
                </ul>
                <dl className="stats">
                  <div><dt>rows</dt><dd>{validation.stats.rows} / {validation.stats.rowLimit}</dd></div>
                  <div><dt>columns</dt><dd>{validation.stats.columns}</dd></div>
                  <div><dt>images</dt><dd>{validation.stats.imageCells}</dd></div>
                  <div><dt>broken</dt><dd>{validation.stats.brokenImages}</dd></div>
                  <div><dt>hidden?</dt><dd>{validation.stats.possiblyHiddenRows < 0 ? "n/a" : validation.stats.possiblyHiddenRows}</dd></div>
                </dl>

                {brokenRows.length > 0 && (
                  <div className="uploads">
                    <h3>{t(lang, "upload.title")}</h3>
                    <p className="note">{t(lang, "upload.hint")}</p>
                    {brokenRows.map(r => (
                      <label key={r} className="uprow">
                        <span>Row {r + 1}</span>
                        <input type="file" accept="image/png,image/jpeg,image/webp"
                          onChange={e => e.target.files?.[0] && uploadFor(r, e.target.files[0])} />
                        <em>{t(lang, "upload.button")}</em>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {validation?.ok && (
              <div className="go">
                <div className="row">
                  <label className="field grow">
                    <span>{t(lang, "generate.email")}</span>
                    <input type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
                  </label>
                  <fieldset className="format">
                    <legend>{t(lang, "generate.format")}</legend>
                    {(["A4", "Legal"] as PageFormat[]).map(f => (
                      <label key={f} className={pageFormat === f ? "on" : ""}>
                        <input type="radio" name="fmt" checked={pageFormat === f} onChange={() => setPageFormat(f)} />{f}
                      </label>
                    ))}
                  </fieldset>
                </div>
                <button className="primary big" disabled={busy || !email || phase === "generating"} onClick={generate}>
                  {t(lang, "generate.button")}
                </button>
              </div>
            )}

            {(phase === "generating" || phase === "sent" || phase === "failed") && (
              <div className={`status ${phase}`} role="status">
                {stageLabel(job)}
                {job?.simplifiedRendering && <div className="note">{t(lang, "status.simplified")}</div>}
              </div>
            )}
          </>
        )}
        {flash && <p className="flash">{flash}</p>}
      </section>

      <footer className="foot">demo template · replace logo, name and accent color with your brand</footer>
    </main>
  );
}
