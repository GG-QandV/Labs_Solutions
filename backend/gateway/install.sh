#!/usr/bin/env bash
# Установка ACP-A2A шлюза и агентов из ГОТОВЫХ бинарников.
# Ничего не собирает и не качает: кладёт бинари, конфиг, юнит.
#
#   sudo ./install.sh
#
# Бинари положить рядом со скриптом в bin/ (см. bin/README.md):
#   bin/gatewayd   — обязательно
#   bin/hermes     — агент (обязателен хотя бы один)
#   bin/claurst    — опционально
set -euo pipefail

GW_HOME=/srv/gateway
GW_USER=gateway
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC_BIN=${BIN_DIR:-$HERE/bin}

log()  { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запускать через sudo"
[ -x "$SRC_BIN/gatewayd" ] || die "нет $SRC_BIN/gatewayd (или он не исполняемый). Положи бинарь в bin/"

# --- 1. Бинари запускаются на этом хосте? ---------------------------------
# Единственный реальный риск при переносе готовых бинарников: чужая архитектура
# или более новый glibc на машине сборки. Проверяем сразу, а не после установки.
log "проверка бинарников"
HOST_ARCH=$(uname -m)
for b in "$SRC_BIN"/*; do
  [ -f "$b" ] && [ -x "$b" ] || continue
  n=$(basename "$b")
  if file -b "$b" | grep -q 'ELF'; then
    a=$(file -b "$b" | grep -o 'x86-64\|aarch64\|ARM aarch64' | head -1)
    case "$HOST_ARCH:$a" in
      x86_64:x86-64|aarch64:aarch64|aarch64:"ARM aarch64") : ;;
      *) die "$n собран под '$a', хост — $HOST_ARCH" ;;
    esac
    if ldd "$b" 2>&1 | grep -q 'not found\|GLIBC_.* not found'; then
      ldd "$b" 2>&1 | grep 'not found' | sed 's/^/    /'
      die "$n требует библиотек, которых нет на хосте (собери статически или на этой же ОС)"
    fi
  fi
  log "  $n — ок"
done

# --- 2. Пользователь и каталоги -------------------------------------------
id -u "$GW_USER" >/dev/null 2>&1 || { log "создаю пользователя $GW_USER"; useradd --system --home-dir "$GW_HOME" --shell /usr/sbin/nologin "$GW_USER"; }
install -d -o "$GW_USER" -g "$GW_USER" -m 0755 "$GW_HOME" "$GW_HOME/bin" "$GW_HOME/tasks"
install -d -o "$GW_USER" -g "$GW_USER" -m 0700 "$GW_HOME/workspaces/claurst-a" "$GW_HOME/workspaces/claurst-b"

# --- 3. Копирование бинарников --------------------------------------------
agents=0
for b in "$SRC_BIN"/*; do
  [ -f "$b" ] && [ -x "$b" ] || continue
  n=$(basename "$b"); [ "$n" = "README.md" ] && continue
  install -o "$GW_USER" -g "$GW_USER" -m 0755 "$b" "$GW_HOME/bin/$n"
  log "$n → $GW_HOME/bin/$n"
  [ "$n" != "gatewayd" ] && agents=$((agents+1))
done
[ "$agents" -gt 0 ] || die "в bin/ нет ни одного агента (нужен claurst и/или hermes)"
[ -x "$GW_HOME/bin/claurst" ] && install -d -o "$GW_USER" -g "$GW_USER" -m 0700 "$GW_HOME/workspaces/claurst"

# --- 4. Конфиг и токены (не перезаписываются) ------------------------------
if [ ! -f "$GW_HOME/config.yaml" ]; then
  install -o "$GW_USER" -g "$GW_USER" -m 0644 "$HERE/config.yaml.example" "$GW_HOME/config.yaml"
  log "создан $GW_HOME/config.yaml — проверить public_url"
else
  log "config.yaml на месте, не трогаю"
fi
if [ ! -f "$GW_HOME/env" ]; then
  umask 077
  { echo "GW_TOKEN_MAIN=$(openssl rand -hex 24)"
    echo "GW_TOKEN_DEMO=$(openssl rand -hex 24)"; } > "$GW_HOME/env"
  chown "$GW_USER:$GW_USER" "$GW_HOME/env"; chmod 0600 "$GW_HOME/env"
  log "сгенерированы токены в $GW_HOME/env (0600)"
else
  log "env на месте, токены не перегенерирую"
fi

# --- 5. systemd ------------------------------------------------------------
install -m 0644 "$HERE/systemd/acp-gateway.service" /etc/systemd/system/acp-gateway.service
systemctl daemon-reload
systemctl enable acp-gateway.service
log "готово"

cat <<EOF

Дальше:
  1. Проверить public_url в $GW_HOME/config.yaml (должен совпасть с доменом Traefik).
  2. Задать РАЗНЫЕ модели агентам (иначе смысл двух агентов теряется):
       sudo -u $GW_USER env HOME=$GW_HOME/workspaces/claurst-a $GW_HOME/bin/claurst /model
       sudo -u $GW_USER env HOME=$GW_HOME/workspaces/claurst-b $GW_HOME/bin/claurst /model
  3. systemctl restart acp-gateway
  4. curl -so /dev/null -w '%{http_code}\\n' \\
       http://127.0.0.1:8348/agents/x/.well-known/agent.json     # 401 = живой
EOF
