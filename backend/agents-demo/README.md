# agents-demo — сверка двух версий документа

Седьмой модуль демо-парка. Два агента независимо извлекают условия из оригинала и
перевода договора, арбитр сверяет, человек подтверждает отчёт.

Спека: [`docs/SPEC_agents_demo_v1.md`](../../docs/SPEC_agents_demo_v1.md).
Черновики, из которых она выросла: `SKELETON_agents_demo` / `coments_agents_demo`.

## Что показывает

В переводе намеренно подменены три условия — сумма, срок оплаты, пеня. Агент A читает
**только** оригинал, агент B — **только** перевод; друг о друге они не знают, и это
проговаривается в комментариях (иначе зритель заподозрит подыгрывание). Арбитр сличает
извлечённое и находит расхождения.

Результат проверяемый глазами: не «оцените текст», а конкретные цифры со строкой-источником.

```
                              документ EN ──► агент A ─┐
                                                        ├─► арбитр ──► gate ──► вердикт
                              документ UK ──► агент B ─┘         (ждёт человека)
```

Демо укладывается в тот же семишаговый трек, что и остальные модули парка:
`Received → Extracted → Verified → Matched → Drafted → Awaiting approval → Sent`.

## Запуск локально

```bash
uv venv && uv pip install fastapi "uvicorn[standard]" httpx
.venv/bin/python -m uvicorn app.main:app --port 8080
# http://127.0.0.1:8080 ; быстрее прогон — SPEED=5
```

В парке: `docker compose up -d --build` (конвенции OpsHub уже в `docker-compose.yml`).

## Режимы

| Режим | Когда | Что делает |
|---|---|---|
| `cached` (по умолчанию) | всегда | детерминированное извлечение без LLM, стабильно и бесплатно |
| `live` | если задан `GEMINI_API_KEY` | реальные вызовы Gemini, лимит `LIVE_RUNS_PER_DAY_PER_IP` в сутки на IP |

Без ключа кнопка живого прогона просто не показывается (`/health` отдаёт `live_enabled:false`),
а `mode=live` отвечает `409`. Демо остаётся рабочим — это штатное состояние, а не поломка.

## API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/stream?lang=en\|uk\|pl\|ru&mode=cached\|live` | SSE-поток событий |
| POST | `/api/approve/{run_id}` | подтверждение человеком (шаг 06) |
| GET | `/health` | liveness для Traefik/OpsHub |

Один SSE-поток на всё демо; каждое событие несёт `panel` (`a` / `b` / `arbiter` / `gate` /
`verdict` / `meta`), фронт раскладывает по колонкам. Три отдельных соединения упёрлись бы
в лимит браузера.

```json
{"panel":"a","type":"result","key":"amount","value":"USD 48,000","source":"3.1 The total contract amount is USD 48,000 ..."}
{"panel":"arbiter","type":"compare","key":"amount","a":"USD 48,000","b":"USD 84,000","match":false}
{"panel":"gate","type":"approval_pending"}
{"panel":"verdict","type":"final","mismatches":3,"risk":"high"}
```

Паузы между событиями задаёт **сервер** (`SPEED`), не клиент: пошаговость выглядит одинаково у всех.

## Human-in-the-loop — не украшение

После `approval_pending` генератор блокируется на `asyncio.Event` и вердикт **не отправляется**,
пока не придёт `POST /api/approve/{run_id}`. По таймауту (`GATE_TIMEOUT_SEC`, дефолт 300 с)
поток закрывается событием `timeout` — тоже без вердикта. Проверено тестом.

## i18n

Два слоя текста, их нельзя смешивать:

- **комментарии хода работы** — `app/i18n.py`, 4 языка, переключаются мгновенно;
- **извлечённые значения** (суммы, сроки) — от агентов, языконезависимы по смыслу.

Коды языков ISO (`uk`), кнопка в UI подписана `UA` — по правилу `CLAUDE.md`.

## Прокси, Cloudflare и SSE

Поддомен `agents-labs.mnemostroma.com` можно держать **проксированным** (оранжевое облако),
но не «как есть» — нужны исключения, иначе демо ломается тремя разными способами.

Со стороны приложения: `Cache-Control: no-store` и `X-Accel-Buffering: no` (без второго
nginx буферизует поток и пошаговость исчезает — событий не видно до самого конца).

Со стороны Cloudflare — два правила, оба **точечные**, не на весь хост.

### Правило 1 — Bypass cache для потока

**Caching → Cache Rules → Create rule.** В визуальном билдере поля заполняются по отдельности,
значения — **без кавычек**:

