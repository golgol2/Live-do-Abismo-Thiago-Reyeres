from __future__ import annotations

import time
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import DEFAULT_HOST, DEFAULT_PORT, LIVE_CONTROL_CONFIG_FILE, RUNS_DIR
from boneco_game.services.audio_routing import ensure_live_audio_sink, player_sink_for_audio_source
from boneco_game.services.credentials import StreamlabsCredentialProvider, end_streamlabs_live_if_saved
from boneco_game.services.renderer_window import restart_renderer_window, status as renderer_window_status
from boneco_game.services.runtime_state import read_state, update_state
from boneco_game.services.live_events import reset_event_state
from boneco_game.services.layout_manager import (
    cancel_layout_session,
    confirm_layout_session,
    reserve_layout_session,
)
from boneco_game.services.speech_queue import push_ready, reset_speech_queues
from boneco_game.services.text_ai import generate_live_opening
from boneco_game.services.tts_service import synthesize_for_job
from boneco_game.services.tiktok_monitor import start_monitor, status as monitor_status, stop_monitor
from boneco_game.services.transmission import start_transmission, status as transmission_status, stop_transmission


STATUS_FILE = RUNS_DIR / "live_control_status.json"

_LAST_MONITOR_RECOVERY = 0.0


def default_live_config() -> dict[str, Any]:
    return {
        "enabled": False,
        "username": "bonecodoabismo",
        "monitor_server": "http://127.0.0.1:2618",
        "mode": "normal",
        "title": "Live Do Boneco do Abismo",
        "game": "Others",
        "audience_type": "0",
        "auto_streamlabs": True,
        "rtmp_url": "",
        "output_file": "",
        "video_bitrate": 3100,
        "video_encoder": "nvenc",
        "rtmp_sink": "rtmp2sink",
        "display": "",
        "audio_source": "",
        "renderer_url": f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/renderer",
        "renderer_width": 720,
        "renderer_height": 1280,
        "renderer_x": 0,
        "renderer_y": 0,
        "renderer_fullscreen": False,
        "auto_start_enabled": False,
        "start_min_seconds": 3600,
        "start_max_seconds": 5400,
        "stop_min_seconds": 3000,
        "stop_max_seconds": 4200,
    }


def load_live_config() -> dict[str, Any]:
    raw = read_json(LIVE_CONTROL_CONFIG_FILE, {})
    if not isinstance(raw, dict):
        raw = {}
    return normalize_live_config({**default_live_config(), **raw})


def save_live_config(payload: dict[str, Any]) -> dict[str, Any]:
    current = load_live_config()
    current.update(payload or {})
    config = normalize_live_config(current)
    write_json_atomic(LIVE_CONTROL_CONFIG_FILE, config)
    _write_status({"state": "config_saved", "updated_at": time.time()})
    return public_live_config()


def public_live_config() -> dict[str, Any]:
    return {
        **load_live_config(),
        "file": str(LIVE_CONTROL_CONFIG_FILE),
        "status": status(),
    }


