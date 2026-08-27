from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from boneco_game.core.settings import TEMPLATES_DIR
from boneco_game.services import live_events
from boneco_game.services.event_decision_worker import status as decision_worker_status
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
from boneco_game.services.runtime_state import read_state, update_state
from boneco_game.services.speech_queue import enqueue_text, status
from boneco_game.services.tiktok_monitor import start_monitor, status as monitor_status, stop_monitor
from boneco_game.services.transmission import start_transmission, status as transmission_status, stop_transmission


router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/", response_class=HTMLResponse)
def panel(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("panel.html", {"request": request, "state": read_state()})


@router.get("/api/status", response_class=JSONResponse)
def api_status() -> JSONResponse:
    live = live_status()
    return JSONResponse({
        "state": read_state(),
        "queue": status(),
        "events": live_events.status(),
        "decision_worker": decision_worker_status(),
        "monitor": live.get("monitor") or monitor_status(),
        "renderer_window": renderer_window_status(),
        "transmission": transmission_status(),
        "live": live,
    })


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
    if not text:
        return JSONResponse({"ok": False, "error": "Texto vazio."}, status_code=400)
    job = enqueue_text(text, actor=actor, priority=90, metadata={"source": "manual"})
    return JSONResponse({"ok": True, "job": job.to_dict()})


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
        metadata={"source": "api"},
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
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse({"ok": True, "renderer_window": start_renderer_window(**_renderer_window_payload(payload))})


@router.post("/api/renderer-window/stop", response_class=JSONResponse)
def api_renderer_window_stop() -> JSONResponse:
    return JSONResponse({"ok": True, "renderer_window": stop_renderer_window()})


@router.post("/api/renderer-window/restart", response_class=JSONResponse)
async def api_renderer_window_restart(request: Request) -> JSONResponse:
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
