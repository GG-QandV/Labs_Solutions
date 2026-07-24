# ПРОМПТ ДЛЯ РАЗРАБОТКИ: OpsHub — control plane демо-парка (v1)

Ты — senior Python-разработчик. Создай **OpsHub** — единый инфраструктурный микробекенд для парка из 8–20 демо-сервисов на VPS Netcup 1000 G12 (4 vCore, 8 GB RAM, Ubuntu 24.04, Docker + Traefik standalone). OpsHub — постоянно работающий контейнер (инфраструктура, вне правила «до 3 демо-стеков в RAM»), закрывает: логи ошибок, health/uptime, метрики ресурсов, дашборд, launcher демо-сервисов с автостопом и плановым авторестартом.

## Стек (выбор обоснован)

- **Python 3.12 + FastAPI + uv** — единый стек с RAG-демо (одна экспертиза сопровождения), aiosqlite, docker SDK (`docker-py`), APScheduler для планировщика. Готовые стабильные библиотеки под все задачи; footprint сопоставим с Node (~60–90 MB), выигрыш — скорость разработки и единообразие парка.
- **SQLite (WAL)** в `/data/opshub.db` — OpsHub единственный владелец файла (никакой конкурентной записи из других контейнеров).
- UI дашборда — статические HTML/JS (vanilla, polling каждые 5 с), раздаёт FastAPI. Без фронтенд-сборки.
- Бюджет контейнера: `cpus: 0.3`, `mem_limit: 128m`.

## Схема БД

```sql
services (id, name, container_name, url_health, domain, autostop_minutes, restart_cron, created_at)
logs     (id, ts, service, level, event,            -- error|critical|crash|oom|restart
          message, traceback, request_id, meta_json)   -- индекс (service, ts)
events   (id, ts, service, kind, detail_json)       -- start|stop|die|oom|health_fail|restart_scheduled
metrics  (id, ts, service, mem_mb, cpu_pct, disk_data_mb)  -- индекс (service, ts)
users    (id, login, password_hash)                 -- basic-auth дашборда
```

Ротация (ежесуточно): logs > 30 дней, metrics > 7 дней, events > 30 дней; VACUUM еженедельно.

## Модуль 1: Приём логов

- `POST /api/log` — батч записей `{service, level, event, message, traceback?, request_id?, meta?}`. Принимаются только ERROR/CRITICAL (уровни ниже — 422). Ключ-авторизация: заголовок `X-OpsHub-Key` (общий секрет из env).
- Автосоздание сервиса в `services` при первом логе/регистрации: `POST /api/register {service, container_name, url_health?}`.
- **Drop-in клиент** (поставляется в репо, ~30 строк, две версии — Python `opshub_client.py` и TS `opshub-client.ts`): буферизация в локальный файл при недоступности OpsHub, отправка батчами, ошибки логирования никогда не роняют сам сервис. Интеграция в любое демо = копия файла + env `OPSHUB_URL`, `OPSHUB_KEY`.

## Модуль 2: Health и события Docker

- Подписка на **docker events** через `/var/run/docker.sock` — фиксировать start/stop/die/oom по всем контейнерам с label `demo=true` → таблица `events`; die/oom дублируется в `logs` как event=crash/oom.
- Активный health-poll: каждые 60 с `GET {url_health}` для запущенных сервисов; 3 подряд неудачи → event `health_fail` + запись в logs.
- Docker socket монтируется в OpsHub. Для чтения (events/stats) достаточно ro; **launcher требует записи** — поэтому сокет монтируется rw, компенсация: OpsHub не публикует наружу ни одного эндпоинта без авторизации, контейнер OpsHub без лишних портов, все управляющие эндпоинты — за той же авторизацией дашборда + `X-OpsHub-Key`. Это осознанный риск (socket ≈ root на хосте), зафиксировать в README.

## Модуль 3: Метрики

- Каждые 60 с: docker stats API → mem_mb, cpu_pct по контейнерам `demo=true` + размер `/data` каждого демо (если volume смонтирован по конвенции `/srv/demos/{name}/data`).
- Хранить точки в `metrics`; на дашборде — спарклайны за 24 ч и текущая сумма RAM всех демо vs бюджет хоста.

## Модуль 4: Launcher

