from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from boneco_game.core.settings import RUNS_DIR, TEMPLATES_DIR
from boneco_game.services import live_events, preview_events
from boneco_game.services.system_update import schedule_restart as schedule_system_restart, status as system_update_status, update as apply_system_update
from boneco_game.services.background_removal import start as start_background_removal, status as background_removal_status
from boneco_game.services.event_decision_worker import status as decision_worker_status
from boneco_game.services.live_health import run_check_once as live_health_check, status as live_health_status
from boneco_game.services.live_scheduler import run_check_once as live_schedule_check, status as live_schedule_status
from boneco_game.services.layout_manager import public_layout_state
from boneco_game.services.live_runtime import read_runtime_config, save_runtime_config
from boneco_game.services.live_control import (
    public_live_config,
    save_live_config,
    start_live,
    status as live_status,
    stop_live,
)
from boneco_game.services.renderer_window import (
    restart_renderer_window,
    start_renderer_window,
    status as renderer_window_status,
    stop_renderer_window,
)
from boneco_game.services.runtime_state import (
    manual_speech_music_catalog,
    read_state,
    update_state,
    validate_manual_speech_music_path,
)
from boneco_game.services.speech_queue import enqueue_manual_sequence, enqueue_text, status
from boneco_game.services.tiktok_monitor import start_monitor, status as monitor_status, stop_monitor
from boneco_game.services.transmission import start_transmission, status as transmission_status, stop_transmission


router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/", response_class=HTMLResponse)
def panel(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("panel.html", {"request": request, "state": read_state()})


def _full_status_payload() -> dict[str, object]:
    live = live_status()

    return {
        "state": read_state(),
        "layout": public_layout_state(),
        "queue": status(),
        "events": live_events.status(),
        "decision_worker": decision_worker_status(),
        "monitor": live.get("monitor") or monitor_status(),
        "renderer_window": renderer_window_status(),
        "transmission": transmission_status(),
        "live": live,
        "health": live_health_status(),
        "schedule": live_schedule_status(),
        "background_removal": background_removal_status(),
        "runtime": read_runtime_config(),
    }


def _compact_status_payload() -> dict[str, object]:
    live = live_status()
    renderer = renderer_window_status()
    transmission = transmission_status()

    return {
        "state": read_state(),
        "layout": public_layout_state(),
        "runtime": read_runtime_config(),
        "live": {
            "running": bool(live.get("running")),
            "state": live.get("state", ""),
            "message": live.get("message", ""),
        },
        "renderer_window": {
            "running": bool(renderer.get("running")),
            "pid": renderer.get("pid", 0),
            "pulse_sink": renderer.get("pulse_sink", ""),
            "last_error": renderer.get("last_error", ""),
        },
        "transmission": {
            "running": bool(transmission.get("running")),
            "pid": transmission.get("pid", 0),
            "audio_sink": transmission.get("audio_sink", ""),
            "audio_source": transmission.get("audio_source", ""),
            "last_error": transmission.get("last_error", ""),
        },
        "schedule": live_schedule_status(),
    }


_SENSITIVE_KEYS = {
    "rtmp_url",
    "stream_key",
    "api_key",
    "openai_api_key",
    "token",
    "access_token",
    "refresh_token",
    "password",
    "secret",
    "wssecret",
    "credentials",
}


def _sanitize_text(text: str) -> str:
    value = str(text)

    value = re.sub(
        r"(?i)\b(?:rtmp|rtmps)://[^\s\"'<>]+",
        "[RTMP_REDACTED]",
        value,
    )

    value = re.sub(
        r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+",
        r"\1[REDACTED]",
        value,
    )

    value = re.sub(
        r"(?i)((?:token|secret|password|wssecret|api[_-]?key|stream[_-]?key)\s*[:=]\s*)[^\s,;]+",
        r"\1[REDACTED]",
        value,
    )

    value = re.sub(
        r"(?i)([?&](?:token|secret|password|api[_-]?key|stream[_-]?key)=)[^&\s]+",
        r"\1[REDACTED]",
        value,
    )

    return value


def _sanitize_value(value: object, key: str = "") -> object:
    key_lower = str(key).strip().lower()

    if key_lower in _SENSITIVE_KEYS:
        if value in ("", None):
            return value
        return "[REDACTED]"

    if isinstance(value, dict):
        return {
            str(item_key): _sanitize_value(item_value, str(item_key))
            for item_key, item_value in value.items()
        }

    if isinstance(value, list):
        return [
            _sanitize_value(item)
            for item in value
        ]

    if isinstance(value, tuple):
        return [
            _sanitize_value(item)
            for item in value
        ]

    if isinstance(value, str):
        return _sanitize_text(value)

    return value


def _tail_log(name: str, *, max_bytes: int, max_lines: int) -> str:
    path = RUNS_DIR / name

    try:
        with path.open("rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            start = max(0, size - max_bytes)
            handle.seek(start)
            raw = handle.read()
    except OSError:
        return "[arquivo ausente ou indisponível]"

    text = raw.decode(
        "utf-8",
        errors="replace",
    )

    if start > 0:
        first_newline = text.find("\n")
        if first_newline >= 0:
            text = text[first_newline + 1:]

    lines = text.splitlines()

    return _sanitize_text(
        "\n".join(lines[-max_lines:])
    )


def _current_error_summary() -> dict[str, object]:
    live = live_status()
    monitor = live.get("monitor") or monitor_status()
    renderer = renderer_window_status()
    transmission = transmission_status()
    health = live_health_status()

    return _sanitize_value({
        "live": {
            "state": live.get("state", ""),
            "message": live.get("message", ""),
        },
        "monitor": {
            "last_error": monitor.get("last_error", ""),
        },
        "renderer_window": {
            "last_error": renderer.get("last_error", ""),
        },
        "transmission": {
            "last_error": transmission.get("last_error", ""),
        },
        "health": health,
    })


@router.get("/api/status", response_class=JSONResponse)
def api_status() -> JSONResponse:
    return JSONResponse(_full_status_payload())


@router.get("/api/status/compact", response_class=JSONResponse)
def api_status_compact() -> JSONResponse:
    return JSONResponse(_compact_status_payload())


@router.get("/api/diagnostics/status", response_class=JSONResponse)
def api_diagnostics_status() -> JSONResponse:
    return JSONResponse(
        _sanitize_value(
            _full_status_payload()
        )
    )


@router.get("/api/diagnostics/logs", response_class=JSONResponse)
def api_diagnostics_logs() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "current_errors": _current_error_summary(),
        "logs": {
            "transmission.log": _tail_log(
                "transmission.log",
                max_bytes=96_000,
                max_lines=160,
            ),
            "tts_errors.log": _tail_log(
                "tts_errors.log",
                max_bytes=64_000,
                max_lines=140,
            ),
            "text_ai_errors.log": _tail_log(
                "text_ai_errors.log",
                max_bytes=64_000,
                max_lines=140,
            ),
            "system_update.log": _tail_log(
                "system_update.log",
                max_bytes=48_000,
                max_lines=100,
            ),
            "server.log": _tail_log(
                "server.log",
                max_bytes=48_000,
                max_lines=100,
            ),
        },
    })


