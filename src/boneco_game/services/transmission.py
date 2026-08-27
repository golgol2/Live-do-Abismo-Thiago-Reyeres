from __future__ import annotations

import os
import signal
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import DEFAULT_HOST, DEFAULT_PORT, PROJECT_DIR, RUNS_DIR
from boneco_game.services.audio_routing import ensure_live_audio_sink, player_sink_for_audio_source, remove_live_audio_sink, reset_live_audio_sink
from boneco_game.services.renderer_window import restart_renderer_window, stop_renderer_window


STATUS_FILE = RUNS_DIR / "transmission_status.json"
LOG_FILE = RUNS_DIR / "transmission.log"


def start_transmission(
    *,
    rtmp_url: str = "",
    output_file: str = "",
    audio_source: str = "",
    display: str = "",
    video_bitrate: int = 3100,
    video_encoder: str = "nvenc",
    mode: str = "normal",
    rtmp_sink: str = "rtmp2sink",
    renderer_url: str = "",
    renderer_width: int = 720,
    renderer_height: int = 1280,
    renderer_x: int = 0,
    renderer_y: int = 0,
    renderer_fullscreen: bool = False,
) -> dict[str, Any]:
    current = status()
    if current.get("running"):
        return current

    if not str(rtmp_url or "").strip() and not str(output_file or "").strip():
        return _write_status(running=False, last_error="Informe RTMP URL ou arquivo de saida.")

    requested_audio_source = str(audio_source or "").strip()
    player_audio_sink = ""
    pulse_module_id = ""
    project_audio_requested = (
        not requested_audio_source
        or requested_audio_source == "tiktok_live_pygame.monitor"
    )
    if project_audio_requested:
        audio_source, player_audio_sink, pulse_module_id = reset_live_audio_sink()
        if not audio_source:
            audio_source = detect_default_monitor_source()
            player_audio_sink = player_sink_for_audio_source(audio_source)
    else:
        audio_source = requested_audio_source
        player_audio_sink = player_sink_for_audio_source(audio_source)
    if not audio_source:
        return _write_status(running=False, last_error="Nenhuma fonte .monitor encontrada para capturar audio.")

    requested_display = str(display or "").strip()
    virtual_display = ""
    virtual_pid = 0
    width = int(renderer_width or 720)
    height = int(renderer_height or 1280)
    if requested_display:
        display = requested_display
    else:
        virtual = _start_virtual_display(width, height)
        virtual_display = str(virtual.get("display") or "")
        virtual_pid = int(virtual.get("pid") or 0)
        if not virtual_display:
            return _write_status(
                running=False,
                last_error=str(virtual.get("last_error") or "Nao foi possivel criar display virtual isolado."),
            )
        display = virtual_display
    mode = "battle" if str(mode or "").lower() == "battle" else "normal"
    default_url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}/renderer" + ("?mode=battle" if mode == "battle" else "")
    url = str(renderer_url or "").strip() or default_url
    if mode == "battle" and "mode=battle" not in url:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}mode=battle"
    renderer = restart_renderer_window(
        url=url,
        width=width,
        height=height,
        x=0 if virtual_display else int(renderer_x or 0),
        y=0 if virtual_display else int(renderer_y or 0),
        fullscreen=bool(renderer_fullscreen or virtual_display),
        display=display,
        pulse_sink=player_audio_sink,
    )
    if not renderer.get("running"):
        _stop_virtual_display_pid(virtual_pid)
        return _write_status(
            running=False,
            display=display,
            virtual_display=virtual_display,
            virtual_pid=0,
            last_error=str(renderer.get("last_error") or "Falha ao abrir renderer."),
        )

    # Evita capturar o primeiro frame preto do Chrome antes do renderer pintar a cena.
    time.sleep(1.2 if virtual_display else 0.4)

    command = [
        shutil.which("python3") or "python3",
        str(PROJECT_DIR / "scripts" / "gst_html_capture_pipeline.py"),
        "--display",
        display,
        "--audio-source",
        audio_source,
        "--video-bitrate",
        str(max(300, int(video_bitrate or 3100))),
        "--video-encoder",
        video_encoder if video_encoder in {"x264", "nvenc", "auto"} else "nvenc",
        "--rtmp-sink",
        rtmp_sink if rtmp_sink in {"ffmpeg", "rtmpsink", "rtmp2sink"} else "rtmp2sink",
    ]
    if output_file:
        command.extend(["--output-file", str(Path(output_file).expanduser())])
    else:
        command.extend(["--rtmp-url", str(rtmp_url).strip()])

    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log_handle = LOG_FILE.open("ab")
    try:
        process = subprocess.Popen(
            command,
            cwd=str(PROJECT_DIR),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except Exception as exc:
        log_handle.close()
        stop_renderer_window()
        _stop_virtual_display_pid(virtual_pid)
        return _write_status(running=False, last_error=f"{type(exc).__name__}: {exc}")
    finally:
        try:
            log_handle.close()
        except Exception:
            pass

    time.sleep(0.8)
    if process.poll() is not None:
        stop_renderer_window()
        _stop_virtual_display_pid(virtual_pid)
        return _write_status(
            running=False,
            pid=0,
            mode=mode,
            display=display,
            virtual_display=virtual_display,
            virtual_pid=0,
            audio_source=audio_source,
            audio_sink=player_audio_sink,
            pulse_module_id=pulse_module_id,
            rtmp_url=str(rtmp_url or ""),
            output_file=str(output_file or ""),
            video_bitrate=int(video_bitrate or 3100),
            video_encoder=video_encoder,
            rtmp_sink=rtmp_sink,
            last_error=f"Streamer encerrou ao iniciar rc={process.returncode}. Veja runs/transmission.log.",
        )

    return _write_status(
        running=True,
        pid=process.pid,
        mode=mode,
        display=display,
        virtual_display=virtual_display,
        virtual_pid=virtual_pid,
        audio_source=audio_source,
        audio_sink=player_audio_sink,
        pulse_module_id=pulse_module_id,
        rtmp_url=str(rtmp_url or ""),
        output_file=str(output_file or ""),
        video_bitrate=int(video_bitrate or 3100),
        video_encoder=video_encoder,
        rtmp_sink=rtmp_sink,
        last_error="",
    )


def stop_transmission() -> dict[str, Any]:
    current = read_json(STATUS_FILE, {})
    pid = int(current.get("pid") or 0) if isinstance(current, dict) else 0
    if pid and _pid_alive(pid):
        try:
            os.killpg(pid, signal.SIGTERM)
        except Exception:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
        deadline = time.time() + 3
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
    stop_renderer_window()
    virtual_pid = int(current.get("virtual_pid") or 0) if isinstance(current, dict) else 0
    _stop_virtual_display_pid(virtual_pid)
    _reap_child_pid(pid)
    remove_live_audio_sink()
    return _write_status(running=False, last_error="Transmissao parada.")


def status() -> dict[str, Any]:
    state = read_json(STATUS_FILE, {})
    if not isinstance(state, dict):
        state = {}
    pid = int(state.get("pid") or 0)
    running = bool(pid and _pid_alive(pid))
    if bool(state.get("running")) and pid and not running:
        stop_renderer_window()
        virtual_pid = int(state.get("virtual_pid") or 0)
        _stop_virtual_display_pid(virtual_pid)
        return _write_status(
            running=False,
            pid=0,
            mode=state.get("mode") or "normal",
            display=os.getenv("DISPLAY", ""),
            virtual_display="",
            virtual_pid=0,
            audio_source=state.get("audio_source") or "",
            audio_sink=state.get("audio_sink") or "",
            pulse_module_id=state.get("pulse_module_id") or "",
            rtmp_url=state.get("rtmp_url") or "",
            output_file=state.get("output_file") or "",
            video_bitrate=int(state.get("video_bitrate") or 3100),
            video_encoder=state.get("video_encoder") or "nvenc",
            rtmp_sink=state.get("rtmp_sink") or "rtmp2sink",
            last_error="Transmissao encerrada inesperadamente. Veja runs/transmission.log.",
        )
    return {
        "running": running,
        "pid": pid if running else 0,
        "mode": state.get("mode") or "normal",
        "display": state.get("display") or os.getenv("DISPLAY", ""),
        "virtual_display": state.get("virtual_display") or "",
        "virtual_pid": int(state.get("virtual_pid") or 0) if _pid_alive(int(state.get("virtual_pid") or 0)) else 0,
        "audio_source": state.get("audio_source") or "",
        "audio_sink": state.get("audio_sink") or "",
        "pulse_module_id": state.get("pulse_module_id") or "",
        "rtmp_url": state.get("rtmp_url") or "",
        "output_file": state.get("output_file") or "",
        "video_bitrate": int(state.get("video_bitrate") or 3100),
        "video_encoder": state.get("video_encoder") or "nvenc",
        "rtmp_sink": state.get("rtmp_sink") or "rtmp2sink",
        "last_error": state.get("last_error") or ("" if running else "Transmissao parada."),
        "updated_at": state.get("updated_at") or 0,
    }


def detect_default_monitor_source() -> str:
    info = _pactl(["info"])
    default_sink = ""
    for line in info.splitlines():
        if line.startswith("Default Sink:"):
            default_sink = line.split(":", 1)[1].strip()
            break
    sources = _list_sources()
    if default_sink and f"{default_sink}.monitor" in sources:
        return f"{default_sink}.monitor"
    for source in sources:
        if source.endswith(".monitor"):
            return source
    return ""


def _list_sources() -> list[str]:
    output = _pactl(["list", "short", "sources"])
    sources: list[str] = []
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            sources.append(parts[1].strip())
    return sources


def _pactl(args: list[str]) -> str:
    try:
        return subprocess.run(["pactl", *args], capture_output=True, text=True, check=False).stdout
    except OSError:
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


def _start_virtual_display(width: int, height: int) -> dict[str, Any]:
    xephyr = shutil.which("Xephyr")
    xdpyinfo = shutil.which("xdpyinfo")
    if not xephyr or not xdpyinfo:
        return {"display": "", "pid": 0, "last_error": "Xephyr/xdpyinfo indisponivel para display virtual."}
    for number in range(98, 110):
        display = f":{number}"
        if subprocess.run([xdpyinfo, "-display", display], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            continue
        process = subprocess.Popen(
            [
                xephyr,
                display,
                "-screen",
                f"{max(320, int(width))}x{max(320, int(height))}",
                "-ac",
                "-br",
                "-noreset",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        deadline = time.time() + 5.0
        while time.time() < deadline:
            if process.poll() is not None:
                break
            if subprocess.run([xdpyinfo, "-display", display], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                return {"display": display, "pid": process.pid, "last_error": ""}
            time.sleep(0.1)
        _stop_virtual_display_pid(process.pid)
    return {"display": "", "pid": 0, "last_error": "Nenhum display virtual livre entre :98 e :109."}


def _stop_virtual_display_pid(pid: int) -> None:
    if not pid:
        return
    if _pid_state(pid) == "Z":
        _reap_child_pid(pid)
        return
    if not _pid_alive(pid):
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except Exception:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            return
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
    _reap_child_pid(pid)


def _reap_child_pid(pid: int) -> None:
    if pid <= 0:
        return
    try:
        os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        pass
    except OSError:
        pass


def _write_status(**payload: Any) -> dict[str, Any]:
    state = {
        "running": False,
        "pid": 0,
        "mode": "normal",
        "display": os.getenv("DISPLAY", ""),
        "virtual_display": "",
        "virtual_pid": 0,
        "audio_source": "",
        "audio_sink": "",
        "pulse_module_id": "",
        "rtmp_url": "",
        "output_file": "",
        "video_bitrate": 3100,
        "video_encoder": "nvenc",
        "rtmp_sink": "rtmp2sink",
        "last_error": "",
        **payload,
        "updated_at": time.time(),
    }
    write_json_atomic(STATUS_FILE, state)
    return state
