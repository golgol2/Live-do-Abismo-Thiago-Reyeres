from __future__ import annotations

from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import PROJECT_DIR


ACTORS_FILE = PROJECT_DIR / "config" / "actors.json"


def default_registry() -> dict[str, Any]:
    return {
        "version": 1,
        "default_actor": "main",
        "actors": {
            "main": {
                "label": "Boneco",
                "avatar": "BONECO_MAPA_2D",
                "map_point": "main",
                "enabled": True,
                "role": "personagem principal",
            }
        },
    }


def read_registry() -> dict[str, Any]:
    payload = read_json(ACTORS_FILE, {})
    if not isinstance(payload, dict):
        return default_registry()
    base = default_registry()
    base.update(payload)
    if not isinstance(base.get("actors"), dict):
        base["actors"] = default_registry()["actors"]
    return base


def save_registry(payload: dict[str, Any]) -> dict[str, Any]:
    base = default_registry()
    if isinstance(payload, dict):
        base.update(payload)
    write_json_atomic(ACTORS_FILE, base)
    return base

