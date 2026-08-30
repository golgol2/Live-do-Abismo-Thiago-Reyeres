from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import ASSETS_DIR, PROJECT_DIR, RUNS_DIR

STATUS_FILE = RUNS_DIR / "background_removal_status.json"
PROCESS_SCRIPT = PROJECT_DIR / "scripts" / "process_green_avatar_videos.sh"
SUPPORTED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
MODES = ("Falando", "Mudo", "Risadas")

_LOCK = threading.Lock()
_WORKER: threading.Thread | None = None


def pending_videos(avatar: str = "BONECO_MAPA_2D") -> list[dict[str, str]]:
    safe_avatar = _safe_avatar(avatar)
    avatar_dir = ASSETS_DIR / safe_avatar
    pending: list[dict[str, str]] = []
    for mode in MODES:
        source_dir = avatar_dir / mode / "FUNDO_VERDE"
        output_dir = avatar_dir / mode
        if not source_dir.is_dir():
            continue
        for source in sorted(source_dir.iterdir(), key=lambda item: item.name.casefold()):
            if not source.is_file() or source.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            destination = output_dir / f"{source.stem}.webm"
            try:
                up_to_date = destination.is_file() and destination.stat().st_mtime >= source.stat().st_mtime
            except OSError:
                up_to_date = False
            if up_to_date:
                continue
            pending.append({
                "mode": mode,
                "source": str(source),
                "destination": str(destination),
                "name": source.name,
            })
    return pending


def status(avatar: str = "BONECO_MAPA_2D") -> dict[str, Any]:
    safe_avatar = _safe_avatar(avatar)
    stored = read_json(STATUS_FILE, {})
    result = stored if isinstance(stored, dict) else {}
    running = _is_running(safe_avatar)

    if result.get("state") in {"running", "starting"} and not running:
        result = {
            **result,
            "running": False,
            "state": "interrupted",
            "message": "Processamento interrompido antes de concluir.",
            "finished_at": time.time(),
        }
        _write_status(result)

    pending = pending_videos(safe_avatar)
    result = {
        **result,
        "avatar": safe_avatar,
        "running": running,
        "pending": len(pending) if not running else int(result.get("pending") or 0),
    }
    if running and str(result.get("state") or "") in {"error", "interrupted", "idle", "done", "partial"}:
        result = {
            **result,
            "ok": True,
            "state": "running",
            "running": True,
            "message": "Processamento em andamento...",
            "finished_at": None,
        }
    if (
        not running
        and str(result.get("state") or "") == "error"
        and PROCESS_SCRIPT.is_file()
        and "Script não encontrado" in f"{result.get('message') or ''} {result.get('error') or ''}"
    ):
        result = {
            "ok": True,
            "avatar": safe_avatar,
            "running": False,
            "state": "idle",
            "pending": len(pending),
            "total": 0,
            "completed": 0,
            "progress": 0,
            "current_file": "",
            "message": "Script encontrado. Pronto para processar vídeos pendentes.",
            "log_tail": [],
        }
        _write_status(result)
    if not running and str(result.get("state") or "") in {"error", "interrupted"}:
        if not pending:
            result = {
                "ok": True,
                "avatar": safe_avatar,
                "running": False,
                "state": "done",
                "pending": 0,
                "total": int(result.get("total") or 0),
                "completed": int(result.get("total") or result.get("completed") or 0),
                "progress": 100,
                "current_file": "",
                "message": "Processamento concluído.",
                "finished_at": time.time(),
                "log_tail": result.get("log_tail") if isinstance(result.get("log_tail"), list) else [],
            }
            _write_status(result)
        elif "código -15" in f"{result.get('message') or ''} {result.get('error') or ''}":
            result = {
                "ok": True,
                "avatar": safe_avatar,
                "running": False,
                "state": "idle",
                "pending": len(pending),
                "total": 0,
                "completed": 0,
                "progress": 0,
                "current_file": "",
                "message": "Pronto para processar vídeos pendentes.",
                "log_tail": [],
            }
            _write_status(result)
    if not result:
        result = {
            "avatar": safe_avatar,
            "running": False,
            "state": "idle",
            "pending": len(pending),
            "total": 0,
            "completed": 0,
            "progress": 0,
            "current_file": "",
            "message": "Pronto para processar vídeos pendentes.",
            "log_tail": [],
        }
    result.setdefault("state", "idle")
    result.setdefault("total", 0)
    result.setdefault("completed", 0)
    result.setdefault("progress", 0)
    result.setdefault("current_file", "")
    result.setdefault("message", "Pronto para processar vídeos pendentes.")
    result.setdefault("log_tail", [])
    return result


