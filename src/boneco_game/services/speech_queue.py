from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.models import MicroSegment, SpeechJob
from boneco_game.services.tts_service import PREPARED_AUDIO_DIR, safe_tts_chunks, synthesize_for_job


PENDING_QUEUE_FILE = RUNS_DIR / "speech_pending_queue.json"
READY_QUEUE_FILE = RUNS_DIR / "speech_ready_queue.json"
WORKER_STATUS_FILE = RUNS_DIR / "tts_worker_status.json"
QUEUE_RESET_FILE = RUNS_DIR / "speech_queue_reset.json"
MANUAL_SEQUENCE_FILE = RUNS_DIR / "speech_manual_sequence.json"
READY_JOB_MAX_AGE_SECONDS = 90.0
PENDING_JOB_MAX_AGE_SECONDS = 120.0
MANUAL_SEQUENCE_MAX_CHARS = 150
MANUAL_SEQUENCE_PREFETCH = 2


def reset_speech_queues() -> None:
    write_json_atomic(QUEUE_RESET_FILE, {"reset_at": time.time()})
    write_json_atomic(PENDING_QUEUE_FILE, [])
    write_json_atomic(READY_QUEUE_FILE, [])
    write_json_atomic(MANUAL_SEQUENCE_FILE, {"active": False, "reset_at": time.time()})
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


def cleanup_speech_job_files(
    *paths: str,
) -> int:
    removed = 0
    try:
        base = PREPARED_AUDIO_DIR.resolve()
    except OSError:
        return removed

    for raw in paths:
        if not raw:
            continue

        try:
            path = Path(str(raw)).resolve()
        except OSError:
            continue

        if path.parent != base:
            continue

        if (
            path.is_file()
            and path.name.startswith("speech_")
            and path.suffix.lower() in {".wav", ".json"}
        ):
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


def enqueue_manual_sequence(
    text: str,
    *,
    actor: str = "main",
    priority: int = 90,
    manual_music_path: str = "",
) -> dict[str, Any]:
    chunks = safe_tts_chunks(
        str(text or ""),
        max_chars=MANUAL_SEQUENCE_MAX_CHARS,
    )
    chunks = [
        str(chunk).strip()
        for chunk in chunks
        if str(chunk or "").strip()
    ]
    if not chunks:
        raise ValueError("Texto vazio.")

    current = _read_manual_sequence()
    if bool(current.get("active")):
        raise RuntimeError("Já existe uma leitura manual em andamento.")

    now = time.time()
    state: dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "active": True,
        "actor": actor if actor in {"main", "dj", "oracle", "guest", "user"} else "main",
        "priority": int(priority),
        "chunks": chunks,
        "manual_music_path": str(manual_music_path or "").strip(),
        "next_enqueue_index": 0,
        "last_finished_index": -1,
        "created_at": now,
        "updated_at": now,
    }

    write_json_atomic(MANUAL_SEQUENCE_FILE, state)
    _fill_manual_sequence_window(state)
    write_json_atomic(MANUAL_SEQUENCE_FILE, state)
    return _public_manual_sequence(state)


def manual_sequence_status() -> dict[str, Any]:
    return _public_manual_sequence(_read_manual_sequence())


def acknowledge_speech_finished(
    job_id: str,
    *,
    sequence_id: str = "",
    sequence_index: int | None = None,
) -> dict[str, Any]:
    state = _read_manual_sequence()

    if not bool(state.get("active")):
        return {
            "ok": True,
            "manual_sequence": _public_manual_sequence(state),
        }

    active_id = str(state.get("id") or "")
    if not sequence_id or sequence_id != active_id:
        return {
            "ok": True,
            "manual_sequence": _public_manual_sequence(state),
        }

    try:
        index = int(sequence_index if sequence_index is not None else -1)
    except (TypeError, ValueError):
        index = -1

    chunks = state.get("chunks")
    chunks = chunks if isinstance(chunks, list) else []

    if index < 0 or index >= len(chunks):
        return {
            "ok": False,
            "error": "Índice inválido da sequência manual.",
            "manual_sequence": _public_manual_sequence(state),
        }

    last_finished = int(
        state.get("last_finished_index")
        if state.get("last_finished_index") is not None
        else -1
    )

    if index > last_finished:
        state["last_finished_index"] = index
        state["last_finished_job_id"] = str(job_id or "")
        state["last_finished_at"] = time.time()
        state["updated_at"] = time.time()

    if index >= len(chunks) - 1:
        state["active"] = False
        state["completed_at"] = time.time()
        state["updated_at"] = time.time()
    else:
        _fill_manual_sequence_window(state)

    write_json_atomic(MANUAL_SEQUENCE_FILE, state)

    return {
        "ok": True,
        "manual_sequence": _public_manual_sequence(state),
    }


def _read_manual_sequence() -> dict[str, Any]:
    payload = read_json(MANUAL_SEQUENCE_FILE, {"active": False})
    return payload if isinstance(payload, dict) else {"active": False}


def _public_manual_sequence(state: dict[str, Any]) -> dict[str, Any]:
    chunks = state.get("chunks")
    chunks = chunks if isinstance(chunks, list) else []

    return {
        "id": str(state.get("id") or ""),
        "active": bool(state.get("active")),
        "chunk_count": len(chunks),
        "next_enqueue_index": int(state.get("next_enqueue_index") or 0),
        "last_finished_index": int(
            state.get("last_finished_index")
            if state.get("last_finished_index") is not None
            else -1
        ),
        "created_at": float(state.get("created_at") or 0),
        "updated_at": float(state.get("updated_at") or 0),
        "completed_at": float(state.get("completed_at") or 0),
        "manual_music_path": str(state.get("manual_music_path") or ""),
    }


