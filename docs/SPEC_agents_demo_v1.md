# SPEC: Agents — 7-й модуль демо-парка (сверка документов, независимые агенты + арбитр)

> Статус: спека, код не начат. Заменяет черновик `TODO`-переписки (SKELETON/comments_agents_demo) —
> та версия предполагала архитектуру «с нуля» (aiohttp, свой домен, свой RAM-бюджет вне парка) и
> не была сверена с уже реализованным `Labs_Solutions`. Здесь всё приведено в соответствие с
> [`ARCHITECTURE.md`](ARCHITECTURE.md), [`ROADMAP.md`](ROADMAP.md) и фактическим `landing/index.html`.

---

## 0. Что изменилось относительно черновика — и почему

| Черновик (SKELETON) | Факт по репозиторию / решение | Источник |
|---|---|---|
| Домен `agents-labs.mnemostroma.com` как рабочая заглушка, затем варианты `arbiter.mnemostroma.com` | Конвенция парка — **`<slug>-labs.mnemostroma.com`** (`rag-labs`, `pdf-labs`, `dispatcher-labs`, `stt-labs`). Финальный слаг — **`agents`** (короче «arbiter», прямее передаёт суть демо; закреплено владельцем) | `ARCHITECTURE.md` §2 |
| Свой бюджет RAM вне общего пула | Демо живёт под правилом **«≤3 демо-стека в RAM»**, управляется OpsHub (lazy-start/autostop/heartbeat), это не отдельная договорённость, а обязательная конвенция для каждого демо | `ARCHITECTURE.md` §4, §3 |
| Python + aiohttp («FastAPI не нужен, нет OpenAPI») | OpsHub-клиент для Python — `opshub_client.py` — написан как **FastAPI/Starlette middleware** (`heartbeat_middleware`); RAG-демо и OpsHub сами на FastAPI. Ради переиспользования готового клиента без форка — **FastAPI**, не aiohttp | `backend/opshub/clients/opshub_client.py` |
| «7-я карточка», без привязки к структуре секции demos | На лендинге секция `#demos` жёстко озаглавлена **«Six modules. One track.»** и содержит 6 карточек (`dispatcher`, `ocr`, `rag`, `report`, `crm`, `analyst`) в сетке `grid--3` | `landing/index.html:259,267-331` |
| Сценарий не привязан к общему «7-state track» сайта | Каждая карточка на сайте по тексту секции `#pipeline` обязана укладываться в единый цикл **Received → Extracted → Verified → Matched → Drafted → Awaiting approval → Sent** — это заявленный инвариант всего лендинга, не опция | `landing/index.html:229-244` |

Ниже — версия, которая закрывает все четыре расхождения.

---

## 1. Имя, домен, позиционирование

**Слаг модуля: `agents`. Домен: `agents-labs.mnemostroma.com`.** Короче «arbiter» и прямее
указывает на суть демо (несколько независимых агентов), чем узкий термин про арбитраж.

Третий участник сценария (сверка/вердикт) внутри демо по-прежнему называется **Arbiter** —
это имя роли/панели в UI и в event-контракте (`panel:"arbiter"`), не домен. Обоснование именно
этого слова для роли не изменилось: узнаваемость почти без перевода в EN/UK/PL/RU
(arbiter / арбітр / arbiter / арбитр) — нейтральнее «судьи», весомее «аудитора».

DNS: седьмая A-запись в Cloudflare (проксирована) в дополнение к уже запланированным шести
(`labs`, `rag-labs`, `pdf-labs`, `ops-labs`, `stt-labs`, `dispatcher-labs` — см. `ROADMAP.md` Этап 1).

## 2. Место в пайплайне сайта — не отдельный аттракцион, а «Matched»-шаг

Секция `#pipeline` утверждает: «Every demo on this site runs the same seven-state track». Сценарий
из SKELETON (два агента читают документ независимо, третий сверяет) **укладывается в этот цикл
без натяжки**, если явно проговорить шаги в UI:

