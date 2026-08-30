from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import DEFAULT_AVATAR, RUNS_DIR
from boneco_game.services import live_events
from boneco_game.services.live_runtime import read_runtime_config
from boneco_game.services.layout_manager import public_layout_state, read_layout_state
from boneco_game.services.media_library import AUDIO_EXTENSIONS, avatar_dir, list_avatar_videos, list_manual_mudo_videos


STATE_FILE = RUNS_DIR / "runtime_state.json"


def default_state() -> dict[str, Any]:
    return {
        "avatar": DEFAULT_AVATAR,
        "visual_mode": "layout",
        "mode": "normal",
        "current_actor": "main",
        "camera": {"x": 0, "y": 0, "zoom": 1.0},
        "belly_profile_scale": 0.82,
        "belly_profile_offset_x": 0,
        "belly_profile_offset_y": 0,
        "dynamic_camera_enabled": True,
        "camera_manual_shot": "auto",
        "camera_far_zoom_min": 0.82,
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

    layout = read_layout_state()

    state.update({
        "layout_mode": layout.get("layout_mode", "random"),
        "active_layout": layout.get("active_layout", ""),
        "manual_layout": layout.get("manual_layout", ""),
        "enabled_layouts": layout.get("enabled_layouts", []),
        "layout_session_id": layout.get("layout_session_id", ""),
    })

    return state


def update_state(**changes: Any) -> dict[str, Any]:
    state = read_state()
    state.update(changes)
    state["updated_at"] = time.time()
    write_json_atomic(STATE_FILE, state)
    return state


def _video_list(avatar: str, mode: str) -> list[str]:
    return [str(path) for path in list_avatar_videos(avatar, mode)]


def _manual_idle_video_list(avatar: str) -> list[str]:
    return [str(path) for path in list_manual_mudo_videos(avatar)]


def _audio_list(avatar: str, mode: str) -> list[str]:
    root = avatar_dir(avatar) / mode
    if not root.exists():
        return []
    return [
        str(path)
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS
    ]


def manual_speech_music_tracks(avatar: str | None = None) -> list[str]:
    return _audio_list(str(avatar or DEFAULT_AVATAR), "Musicas_Falas")


def manual_speech_music_catalog(avatar: str | None = None) -> list[dict[str, str]]:
    tracks = manual_speech_music_tracks(avatar)
    return [
        {
            "path": path,
            "name": Path(path).stem.replace("_", " ").replace("-", " ").strip() or Path(path).name,
            "file": Path(path).name,
        }
        for path in tracks
    ]


def validate_manual_speech_music_path(path_text: str, avatar: str | None = None) -> str:
    raw = str(path_text or "").strip()
    if not raw:
        return ""

    allowed = set(manual_speech_music_tracks(avatar))
    if raw in allowed:
        return raw

    try:
        resolved = Path(raw).resolve()
    except OSError:
        return ""

    for path in allowed:
        try:
            if Path(path).resolve() == resolved:
                return path
        except OSError:
            continue

    return ""


def _media_version(media: dict[str, list[str]]) -> int:
    newest = 0
    for paths in media.values():
        for path_text in paths:
            try:
                newest = max(newest, int(Path(path_text).stat().st_mtime))
            except OSError:
                continue
    return newest


def renderer_state() -> dict[str, Any]:
    state = read_state()
    state["visual_mode"] = "layout"
    for stale_key in ("tun" + "nel_style", "layout" + "_style"):
        state.pop(stale_key, None)
    avatar = str(state.get("avatar") or DEFAULT_AVATAR)
    media = {
        "idle": _video_list(avatar, "Mudo"),
        "manual_idle": _manual_idle_video_list(avatar),
        "talking": _video_list(avatar, "Falando"),
        "reactions": _video_list(avatar, "Risadas"),
    }
    music = _audio_list(avatar, "Musicas")
    manual_music = manual_speech_music_tracks(avatar)
    return {
        "state": state,
        "runtime": _runtime_config_for_renderer(),
        "layout": public_layout_state(),
        "media": media,
        "music": music,
        "manual_music": manual_music,
        "visual_people": live_events.status().get("recent_people", []),
        "gift_leaderboard": live_events.status().get("gift_leaderboard", []),
        "top_gifter": live_events.status().get("top_gifter"),
        "media_version": _media_version({**media, "music": music, "manual_music": manual_music}),
    }


def _runtime_config_for_renderer() -> dict[str, float]:
    return read_runtime_config()

def _float(value: object, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)
