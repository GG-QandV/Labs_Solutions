# AI Automation Lab — Архитектура проекта

> Каноничный технический документ. Описывает **фактическую** архитектуру, выведенную
> из реализованных модулей в `backend/`, и заменяет устаревшие разделы 2–4 исходного
> [`MASTER_PLAN.md`](MASTER_PLAN.md).
> Стратегия и позиционирование — в [`MASTER_PLAN.md`](MASTER_PLAN.md) и
> [`Контекст_ AI Automation Lab _ лендинг живых демо.md`](Контекст_%20AI%20Automation%20Lab%20_%20лендинг%20живых%20демо.md).
> План работ с чек-листом — в [`ROADMAP.md`](ROADMAP.md).

---

## 1. Что изменилось относительно мастер-плана

Мастер-план проектировал «тяжёлый» стек, рассчитанный на постоянно работающие
самостоятельные сервисы. При реальной сборке демо от него отказались в пользу
лёгкого стека, помещающегося в один VPS. Ключевые решения и причины:

| Аспект | MASTER_PLAN (устарело) | Фактически реализовано | Причина отказа |
|---|---|---|---|
| Оркестрация | Coolify | **Traefik standalone + OpsHub** (свой control plane) | Coolify держит ~1 ГБ RAM постоянно — недопустимо на 8 ГБ под ~20 демо |
| Векторное хранилище | Qdrant / Weaviate (отдельный контейнер) | **SQLite + sqlite-vec** (встроенно в процесс демо) | Отдельный вектор-сервис на каждое демо не окупается по RAM |
| БД метаданных/сессий | PostgreSQL | **SQLite (WAL)** в каждом модуле | «Не поднимать Postgres ради одной сессии» |
| Хранилище файлов | MinIO (S3) | Локальный volume `/srv/demos/{name}/data` | Тот же бюджет RAM/сложности |
| Embeddings/Reranker/NER | Отдельные постоянные Docker-сервисы | ONNX-модели **внутри** процесса демо | Меньше контейнеров, ленивая загрузка |
| Модель работы сервисов | 7+ сервисов онлайн одновременно | **Правило «≤3 демо-стека в RAM»** + lazy-start + autostop | Прямое следствие бюджета 8 ГБ |

**Вывод:** архитектура — не «микросервисный кластер», а **парк демо на одном VPS**,
которым управляет один инфраструктурный контейнер (OpsHub), поднимающий демо по
запросу и выгружающий по неактивности.

---

## 2. Целевая среда

Единственный сервер: **Netcup VPS 1000 G12** — 4 vCore, 8 GB DDR5, 256 GB NVMe,
Ubuntu 24.04, Docker + Traefik standalone. (Сравнение тарифов — [`VPS_Netcup.md`](VPS_Netcup.md).)

