#!/usr/bin/env bash
set -uo pipefail

PROJECT_DIR="${BONECO_GAME_DIR:-/media/allana/Dados240/BONECO_GAME}"
PANEL_URL="${BONECO_GAME_PANEL_URL:-http://127.0.0.1:9292}"
USERNAME="${BONECO_GAME_TIKTOK_USER:-bonecodoabismo}"
SERVER_URL="${BONECO_GAME_MONITOR_SERVER:-http://127.0.0.1:2618}"
INTERVAL="${BONECO_GAME_MONITOR_WATCH_INTERVAL:-15}"
LOG_FILE="$PROJECT_DIR/runs/logs/monitor-watchdog.log"

mkdir -p "$(dirname "$LOG_FILE")"

while true; do
  snapshot="$(
    curl -fsS "$PANEL_URL/api/status" 2>/dev/null \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); l=d.get("live") or {}; m=d.get("monitor") or {}; print(int(bool(l.get("running"))), int(bool(m.get("running"))), int(bool(m.get("listening"))), int(bool(m.get("thread_alive"))))' \
      2>/dev/null || true
  )"
  values=(${snapshot:-0 0 0 0})
  live_running="${values[0]:-0}"
  monitor_running="${values[1]:-0}"
  listening="${values[2]:-0}"
  thread_alive="${values[3]:-0}"
  if [[ "$live_running" == "1" && ( "$monitor_running" != "1" || "$listening" != "1" || "$thread_alive" != "1" ) ]]; then
    printf '%s restart monitor live=%s running=%s listening=%s thread=%s\n' "$(date '+%F %T')" "$live_running" "$monitor_running" "$listening" "$thread_alive" >> "$LOG_FILE"
    curl -fsS -X POST "$PANEL_URL/api/monitor/start" \
      -H 'Content-Type: application/json' \
      --data "{\"username\":\"$USERNAME\",\"server_url\":\"$SERVER_URL\"}" >/dev/null 2>&1 || true
  fi
  sleep "$INTERVAL"
done
