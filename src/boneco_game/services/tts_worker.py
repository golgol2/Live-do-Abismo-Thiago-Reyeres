from __future__ import annotations

import threading
import time
from typing import Any

from boneco_game.core.json_store import write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.services.speech_queue import pop_pending, prepare_pending_job, push_ready


_WORKER_THREAD: threading.Thread | None = None
_STOP = threading.Event()
WORKER_STATUS_FILE = RUNS_DIR / "tts_worker_status.json"


def start_tts_worker() -> None:
    global _WORKER_THREAD
    if _WORKER_THREAD and _WORKER_THREAD.is_alive():
        return
    _STOP.clear()
    _write_status({"state": "starting", "updated_at": time.time()})
    _WORKER_THREAD = threading.Thread(target=_worker_loop, name="boneco-game-tts-worker", daemon=True)
    _WORKER_THREAD.start()


def stop_tts_worker() -> None:
    _STOP.set()
    _write_status({"state": "stopping", "updated_at": time.time()})


def _worker_loop() -> None:
    while not _STOP.is_set():
        job = pop_pending()
        if not job:
            _write_status({"state": "idle", "updated_at": time.time()})
            time.sleep(0.18)
            continue
        _write_status({
            "state": "preparing",
            "job_id": job.get("id"),
            "actor": job.get("actor"),
            "text": str(job.get("text") or "")[:220],
            "started_at": time.time(),
            "updated_at": time.time(),
        })
        try:
            ready = prepare_pending_job(job)
            _write_status({
                "state": "prepared",
                "job_id": job.get("id"),
                "updated_at": time.time(),
            })
        except Exception as exc:
            metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
            job["metadata"] = {**metadata, "prepare_error": f"{type(exc).__name__}: {exc}"}
            ready = job
            _write_status({
                "state": "error",
                "job_id": job.get("id"),
                "error": f"{type(exc).__name__}: {exc}",
                "updated_at": time.time(),
            })
        push_ready(ready)


def _write_status(payload: dict[str, Any]) -> None:
    try:
        write_json_atomic(WORKER_STATUS_FILE, payload)
    except OSError:
        pass
