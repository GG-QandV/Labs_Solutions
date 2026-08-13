# ASP-A2A gateway + два ACP-агента на хосте

Деплой-обвязка для [`GG-QandV/ASP-A2A_gateway`](https://github.com/GG-QandV/ASP-A2A_gateway) —
шлюз между **ACP-агентами** (hermes, claurst, opencode) и **A2A-клиентами**. Даёт демо-модулям
парка (в первую очередь `agents` — сверка документов, `docs/SPEC_agents_demo_v1.md`) единый
HTTP-вход к двум независимым агентам.

Код шлюза не вендорится — здесь только конфиг, юнит, установщик и роутинг.
Сам шлюз собирается из upstream-репозитория (Rust workspace: `protocol` / `core` / `gatewayd`).

## Почему на хост, а не в контейнер

`gatewayd` спавнит stdio-агентов **как дочерние процессы** — они обязаны лежать в той же
файловой системе. Контейнеризация означала бы Rust + Python (hermes) + Node в одном образе,
который пересобирается при каждом обновлении любого агента. На хосте: `systemd`-юнит для шлюза,
агенты ставятся и обновляются независимо, наружу — только один HTTP-порт через Traefik.

## Установка

```bash
sudo ./install.sh                 # или: sudo ./install.sh /path/to/ASP-A2A_gateway
systemctl restart asp-gateway
systemctl status asp-gateway
```

`install.sh` идемпотентен: проверяет `rustc >= 1.80` и dev-пакеты (`pkg-config`, `libssl-dev`,
`build-essential`), заводит пользователя `gateway`, собирает `cargo build --release --workspace`,
кладёт бинарь в `/srv/gateway/bin`, симлинкует найденные агенты, генерирует токены в
`/srv/gateway/env` (0600) и ставит юнит. `config.yaml` и `env` при повторном запуске **не
перезаписываются**.

Агенты ставятся отдельно (установщик их не тянет, только проверяет наличие):

| Агент | ACP-режим | Установка |
|---|---|---|
| hermes | `hermes acp` | `curl -fsSL https://hermes-agent.nousresearch.com/install.sh \| bash` |
| claurst | `claurst acp` | по инструкции поставщика (проверено на 0.1.7) |

ACP включается **подкомандой** `acp` — не флагом `--bare`/`--print`.

## Два агента

| id в шлюзе | Бинарь | Роль в демо `agents` |
|---|---|---|
| `hermes-main` | `hermes acp` | агент A — читает оригинал |
| `claurst-main` | `claurst acp` | агент B — читает перевод |

Взяты **разные реализации** намеренно: смысл демо в независимости извлечения, а два инстанса
одного агента с одним промптом дали бы коррелированные ошибки и обесценили сверку.

## Сеть и TLS

- `http_listen` `127.0.0.1:8348` → наружу через Traefik (`traefik-dynamic.yml`,
  `gw-labs.mnemostroma.com`). Шлюз **не терминирует TLS сам** — это его сознательное решение.
- `listen` (TCP ACP) `127.0.0.1:8347` — наружу не публикуется: токен идёт первой строкой
  открытым текстом. Доступ — локально или по SSH-туннелю.
- `public_url` в конфиге обязан совпадать с доменом Traefik: он уходит в
  `AgentCard.url` (`.well-known/agent.json`), иначе карточка невалидна по A2A-спеке.

## Как дёргать (направление 4: A2A-клиент → ACP-агент)

```bash
TOKEN=$(sudo awk -F= '/GW_TOKEN_DEMO/{print $2}' /srv/gateway/env)

curl -H "Authorization: Bearer $TOKEN" \
     https://gw-labs.mnemostroma.com/agents/hermes-main/.well-known/agent.json

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     https://gw-labs.mnemostroma.com/agents/hermes-main/rpc \
     -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","parts":[{"kind":"text","text":"..."}]}}}'
```

## Healthcheck

У шлюза **нет** `/health` (в отличие от конвенции парка для демо-сервисов). Готовый заменитель —
запрос карточки **без токена**: авторизация проверяется до спавна агента, поэтому ответ приходит
сразу и агенты не поднимаются:

```bash
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:8348/agents/x/.well-known/agent.json   # 401 = живой
```

Не использовать для healthcheck запрос **с** токеном: он вызывает `get_or_spawn_adapter` и
поднимет агента на каждой проверке.

## Ограничения upstream, важные для интеграции

Из `TECH_DEBT.md` шлюза — учитывать при написании клиента демо:

1. **Multi-turn по `contextId` в направлении 4 не работает** (impact: high). Второй
   `message/send` в ту же сессию виснет до `agent_call_timeout_secs`. Для демо `agents` это не
   блокер: сценарий односоставный — каждый агент вызывается **один раз** (извлёк условия →
   вернул JSON), арбитр сравнивает результаты. Многоходовые диалоги через шлюз сейчас строить нельзя.
2. **Стриминг в конвертерах не реализован** — `Reply::Streaming` падает в обоих направлениях
   с конвертером. SSE проходит как есть только в направлении 2 (чистый A2A reverse-proxy).
   SSE-поток самого демо (`panel:a/b/arbiter`) это не затрагивает — он живёт в бэкенде демо.
3. Хеш токена — не криптографический (`DefaultHasher`), impact low; модель угроз — сравнение
   на равенство, не подбор.
4. Перезапуск агента теряет разговоры: обращение к старому `contextId` → `-32010` / HTTP 409,
   клиент обязан начать заново.

## Ресурсы

Сам `gatewayd` лёгкий; потолок памяти в юните (`MemoryHigh=1200M` / `MemoryMax=1500M`) рассчитан
на два поднятых stdio-агента. Агенты спавнятся **лениво** — при первом обращении к их `agent_id`,
и живут до падения/перезапуска юнита. Это инфраструктура (как OpsHub и Traefik), она **вне**
правила «≤3 демо-стека в RAM» — но её потолок нужно учитывать в общем бюджете 8 GB.

## Файлы

| Файл | Назначение |
|---|---|
| `install.sh` | идемпотентная установка на хост |
| `config.yaml.example` | конфиг шлюза с двумя агентами → `/srv/gateway/config.yaml` |
| `systemd/asp-gateway.service` | юнит (явный PATH для спавна агентов, лимиты, хардненинг) |
| `traefik-dynamic.yml` | публикация 8348 наружу (file-provider, т.к. шлюз не в Docker) |
