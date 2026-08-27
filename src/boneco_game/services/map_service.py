from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import ASSETS_DIR, DEFAULT_AVATAR, DEFAULT_MAP


MAP_LAYERS = ["sky", "far_bg", "back_props", "floor", "front_props", "interactive"]


def safe_name(value: object, fallback: str) -> str:
    name = Path(str(value or "").strip()).name
    name = re.sub(r"[^A-Za-z0-9_. -]+", "_", name).strip(" ._")
    return name or fallback


def map_dir(avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> Path:
    root = ASSETS_DIR / safe_name(avatar, DEFAULT_AVATAR) / "Mapas" / safe_name(map_name, DEFAULT_MAP)
    root.mkdir(parents=True, exist_ok=True)
    for layer in MAP_LAYERS:
        (root / layer).mkdir(parents=True, exist_ok=True)
    return root


def default_map(avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> dict[str, Any]:
    return {
        "version": 2,
        "avatar": safe_name(avatar, DEFAULT_AVATAR),
        "map_name": safe_name(map_name, DEFAULT_MAP),
        "world": {"width": 1280, "height": 720},
        "stage": {"width": 720, "height": 1280},
        "viewport": {"x": 437.5, "y": 0, "w": 405, "h": 720},
        "camera": {"x": 437.5, "y": 0, "zoom": 1.0},
        "movement": {
            "camera_speed": 3.25,
            "stop_follow_seconds": 1.0,
            "run_direction": "right",
            "main_camera_scale": 1.18,
            "main_camera_x_offset": 0.0,
            "main_camera_y_offset": 0.0,
            "wide_shot_enabled": True,
            "wide_shot_chance": 0.22,
            "wide_shot_viewport_scale": 1.28,
            "wide_shot_y_offset": 0.0,
            "run_start_shot_scale_min": 1.25,
            "run_start_shot_scale_max": 2.15,
            "run_stop_shot_scale_min": 1.2,
            "run_stop_shot_scale_max": 2.05,
            "run_stop_shot_x_offset": 52.0,
            "wide_shot_duration_min": 5.0,
            "wide_shot_duration_max": 9.0,
            "wide_shot_interval_min": 7.0,
            "wide_shot_interval_max": 15.0,
        },
        "spawn_points": {
            "main": {"x": 640, "y": 590},
            "dj": {"x": 980, "y": 590},
            "oracle": {"x": 220, "y": 590},
        },
        "objects": [],
        "updated_at": time.time(),
    }


def map_path(avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> Path:
    return map_dir(avatar, map_name) / "map.json"


def read_map(avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> dict[str, Any]:
    path = map_path(avatar, map_name)
    if not path.exists():
        payload = default_map(avatar, map_name)
        write_json_atomic(path, payload)
        return payload
    payload = read_json(path, {})
    if not isinstance(payload, dict):
        payload = {}
    base = default_map(avatar, map_name)
    base.update(payload)
    if not isinstance(base.get("objects"), list):
        base["objects"] = []
    return base


def save_map(payload: dict[str, Any], avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> dict[str, Any]:
    base = default_map(avatar, map_name)
    if isinstance(payload.get("layers"), list):
        base["layers"] = payload["layers"]
    if isinstance(payload.get("world"), dict):
        base["world"].update(payload["world"])
    if isinstance(payload.get("viewport"), dict):
        base["viewport"].update(payload["viewport"])
    if isinstance(payload.get("camera"), dict):
        base["camera"].update(payload["camera"])
    if isinstance(payload.get("movement"), dict):
        movement = payload["movement"]
        try:
            base["movement"]["camera_speed"] = max(0.2, min(4.0, float(movement.get("camera_speed", base["movement"]["camera_speed"]))))
        except (TypeError, ValueError):
            pass
        try:
            base["movement"]["stop_follow_seconds"] = max(0.0, min(4.0, float(movement.get("stop_follow_seconds", base["movement"]["stop_follow_seconds"]))))
        except (TypeError, ValueError):
            pass
        base["movement"]["wide_shot_enabled"] = bool(movement.get("wide_shot_enabled", base["movement"]["wide_shot_enabled"]))
        for key, minimum, maximum in [
            ("wide_shot_chance", 0.0, 1.0),
            ("main_camera_scale", 1.0, 1.8),
            ("main_camera_x_offset", -220.0, 220.0),
            ("main_camera_y_offset", -240.0, 240.0),
            ("wide_shot_viewport_scale", 1.0, 1.75),
            ("wide_shot_y_offset", -240.0, 240.0),
            ("run_start_shot_scale_min", 1.0, 2.6),
            ("run_start_shot_scale_max", 1.0, 2.6),
            ("run_stop_shot_scale_min", 1.0, 2.6),
            ("run_stop_shot_scale_max", 1.0, 2.6),
            ("run_stop_shot_x_offset", 0.0, 180.0),
            ("wide_shot_duration_min", 1.0, 30.0),
            ("wide_shot_duration_max", 1.0, 45.0),
            ("wide_shot_interval_min", 1.0, 60.0),
            ("wide_shot_interval_max", 1.0, 90.0),
        ]:
            try:
                base["movement"][key] = max(minimum, min(maximum, float(movement.get(key, base["movement"][key]))))
            except (TypeError, ValueError):
                pass
        if base["movement"]["wide_shot_duration_max"] < base["movement"]["wide_shot_duration_min"]:
            base["movement"]["wide_shot_duration_max"] = base["movement"]["wide_shot_duration_min"]
        if base["movement"]["wide_shot_interval_max"] < base["movement"]["wide_shot_interval_min"]:
            base["movement"]["wide_shot_interval_max"] = base["movement"]["wide_shot_interval_min"]
        if base["movement"]["run_start_shot_scale_max"] < base["movement"]["run_start_shot_scale_min"]:
            base["movement"]["run_start_shot_scale_max"] = base["movement"]["run_start_shot_scale_min"]
        if base["movement"]["run_stop_shot_scale_max"] < base["movement"]["run_stop_shot_scale_min"]:
            base["movement"]["run_stop_shot_scale_max"] = base["movement"]["run_stop_shot_scale_min"]
        # Este avatar foi definido para correr apenas para a direita.
        base["movement"]["run_direction"] = "right"
    if isinstance(payload.get("spawn_points"), dict):
        base["spawn_points"].update(payload["spawn_points"])
    objects: list[dict[str, Any]] = []
    for index, item in enumerate(payload.get("objects") if isinstance(payload.get("objects"), list) else []):
        if not isinstance(item, dict):
            continue
        layer = str(item.get("layer") or "back_props")
        if layer not in MAP_LAYERS:
            layer = "back_props"
        asset = str(item.get("asset") or "").strip()
        if not asset:
            continue
        objects.append(
            {
                "id": str(item.get("id") or f"obj_{index}_{int(time.time())}"),
                "name": str(item.get("name") or Path(asset).name),
                "layer": layer,
                "asset": asset,
                "x": float(item.get("x") or 0),
                "y": float(item.get("y") or 0),
                "w": max(1.0, float(item.get("w") or 120)),
                "h": max(1.0, float(item.get("h") or 120)),
                "z": int(item.get("z") or 0),
                "parallax": float(item.get("parallax") or 1.0),
                "visible": bool(item.get("visible", True)),
                "lock_ratio": bool(item.get("lock_ratio", True)),
            }
        )
    base["objects"] = objects
    base["updated_at"] = time.time()
    write_json_atomic(map_path(avatar, map_name), base)
    return base
