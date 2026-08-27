from __future__ import annotations

import json
import re
import os
import subprocess
import threading
import time
import random
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import MONITOR_NETWORK_FILE, MONITOR_START_SCRIPT, MONITOR_STATUS_FILE, PROJECT_DIR
from boneco_game.services import live_events
from boneco_game.services.live_text import display_name as sanitize_display_name

try:
    import socketio as socketio_client
except Exception:  # pragma: no cover
    socketio_client = None


_LOCK = threading.Lock()
_THREAD: threading.Thread | None = None
_STOP = threading.Event()
_CLIENT: Any = None
WELCOME_VIEWER_LIMIT = 20
WELCOME_COOLDOWN_SECONDS = 9.0
WELCOME_PRIORITY = 100
WELCOME_PHRASES_FILE = PROJECT_DIR / "config" / "member_welcome_phrases.txt"
_WELCOMED_USERS: set[str] = set()
_LAST_WELCOME_AT = 0.0
_RECENT_WELCOME_PHRASES: list[str] = []
_PROFILE_CACHE: dict[str, str] = {}
_STATE: dict[str, Any] = {
    "running": False,
    "connected": False,
    "listening": False,
    "username": "",
    "server_url": "http://127.0.0.1:2618",
    "last_error": "",
    "last_event": "",
    "counters": {},
    "viewer_count": 0,
    "viewer_count_known": False,
    "welcome_count": 0,
}


def start_monitor(username: str, *, server_url: str = "http://127.0.0.1:2618") -> dict[str, Any]:
    global _THREAD, _LAST_WELCOME_AT
    username = str(username or "").strip().lstrip("@")
    if not username:
        _update(running=False, last_error="Usuario TikTok vazio.")
        return status()
    with _LOCK:
        _WELCOMED_USERS.clear()
        _RECENT_WELCOME_PHRASES.clear()
        _PROFILE_CACHE.clear()
        _LAST_WELCOME_AT = 0.0
        _STATE["viewer_count"] = 0
        _STATE["viewer_count_known"] = False
        _STATE["welcome_count"] = 0
    with _LOCK:
        alive = bool(_THREAD and _THREAD.is_alive())
    if alive:
        _update(username=username, server_url=server_url, last_error="Monitor ja estava rodando.")
        return status()
    _STOP.clear()
    _THREAD = threading.Thread(target=_loop, args=(username, server_url), daemon=True, name="boneco-game-tiktok-monitor")
    _THREAD.start()
    _update(running=True, username=username, server_url=server_url, last_error="Monitor iniciando.")
    return status()


def stop_monitor() -> dict[str, Any]:
    _STOP.set()
    _disconnect()
    _update(running=False, connected=False, listening=False, last_error="Monitor parado.")
    return status()


def status() -> dict[str, Any]:
    with _LOCK:
        state = dict(_STATE)
    state["available"] = socketio_client is not None
    state["thread_alive"] = bool(_THREAD and _THREAD.is_alive())
    state["network"] = read_json(MONITOR_NETWORK_FILE, {"mode": "unknown"})
    return state


def _loop(username: str, server_url: str) -> None:
    global _CLIENT
    while not _STOP.is_set():
        if socketio_client is None:
            _update(running=False, connected=False, listening=False, last_error="Dependencia ausente: python-socketio[client].")
            _STOP.wait(10)
            continue
        _ensure_node_monitor()
        client = socketio_client.Client(
            reconnection=True,
            reconnection_attempts=5,
            reconnection_delay=2,
            logger=False,
            engineio_logger=False,
        )
        _CLIENT = client
        _register_handlers(client, username)
        try:
            _update(running=True, connected=False, listening=False, last_error="Conectando ao monitor Node.")
            client.connect(server_url, transports=["websocket", "polling"], wait_timeout=12)
            while not _STOP.wait(2):
                if not getattr(client, "connected", False):
                    break
        except Exception as exc:
            _update(running=True, connected=False, listening=False, last_error=f"{type(exc).__name__}: {exc}")
            _STOP.wait(8)
        finally:
            _disconnect()
    _update(running=False, connected=False, listening=False)


