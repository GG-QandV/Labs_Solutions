# AI Automation Lab — Roadmap и чек-лист

> План работ, синхронизированный с фактическим состоянием `backups/` и реализованным
> `landing/`. Заменяет идею roadmap из [`MASTER_PLAN.md`](MASTER_PLAN.md) §5 (та писалась
> под устаревший стек Coolify/Postgres/Qdrant). Архитектура — [`ARCHITECTURE.md`](ARCHITECTURE.md).

Легенда: ✅ готово · 🟡 частично (есть срез в `backups/`) · ⬜ не начато

---

## 0. Сводка статуса модулей

| Модуль | Статус | Источник | Что осталось |
|---|---|---|---|
| Лендинг | 🟡 фронт готов, разложен в `landing/` | `Landing_Labs_fin_v.1_files.zip` | шрифты, иконки, бэкенд формы, домен/почта |
| OpsHub | 🟡 код готов | `opshub.tar.gz` | деплой на VPS, basic-auth пользователи |
| RAG-демо | 🟡 код готов (v1.1) | `rag-demo.tar.gz` | ONNX-модели, интеграция в парк, страница демо |
| PDF-отчёты | 🟡 код готов (v3_VPS) | `pdf-report-demo-vps.tar.gz` | Redis/Playwright на VPS, Resend-ключ, страница демо |
| STT/Speech | 🟡 только LLM-слой | `stt-llm-module.tar.gz` | whisper.cpp + PipeWire + аудио-пайплайн + UI |
| Диспетчер заявок | ⬜ | — (описан в Контексте) | весь модуль |
| CRM-copilot | ⬜ | — | весь модуль |
| CSV/XLSX-аналитик | ⬜ | — | весь модуль |

---

## Этап 1 — Лендинг в прод (ближайшая задача)

Фронт реализован и разложен в `landing/` (см. `landing/README.md`, `landing/docs/DEPLOY.md`).
До публикации на `labs.mnemostroma.com`:

**Контент и ассеты**
- [ ] Скачать и просабсетить шрифты (Archivo / Inter / JetBrains Mono, OFL) → `landing/assets/fonts/` (DEPLOY.md §5)
- [ ] Положить 31 SVG-иконку → `landing/assets/icons/` (замена плейсхолдеров, `landing/docs/ICONS.md`)
- [ ] Добавить `landing/assets/favicon.svg` и `landing/assets/og-cover.png`
- [ ] Заменить 2 изображения-схемы/скриншота (`grep -n 'ph__t' index.html`)
- [ ] Проставить реальные ссылки вместо `data-href-todo` (страницы демо, кейсы, Telegram, privacy/terms, GitHub-репозитории)
- [ ] Секция «Track record»: вписать реальные кейсы (`proof.p1…p3` в `i18n/*.json`), честно расставить метки «client deployment» / «reference implementation»

