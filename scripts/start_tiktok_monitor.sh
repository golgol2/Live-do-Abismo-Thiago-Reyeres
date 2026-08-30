#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${BONECO_GAME_DIR:-/media/allana/Dados240/BONECO_GAME}"
MONITOR_DIR="$PROJECT_DIR/external/tiktok-live-monitoring-server"
PORT="${TIKTOK_MONITOR_PORT:-2618}"
LOG_DIR="$PROJECT_DIR/runs/logs"
LOG_FILE="$LOG_DIR/tiktok-live-monitor.log"
LOCK_FILE="$PROJECT_DIR/runs/tiktok-live-monitor.lock"
NETWORK_FILE="$PROJECT_DIR/runs/monitor_network.json"
TOR_HOST="${TOR_HOST:-127.0.0.1}"
TOR_SOCKS_PORT="${TOR_SOCKS_PORT:-9050}"

mkdir -p "$LOG_DIR" "$(dirname "$LOCK_FILE")"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    exit 0
  fi
fi

write_network_state() {
  local mode="$1"
  local detail="$2"
  python3 - "$NETWORK_FILE" "$mode" "$detail" <<'PY'
import json
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({
    "mode": sys.argv[2],
    "detail": sys.argv[3],
    "forced": True,
    "updated_at": time.time(),
}, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

port_listening() {
  ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"
}

if port_listening; then
  write_network_state "active" "monitor ja ativo na porta $PORT"
  exit 0
fi

if [[ ! -d "$MONITOR_DIR" ]]; then
  echo "Monitor do TikTok nao encontrado em $MONITOR_DIR" >&2
  write_network_state "missing" "monitor node nao encontrado"
  exit 1
fi

if ! command -v torsocks >/dev/null 2>&1; then
  echo "torsocks nao encontrado; rede direta bloqueada" >&2
  write_network_state "tor_failed" "torsocks nao encontrado"
  exit 2
fi

if ! ss -ltn "( sport = :$TOR_SOCKS_PORT )" | grep -q ":$TOR_SOCKS_PORT"; then
  echo "Tor SOCKS nao esta ouvindo em $TOR_HOST:$TOR_SOCKS_PORT" >&2
  write_network_state "tor_failed" "tor nao esta ouvindo em $TOR_HOST:$TOR_SOCKS_PORT"
  exit 2
fi

cd "$MONITOR_DIR"
if [[ ! -d node_modules ]]; then
  npm install
fi

if torsocks -a "$TOR_HOST" -P "$TOR_SOCKS_PORT" getent hosts www.tiktok.com >/dev/null 2>&1; then
  echo "Iniciando TikTok monitor via Tor $TOR_HOST:$TOR_SOCKS_PORT" >>"$LOG_FILE"
  write_network_state "tor" "monitor iniciado via Tor SOCKS $TOR_HOST:$TOR_SOCKS_PORT"
  (
    exec 9>&- || true
    setsid -f env TORSOCKS_ALLOW_INBOUND=1 torsocks -a "$TOR_HOST" -P "$TOR_SOCKS_PORT" node server.js >>"$LOG_FILE" 2>&1 </dev/null
  )
else
  echo "Tor SOCKS ativo, mas DNS do TikTok falhou; iniciando monitor em rede direta" >>"$LOG_FILE"
  write_network_state "direct" "fallback direto: Tor ativo, mas DNS do TikTok falhou"
  (
    exec 9>&- || true
    setsid -f env TIKTOK_MONITOR_PORT="$PORT" BONECO_GAME_DIR="$PROJECT_DIR" node server.js >>"$LOG_FILE" 2>&1 </dev/null
  )
fi

sleep 2
if port_listening; then
  exit 0
fi

write_network_state "failed" "monitor nao abriu na porta $PORT"
echo "Monitor nao abriu na porta $PORT" >>"$LOG_FILE"
exit 1
