from __future__ import annotations

import time
import uuid
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import RUNS_DIR
from boneco_game.services.chat_safety import has_blocked_term, has_low_value_noise_pattern
from boneco_game.services.gift_values import gift_coin_value, gift_score
from boneco_game.services.live_text import clean_chat_message, display_name_from_candidates


COMMENT_LATEST_FILE = RUNS_DIR / "event_latest_comments.json"
GIFT_QUEUE_FILE = RUNS_DIR / "event_gift_queue.json"
SYSTEM_QUEUE_FILE = RUNS_DIR / "event_system_queue.json"
RECENT_PEOPLE_FILE = RUNS_DIR / "event_recent_people.json"
GIFT_LEADERBOARD_FILE = RUNS_DIR / "event_gift_leaderboard.json"
COMMENT_MAX_AGE_SECONDS = 60.0
GIFT_MAX_AGE_SECONDS = 90.0
SYSTEM_MAX_AGE_SECONDS = 300.0
MAX_GIFT_BURST_BEFORE_CHAT = 2
_gift_burst_count = 0


def reset_event_state() -> None:
    global _gift_burst_count
    _gift_burst_count = 0
    write_json_atomic(COMMENT_LATEST_FILE, {})
    write_json_atomic(GIFT_QUEUE_FILE, [])
    write_json_atomic(SYSTEM_QUEUE_FILE, [])
    write_json_atomic(RECENT_PEOPLE_FILE, [])
    write_json_atomic(GIFT_LEADERBOARD_FILE, {})