| Шаг сайта | Что показывает демо |
|---|---|
| 01 Received | Два файла приняты как есть: `contract_en.txt` (оригинал), `contract_uk.txt` (перевод) |
| 02 Extracted | Агент A и агент B независимо извлекают три условия (сумма, срок оплаты, штраф) каждый из своего документа |
| 03 Verified | Схема результата валидируется (формат суммы/даты/процента) до сравнения |
| 04 **Matched** | Arbiter сверяет пары значений — это ядро демо, буквально то же действие, что «Matched» у остальных модулей («retrieved with the source fragment») |
| 05 Drafted | Черновик отчёта о расхождениях (3 пункта, риск) |
| 06 Awaiting approval | Отчёт не считается финальным, пока человек не подтвердит («review before escalation») |
| 07 Sent | Подтверждённый отчёт «уходит» — в демо это финальный экран с меткой отправки (email-заглушка на публичном демо, реальная отправка — по запросу) |

Это меняет сценарий из SKELETON минимально: нужно добавить шаг 06 (сейчас в SKELETON вердикт
показывается сразу как финал без паузы на подтверждение) — иначе демо ломает заявленный на
сайте инвариант «gate не опционален» и это будет заметно тому, кто прошёл через 6 других карточек
подряд.

## 3. Карточка на лендинге

Правки в `landing/index.html`:

- `demos.h2`: **«Six modules. One track.»** → **«Seven modules. One track.»** (и параллельно в
  `landing/i18n/uk.json` / `pl.json` / `ru.json` — везде, где встречается число шести/6/Six)
- Новая карточка `data-demo="agents"` — седьмая в `#demoGrid`, после `analyst` (сохраняет порядок
  «сначала работающие через реальный бэкенд» → в конец списка, как остальные ещё не задеплоенные)
- Иконка: 256×256 `currentColor`, тема — весы (scales) или две смежные фигуры-«агента», тот же
  стиль обводки, что у остальных 6 (Phosphor-подобный контур, см. существующие `<path>` в карточках)
- CTA: `data-href-todo="LINK: /demos/agents"` до деплоя, затем `href="https://agents-labs.mnemostroma.com"`
  (тот же переход, что уже произошёл у `dispatcher`/`rag`/`report`)

```html
<article class="card card--demo" data-demo="agents">
  <header class="card__h">
    <svg class="ico ico--lg" data-tone="accent" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><!-- scales icon --></svg>
    <span class="pill" data-demo-state>—</span>
  </header>
  <h3 class="h4" data-i18n="demos.d7.t">Cross-document check</h3>
  <p data-i18n="demos.d7.d">Two versions of one document in — amounts, dates and figures extracted independently from each, then matched. Every mismatch keeps its source line.</p>
  <p class="meta"><span data-i18n="demos.in">In</span>: original + translation · <span data-i18n="demos.out">Out</span>: match report + risk</p>
  <a class="btn btn--ghost btn--sm" href="#" data-href-todo="LINK: /demos/agents" data-i18n="cta.try">Try it</a>
</article>
```

i18n-ключи (`en.json`, зеркально в `uk.json`/`pl.json`/`ru.json`):
```json
"demos.d7.t": "Cross-document check",
"demos.d7.d": "Two versions of one document in — amounts, dates and figures extracted independently from each, then matched. Every mismatch keeps its source line."
```

Формулировка сознательно не про «перевод» буквально (это сузило бы демо до одного применения) —
про сверку двух версий документа, что охватывает и перевод, и ревизии контракта, и сверку копий.
Сам показательный пример на UI (EN/UK) остаётся как в SKELETON — это конкретная демонстрация,
не ограничение сценария.

## 4. Архитектура и OpsHub-конвенции (обязательны для публикации, см. §4 ARCHITECTURE.md)

Стек: **Python 3.12 + FastAPI + uv** (совпадает с OpsHub/RAG-демо), SSE-эндпоинт вместо REST для
потока событий. `opshub_client.py` подключается как есть — `heartbeat_middleware` в FastAPI-app,
`opshub_register()` при старте, `opshub_error()` на ERROR/CRITICAL.