- `POST /api/services/{name}/start|stop|restart` — через docker SDK (эквивалент `docker start/stop/restart`). Кнопки на дашборде.
- **Правило «до 3 демо-стеков в RAM»**: перед start проверять число запущенных `demo=true`; если уже 3 — отклонить с сообщением «Stop one of the running demos first» и списком (принудительное вытеснение — зона роста).
- **Автостоп по неактивности**: демо считается активным, если Traefik access-роутинг к нему был недавно. Реализация без парсинга логов Traefik: демо само дергает `POST /api/heartbeat {service}` из middleware на каждый входящий запрос (строка в drop-in клиенте); нет heartbeat дольше `autostop_minutes` (конфиг per-service, дефолт 30) → `docker stop`. Событие в `events`.
- **Плановый авторестарт (борьба с утечками памяти)** — использовать **нативные механизмы**, не изобретать контролер:
  1. **OOM-авторестарт (нативный Docker/cgroup)**: каждое демо в compose обязано иметь `mem_limit` + `restart: on-failure` — при утечке ядро (cgroup OOM-killer) убивает процесс, Docker сам перезапускает контейнер. OpsHub только фиксирует событие oom в logs. Это первичная защита.
  2. **Плановый рестарт по расписанию**: per-service `restart_cron` (дефолт: ежесуточно 04:00, после очистки данных демо в 03:00) → APScheduler вызывает `docker restart`, только если у сервиса нет активного heartbeat последние 10 минут (не рвать живую сессию; иначе перенос на +1 час, максимум 3 переноса).
  3. Хост-уровень: в README — включение systemd-опций для docker.service не требуется; ничего кастомного на хосте.

## Модуль 5: Дашборд

- `ops.solutions.dpdns.org` за Traefik (docker-labels), basic-auth (users в SQLite, bcrypt).
- Одна страница: сетка сервисов — статус (🟢 running / ⚪ stopped / 🔴 crash|health_fail), RAM/CPU текущие + спарклайн 24 ч, uptime, кнопки start/stop/restart, счётчик «running X/3».
- Ниже — лента последних 50 ошибок (фильтр по сервису/уровню), клик — полная запись с traceback.
- `GET /api/logs?service=&level=&since=&limit=` и `GET /api/overview` — JSON для страницы и для внешних скриптов.

## Безопасность

- Всё наружу — только через Traefik + basic-auth; `POST /api/log|register|heartbeat` — по `X-OpsHub-Key` (демо-контейнеры ходят по внутренней docker-сети `opsnet`, порт OpsHub наружу не публикуется).
- docker.sock: см. Модуль 2. Альтернатива на будущее (зона роста): docker-socket-proxy с whitelist API-методов.
- Rate-limit на приём логов: 100 записей/мин на сервис (защита от лог-шторма при цикле падений).

## Структура репозитория

```
/app
  main.py            — FastAPI, роуты
  db.py              — aiosqlite, схема, миграции, ротация
  collector.py       — docker events + stats
  healthcheck.py     — активный poll
  launcher.py        — start/stop/restart, правило 3-х, автостоп, APScheduler
  auth.py            — basic-auth + api-key
  /static            — dashboard.html, app.js, style.css
/clients
  opshub_client.py   — drop-in для Python-демо (лог + heartbeat middleware)
  opshub-client.ts   — drop-in для Node/TS-демо
Dockerfile, pyproject.toml, uv.lock, docker-compose.yml (opshub + пример labels для демо)
```

## Конвенции для всех демо-сервисов (зафиксировать в README парка)

```yaml
# каждый демо-compose обязан:
labels: [ "demo=true", "traefik.enable=true", ... ]
mem_limit: <бюджет>          # обязателен — включает нативный OOM-рестарт
restart: on-failure
environment: [ OPSHUB_URL=http://opshub:8700, OPSHUB_KEY=${OPSHUB_KEY} ]
networks: [ opsnet, web ]
healthcheck: GET /health
```

## Деплой

1. Docker-сеть `opsnet` (internal) и `web` (Traefik).
2. `docker compose up -d` в /srv/opshub; volume `/srv/opshub/data:/data`.
3. Traefik-labels: `ops.solutions.dpdns.org` → opshub:8700, basic-auth-мидлвар Traefik ИЛИ auth внутри приложения (выбрать одно, зафиксировать).
4. Интеграция существующих демо (PDF, RAG): добавить labels/env/mem_limit по конвенции + drop-in клиент.
5. Smoke: убить процесс внутри демо → oom/die виден на дашборде и в logs; стоп 30 мин без heartbeat → автостоп; 04:00 → плановый рестарт; попытка запустить 4-е демо → отказ с подсказкой.

## Зона роста

Алерты в Telegram, принудительное вытеснение LRU-демо при старте 4-го, docker-socket-proxy, per-demo страницы с графиками, экспорт метрик Prometheus, WARN-уровень логов.

## Критерий готовности

1. Дашборд показывает все контейнеры `demo=true`: статус, RAM/CPU, uptime, «running X/3».
2. Ошибки демо попадают в SQLite через drop-in клиент; падения/OOM фиксируются пассивно через docker events.
3. Кнопки start/stop/restart работают; 4-й одновременный старт блокируется.
4. Автостоп неактивных демо и плановый ночной рестарт (с уважением активных сессий) работают.
5. Утечка памяти в демо гасится нативно (mem_limit + OOM + restart: on-failure), событие видно в логах.
6. OpsHub ≤128 MB RAM; всё наружу — только через auth.