def start_live(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    config = load_live_config()
    if payload:
        config.update(payload)
        config = normalize_live_config(config)
        write_json_atomic(LIVE_CONTROL_CONFIG_FILE, config)

    live = status()
    if live.get("running"):
        return _result(True, "running", "Live ja esta rodando.", config)

    transmission = transmission_status()
    if transmission.get("running"):
        return _result(True, "running", "Live ja esta rodando.", config)

    reset_event_state()
    reset_speech_queues()

    _write_status({"state": "preparing_opening", "running": False, "message": "Gerando abertura e aquecendo TTS.", "updated_at": time.time()})
    try:
        opening = _prepare_live_opening()
    except Exception as exc:
        reset_speech_queues()
        return _result(False, "error", f"Falha ao preparar abertura da live: {exc}", config, opening={"prepared": False, "error": str(exc)})

    previous_state = read_state()

    previous_layout = str(
        previous_state.get("active_layout")
        or "classic"
    )

    layout_session = reserve_layout_session(
        previous_layout=str(
            previous_layout
            or ""
        )
    )

    layout_session_id = str(
        layout_session.get("layout_session_id")
        or ""
    )

    active_layout = str(
        layout_session.get("active_layout")
        or "classic"
    )

    mode = "battle" if config.get("mode") == "battle" else "normal"

    update_state(
        mode=mode,
        current_actor="main",
        camera={"x": 0, "y": 0, "zoom": 1.06 if mode == "battle" else 1},
    )

    rtmp_url = str(config.get("rtmp_url") or "").strip()
    output_file = str(config.get("output_file") or "").strip()
    streamlabs_info: dict[str, Any] = {"auto": bool(config.get("auto_streamlabs"))}
    if bool(config.get("auto_streamlabs")) and not output_file:
        startup_end = end_streamlabs_live_if_saved()
        try:
            credentials = StreamlabsCredentialProvider().start_live(
                title=str(config.get("title") or "Live Do Boneco do Abismo"),
                game=str(config.get("game") or "Others"),
                audience_type=str(config.get("audience_type") or "0"),
            )
        except RuntimeError as exc:
            cancel_layout_session(
                layout_session_id
            )
            return _result(False, "error", str(exc) or "Falha ao gerar credenciais Streamlabs.", config)
        rtmp_url = credentials.rtmp_url
        streamlabs_info = {
            "auto": True,
            "stream_id": credentials.stream_id,
            "title": credentials.title,
            "category": credentials.category,
            "cleanup": startup_end,
        }

    has_stream_destination = bool(rtmp_url or output_file)
    if not has_stream_destination:
        local_audio_source = str(config.get("audio_source") or "").strip()
        player_audio_sink = player_sink_for_audio_source(local_audio_source)
        if player_audio_sink:
            ensure_live_audio_sink()
        renderer = restart_renderer_window(
            url=_renderer_url(config, mode),
            width=int(config.get("renderer_width") or 720),
            height=int(config.get("renderer_height") or 1280),
            x=int(config.get("renderer_x") or 0),
            y=int(config.get("renderer_y") or 0),
            fullscreen=bool(config.get("renderer_fullscreen")),
            display=str(config.get("display") or ""),
            pulse_sink=player_audio_sink,
        )
        if not renderer.get("running"):
            cancel_layout_session(
                layout_session_id
            )
            return _result(False, "error", str(renderer.get("last_error") or "Falha ao abrir renderer."), config, renderer=renderer)
        monitor = start_monitor(
            str(config.get("username") or "").strip(),
            server_url=str(config.get("monitor_server") or "http://127.0.0.1:2618").strip(),
        )
        confirm_layout_session(
            layout_session_id
        )
        return _result(True, "running", "Live HDMI/Live Studio iniciada com abertura preparada.", config, monitor=monitor, renderer=renderer, opening=opening, transport="local")

    transmission = start_transmission(
        rtmp_url=rtmp_url,
        output_file=output_file,
        audio_source=str(config.get("audio_source") or ""),
        display=str(config.get("display") or ""),
        video_bitrate=int(config.get("video_bitrate") or 3100),
        video_encoder=str(config.get("video_encoder") or "nvenc"),
        mode=mode,
        rtmp_sink=str(config.get("rtmp_sink") or "rtmp2sink"),
        renderer_url=str(config.get("renderer_url") or ""),
        renderer_width=int(config.get("renderer_width") or 720),
        renderer_height=int(config.get("renderer_height") or 1280),
        renderer_x=int(config.get("renderer_x") or 0),
        renderer_y=int(config.get("renderer_y") or 0),
        renderer_fullscreen=bool(config.get("renderer_fullscreen")),
    )
    if not transmission.get("running"):
        if streamlabs_info.get("auto"):
            streamlabs_info["start_failed_cleanup"] = end_streamlabs_live_if_saved()

        cancel_layout_session(
            layout_session_id
        )

        return _result(
            False,
            "error",
            str(transmission.get("last_error") or "Falha ao iniciar transmissao."),
            config,
            streamlabs=streamlabs_info,
            transport="direct",
        )

    confirm_layout_session(
        layout_session_id
    )

    monitor = start_monitor(
        str(config.get("username") or "").strip(),
        server_url=str(config.get("monitor_server") or "http://127.0.0.1:2618").strip(),
    )
    return _result(True, "running", "Live iniciada com abertura preparada.", config, monitor=monitor, transmission=transmission, streamlabs=streamlabs_info, opening=opening, transport="direct")


def stop_live() -> dict[str, Any]:
    transmission = stop_transmission()
    monitor = stop_monitor()
    streamlabs_end = end_streamlabs_live_if_saved()
    reset_event_state()
    reset_speech_queues()
    return _result(
        True,
        "stopped",
        "Live parada.",
        load_live_config(),
        monitor=monitor,
        transmission=transmission,
        streamlabs={"end": streamlabs_end},
        transport="stopped",
    )


def status() -> dict[str, Any]:
    current = read_json(STATUS_FILE, {})
    if not isinstance(current, dict):
        current = {}
    transmission = transmission_status()
    monitor = monitor_status()
    renderer = renderer_window_status()
    transport = str(current.get("transport") or "")
    if current.get("state") == "running" and transport == "direct":
        running = bool(transmission.get("running"))
        if not running:
            current = {
                "state": "error",
                "running": False,
                "message": transmission.get("last_error") or "Transmissao encerrada inesperadamente.",
                "transport": "stopped",
                "updated_at": time.time(),
            }
            _write_status(current)
            transport = "stopped"
    else:
        running = bool(transmission.get("running") or (current.get("state") == "running" and (renderer.get("running") or monitor.get("running"))))
    if running:
        monitor = _recover_monitor_if_needed(monitor)
    state = "running" if running else ("error" if current.get("state") == "error" else "stopped")
    return {
        "state": state,
        "running": running,
        "message": current.get("message") or "",
        "updated_at": current.get("updated_at") or 0,
        "transmission": transmission,
        "monitor": monitor,
        "renderer_window": renderer,
        "transport": transport,
    }


def _recover_monitor_if_needed(monitor: dict[str, Any]) -> dict[str, Any]:
    global _LAST_MONITOR_RECOVERY
    config = load_live_config()
    username = str(config.get("username") or "").strip().lstrip("@")
    if not username:
        return monitor
    now = time.time()
    updated_at = float(monitor.get("updated_at") or 0)
    dead = not bool(monitor.get("running")) or not bool(monitor.get("thread_alive"))
    stale = bool(monitor.get("running")) and not bool(monitor.get("listening")) and updated_at > 0 and (now - updated_at) >= 30
    if not (dead or stale):
        return monitor
    if now - _LAST_MONITOR_RECOVERY < 20:
        return monitor
    _LAST_MONITOR_RECOVERY = now
    return start_monitor(
        username,
        server_url=str(config.get("monitor_server") or "http://127.0.0.1:2618").strip(),
    )


def normalize_live_config(raw: dict[str, Any]) -> dict[str, Any]:
    base = default_live_config()
    mode = str(raw.get("mode") or base["mode"]).strip().lower()
    encoder = str(raw.get("video_encoder") or base["video_encoder"]).strip().lower()
    sink = str(raw.get("rtmp_sink") or base["rtmp_sink"]).strip().lower()
    return {
        **base,
        "enabled": _bool(raw.get("enabled"), base["enabled"]),
        "username": str(raw.get("username") or base["username"]).strip().lstrip("@"),
        "monitor_server": str(raw.get("monitor_server") or base["monitor_server"]).strip(),
        "mode": "battle" if mode == "battle" else "normal",
        "title": str(raw.get("title") or base["title"]).strip()[:120] or base["title"],
        "game": str(raw.get("game") or base["game"]).strip()[:80] or base["game"],
        "audience_type": "1" if str(raw.get("audience_type") or base["audience_type"]).strip() == "1" else "0",
        "auto_streamlabs": _bool(raw.get("auto_streamlabs"), base["auto_streamlabs"]),
        "rtmp_url": str(raw.get("rtmp_url") or "").strip(),
        "output_file": str(raw.get("output_file") or "").strip(),
        "video_bitrate": _clamp_int(raw.get("video_bitrate"), base["video_bitrate"], 300, 12000),
        "video_encoder": encoder if encoder in {"auto", "x264", "nvenc"} else "nvenc",
        "rtmp_sink": sink if sink in {"ffmpeg", "rtmpsink", "rtmp2sink"} else "rtmp2sink",
        "display": str(raw.get("display") or "").strip(),
        "audio_source": str(raw.get("audio_source") or "").strip(),
        "renderer_url": str(raw.get("renderer_url") or base["renderer_url"]).strip(),
        "renderer_width": _clamp_int(raw.get("renderer_width"), base["renderer_width"], 320, 3840),
        "renderer_height": _clamp_int(raw.get("renderer_height"), base["renderer_height"], 320, 3840),
        "renderer_x": _clamp_int(raw.get("renderer_x"), base["renderer_x"], -10000, 10000),
        "renderer_y": _clamp_int(raw.get("renderer_y"), base["renderer_y"], -10000, 10000),
        "renderer_fullscreen": _bool(raw.get("renderer_fullscreen"), base["renderer_fullscreen"]),
        "auto_start_enabled": _bool(raw.get("auto_start_enabled"), base["auto_start_enabled"]),
        "start_min_seconds": _clamp_int(raw.get("start_min_seconds"), base["start_min_seconds"], 60, 86400),
        "start_max_seconds": _clamp_int(raw.get("start_max_seconds"), base["start_max_seconds"], 60, 86400),
        "stop_min_seconds": _clamp_int(raw.get("stop_min_seconds"), base["stop_min_seconds"], 60, 86400),
        "stop_max_seconds": _clamp_int(raw.get("stop_max_seconds"), base["stop_max_seconds"], 60, 86400),
    }


def _result(
    ok: bool,
    state: str,
    message: str,
    config: dict[str, Any],
    *,
    monitor: dict[str, Any] | None = None,
    transmission: dict[str, Any] | None = None,
    renderer: dict[str, Any] | None = None,
    streamlabs: dict[str, Any] | None = None,
    opening: dict[str, Any] | None = None,
    transport: str = "",
) -> dict[str, Any]:
    payload = {
        "state": state,
        "running": state == "running",
        "message": message,
        "transport": transport,
        "updated_at": time.time(),
    }
    _write_status(payload)
    return {
        "ok": bool(ok),
        "live": {
            **payload,
            "config": config,
            "monitor": monitor or monitor_status(),
            "transmission": transmission or transmission_status(),
            "renderer_window": renderer or renderer_window_status(),
            "streamlabs": streamlabs or {},
            "opening": opening or {},
        },
    }



def _prepare_live_opening() -> dict[str, Any]:
    import uuid

    started_at = time.time()
    text = generate_live_opening(max_chars=600)
    speech = synthesize_for_job(text)
    job = {
        "id": uuid.uuid4().hex,
        "actor": "main",
        "text": text,
        "audio_path": str(speech.get("audio_path") or ""),
        "timeline_path": str(speech.get("timeline_path") or ""),
        "timeline": speech.get("timeline") or {},
        "priority": 120,
        "metadata": {
            "source": "live_opening",
            "created_at": started_at,
            "prepared_at": time.time(),
            "chunks": speech.get("chunks") or [],
            "tts_input": speech.get("tts_input") or text,
            "voice_speed": speech.get("voice_speed"),
            "voice_pitch": speech.get("voice_pitch"),
        },
    }
    push_ready(job)
    return {
        "prepared": True,
        "text": text,
        "audio_path": job["audio_path"],
        "timeline_path": job["timeline_path"],
        "chunks": job["metadata"]["chunks"],
        "prepare_seconds": round(time.time() - started_at, 3),
    }


def _renderer_url(config: dict[str, Any], mode: str) -> str:
    url = str(config.get("renderer_url") or f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/renderer").strip()
    if mode == "battle" and "mode=battle" not in url:
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}mode=battle"
    return url


def _write_status(payload: dict[str, Any]) -> None:
    write_json_atomic(STATUS_FILE, payload)


def _clamp_int(value: object, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(float(str(value)))
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {"1", "true", "sim", "yes", "on"}:
        return True
    if text in {"0", "false", "nao", "não", "no", "off"}:
        return False
    return default
