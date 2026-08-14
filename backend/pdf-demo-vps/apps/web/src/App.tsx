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
        <a href="https://labs.mnemostroma.com/" className="brand" aria-label="Labs.Mnemostroma">
          <svg viewBox="0 0 16730.7 1527.0" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Labs.Mnemostroma">
            <g transform="translate(0 1490.0) scale(1 -1)">
              <g data-logo-part="labs"><path d="M268 1490V0H139V1490Z"/><path d="M451 -25Q350 -25 266.0 14.5Q182 54 132.5 129.5Q83 205 83 313Q83 396 114.0 452.0Q145 508 203.0 544.5Q261 581 339.5 602.5Q418 624 513 635Q607 647 672.0 655.5Q737 664 771.0 683.0Q805 702 805 744V770Q805 885 737.0 950.5Q669 1016 542 1016Q421 1016 345.0 963.0Q269 910 239 838L115 883Q153 974 220.0 1029.0Q287 1084 370.0 1108.5Q453 1133 538 1133Q602 1133 671.0 1116.0Q740 1099 800.0 1058.0Q860 1017 897.5 943.5Q935 870 935 758V0H805V177H797Q775 128 729.0 81.5Q683 35 614.0 5.0Q545 -25 451 -25ZM469 93Q572 93 647.5 138.5Q723 184 764.0 261.0Q805 338 805 429V590Q790 576 756.5 565.0Q723 554 679.5 546.0Q636 538 591.5 532.0Q547 526 513 522Q419 510 351.5 485.0Q284 460 248.5 417.0Q213 374 213 306Q213 205 285.5 149.0Q358 93 469 93Z" transform="translate(346 0)"/></g>
              <g data-logo-part="mnemo"><path d="M91 0V1118H384V919H398Q433 1018 515.0 1075.0Q597 1132 710 1132Q825 1132 905.5 1074.5Q986 1017 1013 919H1025Q1059 1016 1149.0 1074.0Q1239 1132 1361 1132Q1517 1132 1615.5 1033.0Q1714 934 1714 752V0H1404V690Q1404 784 1354.5 830.0Q1305 876 1231 876Q1147 876 1099.5 822.5Q1052 769 1052 682V0H752V698Q752 779 705.0 827.5Q658 876 582 876Q530 876 489.0 850.0Q448 824 424.0 778.5Q400 733 400 670V0Z" transform="translate(3880.65 0)"/></g>
              <g data-logo-part="stroma"><path d="M889 871 771 839Q745 914 684.5 966.5Q624 1019 511 1019Q398 1019 325.0 964.5Q252 910 252 825Q252 754 301.5 708.5Q351 663 455 637L624 596Q764 561 834.5 487.5Q905 414 905 302Q905 208 852.5 134.0Q800 60 707.0 18.0Q614 -24 491 -24Q327 -24 221.0 50.5Q115 125 85 264L209 294Q232 195 303.0 144.0Q374 93 489 93Q617 93 695.0 151.0Q773 209 773 295Q773 433 590 478L408 522Q262 557 192.0 632.0Q122 707 122 819Q122 911 172.5 982.0Q223 1053 311.0 1093.0Q399 1133 511 1133Q665 1133 757.0 1062.5Q849 992 889 871Z" transform="translate(10800.65 0)"/></g>
              <circle data-logo-part="dot" cx="3663.825" cy="566.000" r="206.500"/>
            </g>
          </svg>
        </a>
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
