from __future__ import annotations

import os
import subprocess
import threading
import time
from typing import Any

from boneco_game.core.settings import PROJECT_DIR, RUNS_DIR

REMOTE = "origin"
BRANCH = "main"
RESTART_SCRIPT = PROJECT_DIR / "scripts" / "start_clean_panel.sh"
UPDATE_LOG = RUNS_DIR / "system_update.log"

_LOCK = threading.Lock()


def status(*, fetch: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": True,
        "project_dir": str(PROJECT_DIR),
        "remote": REMOTE,
        "branch": BRANCH,
        "fetch_attempted": bool(fetch),
        "fetch_ok": None,
        "fetch_error": "",
    }
    if not (PROJECT_DIR / ".git").is_dir():
        return {**result, "ok": False, "error": "A pasta do projeto não é um repositório Git."}

    if fetch:
        fetched = _git(["fetch", "--prune", REMOTE, BRANCH], timeout=45)
        result["fetch_ok"] = fetched["returncode"] == 0
        result["fetch_error"] = fetched["stderr"] if fetched["returncode"] else ""
        if fetched["returncode"] != 0:
            return {**result, "ok": False, "error": fetched["stderr"] or "Falha ao consultar o GitHub."}

    local_sha = _git_text(["rev-parse", "HEAD"])
    remote_sha = _git_text(["rev-parse", f"{REMOTE}/{BRANCH}"])
    branch = _git_text(["branch", "--show-current"]) or BRANCH
    dirty_lines = _git_lines(["status", "--porcelain=v1", "--untracked-files=all"])

    ahead = behind = 0
    if local_sha and remote_sha:
        counts = _git_text(["rev-list", "--left-right", "--count", f"HEAD...{REMOTE}/{BRANCH}"]).split()
        if len(counts) >= 2:
            try:
                ahead, behind = int(counts[0]), int(counts[1])
            except ValueError:
                pass

    changed_files = _git_lines(["diff", "--name-only", f"HEAD..{REMOTE}/{BRANCH}"]) if behind > 0 else []
    return {
        **result,
        "branch": branch,
        "local_sha": local_sha,
        "local_short": local_sha[:8] if local_sha else "",
        "remote_sha": remote_sha,
        "remote_short": remote_sha[:8] if remote_sha else "",
        "ahead": ahead,
        "behind": behind,
        "update_available": behind > 0,
        "dirty": bool(dirty_lines),
        "dirty_files": dirty_lines[:80],
        "changed_files": changed_files[:120],
        "can_update": behind > 0 and not dirty_lines and ahead == 0 and branch == BRANCH,
        "restart_available": RESTART_SCRIPT.is_file(),
    }


def update() -> dict[str, Any]:
    with _LOCK:
        before = status(fetch=True)
        if not before.get("ok"):
            return before
        if before.get("branch") != BRANCH:
            return {**before, "ok": False, "error": f"Branch atual é {before.get('branch')!r}; atualização automática só é permitida na {BRANCH!r}."}
        if before.get("dirty"):
            return {**before, "ok": False, "error": "Existem alterações locais. Faça commit, stash ou reverta antes de atualizar."}
        if int(before.get("ahead") or 0) > 0:
            return {**before, "ok": False, "error": "A cópia local possui commits que ainda não estão no GitHub. Envie-os antes de atualizar."}
        if not before.get("update_available"):
            return {**before, "ok": True, "updated": False, "message": "O sistema já está atualizado.", "restart_required": False}

        pulled = _git(["pull", "--ff-only", REMOTE, BRANCH], timeout=120)
        _append_log(f"[{time.strftime('%F %T')}] git pull --ff-only {REMOTE} {BRANCH}\n{pulled['stdout']}\n{pulled['stderr']}\n")
        if pulled["returncode"] != 0:
            return {**before, "ok": False, "updated": False, "error": pulled["stderr"] or pulled["stdout"] or "Falha ao atualizar o sistema."}

        after = status(fetch=False)
        return {
            **after,
            "ok": True,
            "updated": True,
            "message": "Atualização baixada com sucesso. Reinicie o sistema para carregar o novo código.",
            "restart_required": True,
            "pull_output": (pulled["stdout"] or pulled["stderr"])[-6000:],
        }


def schedule_restart(delay_seconds: float = 1.2) -> dict[str, Any]:
    if not RESTART_SCRIPT.is_file():
        return {"ok": False, "error": f"Script de reinicialização não encontrado: {RESTART_SCRIPT}"}
    launcher = f'sleep {max(0.5, float(delay_seconds)):.2f}; exec "{RESTART_SCRIPT}" >> "{UPDATE_LOG}" 2>&1'
    env = os.environ.copy()
    env["BONECO_GAME_DIR"] = str(PROJECT_DIR)
    try:
        subprocess.Popen(
            ["bash", "-lc", launcher],
            cwd=str(PROJECT_DIR),
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        return {"ok": False, "error": f"Não foi possível agendar a reinicialização: {exc}"}
    return {"ok": True, "scheduled": True, "message": "Reinicialização agendada. O painel ficará indisponível por alguns segundos."}


def _git(args: list[str], *, timeout: float = 30) -> dict[str, Any]:
    try:
        proc = subprocess.run(["git", *args], cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=max(3.0, timeout), check=False)
        return {"returncode": proc.returncode, "stdout": (proc.stdout or "").strip(), "stderr": (proc.stderr or "").strip()}
    except subprocess.TimeoutExpired:
        return {"returncode": 124, "stdout": "", "stderr": "Tempo limite excedido."}
    except OSError as exc:
        return {"returncode": 127, "stdout": "", "stderr": str(exc)}


def _git_text(args: list[str]) -> str:
    result = _git(args)
    return result["stdout"] if result["returncode"] == 0 else ""


def _git_lines(args: list[str]) -> list[str]:
    return [line.strip() for line in _git_text(args).splitlines() if line.strip()]


def _append_log(text: str) -> None:
    try:
        RUNS_DIR.mkdir(parents=True, exist_ok=True)
        with UPDATE_LOG.open("a", encoding="utf-8") as handle:
            handle.write(text.rstrip() + "\n")
    except OSError:
        pass
