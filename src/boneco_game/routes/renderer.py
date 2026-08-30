from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from boneco_game.core.json_store import write_json_atomic
from boneco_game.core.settings import ASSETS_DIR, PROJECT_DIR, RUNS_DIR, TEMPLATES_DIR
from boneco_game.services import preview_events
from boneco_game.services.runtime_state import renderer_state
from boneco_game.services.speech_queue import acknowledge_speech_finished, cleanup_speech_job_files, pop_next


router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
RENDERER_HEARTBEAT_FILE = RUNS_DIR / "renderer_heartbeat.json"


@router.get("/renderer", response_class=HTMLResponse)
def renderer(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("renderer.html", {"request": request})


@router.get("/api/renderer/state", response_class=JSONResponse)
def api_renderer_state() -> JSONResponse:
    return JSONResponse(renderer_state())


@router.post("/api/renderer/heartbeat", response_class=JSONResponse)
async def api_renderer_heartbeat(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    safe = {
        "updated_at": time.time(),
        "preview": bool(payload.get("preview")),
        "active_layout": str(payload.get("active_layout") or ""),
        "visual_mode": str(payload.get("visual_mode") or ""),
        "current_scene": str(payload.get("current_scene") or ""),
        "speech_busy": bool(payload.get("speech_busy")),
        "speech_fetch_busy": bool(payload.get("speech_fetch_busy")),
        "reaction_busy": bool(payload.get("reaction_busy")),
        "active_speech_job_id": str(payload.get("active_speech_job_id") or ""),
        "speech_age_ms": float(payload.get("speech_age_ms") or 0),
        "speech_deadline_ms": float(payload.get("speech_deadline_ms") or 0),
        "location": str(payload.get("location") or ""),
        "phase": str(payload.get("phase") or ""),
        "error": str(payload.get("error") or ""),
        "source": str(payload.get("source") or ""),
        "lineno": int(payload.get("lineno") or 0),
        "colno": int(payload.get("colno") or 0),
        "game_loop_age_ms": float(payload.get("game_loop_age_ms") or 0),
        "tunnel_draw_age_ms": float(payload.get("tunnel_draw_age_ms") or 0),
        "active_video_paused": bool(payload.get("active_video_paused")),
        "active_video_ended": bool(payload.get("active_video_ended")),
        "active_video_ready_state": int(payload.get("active_video_ready_state") or 0),
        "active_video_current_time": float(payload.get("active_video_current_time") or 0),
        "active_video_duration": float(payload.get("active_video_duration") or 0),
        "idle_full_play": bool(payload.get("idle_full_play")),
        "idle_full_play_age_ms": float(payload.get("idle_full_play_age_ms") or 0),
        "current_video": str(payload.get("current_video") or ""),
        "video_watchdog_presented_frames": int(payload.get("video_watchdog_presented_frames") or 0),
        "video_watchdog_age_ms": float(payload.get("video_watchdog_age_ms") or 0),
        "general_video_watchdog_recovering": bool(payload.get("general_video_watchdog_recovering")),
        "general_video_watchdog_age_ms": float(payload.get("general_video_watchdog_age_ms") or 0),
    }

    write_json_atomic(RENDERER_HEARTBEAT_FILE, safe)

    return JSONResponse({"ok": True})


def _is_preview_request(request: Request) -> bool:
    return str(
        request.query_params.get("preview") or ""
    ).strip() == "1"


@router.get("/api/renderer/preview-events", response_class=JSONResponse)
def api_preview_events(
    request: Request,
    after: int = 0,
) -> JSONResponse:
    if not _is_preview_request(request):
        return JSONResponse(
            {
                "ok": False,
                "error": "Rota disponível apenas para preview.",
            },
            status_code=403,
        )

    payload = preview_events.events_after(after)

    return JSONResponse({
        "ok": True,
        "preview": True,
        **payload,
    })


@router.get("/api/renderer/next-speech", response_class=JSONResponse)
def api_next_speech(request: Request) -> JSONResponse:
    if _is_preview_request(request):
        return JSONResponse({
            "job": None,
            "preview": True,
            "consumed": False,
        })

    job = pop_next()
    return JSONResponse({"job": job})


@router.post("/api/renderer/speech-finished", response_class=JSONResponse)
async def api_speech_finished(request: Request) -> JSONResponse:
    if _is_preview_request(request):
        return JSONResponse({
            "ok": True,
            "preview": True,
            "acknowledged": False,
        })

    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    removed_files = cleanup_speech_job_files(
        str(payload.get("audio_path") or ""),
        str(payload.get("timeline_path") or ""),
    )

    result = acknowledge_speech_finished(
        str(payload.get("job_id") or ""),
        sequence_id=str(payload.get("manual_sequence_id") or ""),
        sequence_index=payload.get("manual_sequence_index"),
    )
    result["removed_files"] = removed_files

    return JSONResponse(
        result,
        status_code=200 if result.get("ok") else 400,
    )


@router.get("/file")
def file_response(path: str) -> FileResponse:
    raw = Path(path)
    if not raw.is_absolute():
        raw = PROJECT_DIR / raw
    resolved = raw.resolve()
    allowed_roots = [PROJECT_DIR.resolve(), ASSETS_DIR.resolve()]
    if not any(str(resolved).startswith(str(root)) for root in allowed_roots):
        raise FileNotFoundError("Arquivo fora do projeto.")
    return FileResponse(
        str(resolved),
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )
