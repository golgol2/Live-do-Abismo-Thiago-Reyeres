from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse


router = APIRouter(
    prefix="/api/layouts/orbital_cathedral",
    tags=["layout-orbital-cathedral"],
)


@router.get(
    "/info",
    response_class=JSONResponse,
)
def api_orbital_cathedral_info() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "id": "orbital_cathedral",
        "name": "Catedral Orbital",
        "backend": "isolated",
        "legacy_renderer": True,
        "features": [
            "plasma",
            "orbital_floor",
            "music_reactivity",
            "super_cube",
        ],
    })
