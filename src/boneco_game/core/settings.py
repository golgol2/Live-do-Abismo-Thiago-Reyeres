from __future__ import annotations

import os
from pathlib import Path


PROJECT_DIR = Path(os.getenv("BONECO_GAME_DIR", "/media/allana/Dados240/BONECO_GAME"))
ASSETS_DIR = Path(os.getenv("BONECO_GAME_ASSETS_DIR", str(PROJECT_DIR / "assets")))
PRIVATE_DIR = PROJECT_DIR / "private"
RUNS_DIR = PROJECT_DIR / "runs"
LOGS_DIR = PROJECT_DIR / "logs"
TEMPLATES_DIR = PROJECT_DIR / "src" / "boneco_game" / "templates"
STATIC_DIR = PROJECT_DIR / "src" / "boneco_game" / "static"

DEFAULT_AVATAR = os.getenv("BONECO_GAME_AVATAR", "BONECO_MAPA_2D")
DEFAULT_HOST = os.getenv("BONECO_GAME_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("BONECO_GAME_PORT", "9292"))
DEFAULT_WIDTH = 720
DEFAULT_HEIGHT = 1280

STREAMLABS_CONFIG_FILE = PRIVATE_DIR / "streamlabs_tiktok.json"
LIVE_AI_CONFIG_FILE = PRIVATE_DIR / "live_text_ai.json"
LIVE_RUNTIME_CONFIG_FILE = PRIVATE_DIR / "live_runtime.json"
LIVE_CONTROL_CONFIG_FILE = PRIVATE_DIR / "live_control.json"
BLACKLIST_FILE = PRIVATE_DIR / "chat_blacklist_terms.txt"
MONITOR_START_SCRIPT = PROJECT_DIR / "scripts" / "start_tiktok_monitor.sh"
MONITOR_NETWORK_FILE = RUNS_DIR / "monitor_network.json"
MONITOR_STATUS_FILE = RUNS_DIR / "monitor_status.json"


def ensure_runtime_dirs() -> None:
    for path in (ASSETS_DIR, PRIVATE_DIR, RUNS_DIR, LOGS_DIR):
        path.mkdir(parents=True, exist_ok=True)
