#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export BONECO_GAME_DIR="${BONECO_GAME_DIR:-$PWD}"
ARGS=(--app-dir src boneco_game.main:app --host "${BONECO_GAME_HOST:-127.0.0.1}" --port "${BONECO_GAME_PORT:-9292}")
if [[ "${BONECO_GAME_RELOAD:-0}" == "1" ]]; then
  ARGS+=(--reload)
fi
exec .venv/bin/python -m uvicorn "${ARGS[@]}"
