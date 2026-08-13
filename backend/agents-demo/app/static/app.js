/* Демо `agents`: один SSE-поток, события раскладываются по колонкам через panel.
   Никакого xterm.js: нет PTY, нет ANSI, нет ввода — <pre> и таймер дают тот же эффект. */
'use strict';

const LANGS = ['en', 'uk', 'pl', 'ru'];

/* Статические строки страницы. Комментарии агентов приходят с сервера уже на нужном языке. */
const UI = {
  en: { h1: 'Two versions of one document. Checked independently.',
        lead: 'Agent A reads the original, agent B reads the translation. Neither knows about the other. The arbiter compares what they extracted — every mismatch keeps its source line.',
        start: 'Run the check', live: 'Live run', cached: 'replay of a warmed-up run',
        liveMode: 'live run', src: 'source', foot: 'Fictional contract. Amounts, terms and penalties in the translation were altered on purpose.' },
  uk: { h1: 'Дві версії одного документа. Перевірені незалежно.',
        lead: 'Агент A читає оригінал, агент B — переклад. Один про одного не знають. Арбітр звіряє витягнуте — кожна розбіжність зберігає рядок-джерело.',
        start: 'Запустити звірку', live: 'Живий прогін', cached: 'відтворення прогрітого прогону',
        liveMode: 'живий прогін', src: 'джерело', foot: 'Договір вигаданий. Суми, строки та пеню в перекладі змінено навмисно.' },
  pl: { h1: 'Dwie wersje jednego dokumentu. Sprawdzone niezależnie.',
        lead: 'Agent A czyta oryginał, agent B — tłumaczenie. Nie wiedzą o sobie nawzajem. Arbiter porównuje wyniki — każda rozbieżność zachowuje wiersz źródłowy.',
        start: 'Uruchom porównanie', live: 'Przebieg na żywo', cached: 'odtworzenie rozgrzanego przebiegu',
        liveMode: 'przebieg na żywo', src: 'źródło', foot: 'Umowa fikcyjna. Kwoty, terminy i kary w tłumaczeniu zmieniono celowo.' },
  ru: { h1: 'Две версии одного документа. Проверены независимо.',
        lead: 'Агент A читает оригинал, агент B — перевод. Друг о друге не знают. Арбитр сверяет извлечённое — каждое расхождение хранит строку-источник.',
        start: 'Запустить сверку', live: 'Живой прогон', cached: 'воспроизведение прогретого прогона',
        liveMode: 'живой прогон', src: 'источник', foot: 'Договор вымышленный. Суммы, сроки и пеня в переводе изменены намеренно.' },
};

const $ = (id) => document.getElementById(id);
let lang = pickLang();
let es = null;
let runId = null;

function pickLang() {
  const saved = localStorage.getItem('agents.lang');
  if (LANGS.includes(saved)) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (nav === 'uk' || nav === 'be') return 'uk';
  return LANGS.includes(nav) ? nav : 'en';
}

function applyUI() {
  const s = UI[lang];
  document.documentElement.lang = lang;
  $('start').textContent = s.start;
  $('live').textContent = s.live;
  $('foot').textContent = s.foot;
  document.querySelector('[data-s="h1"]').textContent = s.h1;
  document.querySelector('[data-s="lead"]').textContent = s.lead;
  document.querySelectorAll('[data-lang]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

function reset() {
  ['a', 'b', 'arbiter'].forEach((p) => { $('term-' + p).textContent = ''; });
  $('gate').hidden = true;
  $('verdict').hidden = true;
  $('rows').innerHTML = '';
  $('mode').textContent = '';
  document.querySelectorAll('#track li').forEach((li) => li.classList.remove('on', 'now'));
}

function stage(name) {
  const items = [...document.querySelectorAll('#track li')];
  const idx = items.findIndex((li) => li.dataset.stage === name);
  items.forEach((li, i) => {
    li.classList.toggle('on', i < idx);
    li.classList.toggle('now', i === idx);
  });
}

/* Посимвольный вывод: сервер задаёт паузы между событиями, здесь — только «печать» строки. */
function type(pre, text, cls) {
  const line = document.createElement('span');
  if (cls) line.className = cls;
  pre.appendChild(line);
  pre.appendChild(document.createTextNode('\n'));
  let i = 0;
  const step = () => {
    if (i >= text.length) return;
    line.textContent += text[i++];
    pre.scrollTop = pre.scrollHeight;
    if (i < text.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function onEvent(ev) {
  const p = ev.panel;
  if (p === 'meta') {
    if (ev.type === 'run') runId = ev.run_id;
    if (ev.type === 'stage') stage(ev.stage);
    if (ev.type === 'mode' || ev.mode) $('mode').textContent = ev.mode === 'live' ? UI[lang].liveMode : UI[lang].cached;
    if (ev.type === 'end' && es) { es.close(); es = null; $('start').disabled = false; }
    return;
  }
  if (p === 'a' || p === 'b' || p === 'arbiter') {
    if (ev.type === 'line') {
      const cls = ev.ok === false ? 'bad' : (ev.ok === true ? 'good' : '');
      type($('term-' + p), ev.text, cls);
    }
    return;
  }
  if (p === 'gate' && ev.type === 'approval_pending') {
    $('gate-text').textContent = ev.text;
    $('approve').textContent = ev.button;
    $('gate').hidden = false;
    return;
  }
  if (p === 'gate' && ev.type === 'timeout') { $('gate').hidden = true; return; }
  if (p === 'verdict' && ev.type === 'final') {
    $('gate').hidden = true;
    $('verdict-title').textContent = ev.title;
    $('verdict-text').textContent = ev.text;
    $('verdict').dataset.risk = ev.risk;
    $('rows').innerHTML = ev.rows.map((r) => `
      <tr class="${r.match ? 'ok' : 'no'}">
        <td>${r.label || r.key}</td><td>${r.a || '—'}</td><td>${r.b || '—'}</td>
        <td class="src" title="${(r.a_source || '').replace(/"/g, '&quot;')}">${r.match ? '✓' : '≠'}</td>
      </tr>`).join('');
    $('verdict').hidden = false;
  }
}

function start(mode) {
  reset();
  $('start').disabled = true;
  $('mode').textContent = mode === 'live' ? UI[lang].liveMode : UI[lang].cached;
  es = new EventSource(`/api/stream?lang=${lang}&mode=${mode}`);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (_) {} };
  es.onerror = () => { if (es) { es.close(); es = null; } $('start').disabled = false; };
}

document.addEventListener('DOMContentLoaded', () => {
  applyUI();
  $('start').addEventListener('click', () => start('cached'));
  $('live').addEventListener('click', () => start('live'));
  $('approve').addEventListener('click', async () => {
    if (!runId) return;
    $('approve').disabled = true;
    try { await fetch(`/api/approve/${runId}`, { method: 'POST' }); }
    finally { $('approve').disabled = false; }
  });
  document.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      lang = b.dataset.lang;
      localStorage.setItem('agents.lang', lang);
      applyUI();
    }));
  fetch('/health').then((r) => r.json()).then((h) => { $('live').hidden = !h.live_enabled; })
    .catch(() => {});
});