def _register_handlers(client: Any, username: str) -> None:
    @client.event
    def connect() -> None:
        _update(running=True, connected=True, listening=False, last_error="")
        client.emit("listenToUsername", json.dumps({"username": username}))

    @client.event
    def disconnect() -> None:
        _update(connected=False, listening=False)

    @client.on("data-connection")
    def on_data_connection(raw: object) -> None:
        data = _parse_payload(raw)
        listening = bool(data.get("isConnected"))
        _update(
            running=True,
            connected=True,
            listening=listening,
            last_error="" if listening else str(data.get("message") or "Monitor aguardando live."),
        )

    @client.on("data-chat")
    def on_chat(raw: object) -> None:
        data = _parse_payload(raw)
        text = _first(data, "comment", "message", "text", "content")
        user = _username(data)
        display = _display_name(data)
        if text and user:
            live_events.push_comment(
                user,
                text,
                display_name=display,
                metadata=_event_metadata(data, user),
            )
            _count("chat")
            _update(last_event=f"chat {time.strftime('%H:%M:%S')}", last_error="")

    @client.on("data-gift")
    def on_gift(raw: object) -> None:
        data = _parse_payload(raw)
        gift_name = _gift_name(data)
        user = _username(data)
        display = _display_name(data)
        count = _gift_count(data)
        if gift_name and user:
            live_events.push_gift(
                user,
                gift_name,
                count=count,
                display_name=display,
                metadata=_event_metadata(data, user),
            )
            _count("gift")
            _update(last_event=f"gift {time.strftime('%H:%M:%S')}", last_error="")

    @client.on("data-member")
    def on_member(raw: object) -> None:
        data = _parse_payload(raw)
        user = _username(data)
        display = _display_name(data)
        metadata = _event_metadata(data, user) if user else {"raw": _small_raw(data), "source": "tiktok"}
        profile = str(metadata.get("profile_image") or "").strip()
        _count("member")
        _update(last_event=f"member {time.strftime('%H:%M:%S')}", last_error="")
        if user:
            _maybe_welcome_member(user, display or user, profile)

    @client.on("data-viewer")
    def on_viewer(raw: object) -> None:
        data = _parse_payload(raw)
        count = _viewer_count(data)
        if count is not None:
            _update(viewer_count=count, viewer_count_known=True, last_event=f"viewer {time.strftime('%H:%M:%S')}")

    @client.on("data-roomInfo")
    def on_room_info(raw: object) -> None:
        data = _parse_payload(raw)
        count = _viewer_count(data)
        if count is not None:
            _update(viewer_count=count, viewer_count_known=True, last_event=f"roomInfo {time.strftime('%H:%M:%S')}")



def _event_metadata(data: dict[str, Any], username: str) -> dict[str, Any]:
    key = str(username or "").strip().casefold()
    raw = _small_raw(data)
    profile = _profile_image_url(data)
    if profile and key:
        _PROFILE_CACHE[key] = profile
    elif key:
        profile = str(_PROFILE_CACHE.get(key) or "").strip()
    if profile:
        raw["profile_image"] = profile
        raw["profile_image_url"] = profile
    return {
        "raw": raw,
        "source": "tiktok",
        "profile_image": profile,
        "profile_image_url": profile,
    }


def _maybe_welcome_member(username: str, raw_display_name: str, profile_image: str = "") -> None:
    global _LAST_WELCOME_AT

    key = str(username or "").strip().casefold()
    name = sanitize_display_name(raw_display_name or username, fallback="visitante")
    if not key or not name:
        return

    with _LOCK:
        viewer_known = bool(_STATE.get("viewer_count_known"))
        viewer_count = int(_STATE.get("viewer_count") or 0)
        already_welcomed = key in _WELCOMED_USERS
        cooldown_ok = (time.time() - _LAST_WELCOME_AT) >= WELCOME_COOLDOWN_SECONDS

    if not viewer_known:
        return
    if viewer_count >= WELCOME_VIEWER_LIMIT:
        return
    if already_welcomed or not cooldown_ok:
        return

    phrase = _choose_welcome_phrase(name)
    if not phrase:
        return

    with _LOCK:
        if key in _WELCOMED_USERS:
            return
        _WELCOMED_USERS.add(key)
        _LAST_WELCOME_AT = time.time()
        _STATE["welcome_count"] = int(_STATE.get("welcome_count") or 0) + 1
        welcome_count = int(_STATE["welcome_count"])

    live_events.push_system(
        phrase,
        priority=WELCOME_PRIORITY,
        username=username,
        display_name=name,
        metadata={
            "source": "tiktok_member",
            "username": username,
            "display_name": name,
            "profile_image": str(profile_image or "").strip(),
            "profile_image_url": str(profile_image or "").strip(),
            "viewer_count": viewer_count,
        },
    )
    _count("welcome")
    _update(
        last_event=f"welcome {time.strftime('%H:%M:%S')}",
        last_error="",
        welcome_count=welcome_count,
        last_welcome_user=username,
        last_welcome_name=name,
        last_welcome_at=time.time(),
    )


def _choose_welcome_phrase(name: str) -> str:
    try:
        raw_lines = WELCOME_PHRASES_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        raw_lines = []

    phrases = [
        line.strip()
        for line in raw_lines
        if line.strip() and not line.lstrip().startswith("#") and "{nome}" in line
    ]
    if not phrases:
        phrases = ["Oi, {nome}!", "E aí, {nome}?", "Como vai, {nome}?"]

    with _LOCK:
        candidates = [item for item in phrases if item not in _RECENT_WELCOME_PHRASES]
        template = random.choice(candidates or phrases)
        _RECENT_WELCOME_PHRASES.append(template)
        max_recent = max(1, min(8, len(phrases) - 1))
        del _RECENT_WELCOME_PHRASES[:-max_recent]

    safe_name = name[:60].strip(" ,.;:")
    return template.replace("{nome}", safe_name).strip()


