from __future__ import annotations

import random
import threading
import time
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.services.live_control import load_live_config, start_live, status as live_status, stop_live


STATUS_FILE = RUNS_DIR / "live_scheduler_status.json"
CHECK_INTERVAL_SECONDS = 1.0

_THREAD: threading.Thread | None = None
_STOP = threading.Event()
_LOCK = threading.Lock()

_scheduled_action = ""
_scheduled_at = 0.0
_config_signature = ""
_running_generation = 0


def start_live_scheduler() -> None:
    global _THREAD
    with _LOCK:
        if _THREAD and _THREAD.is_alive():
            return
        _STOP.clear()
        _THREAD = threading.Thread(
            target=_loop,
            name="boneco-game-live-scheduler",
            daemon=True,
        )
        _THREAD.start()


def stop_live_scheduler() -> None:
    _STOP.set()
    _write_status({
        "state": "stopping",
        "enabled": False,
        "updated_at": time.time(),
    })


def status() -> dict[str, Any]:
    payload = read_json(STATUS_FILE, {})
    status_payload = payload if isinstance(payload, dict) else {}
    updated_at = float(status_payload.get("updated_at") or 0)
    return {
        **status_payload,
        "thread_alive": bool(_THREAD and _THREAD.is_alive()),
        "status_age_seconds": round(max(0.0, time.time() - updated_at), 1) if updated_at else 0,
    }


def run_check_once() -> dict[str, Any]:
    global _scheduled_action, _scheduled_at, _config_signature, _running_generation

    now = time.time()
    config = load_live_config()
    live = live_status()
    enabled = bool(config.get("auto_start_enabled"))
    running = bool(live.get("running"))
    signature = _config_signature_for(config)

    if not enabled:
        _scheduled_action = ""
        _scheduled_at = 0.0
        _config_signature = signature
        return _write_status({
            "state": "disabled",
            "enabled": False,
            "live_running": running,
            "updated_at": now,
        })

    if signature != _config_signature:
        _scheduled_action = ""
        _scheduled_at = 0.0
        _config_signature = signature

    desired_action = "stop" if running else "start"

    if desired_action == "stop" and _scheduled_action != "stop":
        _running_generation += 1

    if _scheduled_action != desired_action or _scheduled_at <= 0:
        _scheduled_action = desired_action
        _scheduled_at = now + _delay_for(config, desired_action)
        return _write_status(_status_payload("scheduled", config, live, now))

    if now < _scheduled_at:
        return _write_status(_status_payload("waiting", config, live, now))

    action = _scheduled_action
    _scheduled_action = ""
    _scheduled_at = 0.0

    if action == "start":
        result = start_live(config)
        next_live = live_status()
        return _write_status({
            **_status_payload("started" if result.get("ok") else "start_error", config, next_live, time.time()),
            "last_action": "start",
            "last_result": _compact_result(result),
            "last_action_at": time.time(),
        })

    result = stop_live()
    next_live = live_status()
    return _write_status({
        **_status_payload("stopped" if result.get("ok") else "stop_error", config, next_live, time.time()),
        "last_action": "stop",
        "last_result": _compact_result(result),
        "last_action_at": time.time(),
    })


def _loop() -> None:
    _write_status({
        "state": "starting",
        "enabled": False,
        "updated_at": time.time(),
    })
    while not _STOP.is_set():
        try:
            run_check_once()
        except Exception as exc:
            _write_status({
                "state": "error",
                "enabled": False,
                "error": f"{type(exc).__name__}: {exc}",
                "updated_at": time.time(),
            })
            time.sleep(5.0)
            continue
        _STOP.wait(CHECK_INTERVAL_SECONDS)


def _status_payload(
    state: str,
    config: dict[str, Any],
    live: dict[str, Any],
    now: float,
) -> dict[str, Any]:
    remaining = max(0, _scheduled_at - now) if _scheduled_at else 0
    return {
        "state": state,
        "enabled": bool(config.get("auto_start_enabled")),
        "live_running": bool(live.get("running")),
        "scheduled_action": _scheduled_action,
        "scheduled_at": _scheduled_at,
        "remaining_seconds": round(remaining, 1),
        "start_min_seconds": int(config.get("start_min_seconds") or 0),
        "start_max_seconds": int(config.get("start_max_seconds") or 0),
        "stop_min_seconds": int(config.get("stop_min_seconds") or 0),
        "stop_max_seconds": int(config.get("stop_max_seconds") or 0),
        "running_generation": _running_generation,
        "updated_at": now,
    }


def _delay_for(config: dict[str, Any], action: str) -> float:
    if action == "stop":
        minimum = int(config.get("stop_min_seconds") or 3000)
        maximum = int(config.get("stop_max_seconds") or minimum)
    else:
        minimum = int(config.get("start_min_seconds") or 3600)
        maximum = int(config.get("start_max_seconds") or minimum)
    low = max(1, min(minimum, maximum))
    high = max(low, max(minimum, maximum))
    return random.uniform(low, high)


def _config_signature_for(config: dict[str, Any]) -> str:
    keys = (
        "auto_start_enabled",
        "username",
        "monitor_server",
        "mode",
        "title",
        "game",
        "audience_type",
        "auto_streamlabs",
        "rtmp_url",
        "output_file",
        "video_bitrate",
        "video_encoder",
        "rtmp_sink",
        "display",
        "audio_source",
        "renderer_url",
        "renderer_width",
        "renderer_height",
        "renderer_x",
        "renderer_y",
        "renderer_fullscreen",
        "start_min_seconds",
        "start_max_seconds",
        "stop_min_seconds",
        "stop_max_seconds",
    )
    return "|".join(f"{key}={config.get(key)!r}" for key in keys)


def _compact_result(result: dict[str, Any]) -> dict[str, Any]:
    live = result.get("live") if isinstance(result.get("live"), dict) else {}
    return {
        "ok": bool(result.get("ok")),
        "state": str(live.get("state") or ""),
        "running": bool(live.get("running")),
        "message": str(live.get("message") or ""),
    }


def _write_status(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        write_json_atomic(STATUS_FILE, payload)
    except OSError:
        pass
    return payload
