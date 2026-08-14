/* RAG demo frontend: theme, i18n (en/uk), session, docs, ask, registration, cleanup. */
let token = null, expiresAt = 0, pollTimer = null;
const $ = id => document.getElementById(id);
const H = () => ({ "x-demo-token": token });

/* ---------------- i18n ---------------- */
const I18N = {
  en: {
    "hero.title": "Ask your documents",
    "hero.tagline": "Answers come only from the fragments retrieved in your files — with the source shown next to every claim.",
    "start": "Start demo session",
    "docs.title": "Documents",
    "docs.note": "Demo only — upload test files without sensitive or valuable content. All data is wiped daily.",
    "upload.title": "Upload your file",
    "upload.hint": "PDF, DOCX or TXT · up to {mb} MB",
    "usage.files": "{files}/{limit} files · {pages}/{limit2} pages",
    "ask.btn": "Ask",
    "ask.placeholder": "What does the contract say about payment terms?",
    "ask.searching": "Searching your documents…",
    "score": "score",
    "reg.btn": "Keep my chat history",
    "reg.note": "We send one confirmation email. History is kept for 7 days.",
    "reg.placeholder": "you@company.com",
    "reg.sent": "Confirmation email sent to {email}.",
    "cleanup.warn": "Daily cleanup starts soon — uploaded files and indexes will be removed.",
    "cleanup.postpone": "Postpone 1 hour",
    "status.ready": "ready",
    "status.error": "error",
    "status.pending": "pending",
    "status.extracting": "extracting",
    "status.indexing": "indexing",
  },
  uk: {
    "hero.title": "Ставте запитання документам",
    "hero.tagline": "Відповіді надходять лише з фрагментів, знайдених у ваших файлах — із зазначенням джерела біля кожного твердження.",
    "start": "Почати демо-сесію",
    "docs.title": "Документи",
    "docs.note": "Лише демо — завантажуйте тестові файли без чутливого чи цінного вмісту. Усі дані стираються щодня.",
    "upload.title": "Завантажити файл",
    "upload.hint": "PDF, DOCX або TXT · до {mb} МБ",
    "usage.files": "{files}/{limit} файлів · {pages}/{limit2} стор.",
    "ask.btn": "Запитати",
    "ask.placeholder": "Що йдеться в контракті про умови оплати?",
    "ask.searching": "Пошук у ваших документах…",
    "score": "оцінка",
    "reg.btn": "Зберегти історію запитань",
    "reg.note": "Ми надішлемо один лист для підтвердження. Історія зберігається 7 днів.",
    "reg.placeholder": "you@company.com",
    "reg.sent": "Лист підтвердження надіслано на {email}.",
    "cleanup.warn": "Щоденне очищення скоро почнеться — завантажені файли та індекси буде видалено.",
    "cleanup.postpone": "Відкласти на 1 годину",
    "status.ready": "готово",
    "status.error": "помилка",
    "status.pending": "очікує",
    "status.extracting": "витягування",
    "status.indexing": "індексація",
  },
};
const SUPPORTED = ["en", "uk"];
let lang = "en";

function t(key, vars) {
  let v = (I18N[lang] && I18N[lang][key]) ?? (I18N.en[key] ?? key);
  if (vars) for (const [k, val] of Object.entries(vars)) v = String(v).replace(`{${k}}`, String(val));
  return v;
}

function applyLang() {
  document.documentElement.setAttribute("lang", lang);
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-attr]").forEach(el => {
    el.getAttribute("data-i18n-attr").split(",").forEach(pair => {
      const [attr, key] = pair.trim().split("=");
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    });
  });
  document.querySelectorAll("[data-lang]").forEach(b => b.classList.toggle("active", b.getAttribute("data-lang") === lang));
  if (token) refreshUsage();
}

function initLang() {
  const saved = localStorage.getItem("rag-lang");
  lang = saved && SUPPORTED.includes(saved) ? saved : "en";
  applyLang();
  document.querySelectorAll("[data-lang]").forEach(b => {
    b.onclick = () => { lang = b.getAttribute("data-lang"); localStorage.setItem("rag-lang", lang); applyLang(); };
  });
}

/* ---------------- theme ---------------- */
function initTheme() {
  const btn = $("theme-toggle");
  const apply = () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const sun = btn.querySelector('[data-ico="sun"]'), moon = btn.querySelector('[data-ico="moon"]');
    if (sun) sun.style.display = dark ? "none" : "inline-block";
    if (moon) moon.style.display = dark ? "inline-block" : "none";
  };
  btn.onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("rag-theme", next); } catch (e) {}
    apply();
  };
  apply();
}

/* ---------------- api ---------------- */
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

async function refreshUsage() {
  const res = await api("/api/documents"); if (!res?.ok) return;
  const d = await res.json();
  $("usage").textContent = t("usage.files", { files: d.usage.files, limit: d.limits.files, pages: d.usage.pages, limit2: d.limits.pages });
  $("uploadHint").textContent = t("upload.hint", { mb: d.limits.file_mb });
}

async function loadDocs() {
  const res = await api("/api/documents"); if (!res?.ok) return;
  const d = await res.json();
  refreshUsage();
  $("docs").innerHTML = d.documents.map(doc => `
    <li><span class="st ${doc.status}">${doc.status === "ready" ? t("status.ready") : doc.status === "error" ? t("status.error") : t("status." + doc.status) || doc.status}</span>
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
  $("answer").hidden = false; $("answer").className = "answer"; $("answer").textContent = t("ask.searching");
  $("sources").innerHTML = "";
  const res = await api("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
  $("askBtn").disabled = false;
  if (!res) return;
  const data = await res.json();
  if (!res.ok) { $("answer").className = "answer ungrounded"; $("answer").textContent = data.detail; return; }
  $("answer").className = "answer" + (data.grounded ? "" : " ungrounded");
  $("answer").textContent = data.answer;
  const citedPages = extractCitedPages(data.answer);
  $("sources").innerHTML = data.sources.map(s => `
    <div class="src${citedPages.has(String(s.page)) ? " cited" : ""}">
      <div class="head"><span>${escapeHtml(s.filename)} · p.${s.page}</span><span>${t("score")} ${s.score}${citedPages.has(String(s.page)) ? " · cited" : ""}</span></div>
      <div class="body">${highlight(s.text, s.entities)}</div>
    </div>`).join("");
  document.querySelectorAll(".src").forEach(el => el.onclick = () => el.classList.toggle("open"));
}

/* Извлекает страницы, которые LLM реально процитировал в ответе ([p.N]). */
function extractCitedPages(answer) {
  const set = new Set();
  if (!answer) return set;
  for (const m of answer.matchAll(/\[[^\]]*p\.(\d+)[^\]]*\]/g)) set.add(m[1]);
  return set;
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
  alert(res.ok ? t("reg.sent", { email: d.sent_to }) : d.detail);
};

async function checkCleanup() {
  const res = await api("/api/cleanup"); if (!res?.ok) return;
  const c = await res.json();
  const b = $("banner");
  if (!c.warning || c.postponed_until > Date.now()) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<span>${t("cleanup.warn")}</span>`;
  if (c.can_postpone) {
    const btn = document.createElement("button");
    btn.textContent = t("cleanup.postpone");
    btn.onclick = async () => { await api("/api/cleanup/postpone", { method: "POST" }); checkCleanup(); };
    b.appendChild(btn);
  }
}

function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

initLang();
initTheme();