```yaml
# docker-compose.yml — по образцу backend/pdf-demo-vps/deploy/docker-compose.yml
services:
  agents-demo:
    build: { context: .., dockerfile: Dockerfile }
    container_name: agents-demo
    restart: on-failure
    mem_limit: 256m
    cpus: 0.5
    environment:
      - OPSHUB_URL=http://opshub:8700
      - OPSHUB_KEY=${OPSHUB_KEY}
      - OPSHUB_SERVICE=agents-demo
    volumes:
      - /srv/demos/agents-demo/data:/data
    networks: [web, opsnet]
    labels:
      - "demo=true"
      - "traefik.enable=true"
      - "traefik.docker.network=web"
      - "traefik.http.routers.agentsdemo.rule=Host(`agents-labs.mnemostroma.com`)"
      - "traefik.http.routers.agentsdemo.entrypoints=websecure"
      - "traefik.http.routers.agentsdemo.middlewares=sec-headers@file,noindex@file,demo-ratelimit@file"
      - "traefik.http.routers.agentsdemo.tls.certresolver=le"
      - "traefik.http.services.agentsdemo.loadbalancer.server.port=8080"
networks:
  web: { external: true }
  opsnet: { external: true }
```

256m/0.5 CPU — самый лёгкий стек в парке (для сравнения: PDF-демо 2560m из-за Playwright/Chromium,
OpsHub сам 128m). Живёт по общему правилу «≤3 демо-стека одновременно» — lazy-start по заходу на
`agents-labs.mnemostroma.com`, autostop по бездействию (дефолт 30 мин), как у всех остальных.

## 5. Event-контракт (панели: `a` / `b` / `arbiter` / `gate` / `verdict`)

```json
{"panel":"a","type":"line","text":"› читаю оригинал (EN)","delay":800}
{"panel":"a","type":"result","key":"amount","value":"USD 48,000"}
{"panel":"b","type":"result","key":"amount","value":"USD 84,000"}
{"panel":"arbiter","type":"compare","key":"amount","a":"USD 48,000","b":"USD 84,000","match":false}
{"panel":"gate","type":"approval_pending"}
{"panel":"verdict","type":"final","mismatches":3,"risk":"high"}
```
Добавлено событие `gate` (шаг 06 «Awaiting approval» из §2) — фронт показывает кнопку
подтверждения, `verdict` не отправляется автоматически.

## 6. Режим исполнения, кэш, BYOK

Без изменений от предыдущего разбора: прогретый кэш по умолчанию + кнопка живого прогона
(лимит N/сутки/IP). Ключ LLM — режим **«Публичное демо → ограниченный demo-key платформы»**
из BYOK-таблицы `ARCHITECTURE.md` §6, отдельный demo-проект, не общий с другими модулями
(на случай лимита/абьюза одно демо не гасит остальные).

## 7. Открытые вопросы — не изменились, решения зафиксированы

Вымышленный договор; кнопка «свой документ» — не в v1 (парсинг+модерация не решены);
третий агент называется Arbiter (роль, не домен); Telegram-дублирование — следующая версия,
подключается как ещё один подписчик того же SSE-потока без переделки бэка.

## 8. Что нужно сделать до кода

1. Подтвердить копирайт карточки (§3) — формулировка «Cross-document check» шире, чем «проверка
   перевода», это осознанно; если хотите сузить до перевода конкретно — скажите, поменяю h2 сайта
   и meta-описание соответственно.
2. 31 иконка сайта — заглушки (`landing/docs/ICONS.md`, Этап 1 ROADMAP ещё не закрыт); значит
   scales-иконка для этой карточки будет такой же заглушкой до реального SVG-пакета — не блокер
   для кода.
3. Дальше — либо пишу `backend/agents-demo/` (FastAPI + SSE + сценарий + кэш) и патч
   `landing/index.html`/`i18n/*.json`, либо только патч лендинга (карточка + текст) без бэкенда,
   если сначала нужен только «вид» седьмой карточки.
