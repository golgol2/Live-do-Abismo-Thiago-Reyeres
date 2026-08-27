#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${BONECO_GAME_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
HOST="${BONECO_GAME_HOST:-127.0.0.1}"
PORT="${BONECO_GAME_PORT:-9292}"
MONITOR_PORT="${TIKTOK_MONITOR_PORT:-2618}"
LOG_DIR="$PROJECT_DIR/runs/logs"
LOG_FILE="$LOG_DIR/start_clean_panel.log"
URL="http://${HOST}:${PORT}/"

mkdir -p "$LOG_DIR" "$PROJECT_DIR/runs"
cd "$PROJECT_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG_FILE"
}

kill_pid() {
  local pid="${1:-0}"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  (( pid > 1 )) || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  fi
}

kill_pid_hard() {
  local pid="${1:-0}"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 0
  (( pid > 1 )) || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
}

json_pid() {
  local file="$1"
  local key="$2"
  "$PYTHON_BIN" - "$file" "$key" <<'PY' 2>/dev/null || true
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
try:
    data = json.loads(path.read_text())
except Exception:
    data = {}
value = data.get(key, 0) if isinstance(data, dict) else 0
print(int(value or 0))
PY
}

kill_pattern() {
  local pattern="$1"
  pkill -TERM -f "$pattern" 2>/dev/null || true
}

kill_pattern_hard() {
  local pattern="$1"
  pkill -KILL -f "$pattern" 2>/dev/null || true
}

kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -TERM "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN | xargs -r kill -TERM >/dev/null 2>&1 || true
  fi
}

kill_port_hard() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k -KILL "${port}/tcp" >/dev/null 2>&1 || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN | xargs -r kill -KILL >/dev/null 2>&1 || true
  fi
}

if [[ ! -x "$PYTHON_BIN" ]]; then
  log "Erro: venv propria nao encontrada em $PYTHON_BIN"
  log "Rode: python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt"
  exit 1
fi

export PYTHONPATH="$PROJECT_DIR/src"
export BONECO_GAME_DIR="$PROJECT_DIR"
export TIKTOK_MONITOR_PORT="$MONITOR_PORT"
export NUMBA_CACHE_DIR="$PROJECT_DIR/runs/numba_cache"
export MPLCONFIGDIR="$PROJECT_DIR/runs/matplotlib"
mkdir -p "$NUMBA_CACHE_DIR" "$MPLCONFIGDIR"

log "Inicializacao limpa solicitada."
log "Finalizando processos antigos do Boneco Game."

if [[ -f runs/dev.pid ]]; then
  kill_pid "$(cat runs/dev.pid 2>/dev/null || echo 0)"
fi
kill_pid "$(json_pid runs/renderer_window.json pid)"
kill_pid "$(json_pid runs/transmission_status.json pid)"
kill_pid "$(json_pid runs/transmission_status.json virtual_pid)"

kill_pattern "$PROJECT_DIR/.venv/bin/python -m uvicorn boneco_game.main:app"
kill_pattern "$PROJECT_DIR/scripts/gst_html_capture_pipeline.py"
kill_pattern "$PROJECT_DIR/runs/chrome_renderer_profile"
kill_pattern "BONECO_GAME_DIR=$PROJECT_DIR"
kill_pattern "boneco-game-tiktok-monitor"
kill_pattern "$PROJECT_DIR/external/tiktok-live-monitoring-server"
kill_port "$PORT"
kill_port "$MONITOR_PORT"

sleep 1.5

if [[ -f runs/dev.pid ]]; then
  kill_pid_hard "$(cat runs/dev.pid 2>/dev/null || echo 0)"
fi
kill_pid_hard "$(json_pid runs/renderer_window.json pid)"
kill_pid_hard "$(json_pid runs/transmission_status.json pid)"
kill_pid_hard "$(json_pid runs/transmission_status.json virtual_pid)"
kill_pattern_hard "$PROJECT_DIR/.venv/bin/python -m uvicorn boneco_game.main:app"
kill_pattern_hard "$PROJECT_DIR/scripts/gst_html_capture_pipeline.py"
kill_pattern_hard "$PROJECT_DIR/runs/chrome_renderer_profile"
kill_pattern_hard "$PROJECT_DIR/external/tiktok-live-monitoring-server"
kill_port_hard "$PORT"
kill_port_hard "$MONITOR_PORT"

find "$PROJECT_DIR/runs" -maxdepth 1 -name '*.pid' -type f -delete 2>/dev/null || true

log "Processos antigos finalizados. Iniciando painel em $URL"
echo "$$" > "$PROJECT_DIR/runs/dev.pid"

(
  for _ in $(seq 1 25); do
    if curl -fsS "http://${HOST}:${PORT}/api/status" >/dev/null 2>&1; then
      xdg-open "$URL" >/dev/null 2>&1 || true
      exit 0
    fi
    sleep 1
  done
) &

exec "$PYTHON_BIN" -m uvicorn boneco_game.main:app --host "$HOST" --port "$PORT"
