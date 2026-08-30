from __future__ import annotations

from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import LIVE_RUNTIME_CONFIG_FILE


DEFAULT_RUNTIME_CONFIG = {
    "micro_pause_rate": 0.58,
    "micro_pause_freeze_max": 0.35,
    "pause_to_mute_min": 2.0,
    "mute_switch_advance": 0.025,
    "voice_speed": 1.0,
    "voice_pitch": 0.0,
    "music_idle_volume": 0.16,
    "music_speech_volume": 0.055,
}


def read_runtime_config() -> dict[str, float]:
    raw = read_json(LIVE_RUNTIME_CONFIG_FILE, {})
    if not isinstance(raw, dict):
        raw = {}
    return normalize_runtime_config(raw)


def save_runtime_config(changes: dict[str, Any] | None = None) -> dict[str, float]:
    stored = read_json(LIVE_RUNTIME_CONFIG_FILE, {})
    if not isinstance(stored, dict):
        stored = {}
    merged = {**stored, **(changes or {})}
    normalized = normalize_runtime_config(merged)
    write_json_atomic(LIVE_RUNTIME_CONFIG_FILE, {**stored, **normalized})
    return normalized


def normalize_runtime_config(raw: dict[str, Any]) -> dict[str, float]:
    return {
        "micro_pause_rate": _clamp_float(
            raw.get("micro_pause_rate"),
            DEFAULT_RUNTIME_CONFIG["micro_pause_rate"],
            0.10,
            1.00,
        ),
        "micro_pause_freeze_max": _clamp_float(
            raw.get("micro_pause_freeze_max"),
            DEFAULT_RUNTIME_CONFIG["micro_pause_freeze_max"],
            0.35,
            1.50,
        ),
        "pause_to_mute_min": _clamp_float(
            raw.get("pause_to_mute_min"),
            DEFAULT_RUNTIME_CONFIG["pause_to_mute_min"],
            0.50,
            4.00,
        ),
        "mute_switch_advance": _clamp_float(
            raw.get("mute_switch_advance"),
            DEFAULT_RUNTIME_CONFIG["mute_switch_advance"],
            0.000,
            0.200,
        ),
        "voice_speed": _clamp_float(
            raw.get("voice_speed"),
            DEFAULT_RUNTIME_CONFIG["voice_speed"],
            0.50,
            2.00,
        ),
        "voice_pitch": _clamp_float(
            raw.get("voice_pitch"),
            DEFAULT_RUNTIME_CONFIG["voice_pitch"],
            -2.00,
            2.00,
        ),
        "music_idle_volume": _clamp_float(
            raw.get("music_idle_volume"),
            DEFAULT_RUNTIME_CONFIG["music_idle_volume"],
            0.00,
            1.00,
        ),
        "music_speech_volume": _clamp_float(
            raw.get("music_speech_volume"),
            DEFAULT_RUNTIME_CONFIG["music_speech_volume"],
            0.00,
            1.00,
        ),
    }


def _clamp_float(value: object, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = float(default)
    return max(float(minimum), min(float(maximum), parsed))
