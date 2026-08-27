from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from boneco_game.core.settings import ASSETS_DIR, STATIC_DIR, ensure_runtime_dirs
from boneco_game.routes import map_editor, panel, renderer, walk_editor
from boneco_game.services.event_decision_worker import start_event_decision_worker, stop_event_decision_worker
from boneco_game.services.live_events import reset_event_state
from boneco_game.services.speech_queue import reset_speech_queues
from boneco_game.services.tts_worker import start_tts_worker, stop_tts_worker


def create_app() -> FastAPI:
    ensure_runtime_dirs()
    app = FastAPI(title="Boneco Game", version="0.1.0")
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
    app.include_router(panel.router)
    app.include_router(renderer.router)
    app.include_router(map_editor.router)
    app.include_router(walk_editor.router)

    @app.on_event("startup")
    def _startup() -> None:
        reset_event_state()
        reset_speech_queues()
        start_tts_worker()
        start_event_decision_worker()

    @app.on_event("shutdown")
    def _shutdown() -> None:
        stop_event_decision_worker()
        stop_tts_worker()

    return app


app = create_app()