| Шаг | Что выбрать |
|---|---|
| Rule name | `agents-demo SSE bypass` |
| Field | **Hostname** |
| Operator | **equals** |
| Value | `agents-labs.mnemostroma.com` |
| → **And** → Field | **URI Path** |
| Operator | **starts with** |
| Value | `/api/` |
| Then → Cache eligibility | **Bypass cache** |

→ **Deploy**. Всё, одно правило из двух условий через `And` — скобки и `or` в билдере не нужны.

**Как читаются части выражения в билдере** (частая ошибка — вписать их текстом в Value):

| В выражении | Field | Operator | Value |
|---|---|---|---|
| `starts_with(http.request.uri.path, "/api/")` | URI Path | **starts with** | `/api/` |
| `http.request.uri.path eq "/health"` | URI Path | **equals** | `/health` |
| `http.host eq "agents-labs.mnemostroma.com"` | Hostname | **equals** | `agents-labs.mnemostroma.com` |

`starts_with(...)` — это не текст для поля, а сам оператор в выпадающем списке; кавычки в
Value **не ставятся**. Если вставить строку целиком, билдер её не примет.

Если хочется закрыть ещё и `/health` — это **отдельное** правило с теми же двумя условиями,
только `URI Path` **equals** `/health`. Смешивать `And` и `Or` в одном правиле билдер рисует
плохо, а выигрыша нет.

Готовое выражение (вкладка **Edit expression**, если билдер не устраивает):

```
(http.host eq "agents-labs.mnemostroma.com" and starts_with(http.request.uri.path, "/api/"))
```

### Правило 2 — выключить Rocket Loader

**Rules → Configuration Rules → Create rule** (это другой тип правил, не Cache Rules):

| Шаг | Что выбрать |
|---|---|
| Field / Operator / Value | **Hostname** / **equals** / `agents-labs.mnemostroma.com` |
| Then the settings are | **Rocket Loader → Off** |

Он откладывает и переписывает JS, ломая инициализацию `EventSource`. Заодно там же проверить
минификацию/сжатие, если включены на зоне.

### Если в аккаунте только Page Rules (legacy)

Там выражений нет вообще — только URL-маска, поэтому шаги другие:

**Rules → Page Rules → Create Page Rule**

| Поле | Значение |
|---|---|
| URL | `agents-labs.mnemostroma.com/api/*` |
| Setting | **Cache Level → Bypass** |
| — | Save and Deploy |

Rocket Loader там же выключается отдельной настройкой в том же правиле (**Rocket Loader → Off**).
Page Rules считаются от корня хоста, звёздочка обязательна — без неё совпадёт только `/api`.

Отдельно — **таймаут простоя ~100 с**: у Cloudflare проксированное соединение без трафика
закрывается ошибкой 524. На шаге «ожидание подтверждения» человек думает дольше, поэтому
сервер шлёт в поток `{"panel":"meta","type":"ping"}` каждые `GATE_PING_SEC` (15 с) — тишины
в потоке нет никогда. Без этого подтверждение приходило бы в уже мёртвый поток.

Поддомен остаётся **проксированным** — WAF, защита от DDoS и скрытие IP origin нужны
публичному демо. DNS-only сняло бы возню с правилами, но ценой этих трёх вещей, поэтому
так не делаем.

## Ресурсы

`mem_limit: 256m`, `cpus: 0.5` — самый лёгкий стек парка: своей модели нет, инференс в облаке.
Живёт по общему правилу «≤3 демо-стека в RAM», lazy-start и autostop через OpsHub.

## Структура

```
app/config.py     параметры (env)
app/i18n.py       комментарии оркестратора, 4 языка
app/extract.py    извлечение условий: офлайн (кэш) и живое (Gemini)
app/scenario.py   сценарий событий + gate + сравнение
app/main.py       FastAPI: SSE, approve, health, статика
app/static/       фронт: vanilla JS + CSS (xterm.js не нужен — нет PTY и ANSI)
data/docs/        пара документов с тремя подменами
clients/          drop-in клиент OpsHub
```

## Известные ограничения

- Живой прогон через ACP-агентов (`ASP-A2A_gateway`) — следующий этап; сейчас `live` идёт
  напрямую в Gemini. Подключение агентов не потребует переделки фронта: события те же.
- Кнопка «свой документ» не реализована (нужны парсинг PDF и модерация загрузок).
- Поведение SSE через Cloudflare на практике не проверялось: keepalive и заголовки
  проверены локально, но связку с реальным прокси нужно прогнать при первом деплое.
