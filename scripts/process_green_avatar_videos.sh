#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/media/allana/Dados240/BONECO_GAME"
AVATAR="${1:-BONECO_MAPA_2D}"
FORCE="${FORCE:-0}"
PYTHON_BIN="$PROJECT_DIR/.venv/bin/python"
PROCESSOR="$PROJECT_DIR/scripts/process_walk_chromakey.py"
LOG_FILE="$PROJECT_DIR/runs/logs/process_green_avatar_videos.log"

mkdir -p "$PROJECT_DIR/runs/logs"
cd "$PROJECT_DIR"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "venv nao encontrada: $PYTHON_BIN" | tee -a "$LOG_FILE"
  exit 1
fi

process_mode() {
  local mode="$1"
  local source_dir="$PROJECT_DIR/assets/$AVATAR/$mode/FUNDO_VERDE"
  local output_dir="$PROJECT_DIR/assets/$AVATAR/$mode"
  [[ -d "$source_dir" ]] || return 0
  mkdir -p "$output_dir"

  while IFS= read -r -d '' source; do
    local stem
    stem="$(basename "$source")"
    stem="${stem%.*}"
    local destination="$output_dir/$stem.webm"
    if [[ "$FORCE" != "1" && -f "$destination" && "$destination" -nt "$source" ]]; then
      echo "skip $destination" | tee -a "$LOG_FILE"
      continue
    fi
    echo "processando $source -> $destination" | tee -a "$LOG_FILE"
    "$PYTHON_BIN" "$PROCESSOR" \
      --source "$source" \
      --destination "$destination" \
      --key-color "#09e318" \
      --similarity 0.165 \
      --blend 0.106 \
      --edge-px 2 \
      --blur-px 0.7 \
      --despill 0.75 \
      --width 832 \
      --height 1472 \
      --fit cover \
      --crf 18 | tee -a "$LOG_FILE"
  done < <(find "$source_dir" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' -o -iname '*.mkv' \) -print0 | sort -z)
}

process_mode "Falando"
process_mode "Mudo"
echo "processamento finalizado para $AVATAR" | tee -a "$LOG_FILE"