@router.get("/api/live/health", response_class=JSONResponse)
def api_live_health() -> JSONResponse:
    return JSONResponse(live_health_status())


@router.post("/api/live/health/check", response_class=JSONResponse)
def api_live_health_check() -> JSONResponse:
    return JSONResponse(live_health_check(allow_recovery=False))


@router.get("/api/live/schedule", response_class=JSONResponse)
def api_live_schedule() -> JSONResponse:
    return JSONResponse({"ok": True, "schedule": live_schedule_status()})


@router.post("/api/live/schedule/check", response_class=JSONResponse)
def api_live_schedule_check() -> JSONResponse:
    return JSONResponse({"ok": True, "schedule": live_schedule_check()})


@router.get("/api/live/runtime", response_class=JSONResponse)
def api_live_runtime() -> JSONResponse:
    return JSONResponse({"ok": True, "runtime": read_runtime_config()})


@router.post("/api/live/runtime", response_class=JSONResponse)
async def api_live_runtime_save(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    runtime = save_runtime_config(payload)
    return JSONResponse({"ok": True, "runtime": runtime})


@router.post("/api/state", response_class=JSONResponse)
async def api_state(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse(update_state(**payload))


@router.post("/api/speech/manual", response_class=JSONResponse)
async def api_manual_speech(request: Request) -> JSONResponse:
    payload = await request.json()
    text = str(payload.get("text") or "").strip() if isinstance(payload, dict) else ""
    actor = str(payload.get("actor") or "main") if isinstance(payload, dict) else "main"
    manual_music_path = validate_manual_speech_music_path(
        str(payload.get("manual_music_path") or "")
        if isinstance(payload, dict)
        else ""
    )
    if not text:
        return JSONResponse({"ok": False, "error": "Texto vazio."}, status_code=400)
    if isinstance(payload, dict) and payload.get("manual_music_path") and not manual_music_path:
        return JSONResponse({"ok": False, "error": "Música da fala manual inválida."}, status_code=400)
    try:
        sequence = enqueue_manual_sequence(
            text,
            actor=actor,
            priority=90,
            manual_music_path=manual_music_path,
        )
    except RuntimeError as exc:
        return JSONResponse(
            {"ok": False, "error": str(exc)},
            status_code=409,
        )
    except ValueError as exc:
        return JSONResponse(
            {"ok": False, "error": str(exc)},
            status_code=400,
        )

    return JSONResponse({
        "ok": True,
        "manual_sequence": sequence,
        "parts": int(sequence.get("chunk_count") or 0),
    })


@router.get("/api/speech/manual/music", response_class=JSONResponse)
def api_manual_speech_music() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "tracks": manual_speech_music_catalog(),
    })


