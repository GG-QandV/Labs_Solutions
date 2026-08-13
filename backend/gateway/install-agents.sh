#!/usr/bin/env bash
# Установка ACP-агентов на хост для ASP-A2A шлюза.
# Вызывается из install.sh, но работает и отдельно:
#
#   sudo ./install-agents.sh
#   sudo CLAURST_BIN=/opt/claurst/claurst ./install-agents.sh   # + claurst, если есть
#
# Ставит ДВА независимых инстанса hermes (agent A и agent B). Независимость —
# на уровне модели: у каждого свой HOME → свой ~/.hermes → свой провайдер и
# модель. Два агента на ОДНОЙ модели с одним промптом дают коррелированные
# ошибки и обесценивают сверку документов, ради которой демо и делается.
#
# claurst не ставится автоматически: его дистрибутив не публичный, в репозитории
# шлюза только пометка «проверено на 0.1.7». Передай путь к бинарю в CLAURST_BIN —
# скрипт подключит его третьим агентом.
set -euo pipefail

GW_HOME=/srv/gateway
GW_USER=gateway
AGENT_HOMES=("$GW_HOME/workspaces/hermes-a" "$GW_HOME/workspaces/hermes-b")
HERMES_INSTALLER=https://hermes-agent.nousresearch.com/install.sh

log()  { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запускать через sudo"
id -u "$GW_USER" >/dev/null 2>&1 || die "нет пользователя $GW_USER — сначала ./install.sh"

# --- 1. Зависимости установщика hermes ------------------------------------
# Он тянет uv, Python 3.11, Node.js, ripgrep, ffmpeg сам, но curl/git нужны до него.
for c in curl git; do command -v "$c" >/dev/null || die "нет $c: apt install -y curl git"; done

# --- 2. hermes (общий бинарь) ---------------------------------------------
if command -v hermes >/dev/null 2>&1 || [ -x "$GW_HOME/.local/bin/hermes" ]; then
  log "hermes уже установлен, пропускаю загрузку"
else
  log "ставлю hermes официальным установщиком (от пользователя $GW_USER)"
  # Установщик пишет в $HOME пользователя, поэтому запускаем от gateway, не от root.
  runuser -u "$GW_USER" -- env HOME="$GW_HOME" bash -c \
    "curl -fsSL $HERMES_INSTALLER | bash" \
    || die "установщик hermes завершился с ошибкой (см. вывод выше)"
fi

# Найти бинарь и положить симлинк туда, откуда его берёт systemd-юнит.
HERMES_BIN=$(command -v hermes 2>/dev/null || true)
[ -n "$HERMES_BIN" ] || for p in "$GW_HOME/.local/bin/hermes" "$GW_HOME/.hermes/bin/hermes"; do
  [ -x "$p" ] && HERMES_BIN=$p && break
done
[ -n "$HERMES_BIN" ] || die "hermes установлен, но бинарь не найден — проверь $GW_HOME/.local/bin"
install -d -o "$GW_USER" -g "$GW_USER" -m 0755 "$GW_HOME/bin"
ln -sfn "$HERMES_BIN" "$GW_HOME/bin/hermes"
log "hermes → $HERMES_BIN"

# --- 3. Два изолированных HOME для агентов A и B --------------------------
# gatewayd спавнит агента с env.HOME из config.yaml; hermes держит конфиг,
# ключи и состояние в $HOME/.hermes, поэтому разные HOME = разные модели.
for h in "${AGENT_HOMES[@]}"; do
  install -d -o "$GW_USER" -g "$GW_USER" -m 0700 "$h" "$h/.hermes"
  log "агент-хоум: $h"
done

# --- 4. claurst (опционально) ---------------------------------------------
if [ -n "${CLAURST_BIN:-}" ]; then
  [ -x "$CLAURST_BIN" ] || die "CLAURST_BIN=$CLAURST_BIN — не исполняемый файл"
  ln -sfn "$CLAURST_BIN" "$GW_HOME/bin/claurst"
  install -d -o "$GW_USER" -g "$GW_USER" -m 0700 "$GW_HOME/workspaces/claurst"
  log "claurst → $CLAURST_BIN (раскомментируй claurst-main в config.yaml)"
else
  warn "claurst не подключён (CLAURST_BIN не задан) — работают два инстанса hermes"
fi

chown -R "$GW_USER:$GW_USER" "$GW_HOME/bin" "$GW_HOME/workspaces"

# --- 5. Что осталось сделать руками ---------------------------------------
cat <<EOF

Агенты установлены. Осталось задать РАЗНЫЕ модели (в этом смысл двух агентов):

  sudo -u $GW_USER env HOME=${AGENT_HOMES[0]} $GW_HOME/bin/hermes model
  sudo -u $GW_USER env HOME=${AGENT_HOMES[1]} $GW_HOME/bin/hermes model

Провайдер задаётся там же; ключи кладутся в \$HOME/.hermes каждого агента и в
общий /srv/gateway/env НЕ попадают. Проверка, что ACP-режим поднимается:

  sudo -u $GW_USER env HOME=${AGENT_HOMES[0]} $GW_HOME/bin/hermes acp </dev/null

(ACP включается подкомандой \`acp\`; ждёт JSON-RPC построчно — пустой stdin
завершит процесс без ошибки. Падение здесь = агент не готов, шлюз его тоже не поднимет.)

Затем: systemctl restart asp-gateway
EOF
