#!/usr/bin/env bash
# Установка ASP-A2A gateway + двух ACP-агентов на хост парка.
# Идемпотентно: повторный запуск обновляет бинарь и юнит, не трогая config/env.
#
#   sudo ./install.sh [путь-к-клону-ASP-A2A_gateway]
#
# Почему на хост, а не в контейнер: gatewayd спавнит stdio-агентов
# (hermes/claurst) как ДОЧЕРНИЕ процессы — они обязаны лежать в той же
# файловой системе. Пихать их в образ шлюза = мультистек Python+Node+Rust
# в одном контейнере; на хосте это две команды и обновляется независимо.
set -euo pipefail

GW_HOME=/srv/gateway
GW_USER=gateway
REPO_URL=https://github.com/GG-QandV/ASP-A2A_gateway.git
SRC=${1:-/usr/local/src/ASP-A2A_gateway}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

log() { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[0;31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запускать через sudo"

# --- 1. Зависимости сборки -------------------------------------------------
log "проверка окружения"
command -v cargo >/dev/null || die "нет cargo. Поставить: https://rustup.rs (нужен rustc 1.80+)"
RUSTV=$(rustc --version | awk '{print $2}')
# Минимальная из пары должна быть 1.80.0 — иначе локальный toolchain старее.
[ "$(printf '%s\n1.80.0\n' "$RUSTV" | sort -V | head -1)" = "1.80.0" ] \
  || die "rustc $RUSTV < 1.80 (зависимости: openssl, native-tls)"
for p in pkg-config libssl-dev build-essential; do
  dpkg -s "$p" >/dev/null 2>&1 || die "нет пакета $p. Поставить: apt install -y pkg-config libssl-dev build-essential"
done

# --- 2. Пользователь и каталоги -------------------------------------------
id -u "$GW_USER" >/dev/null 2>&1 || { log "создаю пользователя $GW_USER"; useradd --system --home-dir "$GW_HOME" --shell /usr/sbin/nologin "$GW_USER"; }
install -d -o "$GW_USER" -g "$GW_USER" -m 0755 "$GW_HOME" "$GW_HOME/bin" "$GW_HOME/tasks" \
                                               "$GW_HOME/workspaces/hermes" "$GW_HOME/workspaces/claurst"

# --- 3. Сборка gatewayd ----------------------------------------------------
if [ -d "$SRC/.git" ]; then
  log "обновляю исходники: $SRC"; git -C "$SRC" pull --ff-only
else
  log "клонирую $REPO_URL → $SRC"; install -d "$(dirname "$SRC")"; git clone "$REPO_URL" "$SRC"
fi
# Cargo.lock намеренно не в репозитории (зависимости там понижены под старый
# компилятор) — резолвим заново под локальный toolchain.
log "cargo build --release --workspace"
( cd "$SRC" && cargo build --release --workspace )
install -o "$GW_USER" -g "$GW_USER" -m 0755 "$SRC/target/release/gatewayd" "$GW_HOME/bin/gatewayd"

# --- 4. Два агента ---------------------------------------------------------
# ACP-режим включается ПОДКОМАНДОЙ `acp`, не флагом (проверено на живых бинарях).
missing=0
for a in hermes claurst; do
  if p=$(command -v "$a" 2>/dev/null); then
    ln -sfn "$p" "$GW_HOME/bin/$a"; log "агент $a → $p"
  else
    printf '\033[0;33m!\033[0m агент %s не найден в PATH\n' "$a"; missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  cat <<'EOF'

Поставить недостающих агентов и повторить запуск:
  hermes : curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
  claurst: по инструкции поставщика (нужна подкоманда `claurst acp`, проверено на 0.1.7)
Бинарь должен быть виден в PATH root'а — install.sh симлинкует его в /srv/gateway/bin,
откуда его берёт systemd-юнит (его PATH задан явно).
EOF
fi

# --- 5. Конфиг и секреты (не перезаписываются) -----------------------------
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

# --- 6. systemd ------------------------------------------------------------
install -m 0644 "$HERE/systemd/asp-gateway.service" /etc/systemd/system/asp-gateway.service
systemctl daemon-reload
systemctl enable asp-gateway.service
log "готово. Запуск: systemctl restart asp-gateway && systemctl status asp-gateway"
log "проверка: curl -so /dev/null -w '%{http_code}\\n' http://127.0.0.1:8348/agents/x/.well-known/agent.json  # ожидается 401"
