from __future__ import annotations

import os
import shutil
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import DEFAULT_HOST, DEFAULT_PORT, RUNS_DIR
from boneco_game.services.audio_routing import append_pulse_props


STATUS_FILE = RUNS_DIR / "renderer_window.json"
PROFILE_DIR = RUNS_DIR / "chrome_renderer_profile"
LOG_FILE = RUNS_DIR / "logs" / "renderer_window.log"


def start_renderer_window(
    *,
    url: str | None = None,
    width: int = 720,
    height: int = 1280,
    x: int = 0,
    y: int = 0,
    fullscreen: bool = False,
    display: str = "",
    pulse_sink: str = "",
) -> dict[str, Any]:
    current = status()
    if current.get("running"):
        return current

    chrome = _chrome_bin()
    if not chrome:
        state = _state(running=False, last_error="Google Chrome/Chromium nao encontrado.")
        _write(state)
        return state

    target_url = str(url or f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/renderer")
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome,
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-translate",
        "--disable-session-crashed-bubble",
            "--disable-infobars",
            "--autoplay-policy=no-user-gesture-required",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-hang-monitor",
            "--lang=pt-BR",
            "--accept-lang=pt-BR,pt,en-US,en",
            "--force-device-scale-factor=1",
            f"--window-size={max(320, int(width))},{max(320, int(height))}",
            f"--window-position={int(x)},{int(y)}",
            "--enable-logging=stderr",
            "--v=0",
    ]
    if "chrome" in Path(chrome).name or "chromium" in Path(chrome).name:
        # Same conservative browser mode used by the old renderer. It avoids
        # Chrome changing the compositor/raster path between runs.
        cmd.extend([
            "--disable-features=Translate,TranslateUI",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-extensions",
            "--disable-sync",
            "--disable-gpu-rasterization",
            "--disable-zero-copy",
            "--disable-accelerated-2d-canvas",
        ])
    if fullscreen:
        cmd.append("--kiosk")
    cmd.append(f"--app={target_url}")

    env = os.environ.copy()
    if display.strip():
        env["DISPLAY"] = display.strip()
    if str(pulse_sink or "").strip():
        env["PULSE_SINK"] = str(pulse_sink).strip()
        env["PULSE_PROP"] = append_pulse_props(env.get("PULSE_PROP", ""))

    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        log_handle = LOG_FILE.open("ab")
        process = subprocess.Popen(
            cmd,
            cwd=str(RUNS_DIR),
            env=env,
            stdout=log_handle,
            stderr=log_handle,
            start_new_session=True,
        )
    except Exception as exc:
        state = _state(running=False, last_error=f"{type(exc).__name__}: {exc}")
        _write(state)
        return state

    state = _state(
        running=True,
        pid=process.pid,
        url=target_url,
        width=max(320, int(width)),
        height=max(320, int(height)),
        x=int(x),
        y=int(y),
        fullscreen=bool(fullscreen),
        display=display.strip() or env.get("DISPLAY", ""),
        pulse_sink=str(pulse_sink or "").strip(),
        last_error="",
    )
    _write(state)
    return state


def stop_renderer_window() -> dict[str, Any]:
    current = read_json(STATUS_FILE, {})
    pid = int(current.get("pid") or 0) if isinstance(current, dict) else 0
    if pid and _pid_alive(pid):
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except Exception:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
        deadline = time.time() + 2.0
        while time.time() < deadline and _pid_alive(pid):
            time.sleep(0.1)
        if _pid_alive(pid):
            try:
                os.killpg(pid, signal.SIGKILL)
            except Exception:
                try:
                    os.kill(pid, signal.SIGKILL)
                except Exception:
                    pass
    state = _state(running=False, last_error="Renderer parado.")
    _write(state)
    return state


def restart_renderer_window(**kwargs: Any) -> dict[str, Any]:
    stop_renderer_window()
    return start_renderer_window(**kwargs)


def status() -> dict[str, Any]:
    state = read_json(STATUS_FILE, {})
    if not isinstance(state, dict):
        state = {}
    pid = int(state.get("pid") or 0)
    running = bool(pid and _pid_alive(pid))
    state = {**_state(running=running), **state, "running": running}
    if pid and not running:
        state["last_error"] = state.get("last_error") or "Processo do renderer nao esta mais ativo."
    return state


def _chrome_bin() -> str:
    configured = os.getenv("BONECO_GAME_CHROME_BIN", "").strip()
    if configured and Path(configured).exists():
        return configured
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "brave-browser"):
        found = shutil.which(name)
        if found:
            return found
    return ""


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return _pid_state(pid) != "Z"


def _pid_state(pid: int) -> str:
    try:
        parts = Path(f"/proc/{pid}/stat").read_text().split()
    except OSError:
        return ""
    return parts[2] if len(parts) > 2 else ""


def _state(**overrides: Any) -> dict[str, Any]:
    return {
        "running": False,
        "pid": 0,
        "url": f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/renderer",
        "width": 720,
        "height": 1280,
        "x": 0,
        "y": 0,
        "fullscreen": False,
        "display": os.getenv("DISPLAY", ""),
        "pulse_sink": "",
        "last_error": "",
        "updated_at": time.time(),
        **overrides,
    }


def _write(state: dict[str, Any]) -> None:
    payload = {**state, "updated_at": time.time()}
    write_json_atomic(STATUS_FILE, payload)
