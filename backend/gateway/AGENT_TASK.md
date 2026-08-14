# Задание агенту: поставить ASP-A2A шлюз и агентов на хост из готовых бинарников

Ничего не собирать и не компилировать на хосте. Бинари собраны локально и лежат в `bin/`.
Задача — разложить, настроить, проверить.

**Результат:** `asp-gateway.service` поднят, по HTTPS отдаёт двух независимых
ACP-агентов (`hermes-a`, `hermes-b`) для демо-модуля `agents`.

---

## 0. Подготовить бинари

Положить в `deploy/bin/` рядом с `install.sh`:

| Файл | Обязателен |
|---|---|
| `gatewayd` | да |
| `hermes` | да (хотя бы один агент) |
| `claurst` | нет |

```bash
chmod +x deploy/bin/*
```

**Требование:** бинари собраны под архитектуру хоста (обычно `x86_64` Linux). `install.sh`
проверит это сам и остановится, если не совпадает.

---

## 1. Установка

```bash
sudo ./deploy/install.sh
```

Скрипт: проверяет бинари (архитектура + `ldd`), заводит пользователя `gateway`, копирует
бинари в `/srv/gateway/bin`, создаёт каталоги и два `HOME` для агентов, кладёт
`config.yaml`, генерирует токены в `/srv/gateway/env` (0600), ставит systemd-юнит.
Повторный запуск не перезаписывает `config.yaml` и `env`.

**Проверка:**
```bash
ls -l /srv/gateway/bin/                    # gatewayd + агенты
sudo stat -c '%a %U' /srv/gateway/env      # 600 gateway
systemctl is-enabled asp-gateway           # enabled
```

**Если install.sh упал на проверке бинарника** (чужая архитектура или нехватка библиотек) —
не подменять библиотеки на хосте и не ставить компилятор. Пересобрать бинарь на машине с
той же ОС либо статически (musl) и повторить.

---

## 2. Домен

В `/srv/gateway/config.yaml` привести `public_url` к реальному домену шлюза.

> Не косметика: `public_url` уходит в `AgentCard.url` (`.well-known/agent.json`). Не совпадёт
> с доменом Traefik — карточка невалидна по A2A-спеке, клиенты пойдут не туда.

**Проверка:** `grep public_url /srv/gateway/config.yaml`, DNS-запись на этот домен есть.

---

## 3. Разные модели агентам — обязательно

Два агента нужны ради **независимости** извлечения. Одна модель и один промпт на обоих =
одинаковые ошибки, сверка документов теряет смысл.

```bash
sudo -u gateway env HOME=/srv/gateway/workspaces/hermes-a /srv/gateway/bin/hermes model
sudo -u gateway env HOME=/srv/gateway/workspaces/hermes-b /srv/gateway/bin/hermes model
```

Ключи вводятся внутри каждого `HOME` и остаются в `$HOME/.hermes` — **не** в общий
`/srv/gateway/env` и **не** в `config.yaml`.

**Проверка:** в выводе `hermes model` для `hermes-a` и `hermes-b` разные модели/провайдеры.

---

## 4. Публикация через Traefik

Шлюз на хосте, а не в Docker — labels неприменимы, нужен file-provider:

```bash
sudo cp deploy/traefik-dynamic.yml /srv/traefik/dynamic/asp-gateway.yml
```

Сверить в файле: `Host(...)` = `public_url` из шага 2; адрес бэкенда — реальный адрес хоста
со стороны Traefik (шлюз должен слушать адрес хоста в docker-сети `web`, где сидит Traefik):
```bash
ip -4 addr show | grep -E '172\.18'   # адрес хоста в сети web, обычно 172.18.0.1
```

**Проверка:** в логах Traefik нет ошибок парсинга конфига.

---

## 5. Запуск и проверка

```bash
sudo systemctl restart asp-gateway
sudo systemctl status asp-gateway --no-pager
```

**5.1 — шлюз жив** (агентов не поднимает, годится для мониторинга):
```bash
curl -so /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:8348/agents/x/.well-known/agent.json    # ожидается 401
```

**5.2 — агенты реально стартуют** (это спавнит агента, выполняется один раз, не в мониторинге):
```bash
TOKEN=$(sudo awk -F= '/GW_TOKEN_DEMO/{print $2}' /srv/gateway/env)
for a in hermes-a hermes-b; do
  echo -n "$a: "
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:8348/agents/$a/.well-known/agent.json"
done
```
Ожидается `200` у обоих. `503` — агент настроен, но не поднимается (`journalctl -u asp-gateway -n 50`).
`404` — опечатка в `agent_id` в конфиге.

**5.3 — снаружи:**
```bash
curl -so /dev/null -w '%{http_code}\n' https://<домен>/agents/x/.well-known/agent.json   # 401
```

---

## Чего делать нельзя

- **Не публиковать TCP 8347 наружу** — шлюз не терминирует TLS, токен идёт первой строкой
  открытым текстом. Только `127.0.0.1` / SSH-туннель.
- **Не класть ключи LLM** в `/srv/gateway/env` или `config.yaml` — их место в `$HOME/.hermes` агента.
- **Не ставить healthcheck с токеном** — он спавнит агента на каждой проверке. Для мониторинга только 5.1.
- **Не строить multi-turn по `contextId`** — в upstream направление A2A→ACP виснет на втором
  `message/send`. Каждый запрос — новая сессия (для сверки документов этого достаточно).

---

## Отчёт

1. Версии бинарников (`gatewayd --version` / `hermes --version`, если поддерживается) и откуда взяты.
2. Коды ответов из 5.1, 5.2, 5.3.
3. Модели `hermes-a` и `hermes-b` — только названия, **без ключей**.
4. Подключён ли `claurst`.
5. `systemctl is-active asp-gateway` + последние 20 строк `journalctl -u asp-gateway`.
6. Что пришлось сделать иначе и почему.

Детали архитектуры и ограничений — `deploy/README.md`.
