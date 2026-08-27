#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f runs/dev.pid ]]; then
  PID="$(cat runs/dev.pid || true)"
  if [[ -n "${PID}" ]] && kill -0 "${PID}" 2>/dev/null; then
    kill "${PID}" 2>/dev/null || true
  fi
fi
pkill -f "[b]oneco_game.main:app" 2>/dev/null || true