**Инфраструктура**
- [ ] Завести ящик `contact@labs.mnemostroma.com` + MX/SPF/DKIM
- [ ] Настроить DNS `labs.mnemostroma.com` (Cloudflare) → VPS
- [ ] Отдать статику через nginx-контейнер за Traefik (TLS Let's Encrypt), CSP из DEPLOY.md
- [ ] Пересобрать украинскую версию после правок: `python3 build/prerender.py`

**Бэкенд формы** (контракт — `landing/docs/BACKEND_API.md`)
- [ ] Реализовать `POST /consult` (заявка) и `GET /demos` (статусы демо)
- [ ] Honeypot + серверный rate-limit; позже — подключить Turnstile (в разметке уже есть слот)
- [ ] Хэшировать IP вместо сырого; фронт **не** ходит в OpsHub напрямую

**Проверка**
- [ ] Локальный smoke: `cd landing && python3 -m http.server 8080` → обе темы, оба языка, анимация pipeline, `prefers-reduced-motion`
- [ ] Валидация HTML обеих версий, сходимость ключей i18n (EN/UA)

---

## Этап 2 — OpsHub на VPS (фундамент парка)

OpsHub должен работать до запуска любого демо (он управляет их жизненным циклом).

- [ ] Развернуть архив `backups/opshub.tar.gz` в `/srv/opshub`
- [ ] Создать docker-сети `opsnet` (internal) и `web` (Traefik)
- [ ] `docker compose up -d`; volume `/srv/opshub/data:/data`
- [ ] Traefik-роут `ops.solutions.dpdns.org` → opshub:8700, basic-auth (bcrypt, users в SQLite)
- [ ] Задать секрет `OPSHUB_KEY` в `.env` парка
- [ ] Убрать из архива случайно закоммиченные `__pycache__/*.pyc` перед деплоем
- [ ] Smoke: убить процесс в демо → oom/die виден на дашборде; 30 мин без heartbeat → автостоп; попытка 4-го демо → отказ

---

## Этап 3 — Первое демо в парке: PDF-отчёты

Материальный, понятный руководителю результат; код готов (v3_VPS).

- [ ] Развернуть `backups/pdf-report-demo-vps.tar.gz` по конвенциям парка (labels/env/mem_limit + drop-in клиент OpsHub)
- [ ] Redis + BullMQ, Playwright + системный Chromium (Docker), лимит 2 параллельных рендера
- [ ] Ключ Resend для email; локальное `/data` + cron-очистка
- [ ] Traefik-роут `pdf.solutions.dpdns.org`; страница демо на лендинге, снять `data-href-todo`
- [ ] Smoke: публичный Google Sheet → валидация/SSRF → ReportJSON → PDF → email

---

## Этап 4 — RAG-демо с цитатами

Демонстрирует работу с корпоративными знаниями; код готов (v1.1).

- [ ] Развернуть `backups/rag-demo.tar.gz`; скачать ONNX-модели (embedder e5-small, reranker TinyBERT, NER)
- [ ] SQLite + sqlite-vec; лимиты сессии (файлы/страницы), очистка 03:00
- [ ] LLM: Gemini free tier (+ DeepSeek опц.); **ответ только с подтверждённым источником**
- [ ] Интеграция в OpsHub (heartbeat, lazy-start, «warming up» при холодном старте)
- [ ] Traefik-роут `rag.solutions.dpdns.org`; страница демо на лендинге

---

## Этап 5 — Lead flow, Stripe и API агентов

- [ ] Сценарий: заявка → созвон → согласованный scope → Stripe Invoice/Checkout
- [ ] Stripe webhook (через тонкий gateway), обновление статуса лида
- [ ] REST/OpenAPI для агентов: `/v1/catalog`, `/v1/demo/sessions`, `/v1/rag/query`, `/v1/reports/generate`, `/v1/leads`
- [ ] API-ключи, scopes, лимиты, базовый audit log
- [ ] Режимы BYOK (demo-key / ephemeral / encrypted / local connector) — см. ARCHITECTURE.md §6

---

## Этап 6 — STT / Speech Translate (полный модуль)

Сейчас в `backups/` только облачный LLM-слой; нужно ядро.

- [ ] whisper.cpp + `ggml-base.bin` multilingual, встроенный VAD/streaming
- [ ] PipeWire (2 канала) для профиля `desktop`; загрузка файла + браузерный микрофон для `server`
- [ ] SQLite-схема (`sessions/audio_streams/segments/jobs`), `raw_text` неизменяем
- [ ] Три режима перевода (`live_literal` / `live_safe` / `post_clean`) с edit_log
- [ ] Watchdog RAM (MemoryHigh=1600M/MemoryMax=1850M), деградация без потери данных
- [ ] BYOK ephemeral (RAM-only, TTL, LogRedactor); экспорт TXT/SRT/VTT/JSON
- [ ] Оба профиля из одного репо (`APP_PROFILE` — единственная развилка), тесты ядра без PipeWire/Docker

---

## Этап 7 — Остальные демо и сквозной pipeline

- [ ] AI-диспетчер заявок (email/форма/Telegram → структурированная заявка + черновик ответа)
- [ ] OCR + извлечение полей (PaddleOCR, PDF/скан → JSON-поля + валидация + confidence)
- [ ] CRM-copilot (лид/переписка → summary, next step, письмо на утверждение)
- [ ] CSV/XLSX-аналитик (таблица → расчёты, графики, аномалии)
- [ ] Сквозной демонстрационный pipeline: dispatcher → OCR → RAG → CRM draft → PDF, с видимым pipeline-bar

---

## Сквозные задачи (параллельно всем этапам)

**Юридика и деньги** (детали — MASTER_PLAN.md §8–9)
- [ ] Выбрать юрлицо (Эстония OÜ / Болгария EOOD / Wyoming LLC) — перепроверить налоговые факты у консультанта, ссылки `[web:*]` в мастер-плане неверифицированы
- [ ] Privacy Policy, Terms, DPA, Security Policy, политика демо-данных (TTL/автоудаление/не для обучения)
- [ ] Реестр open-source лицензий по каждому компоненту (особое внимание GPL/AGPL при хостинге как сервиса)

**Эксплуатация**
- [ ] Ежедневные бэкапы SQLite/данных демо; ротация логов OpsHub
- [ ] Мониторинг суммарного RAM парка против бюджета 8 ГБ (дашборд OpsHub)
- [ ] Учёт токенов LLM по endpoint + автоотключение публичного демо при приближении к лимиту

---

## Порядок и оценка

Реалистичный первый публичный релиз — **лендинг + OpsHub + одно демо (PDF)**: этапы 1–3.
Далее RAG (этап 4), затем Lead flow/Stripe/API (этап 5). STT и остальные демо (этапы 6–7) —
после первых лидов. Гейт между этапами: демо не выходит в паблик, пока не соблюдает конвенции
OpsHub (`demo=true`, `mem_limit`, heartbeat, healthcheck) и лимиты публичного контура.
