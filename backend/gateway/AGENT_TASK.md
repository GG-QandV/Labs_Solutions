# Задание агенту: установить ASP-A2A шлюз и двух ACP-агентов на хост

Исполнителю: работать по шагам, **после каждого шага выполнять блок «Проверка»**.
Не переходить к следующему шагу, если проверка не прошла. Не импровизировать с
командами установки — если шаг падает, остановиться и отчитаться (формат в конце).

**Цель:** на VPS парка поднят `asp-gateway.service`, который по HTTPS отдаёт двух
независимых ACP-агентов (`hermes-a`, `hermes-b`) демо-модулю `agents`.

**Вход:** архив `asp-gateway-deploy.zip` (исходники шлюза + деплой-кит).
**Доступ:** root/sudo на хосте, работающий Traefik парка.

---

## Шаг 0. Преконтроль

```bash
cat /etc/os-release | head -2
rustc --version || echo "НЕТ RUST"
free -m | head -2
df -h / | tail -1
docker ps --format '{{.Names}}' | head
```

**Проверка.** Нужно: Ubuntu 24.04, `rustc >= 1.80`, свободной RAM ≥ 2 GB, диска ≥ 5 GB,
в списке контейнеров виден Traefik.

**Если нет Rust:**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env" && rustc --version
```

**Если `rustc` старее 1.80** — `rustup update stable`. Ставить старый шлюз на старом
компиляторе не пытаться: зависимости требуют 1.80+.

Системные пакеты:
```bash
apt-get update && apt-get install -y pkg-config libssl-dev build-essential curl git unzip
```

---

## Шаг 1. Распаковать бандл

```bash
mkdir -p /opt/asp && cd /opt/asp
unzip -o ~/asp-gateway-deploy.zip
cd asp-gateway-deploy
ls
```

**Проверка.** Видны `INSTALL.md`, `deploy/`, `ASP-A2A_gateway/`.
`ASP-A2A_gateway/Cargo.toml` существует — иначе бандл битый, остановиться.

---

## Шаг 2. Установка шлюза (без агентов)

Ставим сначала **только шлюз** — чтобы отделить ошибки сборки Rust от ошибок установки агентов.

```bash
sudo SKIP_AGENTS=1 ./deploy/install.sh
```

Сборка занимает несколько минут (`cargo build --release`).

**Проверка.**
```bash
ls -l /srv/gateway/bin/gatewayd          # бинарь на месте
ls -l /srv/gateway/config.yaml           # конфиг создан
sudo stat -c '%a %U' /srv/gateway/env    # должно быть: 600 gateway
systemctl is-enabled asp-gateway         # enabled
```

**Стоп-условие.** Если `cargo build` упал — не чинить исходники руками. Сохранить
последние 30 строк вывода и отчитаться.

---

## Шаг 3. Домен и `public_url`

Открыть `/srv/gateway/config.yaml`, привести `public_url` к реальному домену шлюза
(по умолчанию `https://gw-labs.mnemostroma.com`).

> Это не косметика: `public_url` уходит в `AgentCard.url` (`.well-known/agent.json`).
> Если он не совпадает с доменом Traefik, карточка невалидна по A2A-спеке и A2A-клиенты
> будут ходить не туда.

**Проверка.** `grep public_url /srv/gateway/config.yaml` — домен совпадает с тем, что
будет в Traefik-роутере (шаг 6). DNS A-запись на этот домен существует.

---

## Шаг 4. Установка агентов

```bash
sudo ./deploy/install-agents.sh
```

Скрипт ставит `hermes` официальным установщиком **от пользователя `gateway`** (не от root)
и создаёт два изолированных `HOME`.

**Проверка.**
```bash
ls -l /srv/gateway/bin/hermes                       # симлинк на бинарь
ls -ld /srv/gateway/workspaces/hermes-a /srv/gateway/workspaces/hermes-b
sudo -u gateway /srv/gateway/bin/hermes --version || true
```

**Если установщик hermes упал** — повторить один раз (сетевая флуктуация). Если падает
снова, отчитаться с выводом; **не** ставить hermes от root и не менять владельца `/srv/gateway`.

`claurst` не ставится автоматически (дистрибутив не публичный). Если бинарь есть:
```bash
sudo CLAURST_BIN=/путь/к/claurst ./deploy/install-agents.sh
# затем раскомментировать блок claurst-main в /srv/gateway/config.yaml
```

---

## Шаг 5. Разные модели агентам — обязательный шаг

