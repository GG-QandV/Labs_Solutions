/* =====================================================================
   Labs Mnemostroma — app.js
   Vanilla ES2020, без зависимостей. Никаких inline-обработчиков (CSP-friendly).
   Модули: i18n / theme / nav / runner / demo-states / forms
   ===================================================================== */
'use strict';

const API = '/api/v1';                 // единая база; см. docs/BACKEND_API.md
const LANGS = ['en', 'uk', 'pl', 'ru'];
/* Язык, УЖЕ зашитый в разметку текущего файла: 'en' для /, 'uk' для /uk/ (см. build/prerender.py) */
const DEFAULT_LANG = document.documentElement.getAttribute('data-lang-default') || 'en';

/* ---------------------------------------------------------------- i18n */
const i18n = {
  lang: DEFAULT_LANG,
  dict: {},
  cache: new Map(),
  hooks: [],

  async load(lang) {
    if (!LANGS.includes(lang)) lang = DEFAULT_LANG;
    if (this.cache.has(lang)) return this.cache.get(lang);
    const res = await fetch(`/i18n/${lang}.json`, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`i18n ${lang}: HTTP ${res.status}`);
    const dict = await res.json();
    this.cache.set(lang, dict);
    return dict;
  },

  get(key) {
    return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), this.dict);
  },

  /* Применение словаря: textContent (не innerHTML — защита от инъекции в переводах) */
  apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = this.get(el.getAttribute('data-i18n'));
      if (typeof v === 'string') el.textContent = v;
    });
    /* data-i18n-attr="content:meta.title" или несколько через ; */
    document.querySelectorAll('[data-i18n-attr]').forEach(el => {
      el.getAttribute('data-i18n-attr').split(';').forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s && s.trim());
        if (!attr || !key) return;
        const v = this.get(key);
        if (typeof v === 'string') el.setAttribute(attr, v);
      });
    });
    document.documentElement.lang = this.lang;
    const t = this.get('meta.title');
    if (t) document.title = t;
    document.querySelectorAll('[data-lang-set]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.langSet === this.lang));
    });
    this.hooks.forEach(fn => { try { fn(); } catch (e) {} });
  },

  onApply(fn) { this.hooks.push(fn); },

  async set(lang, persist = true) {
    if (!LANGS.includes(lang)) lang = DEFAULT_LANG;
    if (lang === this.lang && Object.keys(this.dict).length) return;
    try {
      this.dict = await this.load(lang);
      this.lang = lang;
      this.apply();
      if (persist) safeStore('lm.lang', lang);
    } catch (e) {
      console.warn('[i18n]', e.message);   // остаётся язык, зашитый в HTML
    }
  }
};

function safeStore(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

/* --------------------------------------------------------------- theme */
function initTheme() {
  const set = (mode) => {
    document.documentElement.setAttribute('data-theme', mode);
    safeStore('lm.theme', mode);
    document.querySelectorAll('#themeToggle,[data-theme-toggle]').forEach(b => {
      b.setAttribute('aria-pressed', String(mode === 'light'));
    });
  };
  document.querySelectorAll('#themeToggle,[data-theme-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      set(cur === 'dark' ? 'light' : 'dark');
    });
  });
  set(document.documentElement.getAttribute('data-theme') || 'dark');
}

/* ----------------------------------------------------------------- nav */
function initNav() {
  const burger = document.getElementById('burger');
  const nav = document.querySelector('.nav');
  if (!burger || !nav) return;
  nav.id = nav.id || 'nav';
  burger.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', e => {
    if (e.target.tagName === 'A') { nav.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); }
  });
}