def _manual_job_matches(job: dict[str, Any], sequence_id: str) -> bool:
    metadata = (
        job.get("metadata")
        if isinstance(job.get("metadata"), dict)
        else {}
    )
    return (
        str(metadata.get("source") or "") == "manual"
        and str(metadata.get("manual_sequence_id") or "") == sequence_id
    )


def _fill_manual_sequence_window(state: dict[str, Any]) -> None:
    chunks = state.get("chunks")
    chunks = chunks if isinstance(chunks, list) else []

    if not chunks or not bool(state.get("active")):
        return

    last_finished = int(
        state.get("last_finished_index")
        if state.get("last_finished_index") is not None
        else -1
    )
    next_index = int(state.get("next_enqueue_index") or 0)

    target_exclusive = min(
        len(chunks),
        last_finished + 1 + MANUAL_SEQUENCE_PREFETCH,
    )

    while next_index < target_exclusive:
        enqueue_text(
            str(chunks[next_index]),
            actor=str(state.get("actor") or "main"),
            priority=int(state.get("priority") or 90),
            metadata={
                "source": "manual",
                "manual_sequence_id": str(state.get("id") or ""),
                "manual_sequence_index": next_index,
                "manual_sequence_part": next_index + 1,
                "manual_sequence_total": len(chunks),
                "manual_sequence_last": next_index == len(chunks) - 1,
                "manual_music_path": str(state.get("manual_music_path") or ""),
            },
        )
        next_index += 1
        state["next_enqueue_index"] = next_index
        state["updated_at"] = time.time()


def pop_pending() -> dict[str, Any] | None:
    queue = _pruned_queue(PENDING_QUEUE_FILE, max_age=PENDING_JOB_MAX_AGE_SECONDS)
    if not queue:
        return None

    sequence = _read_manual_sequence()

    if bool(sequence.get("active")):
        sequence_id = str(sequence.get("id") or "")
        matches = [
            (index, job)
            for index, job in enumerate(queue)
            if isinstance(job, dict)
            and _manual_job_matches(job, sequence_id)
        ]
        if not matches:
            return None

        queue_index, job = min(
            matches,
            key=lambda pair: int(
                (
                    pair[1].get("metadata")
                    if isinstance(pair[1].get("metadata"), dict)
                    else {}
                ).get("manual_sequence_index")
                or 0
            ),
        )
        queue.pop(queue_index)
    else:
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
    queue = _pruned_queue(
        READY_QUEUE_FILE,
        max_age=READY_JOB_MAX_AGE_SECONDS,
        prefer_prepared=True,
    )
    if not queue:
        return None

    sequence = _read_manual_sequence()

    if bool(sequence.get("active")):
        sequence_id = str(sequence.get("id") or "")
        matches = [
            (index, job)
            for index, job in enumerate(queue)
            if isinstance(job, dict)
            and _manual_job_matches(job, sequence_id)
        ]
        if not matches:
            return None

        queue_index, job = min(
            matches,
            key=lambda pair: int(
                (
                    pair[1].get("metadata")
                    if isinstance(pair[1].get("metadata"), dict)
                    else {}
                ).get("manual_sequence_index")
                or 0
            ),
        )
        queue.pop(queue_index)
    else:
        job = queue.pop(0)

    write_json_atomic(READY_QUEUE_FILE, queue)
    return job if isinstance(job, dict) else None


def status() -> dict[str, Any]:
    # Status é somente leitura. Consultas do painel/health-check
    # não podem remover jobs das filas.
    pending = _fresh_queue(
        PENDING_QUEUE_FILE,
        max_age=PENDING_JOB_MAX_AGE_SECONDS,
    )
    ready = _fresh_queue(
        READY_QUEUE_FILE,
        max_age=READY_JOB_MAX_AGE_SECONDS,
        prefer_prepared=True,
    )

    return {
        "pending_size": len(pending),
        "ready_size": len(ready),
        "next_pending": pending[0] if pending else None,
        "next_ready": ready[0] if ready else None,
        "worker": read_json(WORKER_STATUS_FILE, {"state": "unknown"}),
        "manual_sequence": manual_sequence_status(),
    }


def _fresh_queue(
    path: Path,
    *,
    max_age: float,
    prefer_prepared: bool = False,
) -> list[dict[str, Any]]:
    queue = _read_queue(path)
    now = time.time()

    return [
        job
        for job in queue
        if not _job_too_old(
            job,
            now=now,
            max_age=max_age,
            prefer_prepared=prefer_prepared,
        )
    ]


def _pruned_queue(
    path: Path,
    *,
    max_age: float,
    prefer_prepared: bool = False,
) -> list[dict[str, Any]]:
    queue = _read_queue(path)
    now = time.time()

    fresh = [
        job
        for job in queue
        if not _job_too_old(
            job,
            now=now,
            max_age=max_age,
            prefer_prepared=prefer_prepared,
        )
    ]

    if len(fresh) != len(queue):
        write_json_atomic(
            path,
            fresh,
        )

    return fresh


def _job_too_old(
    job: dict[str, Any],
    *,
    now: float,
    max_age: float,
    prefer_prepared: bool = False,
) -> bool:
    reference_at = (
        _job_ready_at(job)
        if prefer_prepared
        else _job_created_at(job)
    )

    return (
        reference_at > 0
        and now - reference_at > max_age
    )


def _job_ready_at(
    job: dict[str, Any],
) -> float:
    metadata = (
        job.get("metadata")
        if isinstance(
            job.get("metadata"),
            dict,
        )
        else {}
    )

    try:
        prepared_at = float(
            metadata.get("prepared_at")
            or 0
        )
    except (TypeError, ValueError):
        prepared_at = 0.0

    if prepared_at > 0:
        return prepared_at

    return _job_created_at(job)


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
