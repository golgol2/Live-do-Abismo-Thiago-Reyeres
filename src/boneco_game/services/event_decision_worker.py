from __future__ import annotations

import threading
import time
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.services import live_events
from boneco_game.services.speech_queue import enqueue_text, status as speech_status
from boneco_game.services.text_ai import generate_chat_reply, generate_gift_thank_you
from boneco_game.services.live_text import display_name, gift_display_name


WORKER_STATUS_FILE = RUNS_DIR / "event_decision_worker_status.json"
_WORKER_THREAD: threading.Thread | None = None
_STOP = threading.Event()

def start_event_decision_worker() -> None:
    global _WORKER_THREAD
    if _WORKER_THREAD and _WORKER_THREAD.is_alive():
        return
    _STOP.clear()
    _write_status({"state": "starting", "updated_at": time.time()})
    _WORKER_THREAD = threading.Thread(target=_worker_loop, name="boneco-game-event-decision", daemon=True)
    _WORKER_THREAD.start()


def stop_event_decision_worker() -> None:
    _STOP.set()
    _write_status({"state": "stopping", "updated_at": time.time()})


def status() -> dict[str, Any]:
    return read_json(WORKER_STATUS_FILE, {"state": "unknown"})


def _worker_loop() -> None:
    while not _STOP.is_set():
        queue_status = speech_status()
        if _speech_pipeline_busy(queue_status):
            _write_status({"state": "waiting_speech_queue", "updated_at": time.time()})
            time.sleep(0.25)
            continue

        event = live_events.pop_next_event()
        if not event:
            _write_status({"state": "idle", "updated_at": time.time()})
            time.sleep(0.2)
            continue
        if live_events.is_stale_event(event):
            _write_status({
                "state": "ignored_stale_event",
                "event_id": event.get("id"),
                "event_kind": event.get("kind"),
                "updated_at": time.time(),
            })
            time.sleep(0.05)
            continue

        _write_status({
            "state": "deciding",
            "event_id": event.get("id"),
            "event_kind": event.get("kind"),
            "updated_at": time.time(),
        })
        text, priority = _text_for_event(event)
        if text:
            event_kind = str(event.get("kind") or "").strip().lower()
            enqueue_text(
                text,
                actor="main",
                priority=priority,
                metadata={
                    "source": "event_decision",
                    "event": event,
                    "counts_as_reaction_response": event_kind in {"comment", "gift"},
                },
            )
        _write_status({
            "state": "queued_speech" if text else "ignored_event",
            "event_id": event.get("id"),
            "event_kind": event.get("kind"),
            "updated_at": time.time(),
        })
        time.sleep(0.08)


def _text_for_event(event: dict[str, Any]) -> tuple[str, int]:
    kind = str(event.get("kind") or "")
    if kind == "system":
        return _clip(str(event.get("text") or ""), 170), int(event.get("priority") or 80)
    if kind == "gift":
        name = _event_name(event)
        metadata = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        gift = gift_display_name(metadata.get("gift_name") or event.get("text") or "presente")
        count = int(metadata.get("count") or 1)
        text = generate_gift_thank_you(name, gift, count, max_chars=150)
        return _clip(text, 150), 95
    if kind == "comment":
        name = _event_name(event)
        message = str(event.get("text") or "").strip()
        text = generate_chat_reply(
            name,
            message,
            language=str(event.get("language") or "pt"),
            max_chars=150,
            user_key=str(event.get("username") or name),
        )
        return _clip(text, 150), 45
    return "", 0


def _speech_pipeline_busy(queue_status: dict[str, Any]) -> bool:
    manual_sequence = (
        queue_status.get("manual_sequence")
        if isinstance(queue_status.get("manual_sequence"), dict)
        else {}
    )
    if bool(manual_sequence.get("active")):
        return True

    if int(queue_status.get("pending_size") or 0) or int(queue_status.get("ready_size") or 0):
        return True

    worker = queue_status.get("worker") if isinstance(queue_status.get("worker"), dict) else {}
    return str(worker.get("state") or "") in {"starting", "preparing", "prepared"}


def _event_name(event: dict[str, Any]) -> str:
    display = str(event.get("display_name") or "").strip()
    username = str(event.get("username") or "").strip()
    return display_name(display or username or "visitante")


def _clip(text: str, limit: int) -> str:
    clean = " ".join(str(text or "").split())
    if len(clean) <= limit:
        return clean
    return clean[: max(1, limit - 1)].rstrip(" ,.;:") + "."


def _write_status(payload: dict[str, Any]) -> None:
    try:
        write_json_atomic(WORKER_STATUS_FILE, payload)
    except OSError:
        pass