@router.get("/api/live/config", response_class=JSONResponse)
def api_live_config() -> JSONResponse:
    return JSONResponse(public_live_config())


@router.post("/api/live/config", response_class=JSONResponse)
async def api_live_config_save(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse(save_live_config(payload))


@router.post("/api/live/start", response_class=JSONResponse)
async def api_live_start(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    result = start_live(payload)
    status_code = 200 if result.get("ok") else 400
    return JSONResponse(result, status_code=status_code)


@router.post("/api/live/stop", response_class=JSONResponse)
def api_live_stop() -> JSONResponse:
    return JSONResponse(stop_live())


@router.get("/api/background-removal/status", response_class=JSONResponse)
def api_background_removal_status() -> JSONResponse:
    return JSONResponse(background_removal_status())


@router.post("/api/background-removal/start", response_class=JSONResponse)
async def api_background_removal_start(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    avatar = str(payload.get("avatar") or "BONECO_MAPA_2D").strip()
    force = bool(payload.get("force"))
    try:
        result = start_background_removal(avatar, force=force)
    except (ValueError, OSError) as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    status_code = 200 if result.get("ok") is not False else 409
    return JSONResponse(result, status_code=status_code)



@router.get("/api/system-update/status", response_class=JSONResponse)
def api_system_update_status(fetch_remote: int = 0) -> JSONResponse:
    return JSONResponse(system_update_status(fetch=bool(fetch_remote)))


@router.post("/api/system-update/apply", response_class=JSONResponse)
def api_system_update_apply() -> JSONResponse:
    live = live_status()
    transmission = transmission_status()
    if bool(live.get("running")) or bool(transmission.get("running")):
        return JSONResponse({"ok": False, "error": "A live está ativa. Pare a transmissão antes de atualizar."}, status_code=409)
    result = apply_system_update()
    return JSONResponse(result, status_code=200 if result.get("ok") else 409)


@router.post("/api/system-update/restart", response_class=JSONResponse)
def api_system_update_restart() -> JSONResponse:
    live = live_status()
    transmission = transmission_status()
    if bool(live.get("running")) or bool(transmission.get("running")):
        return JSONResponse({"ok": False, "error": "A live está ativa. Pare a transmissão antes de reiniciar."}, status_code=409)
    result = schedule_system_restart()
    return JSONResponse(result, status_code=200 if result.get("ok") else 500)


@router.post("/api/preview/events/comment", response_class=JSONResponse)
async def api_preview_event_comment(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    event = preview_events.push_comment(
        str(payload.get("username") or ""),
        str(payload.get("text") or ""),
        display_name=str(
            payload.get("display_name") or ""
        ),
    )

    return JSONResponse({
        "ok": True,
        "preview": True,
        "event": event,
    })


@router.post("/api/preview/events/gift", response_class=JSONResponse)
async def api_preview_event_gift(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    event = preview_events.push_gift(
        str(payload.get("username") or ""),
        str(
            payload.get("gift_name")
            or payload.get("text")
            or ""
        ),
        count=int(payload.get("count") or 1),
        display_name=str(
            payload.get("display_name") or ""
        ),
    )

    return JSONResponse({
        "ok": True,
        "preview": True,
        "event": event,
    })


@router.post("/api/events/comment", response_class=JSONResponse)
async def api_event_comment(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    event = live_events.push_comment(
        str(payload.get("username") or ""),
        str(payload.get("text") or ""),
        display_name=str(payload.get("display_name") or ""),
        metadata={"source": "api"},
    )
    return JSONResponse({"ok": True, "event": event})


@router.post("/api/events/gift", response_class=JSONResponse)
async def api_event_gift(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    event = live_events.push_gift(
        str(payload.get("username") or ""),
        str(payload.get("gift_name") or payload.get("text") or ""),
        count=int(payload.get("count") or 1),
        display_name=str(payload.get("display_name") or ""),
        metadata={"source": "api", "raw": payload},
    )
    return JSONResponse({"ok": True, "event": event})


@router.post("/api/monitor/start", response_class=JSONResponse)
async def api_monitor_start(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    username = str(payload.get("username") or "").strip()
    server_url = str(payload.get("server_url") or "http://127.0.0.1:2618").strip()
    return JSONResponse({"ok": True, "monitor": start_monitor(username, server_url=server_url)})


@router.post("/api/monitor/stop", response_class=JSONResponse)
def api_monitor_stop() -> JSONResponse:
    return JSONResponse({"ok": True, "monitor": stop_monitor()})


@router.post("/api/renderer-window/start", response_class=JSONResponse)
async def api_renderer_window_start(request: Request) -> JSONResponse:
    blocked = _manual_renderer_control_blocked()
    if blocked:
        return JSONResponse(blocked, status_code=409)

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse({"ok": True, "renderer_window": start_renderer_window(**_renderer_window_payload(payload))})


@router.post("/api/renderer-window/stop", response_class=JSONResponse)
def api_renderer_window_stop() -> JSONResponse:
    blocked = _manual_renderer_control_blocked()
    if blocked:
        return JSONResponse(blocked, status_code=409)

    return JSONResponse({"ok": True, "renderer_window": stop_renderer_window()})


@router.post("/api/renderer-window/restart", response_class=JSONResponse)
async def api_renderer_window_restart(request: Request) -> JSONResponse:
    blocked = _manual_renderer_control_blocked()
    if blocked:
        return JSONResponse(blocked, status_code=409)

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse({"ok": True, "renderer_window": restart_renderer_window(**_renderer_window_payload(payload))})


@router.post("/api/transmission/start", response_class=JSONResponse)
async def api_transmission_start(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse({"ok": True, "transmission": start_transmission(**_transmission_payload(payload))})


@router.post("/api/transmission/stop", response_class=JSONResponse)
def api_transmission_stop() -> JSONResponse:
    return JSONResponse({"ok": True, "transmission": stop_transmission()})


def _renderer_window_payload(payload: dict[str, object]) -> dict[str, object]:
    return {
        "url": str(payload.get("url") or "").strip() or None,
        "width": int(payload.get("width") or 720),
        "height": int(payload.get("height") or 1280),
        "x": int(payload.get("x") or 0),
        "y": int(payload.get("y") or 0),
        "fullscreen": bool(payload.get("fullscreen")),
        "display": str(payload.get("display") or "").strip(),
        "pulse_sink": str(payload.get("pulse_sink") or "").strip(),
    }


def _manual_renderer_control_blocked() -> dict[str, object] | None:
    live = live_status()
    transmission = transmission_status()

    if bool(live.get("running")) or bool(transmission.get("running")):
        return {
            "ok": False,
            "blocked": True,
            "error": (
                "Renderer oficial bloqueado enquanto a live/transmissao esta ativa. "
                "Use a previa /renderer?preview=1 para testar layout sem mexer na captura."
            ),
            "live": {
                "running": bool(live.get("running")),
                "state": str(live.get("state") or ""),
            },
            "transmission": {
                "running": bool(transmission.get("running")),
                "pid": int(transmission.get("pid") or 0),
            },
        }

    return None


def _transmission_payload(payload: dict[str, object]) -> dict[str, object]:
    return {
        "rtmp_url": str(payload.get("rtmp_url") or "").strip(),
        "output_file": str(payload.get("output_file") or "").strip(),
        "audio_source": str(payload.get("audio_source") or "").strip(),
        "display": str(payload.get("display") or "").strip(),
        "video_bitrate": int(payload.get("video_bitrate") or 3100),
        "video_encoder": str(payload.get("video_encoder") or "auto").strip(),
        "mode": str(payload.get("mode") or "normal").strip(),
        "rtmp_sink": str(payload.get("rtmp_sink") or "ffmpeg").strip(),
        "renderer_url": str(payload.get("renderer_url") or "").strip(),
        "renderer_width": int(payload.get("renderer_width") or 720),
        "renderer_height": int(payload.get("renderer_height") or 1280),
        "renderer_x": int(payload.get("renderer_x") or 0),
        "renderer_y": int(payload.get("renderer_y") or 0),
        "renderer_fullscreen": bool(payload.get("renderer_fullscreen")),
    }