Домены (за Cloudflare как DNS/proxy, TLS через Traefik + Let's Encrypt):

| Домен | Назначение | Хостинг |
|---|---|---|
| `labs.mnemostroma.com` | Публичный лендинг (статика) | nginx-контейнер, отдельно от API |
| `ops.solutions.dpdns.org` | Дашборд OpsHub (basic-auth) | OpsHub |
| `<demo>.solutions.dpdns.org` | Страницы конкретных демо (rag, pdf, stt…) | контейнер демо за Traefik |

Правило изоляции: **публичный контур (лендинг + демо) отделён от клиентских внедрений.**
При внедрении реального процесса инфраструктура ставится в контуре клиента или на
отдельном сервере с чёткими юридическими границами (см. `MASTER_PLAN.md` §3, §9).

---

## 3. Топология рантайма

```text
                        Cloudflare (DNS + proxy/WAF)
                                   │
                          Traefik standalone
                 (TLS Let's Encrypt, routing по Host)
                                   │
   ┌───────────────┬───────────────┼───────────────┬────────────────┐
   │               │               │               │                │
 landing        opshub          rag-demo        pdf-demo         stt-demo
 (nginx,       (control        (FastAPI+       (Fastify+        (FastAPI+
  статика)      plane,          SQLite+         Redis/BullMQ+    whisper.cpp
                ВСЕГДА online)   sqlite-vec,     Playwright,      + SQLite,
                                 ONNX)           локальн. /data)  lazy)
                                   │
        сети Docker:  web (Traefik) + opsnet (internal, до OpsHub)
                                   │
                  внешние API: LLM-провайдеры (Gemini/DeepSeek/Claude),
                               Resend (email), Stripe (биллинг)
```

**Постоянно в RAM:** только Traefik и OpsHub (инфраструктура, вне лимита «≤3 демо»).
Бюджет OpsHub — `cpus: 0.3`, `mem_limit: 128m`. Всё остальное — по запросу.

### Жизненный цикл демо (управляет OpsHub)

1. Пользователь открывает страницу демо → Traefik роутит → если контейнер стоит,
   OpsHub стартует его (`docker start`), UI показывает «warming up» (модели ONNX/whisper
   грузятся лениво при первой задаче).
2. На каждый входящий запрос демо шлёт `POST /api/heartbeat` в OpsHub.
3. Нет heartbeat дольше `autostop_minutes` (дефолт 30) → OpsHub делает `docker stop`.
4. Утечки памяти гасятся **нативно**: `mem_limit` + `restart: on-failure` → cgroup OOM-killer
   убивает процесс, Docker перезапускает контейнер, OpsHub фиксирует событие `oom`.
5. Плановый ночной рестарт (04:00, после очистки данных в 03:00) — только если нет
   активной сессии (иначе перенос, максимум 3 раза).
6. Правило «≤3 демо-стека в RAM»: попытка запустить 4-е демо отклоняется с подсказкой
   «останови одно из работающих».

---

## 4. Control plane — OpsHub

Единый инфраструктурный микробэкенд парка (реализация — `backend/opshub/`).
Стек: Python 3.12 + FastAPI + uv, aiosqlite, docker-py, APScheduler. UI — статические HTML/JS.

Функции:
- **Приём логов** — `POST /api/log` (только ERROR/CRITICAL), авторизация `X-OpsHub-Key`.
  Drop-in клиент (`opshub_client.py` / `opshub-client.ts`, ~30 строк) буферизует логи
  и шлёт heartbeat; ошибки логирования не роняют сам сервис.
- **Health и события Docker** — подписка на docker events (start/stop/die/oom) по контейнерам
  с label `demo=true`; активный health-poll каждые 60 с.
- **Метрики** — docker stats (mem/cpu) + размер `/data` каждого демо; спарклайны 24 ч,
  суммарный RAM всех демо против бюджета хоста.
- **Launcher** — start/stop/restart через docker SDK, правило «≤3», автостоп, плановый рестарт.
- **Дашборд** — `ops.solutions.dpdns.org`, basic-auth, сетка сервисов + лента 50 последних ошибок.

Схема БД OpsHub (SQLite WAL, единственный владелец файла): `services`, `logs`, `events`,
`metrics`, `users`. Ротация: logs/events > 30 дней, metrics > 7 дней, VACUUM еженедельно.

Осознанный риск: docker.sock монтируется rw (нужно для launcher) ≈ root на хосте —
компенсируется тем, что OpsHub не публикует наружу ни одного эндпоинта без авторизации.

### Конвенции для КАЖДОГО демо-сервиса (обязательны)

```yaml
labels:      [ "demo=true", "traefik.enable=true", ... ]   # demo=true включает управление OpsHub
mem_limit:   <бюджет>            # обязателен — включает нативный OOM-рестарт
restart:     on-failure
environment: [ OPSHUB_URL=http://opshub:8700, OPSHUB_KEY=${OPSHUB_KEY}, OPSHUB_SERVICE=<name> ]
networks:    [ opsnet, web ]
healthcheck: GET /health
volumes:     [ /srv/demos/<name>/data:/data ]
```

---

## 5. Модули парка

Все модули извлечены из архивов в `backend/<module>/` (готовый код). Статус реализации — в [`ROADMAP.md`](ROADMAP.md).

### 5.1. Landing (`landing/`, реализован и развёрнут в этом репозитории)
Чистый HTML/CSS/JS, ноль зависимостей, отдаётся nginx (статика 64 MB), отдельно от API —
падение бэкенда не роняет сайт. i18n: английский зашит в `index.html` (для краулера),
украинский собирается `build/prerender.py` из `i18n/uk.json`; словари работают для мгновенного
переключения в браузере. Сигнатурный элемент — карточка прогона в hero, демонстративно
останавливающаяся на «Awaiting approval» (тезис оффера: модель готовит, отправляет человек).
Контракт бэкенда формы — `landing/docs/BACKEND_API.md`. Деплой — `landing/docs/DEPLOY.md`.

### 5.2. OpsHub (`backend/opshub/`) — см. §4.

### 5.3. RAG-демо (`backend/rag-demo/`)
FastAPI + SQLite/sqlite-vec + ONNX (embedder e5-small, reranker TinyBERT, NER), LLM/OCR —
Gemini free tier + DeepSeek опционально. Загрузка документа → чанкинг → эмбеддинги → ответ
LLM **с обязательными цитатами** (ответ без подтверждённого источника = ошибка). Лимиты
сессии (файлы/страницы), очистка данных 03:00. Интегрирован с OpsHub (heartbeat, lazy-start).
Соответствует версии промпта `ПРОМПТ_RAG_ДЕМО_v1.1.md` (после отказа от Coolify).

### 5.4. PDF-отчёты (`backend/pdf-demo-vps/`)
Монорепо pnpm+Turborepo. Пользователь вставляет ссылку на публичный Google Sheet → валидация
структуры/объёма/SSRF → адаптер `sheetsToReportJSON()` → `ReportJSON` (входной контракт, не
меняется при замене источника) → рендер HTML → PDF через **Playwright + системный Chromium**
→ email (Resend). Очередь **Redis + BullMQ** (2 параллельных рендера, очередь с позицией),
Caddy/Traefik reverse-proxy, локальное `/data` с cron-очисткой. Соответствует `ПРОМПТ_ДЛЯ_РАЗРАБОТКИ_v3_VPS.md`
(миграция с serverless Cloudflare — версия `backend/pdf-demo-base/` — на self-hosted VPS).

### 5.5. STT / Speech Translate (`backend/stt-mvp/`)
Локальная транскрибация (whisper.cpp + `ggml-base.bin` multilingual, PipeWire 2 канала,
встроенный VAD) → SQLite → в облако уходит **только текст** для перевода/редактуры. Три жёстких
режима: `live_literal` (не менять факты/числа/имена), `live_safe` (убрать только слова-паразиты),
`post_clean` (чистовая стенограмма с edit_log). Правило целостности: `raw_text` неизменяем.
Два профиля установки (`APP_PROFILE=desktop|server`) — общий пайплайн, различаются захват звука
и упаковка (десктоп: PipeWire+systemd; сервер: загрузка файла/браузерный микрофон+Docker+Traefik).
В `backend/stt-mvp/` сейчас только облачный LLM-слой (`app/llm/` + `SPEC_llm_endpoint.md`),
аудио-пайплайн — к реализации. Полное ТЗ на STT-пайплайн — в промптах `docs/анализ_логик_промпт.md`
и `docs/анализ_логик_промпт_ПАТЧ_v1.1.md` (двойной таргет desktop/server).

---

## 6. Данные и безопасность (сквозные правила)

- **Human-in-the-loop:** значимые внешние действия (письмо, изменение CRM, финансы) — только
  после подтверждения человеком. Критичные шаги пайплайна демонстративно останавливаются.
- **Проверяемость:** raw-результаты не перезаписываются AI-редактурой; чистовая версия и журнал
  изменений хранятся отдельно (см. `edit_log` в STT, «Awaiting approval» в лендинге).
- **Маскирование:** для чувствительных данных — локальный слой маскирует PII, облачная модель
  обрабатывает обезличенный текст, локальный слой восстанавливает значения.
- **BYOK (Bring Your Own Key)** — 4 режима доверия:

  | Контекст | Режим | Где ключ |
  |---|---|---|
  | Публичное демо | Ограниченный demo-key платформы | Отдельный demo-проект |
  | Закрытый пилот | Ephemeral BYOK | Только RAM изолированного worker, TTL 30–60 мин, кнопка Revoke |
  | Регулярная cloud-работа | Encrypted BYOK | Шифрованно в БД + Vault/KMS, расшифровка только на вызов |
  | Enterprise / чувствительные | Local connector | Только в контуре клиента |

  Правила: только HTTPS POST body; никогда — URL/cookie/localStorage/frontend/логи/аналитика;
  `LogRedactor` маскирует ключи до записи любого лога (включая stdout, который собирает Docker).
  Честная формулировка в UI: ephemeral ≠ «сервер не видит ключ», а «нет записи на диск + удаление по TTL».

---

## 7. Дерево проекта (целевое)

```text
Labs_Solutions/
├── README.md                       индекс репозитория
├── .gitignore                      игнорирует __pycache__/, .pytest_cache/, arch/
│
├── docs/                           СПЕКИ, ПРОМПТЫ, СТРАТЕГИЯ (документация)
│   ├── MASTER_PLAN.md              ◀ исходный стратегический план (source of truth)
│   ├── ai-automation-master.md     дубликат MASTER_PLAN.md (кандидат на удаление, см. примечание)
│   ├── Контекст_ AI Automation Lab _ лендинг живых демо.md   производный контекст
│   ├── ARCHITECTURE.md             ◀ этот файл: каноничная архитектура
│   ├── ROADMAP.md                  ◀ план работ с чек-листом
│   ├── VPS_Netcup.md               справочник тарифов VPS
│   ├── README_ru.md / _uk.md / _pl.md   локализованные README
│   ├── Landing_Labs_fin_v.1.md     итоговые решения по лендингу
│   ├── ПРОМПТ_OPSHUB_v1.md         ТЗ на OpsHub
│   ├── ПРОМПТ_RAG_ДЕМО_v1.md / _v1.1.md          ТЗ на RAG (v1.1 актуальна)
│   ├── ПРОМПТ ДЛЯ РАЗРАБОТКИ.md / _v2.md / _v3_VPS.md   ТЗ на PDF (v3_VPS актуальна)
│   └── анализ_логик_промпт.md / _ПАТЧ_v1.1.md    ТЗ на STT (desktop + server)
│
├── landing/                        РЕАЛИЗОВАННЫЙ ЛЕНДИНГ (корень статического сайта)
│   ├── README.md
│   ├── index.html                  главная (EN, текст в разметке — SEO)
│   ├── uk/ · pl/ · ru/ index.html  пререндер-версии (build/prerender.py)
│   ├── assets/
│   │   ├── css/style.css           дизайн-система, обе темы, адаптив
│   │   ├── js/theme-init.js        синхронная установка темы/языка (без вспышки)
│   │   ├── js/app.js               i18n, тема, меню, анимация pipeline, формы
│   │   ├── fonts/                  (пусто) self-hosted woff2 — DEPLOY.md §5
│   │   └── icons/                  (пусто) SVG-коллекция — docs/ICONS.md
│   ├── i18n/en.json · uk.json · pl.json · ru.json   все тексты (переключатель EN/UA/PL/RU)
│   ├── build/prerender.py          сборка /uk/, /pl/, /ru/ index.html
│   ├── robots.txt, sitemap.xml, site.webmanifest
│   └── docs/                        BACKEND_API.md · DEPLOY.md · ICONS.md
│
├── backend/                        ИЗВЛЕЧЁННЫЕ ДЕМО-МОДУЛИ (готовый код в git)
│   ├── opshub/                      control plane парка (FastAPI + SQLite + docker-py)
│   ├── rag-demo/                    RAG v1.1 (FastAPI + sqlite-vec + ONNX)
│   ├── pdf-demo-base/               PDF на Cloudflare Workers (v2, референс)
│   ├── pdf-demo-vps/                PDF на VPS (v3, актуальный — Fastify + BullMQ + Playwright)
│   └── stt-mvp/                     STT: облачный LLM-слой (app/llm/ + SPEC_llm_endpoint.md)
│
├── backups/                        осталась только документация (не архивы)
│   └── tg-mcp/                      заметки по Telegram-MCP агенту
│
├── tests/                          conftest + test_config / test_i18n / test_prerender
│
└── arch/                           ЛОКАЛЬНОЕ хранилище исходных архивов (в .gitignore,
                                    в GitHub не попадает): *.tar.gz / *.zip демо и лендинга
```

Ранее модули хранились архивами в `backups/`; теперь они **распакованы в `backend/`** —
так удобнее контролировать структуру, доки и диффы в git. Исходные архивы держатся только
локально в `arch/` (в `.gitignore`), чтобы не болтались в GitHub. `landing/` реализован
как рабочий модуль. Соответствие «модуль ↔ версия промпта» зафиксировано в §5 и ROADMAP.

> **Примечание (рассинхрон от массовой распаковки).** `docs/ai-automation-master.md` —
> дубликат `docs/MASTER_PLAN.md`; канонична версия `MASTER_PLAN.md`, дубликат стоит удалить.
> Полная спека STT `SPEC_speech_local_MVP.md` при распаковке была удалена из `docs/speech_translate/`;
> её содержание покрыто промптами `docs/анализ_логик_промпт*.md` (при необходимости восстановить из git-истории).

---

## 8. Внешние зависимости и стоимость

- **Инфраструктура** дешёвая: VPS 10–30 €/мес + домен. Реальный «сжигатель» — **токены LLM и OCR**.
- Публичный демо-контур жёстко лимитируется (размер файла, число запросов, TTL сессий, суточные квоты);
  usage считается по каждому endpoint, демо отключается при приближении к лимиту.
- При платящих клиентах LLM-расходы переносятся на их API-ключи (BYOK) или закладываются в тариф.
- Детальная финмодель — `MASTER_PLAN.md` §6.
