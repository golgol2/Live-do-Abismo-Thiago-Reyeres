from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from boneco_game.core.settings import ASSETS_DIR, STATIC_DIR, ensure_runtime_dirs
from boneco_game.routes import panel, renderer
from boneco_game.routes.layouts import include_layout_routers
from boneco_game.services.event_decision_worker import start_event_decision_worker, stop_event_decision_worker
from boneco_game.services.live_health import start_live_health_worker, stop_live_health_worker
from boneco_game.services.live_scheduler import start_live_scheduler, stop_live_scheduler
from boneco_game.services.tts_worker import start_tts_worker, stop_tts_worker


def create_app() -> FastAPI:
    ensure_runtime_dirs()
    app = FastAPI(title="Boneco Game", version="0.1.0")
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
    app.include_router(panel.router)
    app.include_router(renderer.router)
    app.state.layout_router_errors = include_layout_routers(app)

    @app.on_event("startup")
    def _startup() -> None:
        start_tts_worker()
        start_event_decision_worker()
        start_live_health_worker()
        start_live_scheduler()

    @app.on_event("shutdown")
    def _shutdown() -> None:
        stop_live_scheduler()
        stop_live_health_worker()
        stop_event_decision_worker()
        stop_tts_worker()

    return app


app = create_app()
