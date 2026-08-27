from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.models import MicroSegment, SpeechJob
from boneco_game.services.tts_service import PREPARED_AUDIO_DIR, synthesize_for_job


PENDING_QUEUE_FILE = RUNS_DIR / "speech_pending_queue.json"
READY_QUEUE_FILE = RUNS_DIR / "speech_ready_queue.json"
WORKER_STATUS_FILE = RUNS_DIR / "tts_worker_status.json"
QUEUE_RESET_FILE = RUNS_DIR / "speech_queue_reset.json"
READY_JOB_MAX_AGE_SECONDS = 90.0
PENDING_JOB_MAX_AGE_SECONDS = 120.0


def reset_speech_queues() -> None:
    write_json_atomic(QUEUE_RESET_FILE, {"reset_at": time.time()})
    write_json_atomic(PENDING_QUEUE_FILE, [])
    write_json_atomic(READY_QUEUE_FILE, [])
    cleanup_prepared_speech_files()


def cleanup_prepared_speech_files() -> int:
    removed = 0
    if not PREPARED_AUDIO_DIR.is_dir():
        return removed
    for path in PREPARED_AUDIO_DIR.iterdir():
        if path.is_file() and path.name.startswith("speech_") and path.suffix.lower() in {".wav", ".json"}:
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def _read_queue(path: Path) -> list[dict[str, Any]]:
    payload = read_json(path, [])
    return payload if isinstance(payload, list) else []


def enqueue_text(
    text: str,
    *,
    actor: str = "main",
    priority: int = 40,
    metadata: dict[str, Any] | None = None,
    prepare_audio: bool = True,
) -> SpeechJob:
    job = SpeechJob(
        id=uuid.uuid4().hex,
        actor=actor if actor in {"main", "dj", "oracle", "guest", "user"} else "main",
        text=str(text or "").strip(),
        priority=int(priority),
        metadata={
            "created_at": time.time(),
            "prepare_audio": bool(prepare_audio),
            **(metadata or {}),
        },
    )
    queue = _read_queue(PENDING_QUEUE_FILE if prepare_audio else READY_QUEUE_FILE)
    queue.append(job.to_dict())
    queue.sort(key=lambda item: (-int(item.get("priority") or 0), float(item.get("metadata", {}).get("created_at") or 0)))
    write_json_atomic(PENDING_QUEUE_FILE if prepare_audio else READY_QUEUE_FILE, queue[:50])
    return job


def pop_pending() -> dict[str, Any] | None:
    queue = _pruned_queue(PENDING_QUEUE_FILE, max_age=PENDING_JOB_MAX_AGE_SECONDS)
    if not queue:
        return None
    job = queue.pop(0)
    write_json_atomic(PENDING_QUEUE_FILE, queue)
    return job if isinstance(job, dict) else None


def push_ready(job: dict[str, Any]) -> None:
    if _job_before_last_reset(job):
        return
    queue = _read_queue(READY_QUEUE_FILE)
    queue.append(job)
    queue.sort(key=lambda item: (-int(item.get("priority") or 0), float(item.get("metadata", {}).get("created_at") or 0)))
    write_json_atomic(READY_QUEUE_FILE, queue[:50])


def prepare_pending_job(job: dict[str, Any]) -> dict[str, Any]:
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    voice_path = Path(str(metadata.get("voice_path") or "")) if metadata.get("voice_path") else None
    synth_kwargs: dict[str, Any] = {
        "speed": metadata.get("voice_speed") if metadata.get("voice_speed") is not None else None,
        "pitch": metadata.get("voice_pitch") if metadata.get("voice_pitch") is not None else None,
    }
    if voice_path and voice_path.is_file():
        synth_kwargs["voice_path"] = voice_path
    speech_payload = synthesize_for_job(str(job.get("text") or ""), **synth_kwargs)
    raw_timeline = speech_payload.get("timeline")
    raw_segments = raw_timeline.get("segments") if isinstance(raw_timeline, dict) else raw_timeline
    timeline = [
        MicroSegment(
            kind=str(item.get("kind") or "speech"),
            start=float(item.get("start") or 0.0),
            end=float(item.get("end") or 0.0),
            duration=float(item.get("duration") or 0.0),
            energy=float(item.get("energy") or 0.0),
        ).to_dict()
        for item in (raw_segments if isinstance(raw_segments, list) else [])
        if isinstance(item, dict)
    ]
    timeline_payload = {
        **(raw_timeline if isinstance(raw_timeline, dict) else {}),
        "segments": timeline,
    }
    job["audio_path"] = str(speech_payload.get("audio_path") or "")
    job["timeline_path"] = str(speech_payload.get("timeline_path") or "")
    job["timeline"] = timeline_payload
    job["metadata"] = {
        **metadata,
        "chunks": speech_payload.get("chunks") or [],
        "timeline_path": speech_payload.get("timeline_path") or "",
        "tts_input": speech_payload.get("tts_input") or "",
        "voice_speed": speech_payload.get("voice_speed"),
        "voice_pitch": speech_payload.get("voice_pitch"),
        "prepared_at": time.time(),
    }
    return job


def pop_next() -> dict[str, Any] | None:
    queue = _pruned_queue(READY_QUEUE_FILE, max_age=READY_JOB_MAX_AGE_SECONDS)
    if not queue:
        return None
    job = queue.pop(0)
    write_json_atomic(READY_QUEUE_FILE, queue)
    return job if isinstance(job, dict) else None


def status() -> dict[str, Any]:
    pending = _pruned_queue(PENDING_QUEUE_FILE, max_age=PENDING_JOB_MAX_AGE_SECONDS)
    ready = _pruned_queue(READY_QUEUE_FILE, max_age=READY_JOB_MAX_AGE_SECONDS)
    return {
        "pending_size": len(pending),
        "ready_size": len(ready),
        "next_pending": pending[0] if pending else None,
        "next_ready": ready[0] if ready else None,
        "worker": read_json(WORKER_STATUS_FILE, {"state": "unknown"}),
    }


def _pruned_queue(path: Path, *, max_age: float) -> list[dict[str, Any]]:
    queue = _read_queue(path)
    now = time.time()
    fresh = [job for job in queue if not _job_too_old(job, now=now, max_age=max_age)]
    if len(fresh) != len(queue):
        write_json_atomic(path, fresh)
    return fresh


def _job_too_old(job: dict[str, Any], *, now: float, max_age: float) -> bool:
    created_at = _job_created_at(job)
    return created_at > 0 and now - created_at > max_age


def _job_before_last_reset(job: dict[str, Any]) -> bool:
    reset = read_json(QUEUE_RESET_FILE, {})
    reset_at = float(reset.get("reset_at") or 0) if isinstance(reset, dict) else 0.0
    created_at = _job_created_at(job)
    return reset_at > 0 and created_at > 0 and created_at < reset_at


def _job_created_at(job: dict[str, Any]) -> float:
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    candidates = [metadata.get("created_at"), metadata.get("prepared_at")]
    event = metadata.get("event") if isinstance(metadata.get("event"), dict) else {}
    if event:
        candidates.append(event.get("created_at"))
    values: list[float] = []
    for value in candidates:
        try:
            parsed = float(value or 0)
        except (TypeError, ValueError):
            parsed = 0.0
        if parsed > 0:
            values.append(parsed)
    return min(values) if values else 0.0