def _ensure_node_monitor() -> None:
    if not MONITOR_START_SCRIPT.exists():
        _update(last_error=f"Script do monitor ausente: {MONITOR_START_SCRIPT}")
        return
    env = os.environ.copy()
    env["BONECO_GAME_DIR"] = str(PROJECT_DIR)
    subprocess.run([str(MONITOR_START_SCRIPT)], cwd=str(PROJECT_DIR), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def _disconnect() -> None:
    global _CLIENT
    client = _CLIENT
    if client is None:
        return
    try:
        if getattr(client, "connected", False):
            client.emit("stopListen")
    except Exception:
        pass
    try:
        if getattr(client, "connected", False):
            client.disconnect()
    except Exception:
        pass
    _CLIENT = None


def _parse_payload(raw: object) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {"data": raw}
        return payload if isinstance(payload, dict) else {"data": payload}
    return {"data": raw}


def _username(data: dict[str, Any]) -> str:
    return _first(data, "uniqueId", "username", "userId", "user_id", "secUid").strip().lstrip("@")


def _display_name(data: dict[str, Any]) -> str:
    return _first(data, "profile_display_name", "nickname", "displayName", "realName", "name", "uniqueId", "username")


def _gift_name(data: dict[str, Any]) -> str:
    gift = data.get("gift")
    if isinstance(gift, dict):
        value = _first(gift, "name", "giftName", "describe", "id")
        if value:
            return value
    return _first(data, "giftName", "gift_name", "name", "label", "giftId", "gift_id")


def _gift_count(data: dict[str, Any]) -> int:
    for key in ("repeatCount", "repeat_count", "count", "comboCount", "combo_count"):
        try:
            value = int(float(data.get(key) or 0))
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return 1


def _viewer_count(data: dict[str, Any]) -> int | None:
    for key in ("viewerCount", "viewer_count", "userCount", "user_count", "totalUser", "onlineUserCount"):
        try:
            value = int(float(data.get(key) or 0))
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return None


def _first(data: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _small_raw(data: dict[str, Any]) -> dict[str, Any]:
    allowed = (
        "uniqueId",
        "username",
        "nickname",
        "comment",
        "giftName",
        "repeatCount",
        "userId",
        "profilePictureUrl",
        "profilePicture",
        "avatarUrl",
        "avatar",
    )
    raw = {key: data.get(key) for key in allowed if key in data}
    profile_image = _profile_image_url(data)
    if profile_image:
        raw["profile_image"] = profile_image
        raw["profile_image_url"] = profile_image
    return raw


PROFILE_IMAGE_FIELDS = (
    "profile_image",
    "profile_image_url",
    "profilePictureUrl",
    "profilePicture",
    "avatarUrl",
    "avatar",
    "user.profilePictureUrl",
    "user.profilePicture",
    "user.avatarUrl",
    "user.avatar",
    "userDetails.profilePictureUrl",
    "userDetails.profilePicture",
    "userDetails.profilePictureUrls",
    "userInfo.profilePictureUrl",
    "userInfo.profilePicture",
    "userInfo.user.profilePictureUrl",
    "userInfo.user.profilePicture",
    "userInfo.user.profilePictureUrls",
    "author.profilePictureUrl",
    "author.profilePicture",
    "author.profilePictureUrls",
)


def _profile_image_url(data: dict[str, Any]) -> str:
    for field in PROFILE_IMAGE_FIELDS:
        found = _first_url(_nested_value(data, field))
        if found:
            return found
    return ""


def _nested_value(data: dict[str, Any], field: str) -> Any:
    current: Any = data
    for part in field.split("."):
        if not isinstance(current, dict):
            return ""
        current = current.get(part)
        if current in (None, ""):
            return ""
    return current


def _first_url(value: Any) -> str:
    if isinstance(value, str):
        clean = value.strip()
        return clean if re.match(r"^https?://", clean, re.IGNORECASE) else ""
    if isinstance(value, list):
        for item in value:
            found = _first_url(item)
            if found:
                return found
    if isinstance(value, dict):
        for key in ("url", "uri", "src"):
            found = _first_url(value.get(key))
            if found:
                return found
        for key in ("urls", "urlList", "profilePictureUrls"):
            found = _first_url(value.get(key))
            if found:
                return found
    return ""


def _count(kind: str) -> None:
    with _LOCK:
        counters = dict(_STATE.get("counters") or {})
        counters[kind] = int(counters.get(kind) or 0) + 1
        _STATE["counters"] = counters


def _update(**updates: Any) -> None:
    with _LOCK:
        _STATE.update(updates)
        _STATE["updated_at"] = time.time()
        snapshot = dict(_STATE)
    try:
        write_json_atomic(MONITOR_STATUS_FILE, snapshot)
    except OSError:
        pass