Два агента существуют ради **независимости** извлечения. Если у обоих одна модель и один
промпт, они ошибаются одинаково и сверка документов теряет смысл. Задать **разные**
провайдер/модель:

```bash
sudo -u gateway env HOME=/srv/gateway/workspaces/hermes-a /srv/gateway/bin/hermes model
sudo -u gateway env HOME=/srv/gateway/workspaces/hermes-b /srv/gateway/bin/hermes model
```

Ключи вводятся внутри каждого `HOME` и попадают в `$HOME/.hermes` — **не** в общий
`/srv/gateway/env` и **не** в `config.yaml`.

**Проверка.** Конфиги разошлись и модели различаются:
```bash
sudo -u gateway diff -q /srv/gateway/workspaces/hermes-a/.hermes/config.yaml \
                        /srv/gateway/workspaces/hermes-b/.hermes/config.yaml \
  && echo "ВНИМАНИЕ: конфиги идентичны — модели не разведены"
```
(Путь к конфигу может отличаться в версии hermes — тогда сверить вывод `hermes model`
в каждом `HOME` глазами.)

---

## Шаг 6. Публикация через Traefik

Шлюз живёт на хосте, а не в Docker, поэтому docker-labels неприменимы — нужен file-provider.

```bash
sudo cp deploy/traefik-dynamic.yml /srv/traefik/dynamic/asp-gateway.yml
```

Проверить в файле:
- `Host(...)` совпадает с `public_url` из шага 3;
- адрес бэкенда — реальный адрес хоста со стороны контейнера Traefik:
  ```bash
  ip -4 addr show docker0 | awk '/inet /{print $2}'   # обычно 172.17.0.1/16
  ```
  Если каталог dynamic-конфигов другой — положить туда, где у Traefik `providers.file`.

**Проверка.** В логах Traefik нет ошибок парсинга, роутер появился:
```bash
docker logs --tail 30 <traefik-container> | grep -i -E "error|asp"
```

---

## Шаг 7. Запуск и проверка живости

```bash
sudo systemctl restart asp-gateway
sudo systemctl status asp-gateway --no-pager
```

**Проверка 1 — процесс жив:**
```bash
curl -so /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:8348/agents/x/.well-known/agent.json    # ожидается 401
```
`401` = HTTP-транспорт поднят. Токен здесь **не передавать**: запрос с токеном вызывает
спавн агента, для healthcheck это недопустимо.

**Проверка 2 — агенты реально поднимаются** (это уже спавнит агента, дольше):
```bash
TOKEN=$(sudo awk -F= '/GW_TOKEN_DEMO/{print $2}' /srv/gateway/env)
for a in hermes-a hermes-b; do
  echo -n "$a: "
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:8348/agents/$a/.well-known/agent.json"
done
```
Ожидается `200` для обоих. `503` = агент настроен, но не поднимается (смотреть
`journalctl -u asp-gateway -n 50`). `404` = опечатка в `agent_id`.

**Проверка 3 — снаружи по HTTPS:**
```bash
curl -so /dev/null -w '%{http_code}\n' https://<домен>/agents/x/.well-known/agent.json   # 401
```

---

## Чего делать нельзя

- **Не публиковать TCP-порт 8347 наружу.** Шлюз не терминирует TLS, токен идёт первой
  строкой открытым текстом. Только `127.0.0.1` / SSH-туннель.
- **Не менять `listen`/`http_listen` на `0.0.0.0`**, если порт не закрыт файрволом.
- **Не класть ключи LLM** в `/srv/gateway/env` или `config.yaml` — их место в
  `$HOME/.hermes` конкретного агента.
- **Не использовать healthcheck с токеном** — он поднимает агента на каждой проверке.
- **Не строить многоходовые диалоги** через `contextId`: в upstream направление 4
  (A2A→ACP) на втором `message/send` виснет до таймаута. Каждый запрос — новая сессия.

---

## Отчёт по завершении

1. Версии: `rustc --version`, `hermes --version`, коммит шлюза (`git -C <src> rev-parse --short HEAD` или «из бандла»).
2. Результаты проверок шага 7 (три кода ответа).
3. Какие модели заданы `hermes-a` и `hermes-b` (только названия, **без ключей**).
4. Подключён ли `claurst` (да/нет).
5. `systemctl is-active asp-gateway` и последние 20 строк `journalctl -u asp-gateway`.
6. Любой шаг, который пришлось выполнить иначе, чем написано, — с указанием причины.

Подробности по архитектуре и ограничениям — `deploy/README.md`.
