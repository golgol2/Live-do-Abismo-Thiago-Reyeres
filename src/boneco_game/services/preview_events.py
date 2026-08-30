from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from typing import Any


_LOCK = threading.Lock()
_EVENTS: deque[dict[str, Any]] = deque(maxlen=80)
_SEQUENCE = 0


def push_comment(
    username: str,
    text: str,
    *,
    display_name: str = "",
) -> dict[str, Any]:
    return _push(
        "comment",
        username=username,
        display_name=display_name,
        text=text,
        metadata={},
    )


def push_gift(
    username: str,
    gift_name: str,
    *,
    count: int = 1,
    display_name: str = "",
) -> dict[str, Any]:
    safe_count = max(1, int(count or 1))

    return _push(
        "gift",
        username=username,
        display_name=display_name,
        text=gift_name,
        metadata={
            "gift_name": _clip(gift_name, 80),
            "count": safe_count,
        },
    )


def events_after(
    sequence: int = 0,
) -> dict[str, Any]:
    try:
        after = max(0, int(sequence or 0))
    except (TypeError, ValueError):
        after = 0

    with _LOCK:
        events = [
            dict(event)
            for event in _EVENTS
            if int(event.get("sequence") or 0) > after
        ]

        latest = int(
            _EVENTS[-1].get("sequence") or 0
        ) if _EVENTS else after

    return {
        "events": events[-30:],
        "latest_sequence": latest,
    }


def status() -> dict[str, Any]:
    with _LOCK:
        latest = int(
            _EVENTS[-1].get("sequence") or 0
        ) if _EVENTS else 0

        return {
            "queued": len(_EVENTS),
            "latest_sequence": latest,
        }


def _push(
    kind: str,
    *,
    username: str,
    display_name: str,
    text: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    global _SEQUENCE

    safe_kind = str(kind or "").strip().lower()

    if safe_kind not in {"comment", "gift"}:
        raise ValueError(
            f"Tipo de evento de preview inválido: {safe_kind}"
        )

    safe_username = _clip(username, 80)
    safe_display = _clip(display_name, 100)
    safe_text = _clip(text, 220)

    if not safe_username:
        safe_username = "teste"

    if not safe_display:
        safe_display = safe_username

    with _LOCK:
        _SEQUENCE += 1

        event = {
            "id": uuid.uuid4().hex,
            "sequence": _SEQUENCE,
            "kind": safe_kind,
            "username": safe_username,
            "display_name": safe_display,
            "text": safe_text,
            "profile_image": "",
            "avatar_url": "",
            "metadata": dict(metadata or {}),
            "created_at": time.time(),
            "preview": True,
        }

        _EVENTS.append(event)

    return dict(event)


def _clip(
    value: object,
    limit: int,
) -> str:
    clean = " ".join(
        str(value or "").split()
    )

    return clean[: max(1, int(limit))]
