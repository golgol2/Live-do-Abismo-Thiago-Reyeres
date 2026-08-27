from __future__ import annotations

import threading
import time
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.services.live_control import load_live_config, status as live_status
from boneco_game.services.speech_queue import status as speech_status
from boneco_game.services.tiktok_monitor import start_monitor, status as monitor_status, stop_monitor

STATUS_FILE = RUNS_DIR / "live_health_status.json"
CHECK_INTERVAL_SECONDS = 5.0
MONITOR_GRACE_SECONDS = 45.0
RECOVERY_COOLDOWN_SECONDS = 60.0
SILENCE_NOTICE_SECONDS = 120.0

_THREAD = None
_STOP = threading.Event()
_LOCK = threading.Lock()

_last_monitor_total = 0
_last_monitor_activity_at = 0.0
_unhealthy_since = 0.0
_last_recovery_at = 0.0
_recovery_count = 0


def start_live_health_worker() -> None:
    global _THREAD
    with _LOCK:
        if _THREAD and _THREAD.is_alive():
            return
        _STOP.clear()
        _THREAD = threading.Thread(target=_loop, name="boneco-game-live-health", daemon=True)
        _THREAD.start()


def stop_live_health_worker() -> None:
    _STOP.set()


def status() -> dict[str, Any]:
    current = read_json(STATUS_FILE, {})
    return current if isinstance(current, dict) else {}


def run_check_once(*, allow_recovery: bool = True) -> dict[str, Any]:
    global _last_monitor_total, _last_monitor_activity_at
    global _unhealthy_since, _last_recovery_at, _recovery_count

    now = time.time()
    live = live_status()
    monitor = live.get("monitor") if isinstance(live.get("monitor"), dict) else monitor_status()
    queue = speech_status()
    config = load_live_config()

    running = bool(live.get("running"))
    counters = monitor.get("counters") if isinstance(monitor.get("counters"), dict) else {}
    monitor_total = sum(max(0, _safe_int(value)) for value in counters.values())

    if _last_monitor_activity_at <= 0:
        _last_monitor_activity_at = now
    if monitor_total > _last_monitor_total:
        _last_monitor_activity_at = now
    _last_monitor_total = monitor_total

    network = monitor.get("network") if isinstance(monitor.get("network"), dict) else {}
    tor_ok = str(network.get("mode") or "").strip().lower() == "tor" and bool(network.get("forced"))

    thread_alive = bool(monitor.get("thread_alive"))
    connected = bool(monitor.get("connected"))
    listening = bool(monitor.get("listening"))

    technical_problem = running and (not thread_alive or not connected or not listening)
    if technical_problem:
        if _unhealthy_since <= 0:
            _unhealthy_since = now
    else:
        _unhealthy_since = 0.0

    unhealthy_for = max(0.0, now - _unhealthy_since) if _unhealthy_since > 0 else 0.0
    silence_for = max(0.0, now - _last_monitor_activity_at)

    health = "stopped"
    message = "Live parada."
    recovery = {"attempted": False}

    if running:
        if not tor_ok:
            health = "critical"
            message = "Monitor sem confirmação de Tor obrigatório. Recuperação automática direta bloqueada."
        elif technical_problem:
            health = "recovering" if unhealthy_for >= MONITOR_GRACE_SECONDS else "attention"
            message = (
                f"Monitor TikTok degradado há {int(unhealthy_for)}s: "
                f"thread={thread_alive}, connected={connected}, listening={listening}."
            )
            if allow_recovery and unhealthy_for >= MONITOR_GRACE_SECONDS and now - _last_recovery_at >= RECOVERY_COOLDOWN_SECONDS:
                recovery = _recover_monitor(config, now)
                if recovery.get("ok"):
                    _last_recovery_at = now
                    _recovery_count += 1
                    _unhealthy_since = now
                    health = "recovering"
                    message = "Monitor TikTok reiniciado automaticamente mantendo Tor obrigatório."
                else:
                    health = "critical"
                    message = f"Falha na recuperação automática do monitor: {recovery.get('error') or 'erro desconhecido'}"
        else:
            health = "healthy"
            if silence_for >= SILENCE_NOTICE_SECONDS:
                message = (
                    f"Monitor saudável, mas sem novos eventos contabilizados há {int(silence_for)}s. "
                    "Isso pode ser apenas silêncio da audiência."
                )
            else:
                message = "Transmissão e monitor TikTok saudáveis."

    payload = {
        "state": health,
        "message": message,
        "live_running": running,
        "checked_at": now,
        "monitor": {
            "running": bool(monitor.get("running")),
            "thread_alive": thread_alive,
            "connected": connected,
            "listening": listening,
            "username": str(monitor.get("username") or ""),
            "viewer_count": _safe_int(monitor.get("viewer_count")),
            "viewer_count_known": bool(monitor.get("viewer_count_known")),
            "last_event": str(monitor.get("last_event") or ""),
            "last_error": str(monitor.get("last_error") or ""),
            "counters": counters,
            "events_total": monitor_total,
            "silence_seconds": round(silence_for, 1),
            "unhealthy_seconds": round(unhealthy_for, 1),
        },
        "tor": {
            "ok": tor_ok,
            "mode": str(network.get("mode") or "unknown"),
            "forced": bool(network.get("forced")),
            "detail": str(network.get("detail") or ""),
        },
        "speech": {
            "pending_size": _safe_int(queue.get("pending_size")),
            "ready_size": _safe_int(queue.get("ready_size")),
            "worker": queue.get("worker") if isinstance(queue.get("worker"), dict) else {},
        },
        "recovery": {
            **recovery,
            "count": _recovery_count,
            "last_recovery_at": _last_recovery_at,
            "cooldown_seconds": RECOVERY_COOLDOWN_SECONDS,
        },
        "thresholds": {
            "monitor_grace_seconds": MONITOR_GRACE_SECONDS,
            "silence_notice_seconds": SILENCE_NOTICE_SECONDS,
            "recovery_cooldown_seconds": RECOVERY_COOLDOWN_SECONDS,
        },
    }
    _write_status(payload)
    return payload


