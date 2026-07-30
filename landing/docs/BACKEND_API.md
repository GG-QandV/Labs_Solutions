# BACKEND_API — контракт для разработчика бэкенда

Сайт: `labs.mnemostroma.com`. Фронт — статика, весь динамический функционал через один префикс **`/api/v1`**.
Стек рекомендован тот же, что у OpsHub: Python 3.12 + FastAPI + uv (одна экспертиза сопровождения).

Все ответы — `application/json; charset=utf-8`. Все ошибки — единый формат:

```json
{ "detail": "human readable message", "code": "rate_limited" }
```

---

## 0. Сводная таблица

| Метод | Путь | Auth | Назначение | Используется в |
|:--|:--|:--|:--|:--|
| POST | `/api/v1/consult` | нет (captcha + honeypot + rate-limit) | Заявка на консультацию | `app.js → initConsultForm` |
| GET | `/api/v1/consult/{ref}` | нет (знание ref) | Статус заявки (микро-кабинет) | `app.js → initStatusForm` |
| GET | `/api/v1/demos` | нет | Статусы демо-модулей для карточек | `app.js → initDemoStates` |
| POST | `/api/v1/demos/{slug}/wake` | нет (rate-limit) | Прогрев спящего демо | страница демо (позже) |
| GET | `/api/v1/health` | нет | Liveness для Traefik/OpsHub | инфраструктура |
| GET | `/api/v1/meta` | нет | Версия сборки, доступные языки | опционально |

Фронт **никогда** не обращается к OpsHub напрямую. См. §4.

---

## 1. `POST /api/v1/consult`

Создание заявки на консультацию.

**Request**

```json
{
  "name": "Ihor K.",
  "email": "ihor@example.com",
  "company": "Example LLC",
  "industry": "logistics",
  "process": "Инвойсы и CMR приходят почтой, оператор перебивает вручную…",
  "volume": "1000-10000",
  "privacy": "masked",
  "systems": "Bitrix24, Gmail, Google Drive",
  "locale": "uk",
  "page": "/",
  "captcha_token": "0.x9…"
}
```

**Валидация (обязательна на сервере, не доверять фронту)**

| Поле | Правило |
|:--|:--|
| `name` | 2–80 символов, обязательное |
| `email` | RFC-валидный, ≤120, обязательное; отклонять одноразовые домены по списку |
| `company`, `industry` | ≤120 / ≤80, опционально |
| `process` | 20–1200 символов, обязательное |
| `volume` | enum: `lt100 \| 100-1000 \| 1000-10000 \| gt10000 \| null` |
| `privacy` | enum: `open \| masked \| local \| null` |
| `systems` | ≤200, опционально |
| `locale` | enum: `en \| uk` |
| `captcha_token` | обязателен, если включён Turnstile (§5) |

**Response `202 Accepted`**

```json
{ "ref": "LM-2026-4KD8QZ", "status": "received" }
```

Формат `ref`: `LM-<YYYY>-<6 символов A–Z0–9>`, регэксп на фронте — `^LM-\d{4}-[A-Z0-9]{6}$`.
Генерировать из CSPRNG, без последовательных счётчиков (иначе перебор чужих заявок).

**Коды ошибок**

| Код | Когда |
|:--|:--|
| 400 | ошибка валидации, `detail` — что именно поправить |
| 403 | captcha не прошла |
| 429 | превышен лимит (см. §6) |
| 503 | почтовый провайдер недоступен — заявка **всё равно сохранена**, вернуть `ref` в теле |

**Побочные эффекты**

1. Запись в БД (`consult_requests`).
2. Письмо-подтверждение заявителю с `ref` (шаблон на `locale`).
3. Уведомление владельцу (email + опционально Telegram-бот).
4. Honeypot: если поле `website` непустое — вернуть `202` с фейковым `ref`, в БД **не писать**.

**Схема таблицы**

```sql
CREATE TABLE consult_requests (
  id          BIGSERIAL PRIMARY KEY,
  ref         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  company     TEXT,
  industry    TEXT,
  process     TEXT NOT NULL,
  volume      TEXT,
  privacy     TEXT,
  systems     TEXT,
  locale      TEXT NOT NULL DEFAULT 'en',
  page        TEXT,
  status      TEXT NOT NULL DEFAULT 'received',  -- received|reviewing|scheduled|answered|closed
  next_step   TEXT,
  ip_hash     TEXT,        -- ТОЛЬКО хэш с солью, не сырой IP
  ua_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON consult_requests (created_at DESC);
```

---

## 2. `GET /api/v1/consult/{ref}`

Микро-кабинет: проверка статуса по номеру из письма.

**Response `200`**

```json
{ "ref": "LM-2026-4KD8QZ", "status": "scheduled", "next_step": "Call on Fri 14:00 EET", "created_at": "2026-07-20T09:11:00Z" }
```

`status` — одно из `received | reviewing | scheduled | answered | closed`; человекочитаемые подписи лежат
во фронтовом словаре (`i18n/*.json → cab.state.*`), сервер отдаёт **только ключ**.

**Важно по безопасности:** не возвращать email, имя, компанию и текст процесса — `ref` может попасть третьим лицам.
`404` при отсутствии. Лимит: 20 запросов / 10 мин на IP, иначе `ref` перебирается.

---

## 3. `GET /api/v1/demos`

Статусы карточек демо на главной.

**Response `200`**