/* -------------------------------------------------- runner (сигнатура) */
function initRunner() {
  const root = document.getElementById('runner');
  if (!root) return;
  const steps = [...root.querySelectorAll('.track__i')];
  const badge = document.getElementById('runnerState');
  const approve = document.getElementById('runnerApprove');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null, idx = 0;

  const stateKey = ['running', 'running', 'running', 'running', 'running', 'gate', 'done'];

  function paint(n) {
    steps.forEach((s, i) => {
      s.classList.toggle('is-done', i < n);
      s.classList.toggle('is-active', i === n);
    });
    const key = stateKey[Math.min(n, stateKey.length - 1)];
    const label = i18n.get('runner.state.' + key);
    if (badge) badge.textContent = label || key;
    root.classList.toggle('is-gated', n === 5);
  }

  function run() {
    clearTimeout(timer);
    if (idx >= 5) { paint(5); return; }        // останов на approval gate — суть демонстрации
    paint(idx);
    idx += 1;
    timer = setTimeout(run, 900);
  }

  if (reduced) { idx = 5; paint(5); }
  else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { io.disconnect(); run(); } });
    }, { threshold: .35 });
    io.observe(root);
  }

  approve?.addEventListener('click', () => {
    paint(6);
    root.classList.remove('is-gated');
    setTimeout(() => { idx = 0; run(); }, 2600);   // цикл: показать, что процесс повторяемый
  });
}

/* -------------------------------------------------- статусы демо-модулей
   GET /api/v1/demos → [{slug,state}] где state: ready|cold|soon|down
   Фронт НИКОГДА не ходит в OpsHub напрямую (см. docs/BACKEND_API.md §4).
   Список карточек и счётчик в h2 считаются из ответа бэкенда — статика не расходится с реальностью.  */
async function initDemoStates() {
  const cards = [...document.querySelectorAll('[data-demo]')];
  if (!cards.length) return;
  const label = s => i18n.get('demoState.' + s) || s;

  let realCount = null;
  const h2 = document.querySelector('[data-i18n="demos.h2"]');

  function demoNoun(lang, n) {
    const d = i18n.get('demos.count');
    if (!d || !d.one || !d.few || !d.many) return String(n);
    const a = Math.abs(n);
    if (lang === 'en') return a === 1 ? d.one : d.many;
    if (a % 10 === 1 && a % 100 !== 11) return d.one;
    if (a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 12 || a % 100 > 14)) return d.few;
    return d.many;
  }
  function syncDemoH2() {
    if (realCount == null || !h2) return;
    const rest = i18n.get('demos.h2Rest');
    if (typeof rest !== 'string') return;   // словарь ещё не готов — остаётся статичный h2
    h2.textContent = realCount + ' ' + demoNoun(i18n.lang, realCount) + rest;
  }
  i18n.onApply(syncDemoH2);

  cards.forEach(c => {
    const p = c.querySelector('[data-demo-state]');
    if (p) { p.dataset.state = 'soon'; p.textContent = label('soon'); }
  });

  try {
    const res = await fetch(`${API}/demos`, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return;
    const list = await res.json();
    const map = new Map(list.filter(d => d && d.slug).map(d => [d.slug, d.state]));
    const kept = cards.filter(c => map.has(c.dataset.demo));
    cards.forEach(c => { if (!map.has(c.dataset.demo)) c.remove(); });
    kept.forEach(c => {
      const st = map.get(c.dataset.demo);
      const p = c.querySelector('[data-demo-state]');
      if (p && st) { p.dataset.state = st; p.textContent = label(st); }
    });
    realCount = kept.length;
    syncDemoH2();
  } catch (e) { /* бэкенд ещё не поднят — карточки остаются в состоянии "soon" */ }
}

/* --------------------------------------------------------------- forms */
function msg(el, text, kind) { el.textContent = text; el.dataset.kind = kind || ''; }