def push_comment(username: str, text: str, *, display_name: str = "", metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    clean_text = clean_chat_message(text)
    if not clean_text or has_low_value_noise_pattern(clean_text) or has_blocked_term(clean_text):
        return _ignored_event("comment", username=username, display_name=display_name, text=text, metadata=metadata)
    event = _event(
        "comment",
        username=username,
        display_name=display_name,
        text=clean_text,
        priority=_comment_priority(username, display_name),
        metadata=metadata,
    )
    latest = _read_dict(COMMENT_LATEST_FILE)
    latest[str(username or "").strip().lower()] = event
    write_json_atomic(COMMENT_LATEST_FILE, latest)
    _remember_person(event)
    return event


def push_gift(
    username: str,
    gift_name: str,
    *,
    count: int = 1,
    display_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_count = max(1, int(count or 1))
    safe_metadata = {"gift_name": gift_name, "count": safe_count, **(metadata or {})}
    coin_value = gift_coin_value(gift_name, safe_metadata)
    safe_metadata["gift_coin_value"] = coin_value
    safe_metadata["gift_total_coins"] = gift_score(gift_name, safe_count, safe_metadata)

    event = _event(
        "gift",
        username=username,
        display_name=display_name,
        text=gift_name,
        priority=90 + min(20, max(0, coin_value // 1000)),
        metadata=safe_metadata,
    )
    queue = _read_list(GIFT_QUEUE_FILE)
    queue.append(event)
    write_json_atomic(GIFT_QUEUE_FILE, queue[-80:])
    _remember_person(event, weight=2)
    _remember_gift_leader(event)
    return event


def push_system(
    text: str,
    *,
    priority: int = 50,
    username: str = "",
    display_name: str = "",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event = _event(
        "system",
        username=username,
        display_name=display_name,
        text=text,
        priority=priority,
        metadata=metadata,
    )
    queue = _read_list(SYSTEM_QUEUE_FILE)
    queue.append(event)
    queue.sort(key=lambda item: (-int(item.get("priority") or 0), float(item.get("created_at") or 0)))
    write_json_atomic(SYSTEM_QUEUE_FILE, queue[-50:])
    return event


def pop_next_event() -> dict[str, Any] | None:
    global _gift_burst_count
    prune_stale_events()
    system = _pop_list(SYSTEM_QUEUE_FILE, max_age=SYSTEM_MAX_AGE_SECONDS)
    if system:
        _gift_burst_count = 0
        return system
    latest = _read_dict(COMMENT_LATEST_FILE)
    priority_comment = _pop_priority_comment(latest)
    if priority_comment:
        _gift_burst_count = 0
        return priority_comment
    gifts = _read_list(GIFT_QUEUE_FILE)
    if gifts and (_gift_burst_count < MAX_GIFT_BURST_BEFORE_CHAT or not latest):
        gift = _pop_list(GIFT_QUEUE_FILE, max_age=GIFT_MAX_AGE_SECONDS)
        if gift:
            _gift_burst_count += 1
            return gift
    latest = _read_dict(COMMENT_LATEST_FILE)
    if not latest:
        gift = _pop_list(GIFT_QUEUE_FILE, max_age=GIFT_MAX_AGE_SECONDS)
        if gift:
            _gift_burst_count += 1
            return gift
        return None
    newest_key, newest_event = max(
        latest.items(),
        key=lambda item: float(item[1].get("created_at") or 0) if isinstance(item[1], dict) else 0.0,
    )
    latest.pop(newest_key, None)
    write_json_atomic(COMMENT_LATEST_FILE, latest)
    _gift_burst_count = 0
    return newest_event if isinstance(newest_event, dict) else None


def status() -> dict[str, Any]:
    prune_stale_events()
    comments = _read_dict(COMMENT_LATEST_FILE)
    gifts = _read_list(GIFT_QUEUE_FILE)
    system = _read_list(SYSTEM_QUEUE_FILE)
    return {
        "latest_comments": len(comments),
        "gift_queue": len(gifts),
        "system_queue": len(system),
        "next_comment": _newest_comment(comments),
        "next_gift": gifts[0] if gifts else None,
        "next_system": system[0] if system else None,
        "recent_people": _recent_people(comments, gifts, system),
        "gift_leaderboard": _gift_leaderboard(),
        "top_gifter": _top_gifter(),
    }


def top_gifter_rank(username: str, display_name: str = "", *, limit: int = 3) -> int:
    keys = {
        str(value or "").strip().lower()
        for value in (username, display_name)
        if str(value or "").strip()
    }
    if not keys:
        return 0

    for index, item in enumerate(_gift_leaderboard(limit=max(1, limit)), start=1):
        item_keys = {
            str(value or "").strip().lower()
            for value in (
                item.get("key"),
                item.get("username"),
                item.get("display_name"),
            )
            if str(value or "").strip()
        }
        if keys & item_keys:
            return index
    return 0


def prune_stale_events(now: float | None = None) -> None:
    current = time.time() if now is None else float(now)
    raw_comments = _read_dict(COMMENT_LATEST_FILE)
    raw_gifts = _read_list(GIFT_QUEUE_FILE)
    raw_system = _read_list(SYSTEM_QUEUE_FILE)
    comments = {key: event for key, event in raw_comments.items() if not is_stale_event(event, now=current)}
    gifts = [event for event in raw_gifts if not is_stale_event(event, now=current)]
    system = [event for event in raw_system if not is_stale_event(event, now=current)]
    if len(comments) != len(raw_comments):
        write_json_atomic(COMMENT_LATEST_FILE, comments)
    if len(gifts) != len(raw_gifts):
        write_json_atomic(GIFT_QUEUE_FILE, gifts)
    if len(system) != len(raw_system):
        write_json_atomic(SYSTEM_QUEUE_FILE, system)


def is_stale_event(event: dict[str, Any], *, now: float | None = None) -> bool:
    current = time.time() if now is None else float(now)
    kind = str(event.get("kind") or "")
    if kind == "comment":
        max_age = COMMENT_MAX_AGE_SECONDS
    elif kind == "gift":
        max_age = GIFT_MAX_AGE_SECONDS
    elif kind == "system":
        max_age = SYSTEM_MAX_AGE_SECONDS
    else:
        max_age = COMMENT_MAX_AGE_SECONDS
    return _event_too_old(event, now=current, max_age=max_age)


def _event(
    kind: str,
    *,
    username: str,
    display_name: str,
    text: str,
    priority: int = 40,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    raw = metadata.get("raw") if isinstance(metadata, dict) and isinstance(metadata.get("raw"), dict) else {}
    safe_display = display_name_from_candidates(
        raw.get("profile_display_name") if isinstance(raw, dict) else "",
        raw.get("realName") if isinstance(raw, dict) else "",
        raw.get("displayName") if isinstance(raw, dict) else "",
        raw.get("nickname") if isinstance(raw, dict) else "",
        raw.get("name") if isinstance(raw, dict) else "",
        display_name,
        raw.get("uniqueId") if isinstance(raw, dict) else "",
        username,
    )
    profile_image = _profile_image_from_metadata(metadata or {}, raw)
    return {
        "id": uuid.uuid4().hex,
        "kind": kind,
        "username": str(username or "").strip(),
        "display_name": safe_display,
        "profile_image": profile_image,
        "avatar_url": profile_image,
        "text": str(text or "").strip(),
        "priority": int(priority),
        "created_at": time.time(),
        "metadata": metadata or {},
    }


def _ignored_event(
    kind: str,
    *,
    username: str,
    display_name: str,
    text: object,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "kind": kind,
        "username": str(username or "").strip(),
        "display_name": display_name_from_candidates(display_name, username),
        "text": str(text or "").strip(),
        "ignored": True,
        "created_at": time.time(),
        "metadata": metadata or {},
    }


def _read_list(path) -> list[dict[str, Any]]:
    payload = read_json(path, [])
    return [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []


def _read_dict(path) -> dict[str, dict[str, Any]]:
    payload = read_json(path, {})
    return {str(key): value for key, value in payload.items() if isinstance(value, dict)} if isinstance(payload, dict) else {}


def _pop_list(path, *, max_age: float) -> dict[str, Any] | None:
    now = time.time()
    queue = [event for event in _read_list(path) if not _event_too_old(event, now=now, max_age=max_age)]
    if not queue:
        write_json_atomic(path, [])
        return None
    event = queue.pop(0)
    write_json_atomic(path, queue)
    return event


def _event_too_old(event: dict[str, Any], *, now: float, max_age: float) -> bool:
    try:
        created_at = float(event.get("created_at") or 0)
    except (TypeError, ValueError):
        created_at = 0.0
    return created_at > 0 and now - created_at > max_age


def _newest_comment(comments: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if not comments:
        return None
    event = max(comments.values(), key=lambda item: float(item.get("created_at") or 0))
    return event if isinstance(event, dict) else None



def _pop_priority_comment(comments: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if not comments:
        return None

    candidates = [
        (key, event)
        for key, event in comments.items()
        if isinstance(event, dict) and int(event.get("priority") or 0) >= 100
    ]
    if not candidates:
        return None

    selected_key, selected_event = max(
        candidates,
        key=lambda item: (
            int(item[1].get("priority") or 0),
            float(item[1].get("created_at") or 0),
        ),
    )
    comments.pop(selected_key, None)
    write_json_atomic(COMMENT_LATEST_FILE, comments)
    return selected_event


def _comment_priority(username: str, display_name: str = "") -> int:
    rank = top_gifter_rank(username, display_name, limit=3)
    if rank <= 0:
        return 40
    return 130 - rank


def _remember_gift_leader(event: dict[str, Any]) -> None:
    username = str(event.get("username") or "").strip()
    display_name = str(event.get("display_name") or username).strip()
    profile = str(
        event.get("profile_image") or
        event.get("avatar_url") or
        ""
    ).strip()

    metadata = (
        event.get("metadata")
        if isinstance(event.get("metadata"), dict)
        else {}
    )

    try:
        count = max(1, int(metadata.get("count") or 1))
    except (TypeError, ValueError):
        count = 1

    gift_name = str(
        metadata.get("gift_name") or event.get("text") or "presente"
    ).strip()
    coin_value = gift_coin_value(gift_name, metadata)
    gift_total_coins = gift_score(gift_name, count, metadata)

    if not (username or display_name):
        return

    key = (username or display_name).lower()
    payload = read_json(GIFT_LEADERBOARD_FILE, {})
    board = payload if isinstance(payload, dict) else {}

    previous = board.get(key)
    current = previous if isinstance(previous, dict) else {}

    old_profile = str(
        current.get("profile_image") or
        current.get("avatar_url") or
        ""
    ).strip()

    total_count = int(current.get("total_count") or 0) + count
    gift_events = int(current.get("gift_events") or 0) + 1
    previous_total_coins = int(
        current.get("total_coins")
        or _legacy_total_coins(current)
        or 0
    )
    total_coins = previous_total_coins + gift_total_coins

    board[key] = {
        "key": key,
        "username": username or str(current.get("username") or ""),
        "display_name": display_name or str(current.get("display_name") or username),
        "profile_image": profile or old_profile,
        "avatar_url": profile or old_profile,
        "total_count": total_count,
        "count": total_count,
        "gift_coin_value": coin_value,
        "last_gift_value": coin_value,
        "last_gift_total_coins": gift_total_coins,
        "total_coins": total_coins,
        "score": total_coins,
        "gift_events": gift_events,
        "last_gift_name": gift_name,
        "updated_at": float(event.get("created_at") or time.time()),
    }

    write_json_atomic(GIFT_LEADERBOARD_FILE, board)


def _gift_leaderboard(*, limit: int = 181) -> list[dict[str, Any]]:
    payload = read_json(GIFT_LEADERBOARD_FILE, {})
    if not isinstance(payload, dict):
        return []

    items: list[dict[str, Any]] = []
    for item in payload.values():
        if not isinstance(item, dict):
            continue
        normalized = dict(item)
        score = _leader_score(normalized)
        if score > 0:
            normalized.setdefault("total_coins", score)
            normalized.setdefault("score", score)
        normalized.setdefault(
            "count",
            int(normalized.get("total_count") or 0),
        )
        items.append(normalized)

    items.sort(
        key=lambda item: (
            -_leader_score(item),
            -int(item.get("total_count") or 0),
            -int(item.get("gift_events") or 0),
            -float(item.get("updated_at") or 0),
        )
    )

    return items[:max(1, int(limit))]


def _top_gifter() -> dict[str, Any] | None:
    board = _gift_leaderboard(limit=1)
    return board[0] if board else None


def _leader_score(item: dict[str, Any]) -> int:
    try:
        score = int(item.get("score") or item.get("total_coins") or 0)
    except (TypeError, ValueError):
        score = 0
    if score > 0:
        return score
    return _legacy_total_coins(item)


def _legacy_total_coins(item: dict[str, Any]) -> int:
    gift_name = str(item.get("last_gift_name") or "").strip()
    try:
        total_count = max(0, int(item.get("total_count") or item.get("count") or 0))
    except (TypeError, ValueError):
        total_count = 0
    if not gift_name or total_count <= 0:
        return 0
    return total_count * gift_coin_value(gift_name, {})


def _remember_person(event: dict[str, Any], *, weight: int = 1) -> None:
    profile = str(event.get("profile_image") or event.get("avatar_url") or "").strip()
    username = str(event.get("username") or "").strip()
    display_name = str(event.get("display_name") or username).strip()
    if not profile or not (username or display_name):
        return
    key = (username or display_name or profile).lower()
    people = [item for item in _read_list(RECENT_PEOPLE_FILE) if str(item.get("key") or "").lower() != key]
    people.insert(
        0,
        {
            "key": key,
            "username": username,
            "display_name": display_name,
            "profile_image": profile,
            "avatar_url": profile,
            "weight": int(weight),
            "updated_at": time.time(),
        },
    )
    write_json_atomic(RECENT_PEOPLE_FILE, people[:40])


def _recent_people(
    comments: dict[str, dict[str, Any]],
    gifts: list[dict[str, Any]],
    system: list[dict[str, Any]],
    *,
    limit: int = 18,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    events.extend(reversed(gifts))
    events.extend(sorted(comments.values(), key=lambda item: float(item.get("created_at") or 0), reverse=True))
    events.extend(reversed(system))

    seen: set[str] = set()
    people: list[dict[str, Any]] = []

    def add_person(event: dict[str, Any], *, weight: int = 1) -> None:
        profile = str(event.get("profile_image") or event.get("avatar_url") or "").strip()
        username = str(event.get("username") or "").strip()
        display_name = str(event.get("display_name") or username).strip()
        if not profile or not (username or display_name):
            return
        key = (username or display_name or profile).lower()
        if key in seen:
            return
        seen.add(key)
        people.append(
            {
                "username": username,
                "display_name": display_name,
                "profile_image": profile,
                "avatar_url": profile,
                "weight": int(weight),
            }
        )

    for event in events:
        if not isinstance(event, dict):
            continue
        add_person(event, weight=2 if event.get("kind") == "gift" else 1)
        if len(people) >= limit:
            return people

    for item in _read_list(RECENT_PEOPLE_FILE):
        if not isinstance(item, dict):
            continue
        add_person(item, weight=int(item.get("weight") or 1))
        if len(people) >= limit:
            break

    return people


def _profile_image_from_metadata(metadata: dict[str, Any], raw: dict[str, Any]) -> str:
    candidates = (
        metadata.get("profile_image"),
        metadata.get("profile_image_url"),
        metadata.get("profile_image_file"),
        raw.get("profile_image"),
        raw.get("profile_image_url"),
        raw.get("profile_image_file"),
        raw.get("profilePictureUrl"),
        raw.get("avatarUrl"),
        raw.get("profilePicture"),
        raw.get("avatar"),
    )
    for value in candidates:
        clean = str(value or "").strip()
        if clean:
            return clean
    return ""