```json
[
  { "slug": "dispatcher", "state": "ready",  "url": "/demos/dispatcher" },
  { "slug": "ocr",        "state": "cold",   "url": "/demos/extraction" },
  { "slug": "rag",        "state": "ready",  "url": "/demos/rag" },
  { "slug": "report",     "state": "cold",   "url": "/demos/reports" },
  { "slug": "crm",        "state": "soon",   "url": null },
  { "slug": "analyst",    "state": "soon",   "url": null }
]
```

`state`: `ready` (контейнер запущен и health OK) · `cold` (спит, поднимется по требованию) ·
`soon` (ещё не выпущено) · `down` (health_fail).

`slug` должен совпадать с атрибутом `data-demo` в `index.html`: `dispatcher, ocr, rag, report, crm, analyst`.

Кэшировать ответ на 10 секунд (карточки опрашивают при каждой загрузке страницы, VPS слабый).
Если OpsHub недоступен — отдавать последний известный снимок и `state: "cold"` вместо ошибки; фронт при ошибке
оставляет карточки в состоянии `soon` и не ломается.

---

## 4. Интеграция с OpsHub (`/api/v1/demos`, `/wake`)

OpsHub из `ПРОМПТ_OPSHUB_v1.md` — **внутренний** control plane. Публичный сайт ходит в него сервер-к-серверу.

```
браузер ──► /api/v1/demos ──► site-backend ──► OpsHub GET /api/overview   (X-OpsHub-Key, сеть opsnet)
браузер ──► /api/v1/demos/{slug}/wake ──► site-backend ──► OpsHub POST /api/services/{name}/start
```

**Жёсткие правила:**

1. `X-OpsHub-Key` живёт только в env бэкенда сайта. Никогда не попадает в HTML, JS, ответы API или логи.
2. OpsHub не публикуется наружу (порт не пробрасывается, только сеть `opsnet`) — это уже заложено в его спеке.
3. `slug → container_name` — **белый список в конфиге сайта**. Никакой подстановки имени из запроса в docker-вызов.
4. `wake` уважает правило OpsHub «не более 3 демо в RAM»: при отказе OpsHub вернуть `409` с
   `{"detail":"Another demo is warming up, try in a moment","code":"capacity"}` — фронт покажет это как есть.
5. Лимит `wake`: 5 запросов / 5 мин на IP. Иначе публичная кнопка = бесплатный способ гонять контейнеры на VPS.

**`POST /api/v1/demos/{slug}/wake` → `202`**

```json
{ "slug": "ocr", "state": "warming", "eta_seconds": 12 }
```

---

## 5. Captcha

Cloudflare Turnstile (бесплатный, без cookie-баннера, лучше подходит под GDPR, чем reCAPTCHA).

* Фронт: в `index.html` есть пустой `<div id="captchaSlot" data-captcha="turnstile">`.
  Подключение — отдельным скриптом (`/assets/js/captcha.js`), который кладёт токен в `window.__captchaToken`.
  Скрипт Turnstile добавляется в CSP `script-src` (см. `DEPLOY.md`).
* Бэкенд: верификация токена на `https://challenges.cloudflare.com/turnstile/v0/siteverify` с секретом из env.
* Пока ключи Turnstile не заведены — включить фичефлаг `CAPTCHA_ENABLED=false`; тогда работают только
  honeypot + rate-limit. Это временный режим, зафиксировать в задаче.

---

## 6. Rate limiting и защита

| Эндпоинт | Лимит |
|:--|:--|
| `POST /consult` | 3 / час на IP, 10 / час на подсеть /24, 1 / 30 сек глобально на email |
| `GET /consult/{ref}` | 20 / 10 мин на IP |
| `GET /demos` | 60 / мин на IP (дёшево, отдаётся из кэша) |
| `POST /demos/{slug}/wake` | 5 / 5 мин на IP |

Дополнительно:

* IP и User-Agent хранить **только в виде HMAC-хэша с серверной солью** — заявка не должна тянуть за собой сырые
  идентификаторы; для антиспама хэша достаточно.
* Тело запроса ограничить 32 KB (`--limit-request-field_size` / middleware).
* CORS: **не открывать**. Фронт и API — один origin. Если понадобится поддомен, allowlist конкретного origin,
  без `*` и без `allow_credentials` вместе с wildcard.
* Логи: писать `event`, `ref`, `code`, хэш IP. Не писать содержимое поля `process` в общий лог-поток
  (там бывают коммерческие данные клиента).
* Ошибки отдавать без стектрейсов; стектрейс — в OpsHub через drop-in клиент (`opshub_client.py`).

---

## 7. Что должно быть готово к первому релизу

1. `POST /consult` + письма + запись в БД — **блокирует запуск сайта**, без него форма мертва.
2. `GET /consult/{ref}` — микро-кабинет.
3. `GET /demos` — можно временно отдавать статический список со `state: "soon"`, карточки уже это переживут.
4. `GET /health` — для Traefik healthcheck.
5. `wake` и интеграция с OpsHub — после первого работающего демо, не раньше.

## 8. Открытые решения (нужен выбор владельца)

1. Почтовый провайдер для транзакционных писем: Cloudflare Email Routing (только приём) + SMTP-релей
   (Resend / Postmark / SES) для отправки. Требуется SPF + DKIM + DMARC на `labs.mnemostroma.com`.
2. Календарь: ссылка на Cal.com/Calendly в письме-подтверждении или собственные слоты в БД.
3. Stripe (бронирование времени/предоплата этапа) — в контракт v1 не входит, добавляется как `/api/v1/checkout`.