function initConsultForm() {
  const form = document.getElementById('consultForm');
  if (!form) return;
  const out = document.getElementById('consultMsg');
  const btn = document.getElementById('consultSubmit');
  const slotSel = document.getElementById('slotSelect');

  // load free slots
  (async () => {
    try {
      const r = await fetch(`${API}/slots`, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return;
      const slots = await r.json();
      for (const s of slots) {
        const opt = document.createElement('option');
        opt.value = String(s.id);
        const d = new Date(s.starts_at * 1000);
        opt.textContent = d.toLocaleString(i18n.lang === 'uk' ? 'uk-UA' : 'en-GB', {
          weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
        slotSel.appendChild(opt);
      }
    } catch (e) { /* slots optional */ }
  })();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);

    if (fd.get('website')) return;                       // honeypot: молча игнорируем
    if (!form.checkValidity()) { msg(out, i18n.get('form.invalid') || 'Check the highlighted fields.', 'err'); form.reportValidity(); return; }

    const payload = {
      name: (fd.get('name') || '').toString().trim(),
      email: (fd.get('email') || '').toString().trim(),
      contact_telegram: (fd.get('contact_telegram') || '').toString().trim() || null,
      company: (fd.get('company') || '').toString().trim(),
      service: (fd.get('service') || '').toString().trim() || null,
      process: (fd.get('process') || '').toString().trim(),
      slot_id: fd.get('slot_id') ? Number(fd.get('slot_id')) : null,
      locale: i18n.lang,
      page: location.pathname,
      captcha_token: window.__captchaToken || null
    };

    btn.disabled = true;
    msg(out, i18n.get('form.sending') || 'Sending…', '');
    try {
      const res = await fetch(`${API}/consult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 && data.ref) {
        form.reset();
        msg(out, (i18n.get('form.ok') || 'Request received. Your reference is') + ' ' + data.ref, 'ok');
      } else if (res.status === 429) {
        msg(out, i18n.get('form.rate') || 'Too many attempts. Try again in a few minutes.', 'err');
      } else {
        msg(out, data.detail || i18n.get('form.fail') || 'Could not send. Write to contact@labs.mnemostroma.com.', 'err');
      }
    } catch (err) {
      msg(out, i18n.get('form.offline') || 'Network error. Write to contact@labs.mnemostroma.com.', 'err');
    } finally {
      btn.disabled = false;
    }
  });
}

function initStatusForm() {
  const form = document.getElementById('statusForm');
  if (!form) return;
  const out = document.getElementById('statusMsg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ref = new FormData(form).get('ref').toString().trim().toUpperCase();
    if (!/^LM-\d{4}-[A-Z0-9]{6}$/.test(ref)) { msg(out, i18n.get('cab.bad') || 'Reference looks like LM-2026-XXXXXX.', 'err'); return; }
    msg(out, i18n.get('form.sending') || 'Checking…', '');
    try {
      const res = await fetch(`${API}/consult/${encodeURIComponent(ref)}`);
      if (res.status === 404) { msg(out, i18n.get('cab.none') || 'No request found for that reference.', 'err'); return; }
      if (!res.ok) { msg(out, i18n.get('form.fail') || 'Could not check right now.', 'err'); return; }
      const d = await res.json();
      const human = i18n.get('cab.state.' + d.status) || d.status;
      msg(out, `${ref}: ${human}${d.next_step ? ' — ' + d.next_step : ''}`, 'ok');
    } catch (err) { msg(out, i18n.get('form.offline') || 'Network error.', 'err'); }
  });
}

/* -------------------------------------------- плейсхолдеры ссылок (dev) */
function initLinkPlaceholders() {
  document.querySelectorAll('[data-href-todo]').forEach(a => {
    a.title = a.getAttribute('data-href-todo');
    a.addEventListener('click', e => {
      e.preventDefault();
      console.info('[TODO link]', a.getAttribute('data-href-todo'));
    });
  });
}

/* ----------------------------------------------------------------- boot */
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initNav();
  initLinkPlaceholders();
  initConsultForm();
  initStatusForm();

  document.querySelectorAll('[data-lang-set]').forEach(b => {
    b.addEventListener('click', () => i18n.set(b.dataset.langSet));
  });

  const target = document.documentElement.getAttribute('data-lang-target') || DEFAULT_LANG;
  if (target !== DEFAULT_LANG) await i18n.set(target, false);
  else { try { i18n.dict = await i18n.load(DEFAULT_LANG); i18n.apply(); } catch (e) {} }

  initRunner();
  initDemoStates();

  const yr = document.getElementById('yr');
  if (yr) yr.textContent = String(new Date().getFullYear());
});
