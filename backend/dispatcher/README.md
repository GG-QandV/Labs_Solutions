# dispatcher — AI-диспетчер заявок (демо #1)

Вендоринг [`Rahilralu/FlowDesk-AI`](https://github.com/Rahilralu/FlowDesk-AI) (MIT) под конвенции парка.
План адаптации и обоснование решений — [`AUDIT.md`](./AUDIT.md).

## Что делает

Приём обращений (REST / Telegram-webhook / форма лендинга) → очередь BullMQ → классификация Gemini
(категория, приоритет, краткое описание, уверенность) → статус `CLASSIFIED` → push в дашборд по Socket.IO.
Полный audit-trail переходов, роли ADMIN/AGENT, внутренние заметки.

## Состав стека

| Контейнер | Роль | Порт | Traefik |
| --- | --- | --- | --- |
| `dispatcher-web` | React SPA + nginx, проксирует `/api`, `/webhooks`, `/socket.io`, `/health` внутрь | 80 | ✅ `dispatcher-labs.mnemostroma.com` |
| `dispatcher-api` | Express + Prisma/SQLite + inline BullMQ-воркер | 8080 | ❌ только через `dispatcher-web` |
| `dispatcher-redis` | очередь и pub/sub | 6379 | ❌ |

Один Traefik-роутер на весь стек: браузер общается только с `dispatcher-web`, nginx проксирует внутрь.
Отсюда нет CORS и нет второго роутера на том же `Host()` — а значит нет и конфликта приоритетов
(явный `priority` перекрывает автовычисленный и может оказаться ниже — см. историю с `site` / `site-api`).

## Отличия от апстрима

| Что | Было | Стало |
| --- | --- | --- |
| БД | PostgreSQL + миграции | SQLite (`file:/data/dispatcher.db`), `prisma db push` |
| `enum` в схеме | `Role`, `Source`, `Status`, `Priority` | `String` с дефолтами — Prisma на SQLite не поддерживает enum |
| Зависимости | 22 | 14 (убраны `twilio`, `nodemailer`, `psql`, `redis`, `bcrypt`, `crypto`, `uuid`, `nodemon` из prod) |
| WhatsApp | `Source.WHATSAPP`, `twilio` | удалено — кода вебхука в апстриме не было |
| Воркер | импорт в `index.js` **и** `npm run worker` → два воркера на одну очередь | `WORKER_INLINE` (по умолчанию `true`); standalone-режим через `src/workers/worker.entry.js` |
| `provider` по умолчанию | `'anthropic'` при Gemini-классификации | `'gemini'` |
| Статус после постановки в очередь | оставался `NEW`, воркер логировал переход из несуществующего `QUEUED` | явный `NEW → QUEUED` с событием в audit-trail |
| `seed.js` | интерактивный (`readline`) — повесил бы контейнер | env-driven, идемпотентный, плюс 3 демо-заявки |
| Redis | привязка к Render/Upstash | локальный контейнер, TLS только для `rediss://` |
| Health | отсутствовал | `GET /health` → `{ok, service, db, redis}`, до rate-limiter |
| OpsHub | — | drop-in `src/utils/opshub_client.js` + heartbeat раз в минуту |

## Запуск

```bash
cp .env.example .env && chmod 600 .env   # заполнить значения
docker compose up -d --build
curl -s https://dispatcher-labs.mnemostroma.com/health
```

Вход в дашборд — `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` из `.env`.
При первом старте создаются админ и три примера заявок, чтобы дашборд не открывался пустым.

## Telegram-интеграция (опционально)

`TELEGRAM_BOT_TOKEN` пуст → маршрут вебхука неактивен, остальной стек работает.
Регистрация вебхука — `node scripts/registerTelegram.js` внутри контейнера `dispatcher-api`.

## Что ещё не сделано

- **i18n (EN/UA/PL/RU)** — отдельный PR, план в `AUDIT.md` §4. Сейчас UI только на английском.
- **Связка с лендингом** — снять `data-href-todo` с кнопок `/demos/dispatcher`.
- **Lazy-start / autostop** — стек поднимается вручную; интеграция с лимитом «3 демо» OpsHub не реализована.
- **Проверка сборки** — `npm install` и `prisma generate` в окружении верификации недоступны
  (`binaries.prisma.sh` вне allowlist). Проверен только синтаксис (`node --check`) и валидность YAML.
