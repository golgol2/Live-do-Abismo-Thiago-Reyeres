from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from PIL import Image, UnidentifiedImageError

from boneco_game.core.settings import DEFAULT_AVATAR, DEFAULT_MAP, TEMPLATES_DIR
from boneco_game.services.map_service import read_map, save_map
from boneco_game.services.media_library import IMAGE_EXTENSIONS, avatar_dir, list_avatar_videos, list_media


router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
SKIP_ASSET_DIRS = {"bkp", "backup", "__pycache__", ".git", "metadata"}


@router.get("/map-editor", response_class=HTMLResponse)
def map_editor(request: Request, avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> HTMLResponse:
    idle_videos = list_avatar_videos(avatar, "Mudo")
    return templates.TemplateResponse(
        "map_editor.html",
        {
            "request": request,
            "avatar": avatar,
            "map_name": map_name,
            "idle_video": str(idle_videos[0]) if idle_videos else "",
        },
    )


@router.get("/api/map", response_class=JSONResponse)
def api_get_map(avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> JSONResponse:
    return JSONResponse(read_map(avatar, map_name))


@router.post("/api/map", response_class=JSONResponse)
async def api_save_map(request: Request, avatar: str = DEFAULT_AVATAR, map_name: str = DEFAULT_MAP) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return JSONResponse(save_map(payload, avatar, map_name))


@router.get("/api/map/assets", response_class=JSONResponse)
def api_map_assets(avatar: str = DEFAULT_AVATAR) -> JSONResponse:
    root = avatar_dir(avatar)
    candidates = []
    if not root.exists():
        return JSONResponse({"assets": candidates})

    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        relative_parts = path.relative_to(root).parts
        if any(part.lower() in SKIP_ASSET_DIRS for part in relative_parts):
            continue
        category = _asset_category(root, path)
        candidates.append({
            "name": path.name,
            "path": str(path),
            "asset": str(path.relative_to(root.parent)),
            "category": category,
            **_image_dimensions(path),
        })
    return JSONResponse({"assets": candidates})


def _asset_category(root: Path, path: Path) -> str:
    try:
        parts = path.parent.relative_to(root).parts
    except ValueError:
        return "Outros"
    if not parts:
        return "Raiz"
    if parts[0] == "IMGS_EDIÇAO":
        return "Edição"
    if parts[0] == "Mapas":
        if len(parts) >= 3:
            return f"Mapa / {parts[2]}"
        if len(parts) >= 2:
            return f"Mapa / {parts[1]}"
        return "Mapas"
    return " / ".join(parts[:2])


def _image_dimensions(path: Path) -> dict[str, int]:
    try:
        with Image.open(path) as image:
            width, height = image.size
    except (OSError, UnidentifiedImageError):
        return {}
    return {"width": int(width), "height": int(height)}
