from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse


router = APIRouter(
    prefix="/api/layouts/neon_triangle_tower",
    tags=["layout-neon-triangle-tower"],
)


@router.get(
    "/info",
    response_class=JSONResponse,
)
def api_neon_triangle_tower_info() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "id": "neon_triangle_tower",
        "name": "Torre Triangular Neon",
        "backend": "isolated",
        "legacy_renderer": False,
        "features": [
            "dark_triangle_floor",
            "rgb_energy_lines",
            "music_geometry",
            "user_photo_cube_tower",
        ],
    })
