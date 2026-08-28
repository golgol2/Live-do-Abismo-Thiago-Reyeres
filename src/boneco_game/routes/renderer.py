from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from boneco_game.core.settings import ASSETS_DIR, PROJECT_DIR, TEMPLATES_DIR
from boneco_game.services.runtime_state import renderer_state
from boneco_game.services.speech_queue import acknowledge_speech_finished, pop_next


router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@router.get("/renderer", response_class=HTMLResponse)
def renderer(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("renderer.html", {"request": request})


@router.get("/api/renderer/state", response_class=JSONResponse)
def api_renderer_state() -> JSONResponse:
    return JSONResponse(renderer_state())


@router.get("/api/renderer/next-speech", response_class=JSONResponse)
def api_next_speech() -> JSONResponse:
    job = pop_next()
    return JSONResponse({"job": job})


@router.post("/api/renderer/speech-finished", response_class=JSONResponse)
async def api_speech_finished(request: Request) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}

    result = acknowledge_speech_finished(
        str(payload.get("job_id") or ""),
        sequence_id=str(payload.get("manual_sequence_id") or ""),
        sequence_index=payload.get("manual_sequence_index"),
    )

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
