let token = null, expiresAt = 0, pollTimer = null;
const $ = id => document.getElementById(id);
const H = () => ({ "x-demo-token": token });

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  if (res.status === 401) { location.reload(); return null; }
  return res;
}

$("startBtn").onclick = async () => {
  const res = await fetch("/api/session", { method: "POST" });
  if (!res.ok) { alert((await res.json()).detail); return; }
  const s = await res.json();
  token = s.token; expiresAt = s.expires_at;
  $("startBox").hidden = true; $("app").hidden = false;
  tick(); loadDocs(); checkCleanup();
  setInterval(tick, 1000); setInterval(checkCleanup, 60000);
};

function tick() {
  const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  $("timer").textContent = `session ${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  if (left === 0) location.reload();
}

async function loadDocs() {
  const res = await api("/api/documents"); if (!res?.ok) return;
  const d = await res.json();
  $("usage").textContent = `${d.usage.files}/${d.limits.files} files · ${d.usage.pages}/${d.limits.pages} pages`;
  $("uploadHint").textContent = `PDF, DOCX or TXT · up to ${d.limits.file_mb} MB`;
  $("docs").innerHTML = d.documents.map(doc => `
    <li><span class="st ${doc.status}">${doc.status}</span>
      <span>${escapeHtml(doc.filename)}</span>
      ${doc.pages ? `<span class="ocr">${doc.pages}p${doc.ocr_used ? " · OCR" : ""}</span>` : ""}
      ${doc.error ? `<span class="err">${escapeHtml(doc.error)}</span>` : ""}</li>`).join("");
  const busy = d.documents.some(x => ["pending", "extracting", "indexing"].includes(x.status));
  clearTimeout(pollTimer);
  if (busy) pollTimer = setTimeout(loadDocs, 1500);
}

$("file").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  const res = await api("/api/documents", { method: "POST", body: fd });
  if (res && !res.ok) alert((await res.json()).detail);
  e.target.value = ""; loadDocs();
};

$("askBtn").onclick = ask;
$("q").onkeydown = e => { if (e.key === "Enter") ask(); };

async function ask() {
  const q = $("q").value.trim(); if (!q) return;
  $("askBtn").disabled = true;
  $("answer").hidden = false; $("answer").className = "answer"; $("answer").textContent = "Searching your documents…";
  $("sources").innerHTML = "";
  const res = await api("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
  $("askBtn").disabled = false;
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { $("answer").className = "answer ungrounded"; $("answer").textContent = data.detail; return; }
  $("answer").className = "answer" + (data.grounded ? "" : " ungrounded");
  $("answer").textContent = data.answer;
  $("sources").innerHTML = data.sources.map(s => `
    <div class="src">
      <div class="head"><span>${escapeHtml(s.filename)} · p.${s.page}</span><span>score ${s.score}</span></div>
      <div class="body">${highlight(s.text, s.entities)}</div>
    </div>`).join("");
  document.querySelectorAll(".src").forEach(el => el.onclick = () => el.classList.toggle("open"));
}

function highlight(text, entities) {
  if (!entities?.length) return escapeHtml(text);
  let out = "", pos = 0;
  for (const e of entities.sort((a, b) => a.start - b.start)) {
    if (e.start < pos || e.end > text.length) continue;
    out += escapeHtml(text.slice(pos, e.start)) + `<mark title="${e.type}">${escapeHtml(text.slice(e.start, e.end))}</mark>`;
    pos = e.end;
  }
  return out + escapeHtml(text.slice(pos));
}

$("regBtn").onclick = async () => {
  const email = $("email").value.trim(); if (!email) return;
  const res = await api("/api/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
  if (!res) return;
  const d = await res.json();
  alert(res.ok ? `Confirmation email sent to ${d.sent_to}.` : d.detail);
};

async function checkCleanup() {
  const res = await api("/api/cleanup"); if (!res?.ok) return;
  const c = await res.json();
  const b = $("banner");
  if (!c.warning || c.postponed_until > Date.now()) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<span>Daily cleanup starts soon — uploaded files and indexes will be removed.</span>`;
  if (c.can_postpone) {
    const btn = document.createElement("button");
    btn.textContent = "Postpone 1 hour";
    btn.onclick = async () => { await api("/api/cleanup/postpone", { method: "POST" }); checkCleanup(); };
    b.appendChild(btn);
  }
}

function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
