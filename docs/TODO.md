# TODO

> Актуальный список незавершённого по парку демо и head-лендингу.
> Сверено с `docs/ROADMAP.md`, `docs/ARCHITECTURE.md` и фактическим состоянием проду
> (2026-08-15). Готовые/задеплоенные модули здесь не дублируются.

## D6 — MAIL_FROM на labs.mnemostroma.com (после миграции доменов)

Письма из демо уходят с `@solutions.dpdns.org`, а Resend будет верифицировать
`labs.mnemostroma.com`. До смены домена письма не будут отправляться.

Затрагиваемые файлы (код — инвариант §0.1 TASK_domains_migration.md, правится
отдельной задачей):

- `backend/rag-demo/app/config.py` — `MAIL_FROM` → `rag@labs.mnemostroma.com`
- `backend/pdf-demo-vps/packages/email-sender/src/index.ts` — `from` → `reports@labs.mnemostroma.com`
- `backend/pdf-demo-base/packages/email-sender/src/index.ts` — архивный модуль, трогать только при необходимости
- `backend/pdf-demo-vps/apps/server/src/index.ts` — дефолт `PUBLIC_BASE_URL` → `https://pdf-labs.mnemostroma.com`

**Порядок:**
1. Верифицировать `labs.mnemostroma.com` в Resend (MX/SPF/DKIM/DMARC из §3.1 TASK).
2. Сменить `MAIL_FROM` в указанных файлах.
3. Отдельный коммит на модуль; пересобрать демо на VPS.

## D7 — Нереализованные демо-модули (карточки на лендинге висят «soon»)

- **OCR / Извлечение данных** (`ocr`) — весь модуль: PaddleOCR, PDF/скан → JSON-поля +
  валидация + confidence. Отложено решением от 2026-08-15.
- **CRM-copilot** (`crm`) — весь модуль: лид/переписка → summary, next step, письмо на утверждение.
- **Аналитик таблиц** (`analyst`) — весь модуль: CSV/XLSX → расчёты, графики, аномалии.
  Отправлено в ТГ как актуальное (message 1043).

## D8 — AgentMesh Labs — agentmesh-api (MVP-2/3)

Фронт (`frontend/agentmesh-landing/`) и gatewayd задеплоены; карточка на лендинге есть.
**Не реализован** `agentmesh-api` (Python BFF, FastAPI + aiosqlite): session lifecycle,
rate limits, SSE, revoke, OpsHub-интеграция. Сейчас `/api/v1/agentmesh/*` → 404,
wizard работает на deterministic mock. Скоуп — этапы MVP-2…MVP-4 из
`backups/agentmesh-labs./agentmesh-labs-architecture.md` §C.

## D9 — Hermes + Telegram-бот (Tier 1)

Установка `NousResearch/hermes-agent` + нативный TG-gateway + безопасный лок-даун.
Детали — `docs/ROADMAP.md` Этап 2a.

## D10 — STT / Speech

`backend/stt-mvp/` — только облачный LLM-слой. Нужно: whisper.cpp + VAD,
3 режима перевода, BYOK ephemeral, деплой. Детали — `docs/ROADMAP.md` Этап 6.

## D11 — Лендинг: заглушки-ссылки (`data-href-todo`)

- `/demos/extraction`, `/demos/crm`, `/demos/analyst` — нет страниц демо (см. D7)
- `/cases/freight-intake` — нет кейса
- `/api` — нет страницы API для агентов
- `/privacy`, `/terms` — нет юридических страниц
- Telegram `t.me/<handle>` — не проставлен реальный контакт
- 2 схемы `ph__t` (стр. 269, 513 index.html): скриншот pipeline + диаграмма data flow — pending
- Track record `proof.p1…p3` — раздел в i18n не заполнен

## D12 — Сквозной pipeline

dispatcher → OCR → RAG → CRM draft → PDF с видимым pipeline-bar. Детали —
`docs/ROADMAP.md` Этап 7.

## D13 — Юридика, Stripe, API агентов, эксплуатация

- Юрлицо (Estonia/Болгария/Wyoming) — не выбрано; Privacy/Terms/DPA — нет
- Реестр open-source лицензий (GPL/AGPL при хостинге) — нет
- Stripe (Invoice/Checkout) + webhook + статусы лидов — нет
- REST/OpenAPI для агентов: `/v1/catalog`, `/v1/rag/query`, `/v1/reports/generate`,
  `/v1/leads` + ключи/scopes/audit log — нет
- Бэкапы SQLite/данных + ротация логов OpsHub — нет
- Мониторинг RAM парка vs бюджет 8 GB + учёт токенов LLM + автоотключение — нет

## D14 — Мелочи в коде

- `backend/pdf-demo-vps/apps/worker/src/index.ts:133` — TODO(paid plan): Cloudflare Queues
- `frontend/agentmesh-landing/README.md` — TODO: backend, uk-подстраницы nav-ссылки,
  ре-рендер wizard при смене языка
- `backend/dispatcher/AUDIT.md` / `README.md` — проверить актуальность