def start(avatar: str = "BONECO_MAPA_2D", *, force: bool = False) -> dict[str, Any]:
    global _WORKER
    safe_avatar = _safe_avatar(avatar)
    with _LOCK:
        if _is_running(safe_avatar):
            return {**status(safe_avatar), "ok": False, "error": "Já existe um processamento em andamento."}

        pending = pending_videos(safe_avatar)
        if not pending and not force:
            payload = {
                "ok": True,
                "avatar": safe_avatar,
                "state": "done",
                "running": False,
                "pending": 0,
                "total": 0,
                "completed": 0,
                "progress": 100,
                "current_file": "",
                "message": "Nenhum vídeo pendente para processar.",
                "started_at": time.time(),
                "finished_at": time.time(),
                "log_tail": [],
            }
            _write_status(payload)
            return payload

        payload = {
            "ok": True,
            "avatar": safe_avatar,
            "state": "starting",
            "running": True,
            "pending": len(pending),
            "total": len(pending),
            "completed": 0,
            "progress": 0,
            "current_file": "",
            "message": f"Preparando {len(pending)} vídeo(s) pendente(s)...",
            "started_at": time.time(),
            "finished_at": None,
            "log_tail": [],
        }
        _write_status(payload)
        _WORKER = threading.Thread(
            target=_run,
            args=(safe_avatar, bool(force), len(pending)),
            name="boneco-game-background-removal",
            daemon=True,
        )
        _WORKER.start()
        return payload


def _run(avatar: str, force: bool, total: int) -> None:
    env = os.environ.copy()
    env["BONECO_GAME_DIR"] = str(PROJECT_DIR)
    env["FORCE"] = "1" if force else "0"
    command = [str(PROCESS_SCRIPT), avatar]
    completed = 0
    current_file = ""
    log_tail: list[str] = []
    started_at = time.time()

    try:
        if not PROCESS_SCRIPT.is_file():
            raise FileNotFoundError(f"Script não encontrado: {PROCESS_SCRIPT}")

        proc = subprocess.Popen(
            command,
            cwd=str(PROJECT_DIR),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None

        for raw_line in proc.stdout:
            line = raw_line.rstrip()
            if not line:
                continue
            log_tail.append(line)
            log_tail = log_tail[-12:]

            if line.startswith("processando "):
                source = line[len("processando "):].split(" -> ", 1)[0].strip()
                current_file = Path(source).name
            elif line.startswith("ok "):
                completed = min(total, completed + 1)
                current_file = ""

            progress = 100 if total <= 0 else int(round((completed / total) * 100))
            _write_status({
                "ok": True,
                "avatar": avatar,
                "state": "running",
                "running": True,
                "pending": max(0, total - completed),
                "total": total,
                "completed": completed,
                "progress": progress,
                "current_file": current_file,
                "message": f"Processando {current_file}" if current_file else "Processando vídeos...",
                "started_at": started_at,
                "finished_at": None,
                "log_tail": log_tail,
            })

        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"Processador encerrou com código {rc}.")

        remaining = pending_videos(avatar)
        final_completed = max(completed, max(0, total - len(remaining)))
        _write_status({
            "ok": not remaining,
            "avatar": avatar,
            "state": "done" if not remaining else "partial",
            "running": False,
            "pending": len(remaining),
            "total": total,
            "completed": final_completed,
            "progress": 100 if not remaining else int(round((final_completed / max(1, total)) * 100)),
            "current_file": "",
            "message": "Processamento concluído." if not remaining else f"Processamento terminou com {len(remaining)} vídeo(s) ainda pendente(s).",
            "started_at": started_at,
            "finished_at": time.time(),
            "log_tail": log_tail,
        })
    except Exception as exc:
        _write_status({
            "ok": False,
            "avatar": avatar,
            "state": "error",
            "running": False,
            "pending": len(pending_videos(avatar)),
            "total": total,
            "completed": completed,
            "progress": int(round((completed / max(1, total)) * 100)),
            "current_file": current_file,
            "message": str(exc),
            "error": f"{type(exc).__name__}: {exc}",
            "started_at": started_at,
            "finished_at": time.time(),
            "log_tail": log_tail,
        })


def _safe_avatar(value: str) -> str:
    avatar = str(value or "BONECO_MAPA_2D").strip()
    if not avatar or avatar in {".", ".."} or "/" in avatar or "\\" in avatar:
        raise ValueError("Avatar inválido.")
    return avatar


def _is_running(avatar: str) -> bool:
    if _WORKER and _WORKER.is_alive():
        return True
    script = str(PROCESS_SCRIPT)
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            raw = (entry / "cmdline").read_bytes()
        except OSError:
            continue
        if not raw:
            continue
        args = [part.decode("utf-8", errors="ignore") for part in raw.split(b"\0") if part]
        if len(args) < 2:
            continue
        if script in args and avatar in args:
            return True
    return False


def _write_status(payload: dict[str, Any]) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    write_json_atomic(STATUS_FILE, payload)
