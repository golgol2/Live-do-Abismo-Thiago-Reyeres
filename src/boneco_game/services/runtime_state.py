from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import DEFAULT_AVATAR, DEFAULT_MAP, LIVE_RUNTIME_CONFIG_FILE, RUNS_DIR
from boneco_game.services import live_events
from boneco_game.services.map_service import read_map
from boneco_game.services.media_library import AUDIO_EXTENSIONS, avatar_dir, list_avatar_videos


STATE_FILE = RUNS_DIR / "runtime_state.json"


def default_state() -> dict[str, Any]:
    return {
        "avatar": DEFAULT_AVATAR,
        "map_name": DEFAULT_MAP,
        "visual_mode": "tunnel",
        "tunnel_style": "classic",
        "mode": "normal",
        "current_actor": "main",
        "camera": {"x": 0, "y": 0, "zoom": 1.0},
        "belly_profile_scale": 0.82,
        "belly_profile_offset_x": 0,
        "belly_profile_offset_y": 0,
        "dynamic_camera_enabled": True,
        "camera_manual_shot": "auto",
        "camera_medium_zoom_max": 1.22,
        "camera_close_zoom_max": 1.40,
        "camera_x_max": 22,
        "camera_close_y_max": 175,
        "camera_transition_min": 3.0,
        "camera_transition_max": 7.0,
        "camera_responses_min": 2,
        "camera_responses_max": 5,
        "updated_at": time.time(),
    }


def read_state() -> dict[str, Any]:
    payload = read_json(STATE_FILE, {})
    state = default_state()
    if isinstance(payload, dict):
        state.update(payload)
    return state


def update_state(**changes: Any) -> dict[str, Any]:
    state = read_state()
    state.update(changes)
    state["updated_at"] = time.time()
    write_json_atomic(STATE_FILE, state)
    return state


def _video_list(avatar: str, mode: str) -> list[str]:
    return [str(path) for path in list_avatar_videos(avatar, mode)]


def _audio_list(avatar: str, mode: str) -> list[str]:
    root = avatar_dir(avatar) / mode
    if not root.exists():
        return []
    return [
        str(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS
    ]


def _media_version(media: dict[str, list[str]]) -> int:
    newest = 0
    for paths in media.values():
        for path_text in paths:
            try:
                newest = max(newest, int(Path(path_text).stat().st_mtime))
            except OSError:
                continue
    return newest


def _walk_motion(avatar: str) -> dict[str, float]:
    presets_file = avatar_dir(avatar) / "metadata" / "walk_editor_presets.json"
    defaults = {
        "start": 1.7,
        "accel_end": 3.0,
        "loop_start": 3.25,
        "loop_end": 7.8,
        "decel_start": 8.4,
        "stop_end": 14.6,
    }
    payload = read_json(presets_file, {})
    if not isinstance(payload, dict) or not payload:
        return defaults
    # O renderer usa o primeiro preset salvo; hoje cada avatar tem um video de corrida ativo.
    first = next(iter(payload.values()), {})
    if not isinstance(first, dict):
        return defaults
    motion = defaults.copy()
    for key in motion:
        try:
            motion[key] = float(first.get(key, motion[key]))
        except (TypeError, ValueError):
            pass
    if not (0 <= motion["start"] < motion["loop_start"] < motion["loop_end"] < motion["stop_end"]):
        return defaults
    if not (motion["start"] <= motion["accel_end"] <= motion["loop_start"]):
        motion["accel_end"] = motion["loop_start"]
    if not (motion["loop_end"] <= motion["decel_start"] <= motion["stop_end"]):
        motion["decel_start"] = motion["loop_end"]
    return motion


def renderer_state() -> dict[str, Any]:
    state = read_state()
    avatar = str(state.get("avatar") or DEFAULT_AVATAR)
    map_name = str(state.get("map_name") or DEFAULT_MAP)
    media = {
        "idle": _video_list(avatar, "Mudo"),
        "talking": _video_list(avatar, "Falando"),
        "reactions": _video_list(avatar, "Risadas"),
        "walk_right": _video_list(avatar, "Andando_Direita"),
        "walk_left": _video_list(avatar, "Andando_Esquerda"),
        "walk_start_right": _video_list(avatar, "Andando_Direita/Inicio"),
        "walk_loop_right": _video_list(avatar, "Andando_Direita/Loop"),
        "walk_stop_right": _video_list(avatar, "Andando_Direita/Parando"),
        "walk_start_left": _video_list(avatar, "Andando_Esquerda/Inicio"),
        "walk_loop_left": _video_list(avatar, "Andando_Esquerda/Loop"),
        "walk_stop_left": _video_list(avatar, "Andando_Esquerda/Parando"),
    }
    music = _audio_list(avatar, "Musicas")
    return {
        "state": state,
        "runtime": _runtime_config_for_renderer(),
        "map": read_map(avatar, map_name),
        "media": media,
        "music": music,
        "visual_people": live_events.status().get("recent_people", []),
        "gift_wall": live_events.status().get("wall_gifts", []),
        "top_gifter": live_events.status().get("top_gifter"),
        "media_version": _media_version({**media, "music": music}),
        "walk_motion": _walk_motion(avatar),
    }


def _runtime_config_for_renderer() -> dict[str, float]:
    payload = read_json(LIVE_RUNTIME_CONFIG_FILE, {})
    if not isinstance(payload, dict):
        payload = {}
    return {
        "micro_pause_freeze_max": _float(payload.get("micro_pause_freeze_max"), 0.35),
        "pause_to_mute_min": _float(payload.get("pause_to_mute_min"), 2.0),
        "mute_switch_advance": _float(payload.get("mute_switch_advance"), 0.025),
    }


def _float(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)
