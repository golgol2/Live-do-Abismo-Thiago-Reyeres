from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

from boneco_game.core.settings import STREAMLABS_CONFIG_FILE
from boneco_game.services.streamlabs import StreamlabsTikTokClient


@dataclass(frozen=True)
class StreamCredentials:
    rtmp_url: str
    stream_id: str
    title: str
    category: str


def streamlabs_end_refused(result: dict[str, object]) -> bool:
    attempts = result.get("attempts")
    items = attempts if isinstance(attempts, list) and attempts else [result]
    for item in items:
        if not isinstance(item, dict):
            return False
        error = str(item.get("error") or "").lower()
        if "success': false" not in error and 'success": false' not in error:
            return False
    return True


def end_streamlabs_live_if_saved(retries: int = 3, delay_seconds: float = 1.5) -> dict[str, object]:
    provider = StreamlabsCredentialProvider()
    saved_stream_id = str(provider.load_config().get("last_stream_id") or "").strip()
    total = max(1, int(retries))
    attempts: list[dict[str, object]] = []
    for attempt in range(1, total + 1):
        try:
            result = provider.end_last_live()
        except Exception as exc:
            result = {"attempted": bool(saved_stream_id), "ended": False, "stream_id": saved_stream_id, "error": str(exc)}
        result["attempt"] = attempt
        attempts.append(dict(result))
        if not result.get("attempted") or result.get("ended"):
            if len(attempts) > 1:
                result["attempts"] = attempts
            return result
        if attempt < total:
            time.sleep(max(0.1, delay_seconds))
    final = dict(attempts[-1]) if attempts else {"attempted": False, "ended": False, "stream_id": ""}
    final["attempts"] = attempts
    if saved_stream_id and streamlabs_end_refused(final):
        provider.save_config({"last_stream_id": ""})
        final["cleared_stale_stream_id"] = True
    return final


class StreamlabsCredentialProvider:
    def __init__(self, config_file: Path = STREAMLABS_CONFIG_FILE) -> None:
        self.config_file = Path(config_file)

    def load_config(self) -> dict[str, str]:
        defaults = {
            "token": "",
            "title": "Live Do Boneco do Abismo",
            "game": "Others",
            "audience_type": "0",
            "last_stream_id": "",
        }
        if not self.config_file.exists():
            return defaults
        try:
            raw = json.loads(self.config_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return defaults
        if not isinstance(raw, dict):
            return defaults
        for key in defaults:
            if raw.get(key) is not None:
                defaults[key] = str(raw.get(key) or "").strip()
        return defaults

    def save_config(self, config: dict[str, str]) -> None:
        current = self.load_config()
        current.update({key: str(value or "").strip() for key, value in config.items()})
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        self.config_file.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")

    def start_live(self, *, title: str = "", game: str = "", audience_type: str = "") -> StreamCredentials:
        config = self.load_config()
        token = str(config.get("token") or "").strip()
        if not token:
            raise RuntimeError("Token Streamlabs nao configurado.")
        client = StreamlabsTikTokClient(token)
        resolved_title = str(title or config.get("title") or "Live Do Boneco do Abismo").strip()
        resolved_game = str(game or config.get("game") or "Others").strip()
        audience = "1" if str(audience_type or config.get("audience_type") or "0") == "1" else "0"
        category_id = client.resolve_category_id(resolved_game)
        data = client.start_stream(resolved_title, category_id, audience)
        self.save_config(
            {
                "title": resolved_title,
                "game": resolved_game,
                "audience_type": audience,
                "last_stream_id": str(data.get("id") or "").strip(),
            }
        )
        return StreamCredentials(
            rtmp_url=str(data["rtmp_url"]),
            stream_id=str(data.get("id") or ""),
            title=resolved_title,
            category=resolved_game,
        )

    def end_last_live(self) -> dict[str, object]:
        config = self.load_config()
        token = str(config.get("token") or "").strip()
        stream_id = str(config.get("last_stream_id") or "").strip()
        if not token or not stream_id:
            return {"attempted": False, "ended": False, "stream_id": stream_id}
        client = StreamlabsTikTokClient(token)
        ended = client.end_stream(stream_id)
        if ended:
            self.save_config({"last_stream_id": ""})
        return {"attempted": True, "ended": bool(ended), "stream_id": stream_id}
