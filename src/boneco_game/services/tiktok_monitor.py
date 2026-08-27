from __future__ import annotations

import json
import re
import os
import subprocess
import threading
import time
from typing import Any

from boneco_game.core.json_store import read_json, write_json_atomic
from boneco_game.core.settings import MONITOR_NETWORK_FILE, MONITOR_START_SCRIPT, MONITOR_STATUS_FILE, PROJECT_DIR
from boneco_game.services import live_events

try:
    import socketio as socketio_client
except Exception:  # pragma: no cover
    socketio_client = None


_LOCK = threading.Lock()
_THREAD: threading.Thread | None = None
_STOP = threading.Event()
_CLIENT: Any = None
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
}


def start_monitor(username: str, *, server_url: str = "http://127.0.0.1:2618") -> dict[str, Any]:
    global _THREAD
    username = str(username or "").strip().lstrip("@")
    if not username:
        _update(running=False, last_error="Usuario TikTok vazio.")
        return status()
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
            live_events.push_comment(user, text, display_name=display, metadata={"raw": _small_raw(data), "source": "tiktok"})
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
            live_events.push_gift(user, gift_name, count=count, display_name=display, metadata={"raw": _small_raw(data), "source": "tiktok"})
            _count("gift")
            _update(last_event=f"gift {time.strftime('%H:%M:%S')}", last_error="")

    @client.on("data-viewer")
    def on_viewer(raw: object) -> None:
        data = _parse_payload(raw)
        count = _viewer_count(data)
        if count is not None:
            _update(viewer_count=count, last_event=f"viewer {time.strftime('%H:%M:%S')}")

    @client.on("data-roomInfo")
    def on_room_info(raw: object) -> None:
        data = _parse_payload(raw)
        count = _viewer_count(data)
        if count is not None:
            _update(viewer_count=count, last_event=f"roomInfo {time.strftime('%H:%M:%S')}")


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
