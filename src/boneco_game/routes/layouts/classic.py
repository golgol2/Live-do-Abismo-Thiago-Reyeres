from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse


router = APIRouter(
    prefix="/api/layouts/classic",
    tags=["layout-classic"],
)


@router.get(
    "/info",
    response_class=JSONResponse,
)
def api_classic_info() -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "id": "classic",
        "name": "Túnel Classic",
        "backend": "isolated",
        "legacy_renderer": True,
    })