def _loop() -> None:
    while not _STOP.is_set():
        try:
            run_check_once(allow_recovery=True)
        except Exception as exc:
            _write_status({
                "state": "error",
                "message": f"Erro no autodiagnóstico: {type(exc).__name__}: {exc}",
                "checked_at": time.time(),
            })
        _STOP.wait(CHECK_INTERVAL_SECONDS)


def _recover_monitor(config: dict[str, Any], now: float) -> dict[str, Any]:
    username = str(config.get("username") or "").strip().lstrip("@")
    server_url = str(config.get("monitor_server") or "http://127.0.0.1:2618").strip()
    if not username:
        return {"attempted": True, "ok": False, "error": "Usuário TikTok vazio.", "at": now}

    try:
        before = monitor_status()
        stop_monitor()
        time.sleep(1.0)
        after = start_monitor(username, server_url=server_url)
    except Exception as exc:
        return {"attempted": True, "ok": False, "error": f"{type(exc).__name__}: {exc}", "at": now}

    return {
        "attempted": True,
        "ok": bool(after.get("running")),
        "at": now,
        "before": {
            "thread_alive": bool(before.get("thread_alive")),
            "connected": bool(before.get("connected")),
            "listening": bool(before.get("listening")),
            "last_error": str(before.get("last_error") or ""),
        },
        "after": {
            "running": bool(after.get("running")),
            "thread_alive": bool(after.get("thread_alive")),
            "connected": bool(after.get("connected")),
            "listening": bool(after.get("listening")),
            "last_error": str(after.get("last_error") or ""),
        },
    }


def _safe_int(value: object) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _write_status(payload: dict[str, Any]) -> None:
    try:
        write_json_atomic(STATUS_FILE, payload)
    except OSError:
        pass
