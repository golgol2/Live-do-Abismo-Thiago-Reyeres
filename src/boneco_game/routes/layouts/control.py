from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from boneco_game.services.layout_manager import (
    public_layout_state,
    save_layout_config,
)


router = APIRouter(
    prefix="/api/layouts",
    tags=["layouts"],
)


@router.get("", response_class=JSONResponse)
def api_layouts() -> JSONResponse:
    return JSONResponse(
        public_layout_state()
    )


@router.post(
    "/config",
    response_class=JSONResponse,
)
async def api_layout_config(
    request: Request,
) -> JSONResponse:
    payload = await request.json()

    if not isinstance(payload, dict):
        payload = {}

    try:
        state = save_layout_config(
            layout_mode=payload.get(
                "layout_mode"
            ),
            manual_layout=payload.get(
                "manual_layout"
            ),
            enabled_layouts=payload.get(
                "enabled_layouts"
            ),
        )

    except ValueError as exc:
        return JSONResponse(
            {
                "ok": False,
                "error": str(exc),
            },
            status_code=400,
        )

    return JSONResponse({
        "ok": True,
        "layout": state,
        "applies_to_next_live": True,
    })
