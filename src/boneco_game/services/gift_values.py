from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any


GIFT_VALUES_FILE = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "tiktok_gift_values_br.json"
)

DEFAULT_GIFT_COIN_VALUE = 1

_DIRECT_VALUE_KEYS = {
    "coin",
    "coins",
    "coin_count",
    "coincount",
    "coinvalue",
    "cost",
    "diamond",
    "diamonds",
    "diamond_count",
    "diamondcount",
    "diamondvalue",
    "gift_coin_value",
    "gift_value",
    "giftvalue",
    "gift_price",
    "giftprice",
    "price",
    "value",
}


def gift_coin_value(
    gift_name: object,
    metadata: dict[str, Any] | None = None,
) -> int:
    direct = _metadata_coin_value(metadata or {})
    if direct > 0:
        return direct

    key = _normalize_key(gift_name)
    if key:
        value = _gift_value_lookup().get(key, 0)
        if value > 0:
            return value

    return DEFAULT_GIFT_COIN_VALUE


def gift_score(
    gift_name: object,
    count: object = 1,
    metadata: dict[str, Any] | None = None,
) -> int:
    return max(1, _safe_int(count, 1)) * gift_coin_value(gift_name, metadata)


@lru_cache(maxsize=1)
def _gift_value_lookup() -> dict[str, int]:
    try:
        payload = json.loads(GIFT_VALUES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    raw = payload.get("gift_values") if isinstance(payload, dict) else {}
    if not isinstance(raw, dict):
        return {}

    lookup: dict[str, int] = {}
    for name, value in raw.items():
        key = _normalize_key(name)
        coins = _safe_int(value, 0)
        if key and coins > 0:
            lookup[key] = max(coins, lookup.get(key, 0))
    return lookup


def _metadata_coin_value(metadata: dict[str, Any]) -> int:
    candidates: list[object] = []

    def collect(value: object, key: str = "") -> None:
        clean_key = _normalize_field_key(key)
        if clean_key in _DIRECT_VALUE_KEYS:
            candidates.append(value)

        if isinstance(value, dict):
            for child_key, child_value in value.items():
                collect(child_value, str(child_key))
        elif isinstance(value, list):
            for item in value[:6]:
                collect(item, key)

    collect(metadata)

    for value in candidates:
        parsed = _safe_int(value, 0)
        if parsed > 0:
            return parsed
    return 0


def _normalize_key(value: object) -> str:
    text = str(value or "").strip().casefold()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _normalize_field_key(value: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", str(value or "").strip().casefold())


def _safe_int(value: object, default: int) -> int:
    try:
        return int(float(str(value).replace(",", "").strip()))
    except (TypeError, ValueError):
        return default
