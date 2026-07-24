# ПРОМПТ ДЛЯ РАЗРАБОТКИ (v3 — VPS Netcup 1000 G12)

Ты — senior full-stack разработчик. Создай демонстрационный сервис генерации PDF-отчётов, работающий на **VPS Netcup 1000 G12** (KVM, 4 vCore x86, 8 GB DDR5 ECC RAM, 256 GB NVMe, безлимитный трафик), и задеплой его на домен **solutions.dpdns.org** (DNS остаётся на Cloudflare, A-запись → IP VPS, Cloudflare proxy включён как бесплатный CDN + DDoS-фильтр поверх защиты Netcup).

## Жёсткие ограничения окружения

**На этом же VPS одновременно работают ещё 1–2 других демо-сервиса.** Поэтому:

- **Ресурсный бюджет этого сервиса**: не более **2 vCore и 2.5 GB RAM** в пике (лимиты задать в Docker Compose: `cpus: 2.0`, `mem_limit: 2560m` на стек сервиса).
- **Chromium — главный потребитель**: один инстанс headless Chromium = 300–500 MB RAM. Максимум **2 параллельных рендера**, очередь для остальных (не отклонять, а ставить в очередь).
- Все сервисы на VPS изолированы в Docker, общий вход — один reverse proxy (**Caddy**: авто-HTTPS Let's Encrypt, маршрутизация по поддоменам/путям). Конфиг Caddy должен позволять добавить следующие демо (`demo2.solutions.dpdns.org` и т.д.) одной секцией.
- **Никакого локального SMTP** (порт 25 у большинства VPS-провайдеров ограничен, deliverability с нового IP плохая) — email только через **Resend** (free: 100 писем/день), домен верифицируется SPF/DKIM-записями в Cloudflare DNS.

## Цель проекта

Показать потенциальному заказчику живое демо: он вставляет ссылку на публичный Google Sheet, система валидирует данные, строит структуру автоматически, генерирует брендированный PDF-отчёт с изображениями и отправляет файл на email.

## Общая архитектура

```
[Cloudflare DNS/proxy] → [Caddy reverse proxy на VPS]
     ↓
[Frontend: статические файлы React/Vite, раздаёт Caddy]
     ↓
[API: Node.js (Fastify) + TypeScript]  ←→  [Redis: очередь задач, токены, rate-limit, статусы]
     ↓
[Worker-процесс очереди (BullMQ)] → [Playwright + системный Chromium] → PDF
     ↓
[Локальное хранилище /data (tmpfiles c TTL-очисткой)] → [Resend: письмо с вложением]
```

Ключевое архитектурное правило сохраняется: **PDF Engine принимает только нормализованный `ReportData`**; `sheet-connector` — единственный модуль, знающий про Google Sheets. Источник заменяем без переписывания рендера.

## Технологический стек

- **Frontend**: React + Vite, статическая сборка, раздаётся Caddy (без Node-процесса для фронта).
- **Backend**: Node.js 22 LTS + **Fastify** + TypeScript.
- **Очередь и состояние**: **Redis 7** + **BullMQ** — задачи генерации, статусы, временные токены (TTL), rate-limit. Один Redis-контейнер, ограничение `maxmemory 256mb` + `allkeys-lru`.
- **PDF**: **Playwright** с системным Chromium в отдельном воркер-контейнере. Полный контроль: нет дневных лимитов браузерного времени (в отличие от облачных API). Fallback pdf-lib не нужен — убран.
- **Google Sheets**: только публичный CSV-экспорт `https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv` (и `export?format=csv`). Без OAuth и кредов.
- **Файлы**: локальная папка `/data/{jobId}/` (загруженные изображения, готовые PDF). Cron/systemd-timer чистит файлы старше 24 ч. NVMe 256 GB — квота сервису 20 GB (мониторить).
- **Монорепо**: pnpm workspaces + Turborepo (без изменений).
- **i18n**: словари строк, старт — английский, каркас для добавления языков.
- **Контейнеризация**: Docker Compose, 4 контейнера: `api`, `queue-worker` (Playwright+Chromium), `redis`, (Caddy — общий на VPS, вне компоуза сервиса или в отдельном «инфраструктурном» компоузе).

## Модули 1–3 (без изменений против v2)

- **Модуль 1**: страница ввода ссылки, временный токен доступа (TTL 1 ч, хранение в Redis), таймер, блокировка по истечении.
- **Модуль 2**: детальный отчёт валидации `{ ok, errors[], warnings[] }`: доступность, CSV-формат, лимит строк (~40–60 на 10 страниц, конфиг), скрытые строки best effort (сравнение gviz vs export CSV → warning), проверка доступности image-URL.
- **Модуль 3**: автоопределение структуры (заголовки, типы: текст/число/дата/URL/image-URL), строка → карточка, столбец → поле.

## Модуль 4: Изображения (потоки A+B)

**Поток A — URL в ячейках:**

- Google Drive ссылки: авто-конвертация `file/d/{id}` и `open?id={id}` → `https://drive.google.com/thumbnail?id={id}&sz=w2000`; при неудаче — плейсхолдер + запись в отчёт.
- Прокси изображений через API-endpoint `/api/img-proxy` с защитой от SSRF (Server-Side Request Forgery — подделка серверных запросов): whitelist http/https, запрет приватных/локальных IP-диапазонов (10.x, 172.16–31.x, 192.168.x, 127.x, 169.254.x, ::1) **с резолвом DNS до проверки**, лимит 5 MB, таймаут 10 с.

**Поток B — загрузка с устройства:**

- После валидации: список строк с image-полями, для битых/пустых — кнопка "Upload image" (drag-and-drop, ПК и мобильные).
- Файлы → `/data/{jobId}/uploads/{rowIndex}.{ext}`, лимит 5 MB, типы png/jpg/jpeg/webp, проверка magic bytes (сигнатура файла, а не только расширение).
- Приоритет: загруженный файл (B) перекрывает URL из ячейки (A).

**Масштабирование**: `object-fit: contain` — вписывание в контейнер карточки без обрезки и деформации. Битые изображения → плейсхолдер "image unavailable".

## Модуль 5: PDF-шаблон (без изменений против v2)

- Минималистичный шаблон, брендинг-зоны (логотип-placeholder, название компании, акцентный цвет — CSS-переменная).
- Обложка + повторяемые карточки + автопагинация; `@page` с переключателем **A4 / Legal** (кнопка в UI, параметр рендера); `break-inside: avoid`.
- Шаблоны как файлы `template-1.html`, `template-2.html`… — параметр конфига рендера, PDF Engine не меняется.

## Модуль 6: Генерация и отправка

- Кнопка "Generate PDF & send to email", поле email.
- **Полноценная асинхронная очередь (BullMQ)** — уже не компромисс, а штатный режим:
  - `POST /api/jobs` → задача в очередь, ответ сразу с `jobId`.
  - Concurrency воркера: **2** (под ресурсный бюджет). Очередь показывает позицию: "You are #3 in queue".
  - Frontend опрашивает `GET /api/jobs/{id}`: `queued(#N) → validating → rendering → sending → done | error{stage, message}`.
  - Retry: 1 повтор при падении рендера; Chromium перезапускается между задачами при RSS > 700 MB (защита от утечек памяти).
- Email через Resend: конфигурируемые тема/текст, PDF вложением; если > 20 MB — ссылка на скачивание `/download/{jobId}/{token}` с TTL 24 ч вместо вложения.

## Защита от абьюза

- Rate-limit в Redis: 5 генераций/час на токен, 10/час на IP, глобальный суточный счётчик писем ≤ 90 (буфер под квоту Resend 100/день).
- Cloudflare proxy перед VPS: включить бесплатные WAF managed rules + rate limiting на уровне CF как первый рубеж.
- Валидация email + короткий blocklist disposable-доменов (конфиг).
- Fail2ban на VPS + SSH только по ключам (базовая гигиена, в деплой-инструкцию).

## Структура проекта

```
/apps
  /web            — React/Vite, статика
  /api            — Fastify API (jobs, validate, img-proxy, upload, download, email)
  /queue-worker   — BullMQ consumer + Playwright рендер
/packages
  /report-schema  — ReportData, ReportBlock, ValidationResult, JobStatus
  /sheet-connector
  /report-renderer
  /pdf-engine     — Playwright-рендер, выбор шаблона и формата
  /email-sender   — Resend
  /access-token   — токены (Redis + TTL)
  /rate-limit     — счётчики Redis
  /i18n
/deploy
  docker-compose.yml, Caddyfile (пример секции), .env.example, cleanup.timer
turbo.json, pnpm-workspace.yaml
```

## Деплой (обязательная часть результата)

1. Подготовка VPS: Ubuntu 24.04 LTS, Docker + Docker Compose, fail2ban, ufw (открыты 80/443/SSH), SSH-ключи.
2. Общий Caddy (или подключение к уже работающему на VPS): секция для `solutions.dpdns.org` → api/статика этого сервиса; шаблон секции для будущих демо.
3. Cloudflare DNS: A-запись `solutions.dpdns.org` → IP VPS (proxy on); SPF/DKIM для Resend.
4. `docker compose up -d` с ресурсными лимитами (`cpus`, `mem_limit`) на каждый контейнер; суммарный бюджет стека ≤ 2 vCore / 2.5 GB.
5. Cron/systemd-timer: очистка `/data` (24 ч) и ротация логов.
6. Мониторинг-минимум: `docker stats`-алерты или node_exporter опционально; healthcheck-endpoint `/api/health` (Redis, Chromium, диск).
7. Smoke-чеклист: тестовый Sheet → валидация → upload картинки → очередь → PDF → письмо получено; параллельный запуск 3 задач → 2 рендерятся, 1 в очереди.

## Не реализовывать сейчас (зона роста)

OAuth Google, сервисные аккаунты, постоянное хранение истории, авторизация пользователей, роли, мультитенантность, редактор шаблонов, горизонтальное масштабирование (второй воркер-нода). `sheet-connector` заменяем без изменения `pdf-engine` и `report-renderer`.

## Критерий готовности демо

1. Ссылка на публичный Google Sheet → временный токен (таймер).
2. Детальный отчёт валидации (объём, warnings по скрытым данным, изображения).
3. Догрузка изображений с устройства для проблемных строк.
4. Выбор A4/Legal → "Generate PDF" → позиция в очереди → статусы этапов.
5. Карточки строятся автоматически, изображения масштабируются, битые → плейсхолдер.
6. PDF уходит на email через Resend (или ссылка при > 20 MB).
7. Всё работает на `solutions.dpdns.org`; стек укладывается в 2 vCore / 2.5 GB и не мешает 1–2 соседним демо на том же VPS.
