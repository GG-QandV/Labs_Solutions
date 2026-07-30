# Аудит FlowDesk-AI → модуль `dispatcher`

Оценка [`Rahilralu/FlowDesk-AI`](https://github.com/Rahilralu/FlowDesk-AI) (MIT) как базы демо-модуля
«AI-диспетчер заявок» (демо #1, вход демо-цикла лендинга — см. `docs/ARCHITECTURE.md` §5.7, `docs/ROADMAP.md` Этап 3a).

> Статус: **только аудит и план**. Код ещё не вендорился и не адаптировался.
> Реализация — отдельными коммитами (backend-адаптация → i18n) после утверждения плана.

---

## 1. Что это по факту

Full-stack платформа приёма и AI-классификации клиентских обращений. Клон ~1.8 МБ, структура чистая.

| Слой | Стек |
| --- | --- |
| Backend | Node.js + Express 5, Prisma ORM (**PostgreSQL**), BullMQ + Redis (ioredis), Socket.IO, JWT (access+refresh), helmet, zod |
| Frontend | React 19 + Vite + Tailwind 4, react-router 7, socket.io-client, jwt-decode (4 страницы) |
| AI | Google Gemini (`gemini-2.5-flash-lite`) — классификация в JSON |
| Intake | REST (`POST /api/requests`) + Telegram-webhook |
| Realtime | Redis pub/sub → Socket.IO (`request:classified` / `:failed` / `:event`) |

**Поток:** intake → `CustomerRequest` (SQL) → BullMQ job → worker → Gemini classify → `AiClassification` +
статус `CLASSIFIED` → publish → Socket.IO → дашборд. Модели: `User`, `RefreshToken`, `CustomerRequest`,
`AiClassification`, `RequestEvent` (audit-trail), `InternalNote`.

**Сильные стороны:** промпт классификатора грамотно защищён от prompt-injection (сообщение — «UNTRUSTED INPUT»,
инъекция → `spam`); есть idempotencyKey (дедуп), audit-trail, роли ADMIN/AGENT, rate-limit, помехоустойчивая
отправка ответа в Telegram (3 ретрая). Классификация асинхронна (BullMQ) — API не блокируется. Совпадает с
парком: Gemini (как RAG-демо), Redis/BullMQ (как PDF-демо), фронт-контур на Cloudflare, MIT.

---

## 2. Убрать (лишнее для демо)

| Что | Где | Действие |
| --- | --- | --- |
| **Twilio / WhatsApp** | `package.json` (`twilio`), README, `.env`, `Source.WHATSAPP` | Выкинуть. **Кода WhatsApp-вебхука нет** — в `index.js` смонтирован только Telegram; в дереве только `telegram.webhook.js`. Чистое удаление зависимости и упоминаний |
| `psql@0.0.1` | `package.json` | Мусорный пакет, не используется (`config/psql.js` — это обёртка PrismaClient) |
| `crypto` (npm) | `package.json` | Встроен в Node, npm-пакет лишний |
| `redis` (npm) | `package.json` | Используется `ioredis`; отдельный `redis` не нужен |
| `bcrypt` **и** `bcryptjs` | `package.json`, `scripts/seed.js` | Оставить один (`bcryptjs`, он в seed) |
| `nodemailer` | `package.json` | Проверить использование; для демо, вероятно, убрать |
| `dump.rdb` | корень и `backend/` | Дамп Redis случайно попал в репо — удалить, добавить в `.gitignore` |
| Managed-хостинг | README (Render/Upstash), `config/redis.js` (`render.com` в TLS-проверке) | Убрать привязки к Render/Upstash, оставить локальный Redis |

---

## 3. Адаптировать под парк (VPS 8 GB, конвенции OpsHub)

### 3.1. PostgreSQL → SQLite (Prisma) — главный пункт
Парк намеренно на SQLite (`docs/ARCHITECTURE.md` §1). Перевод `schema.prisma` на `provider = "sqlite"`.

> ⚠️ **Ключевой нюанс:** Prisma на SQLite **не поддерживает `enum`**. В схеме 4 энума —
> `Role`, `Source`, `Status`, `Priority`. Их надо заменить на `String` (с дефолтами). Валидация
> значений в коде уже продублирована (`allowed`-массивы в контроллере, `z.enum` в zod-схеме),
> так что потеря enum на уровне БД не ломает логику — но требует правки схемы и полей моделей.

- Заменить `enum` → `String`; поля `role`, `source`, `status`, `priority` — `String` с `@default(...)`.
- Удалить Postgres-миграции (`prisma/migrations/*` — там `migration.sql` под Postgres) и сгенерировать
  заново под sqlite (`prisma migrate dev` / `db push`).
- `DATABASE_URL=file:./data/dispatcher.db`; том `/data` по конвенции парка.

### 3.2. Инфраструктура
- `docker-compose`: убрать сервис `postgres`; том SQLite; локальный `redis`; сервисы `backend`+`worker`
  (можно слить воркер в backend-процесс для MVP) + `frontend`.
- Конвенции OpsHub: labels `demo=true`, `mem_limit`, `restart: on-failure`, env `OPSHUB_URL/KEY/SERVICE`,
  сети `web`+`opsnet`, healthcheck `/health`, drop-in `opshub_client` + heartbeat, lazy-start/autostop.
- Traefik-роут `dispatcher.solutions.dpdns.org`.
- Каналы MVP: Telegram Bot-webhook (**туннель через Cloudflare Worker**, см. §5.6) + REST + форма лендинга.

### 3.3. Демо-режим и «визуальная реализуемость»
Сейчас фронт требует JWT-логин + живой бэкенд — «просто открыть и показать» нельзя. Для демо:
- сид-пользователь (admin) через `scripts/seed.js` (в репо уже есть), демо-креды в README модуля;
- либо read-only demo-режим/сид-данные, чтобы дашборд рендерился с примерами сразу;
- «Request dispatcher» на лендинге ведёт на этот дашборд (снять `data-href-todo`);
- human-in-the-loop: черновик ответа подтверждает человек (согласуется с §6 модели безопасности).

### 3.4. Найденные баги (поправить при вендоринге)
- `workers/classificationWorker.js`: `provider: classification.provider || 'anthropic'` — при Gemini дефолт
  должен быть `'gemini'` (Gemini `provider` в ответе не возвращает).
- `webhook.service.js` кладёт статус `NEW`, но задачу сразу в очередь — статус `QUEUED` не выставляется до
  воркера (воркер логирует переход `QUEUED→PROCESSING`, которого в БД не было). Косметика audit-trail.
- Двойной запуск воркера: `index.js` импортирует `classificationWorker.js` **и** есть отдельный `npm run worker`
  — при обоих поднимутся два воркера на одну очередь. Для парка выбрать одно (встроенный ИЛИ отдельный сервис).

---

## 4. Мультиязычность (i18n: EN + UK/RU/PL)

Весь UI — хардкод английского в 4 страницах (`Login` 145, `Dashboard` 416, `RequestDetail` 444, `AuditLog` 169
строк JSX). План — лёгкий свой i18n (в духе лендинга, без тяжёлых зависимостей):

- `src/i18n/index.jsx` — провайдер + хук `useT()`, детект языка браузера (`be/uk→uk`, `ru→ru`, `pl→pl`,
  иначе `en`), сохранение выбора в `localStorage`.
- `src/i18n/locales/{en,uk,pl,ru}.js` — словари всех строк UI (эталон ключей — `en`).
- `src/components/LanguageSwitcher.jsx` — переключатель. По правилу `CLAUDE.md`: код языка `uk`, **кнопка `UA`**;
  набор `EN / UA / PL / RU`.
- Обернуть `main.jsx` провайдером, заменить строки в 4 страницах на `t('...')`.
- Статусы/приоритеты/категории (`NEW/CLASSIFIED/...`, `LOW/MEDIUM/HIGH`, `support/sales/urgent/spam/other`) —
  переводить только подписи в UI; значения в БД/API остаются английскими кодами (как `uk` в коде лендинга).

---

## 5. Вердикт и порядок работ

**Реализуемо** как демо-стек парка (lazy-start + autostop; инференс Gemini в облаке ⇒ нагрузка на хост умеренная).
Самый близкий к сценарию готовый OSS-каркас диспетчера. Рекомендованный порядок:

1. **Backend-адаптация** (отдельный PR): вендоринг в `backend/dispatcher/`, SQLite (enums→String), вырезать
   Twilio/мусор, compose под парк, seed-демо, фикс багов §3.4.
2. **i18n** (отдельный PR): система + переключатель `EN/UA/PL/RU` + словари + разводка по 4 страницам.
3. Интеграция в парк (OpsHub-конвенции, Traefik-роут) и связка со страницей демо на лендинге.

> Проверка: после каждого шага нужен `npm install && npm run build` (backend + frontend) на Node-стеке —
> в текущем окружении недоступно, verify выполняется при деплое/локально.
