from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import DEFAULT_AVATAR, PROJECT_DIR, TEMPLATES_DIR
from boneco_game.services.media_library import VIDEO_EXTENSIONS, avatar_dir, list_media


router = APIRouter()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


def _preset_file(avatar: str) -> Path:
    return avatar_dir(avatar) / "metadata" / "walk_editor_presets.json"


def _source_videos(avatar: str) -> list[Path]:
    videos = list_media(avatar_dir(avatar) / "ANDANDO", VIDEO_EXTENSIONS)
    return sorted(videos, key=lambda path: path.stat().st_mtime if path.exists() else 0, reverse=True)


def _read_presets(avatar: str) -> dict[str, Any]:
    payload = read_json(_preset_file(avatar), {})
    return payload if isinstance(payload, dict) else {}


def _safe_source(avatar: str, source_text: str) -> Path:
    root = (avatar_dir(avatar) / "ANDANDO").resolve()
    source = Path(source_text).expanduser().resolve()
    if root not in source.parents or not source.is_file() or source.suffix.lower() not in VIDEO_EXTENSIONS:
        raise ValueError("Video de origem invalido.")
    return source


def _float(payload: dict[str, Any], key: str, default: float) -> float:
    try:
        return float(payload.get(key, default))
    except (TypeError, ValueError):
        return default


def _int(payload: dict[str, Any], key: str, default: int) -> int:
    try:
        return int(payload.get(key, default))
    except (TypeError, ValueError):
        return default


def _preset_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    start = _float(payload, "start", 1.7)
    accel_end = _float(payload, "accel_end", 3.0)
    loop_start = _float(payload, "loop_start", 3.25)
    loop_end = _float(payload, "loop_end", 7.8)
    decel_start = _float(payload, "decel_start", 8.4)
    stop_end = _float(payload, "stop_end", 14.6)
    if not (0 <= start < loop_start < loop_end < stop_end):
        raise ValueError("Tempos invalidos. Use: inicio < loop inicio < loop fim < parada fim.")
    if not (start <= accel_end <= loop_start):
        raise ValueError("Ponto de aceleracao deve ficar entre inicio do movimento e primeiro passo do loop.")
    if not (loop_end <= decel_start <= stop_end):
        raise ValueError("Ponto de desaceleracao deve ficar entre ultimo passo do loop e fim da parada.")
    return {
        "start": start,
        "accel_end": accel_end,
        "loop_start": loop_start,
        "loop_end": loop_end,
        "decel_start": decel_start,
        "stop_end": stop_end,
        "key_color": str(payload.get("key_color") or "#08dd1d").strip(),
        "similarity": _float(payload, "similarity", 0.165),
        "blend": _float(payload, "blend", 0.09),
        "edge_px": _int(payload, "edge_px", 2),
        "blur_px": _float(payload, "blur_px", 0.7),
        "despill": _float(payload, "despill", 0.75),
        "width": _int(payload, "width", 832),
        "height": _int(payload, "height", 1472),
        "crf": _int(payload, "crf", 18),
        "fit": str(payload.get("fit") or "cover").strip() if str(payload.get("fit") or "cover").strip() in {"cover", "stretch"} else "cover",
    }


def _write_preset(avatar: str, source: Path, preset: dict[str, Any]) -> dict[str, Any]:
    presets = _read_presets(avatar)
    presets[str(source)] = preset
    _preset_file(avatar).parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(_preset_file(avatar), presets)
    return presets


@router.get("/walk-editor", response_class=HTMLResponse)
def walk_editor(request: Request, avatar: str = DEFAULT_AVATAR) -> HTMLResponse:
    videos = _source_videos(avatar)
    return templates.TemplateResponse(
        "walk_editor.html",
        {
            "request": request,
            "avatar": avatar,
            "videos": [{"name": path.name, "path": str(path)} for path in videos],
            "presets": _read_presets(avatar),
        },
    )


@router.post("/api/walk-editor/preset", response_class=JSONResponse)
async def api_save_walk_preset(request: Request, avatar: str = DEFAULT_AVATAR) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    try:
        source = _safe_source(avatar, str(payload.get("source") or ""))
        preset = _preset_from_payload(payload)
        presets = _write_preset(avatar, source, preset)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    return JSONResponse({"ok": True, "source": str(source), "preset": preset, "presets": presets})


@router.post("/api/walk-editor/process", response_class=JSONResponse)
async def api_process_walk(request: Request, avatar: str = DEFAULT_AVATAR) -> JSONResponse:
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    try:
        source = _safe_source(avatar, str(payload.get("source") or ""))
        preset = _preset_from_payload(payload)
        _write_preset(avatar, source, preset)
        logs = _process_walk_phases(avatar, source, preset)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    return JSONResponse({"ok": True, "source": str(source), "preset": preset, "logs": logs})


def _process_walk_phases(avatar: str, source: Path, preset: dict[str, Any]) -> list[str]:
    script = PROJECT_DIR / "scripts" / "process_walk_chromakey.py"
    root = avatar_dir(avatar)
    phases = [
        ("Inicio", preset["start"], preset["loop_start"], 2.25),
        ("Loop", preset["loop_start"], preset["loop_end"], 1.0),
        ("Parando", preset["loop_end"], preset["stop_end"], 2.25),
    ]
    logs: list[str] = []
    # O avatar do mapa 2D corre apenas para a direita. Gerar esquerda por
    # espelhamento inverte detalhes do personagem e quebra a transicao para Mudo.
    for direction, mirror in (("Andando_Direita", False),):
        for phase, start, end, speed in phases:
            destination = root / direction / phase / "01.webm"
            cmd = [
                sys.executable,
                str(script),
                "--source",
                str(source),
                "--destination",
                str(destination),
                "--key-color",
                str(preset["key_color"]),
                "--similarity",
                str(preset["similarity"]),
                "--blend",
                str(preset["blend"]),
                "--edge-px",
                str(preset["edge_px"]),
                "--blur-px",
                str(preset["blur_px"]),
                "--despill",
                str(preset["despill"]),
                "--trim-start",
                str(start),
                "--trim-end",
                str(end),
                "--width",
                str(preset["width"]),
                "--height",
                str(preset["height"]),
                "--fit",
                str(preset["fit"]),
                "--crf",
                str(preset["crf"]),
                "--speed",
                str(speed),
            ]
            if mirror:
                cmd.append("--mirror")
            proc = subprocess.run(cmd, cwd=str(PROJECT_DIR), capture_output=True, text=True, check=False)
            output = "\n".join(part for part in [proc.stdout.strip(), proc.stderr.strip()] if part)
            if proc.returncode != 0:
                raise RuntimeError(f"Falha ao processar {direction}/{phase}: {output}")
            logs.append(output or f"ok {direction}/{phase}")
    return logs
