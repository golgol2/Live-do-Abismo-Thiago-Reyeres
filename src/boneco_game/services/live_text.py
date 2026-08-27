from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from boneco_game.core.settings import PRIVATE_DIR


TTS_ABBREVIATIONS_FILE = PRIVATE_DIR / "tts_abbreviations.json"
_ABBREVIATIONS_CACHE: dict[str, str] = {}
_ABBREVIATIONS_MTIME_NS = -1

GIFT_SPEECH_NAMES = {
    "rose": "Rosa",
    "roses": "Rosas",
}


def clamp_text(text: object, max_chars: int = 200) -> str:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(clean) <= max_chars:
        return clean
    return clean[: max(1, max_chars - 1)].rstrip(" .,;:-") + "."


def normalize_tts_text(text: object) -> str:
    clean = unicodedata.normalize("NFKC", str(text or ""))
    clean = "".join(char for char in clean if unicodedata.category(char) != "Mn")
    clean = re.sub(r"[#@]+", " ", clean)
    clean = re.sub(r"(?<!\w)[:;=8xX][-']?[)D(Pp/\\]+(?!\w)", " ", clean)
    clean = re.sub(r"[^\w\sÀ-ÿ.,!?;:()'-]", " ", clean, flags=re.UNICODE)
    clean = re.sub(r"\.{2,}|…+", ".", clean)
    clean = re.sub(r"\s+", " ", clean).strip(" ,;:")
    return make_platform_safe(clean)


def make_platform_safe(text: object) -> str:
    replacements = (
        (r"\binferno\b", "porão das sombras"),
        (r"\bcapeta(s)?\b", "coisa do canto"),
        (r"\bdem[oô]nio(s)?\b", "sombra antiga"),
        (r"\bdiabo\b", "eco torto"),
        (r"\bsatan[aá]s?\b", "sombra maior"),
        (r"\bpix\b", "px"),
    )
    clean = str(text or "")
    for pattern, replacement in replacements:
        clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", clean).strip()


def restore_common_pt_br_accents(text: object) -> str:
    clean = unicodedata.normalize("NFC", str(text or ""))
    replacements = {
        "acao": "ação",
        "acoes": "ações",
        "alem": "além",
        "alguem": "alguém",
        "ate": "até",
        "coracao": "coração",
        "historia": "história",
        "ja": "já",
        "nao": "não",
        "ninguem": "ninguém",
        "silencio": "silêncio",
        "situacao": "situação",
        "tambem": "também",
        "voce": "você",
        "voces": "vocês",
    }

    def replace_word(match: re.Match[str]) -> str:
        word = match.group(0)
        replacement = replacements.get(word.casefold())
        if not replacement:
            return word
        if word.isupper():
            return replacement.upper()
        if word[:1].isupper():
            return replacement[:1].upper() + replacement[1:]
        return replacement

    return re.sub(r"\b[A-Za-zÀ-ÿ]+\b", replace_word, clean)


def display_name(value: object, fallback: str = "visitante") -> str:
    text = normalize_tts_text(_repair_name_symbols(value)).strip().strip("@")
    text = re.sub(r"\d+", "", text)
    text = re.sub(r"[_\\.@-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" .,;:-!?")
    parts = [part.strip("@") for part in text.split() if re.search(r"[A-Za-zÀ-ÿ]", part)]
    if not parts:
        return clamp_text(fallback, 24)
    for part in parts[:3]:
        if len(part) > 1:
            return clamp_text(part, 24)
    if len(parts) >= 2:
        return clamp_text(f"{parts[0]} {parts[1]}", 24)
    return clamp_text(parts[0] or text or fallback, 24)


def display_name_from_candidates(*values: object, fallback: str = "visitante") -> str:
    single_letter = ""
    for value in values:
        name = display_name(value, fallback="")
        if not name:
            continue
        parts = name.split()
        if not parts:
            continue
        if len(parts[0]) > 1 or len(parts) >= 2:
            return name
        single_letter = single_letter or name
    return single_letter or display_name("", fallback=fallback)


def clean_chat_message(value: object) -> str:
    text = normalize_tts_text(value)
    if not text:
        return ""
    text = restore_common_pt_br_accents(_expand_common_chat_abbreviations(text))
    text = re.sub(r"\?{2,}", "?", text)
    text = re.sub(r"!{2,}", "!", text)
    if re.fullmatch(r"(?i)(k|kk|kkk|kkkk+|rs|rsrs)+", text.replace(" ", "")):
        return ""
    words = re.findall(r"[A-Za-zÀ-ÿ0-9]+", text)
    if not words:
        return ""
    if any(len(word) >= 25 for word in words):
        return ""
    if re.search(r"([^\w\sÀ-ÿ])\1+", text):
        return ""
    return clamp_text(text, 180)


def gift_display_name(gift_name: object) -> str:
    clean = normalize_tts_text(gift_name)
    key = unicodedata.normalize("NFKD", clean).encode("ascii", "ignore").decode("ascii").casefold()
    key = re.sub(r"[^a-z0-9]+", " ", key).strip()
    return GIFT_SPEECH_NAMES.get(key, clean)


def compact_user_key(value: object) -> str:
    clean = normalize_tts_text(value).casefold()
    return re.sub(r"[^0-9a-zà-ÿ]+", "", clean)


def _repair_name_symbols(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    # Handles common stylized profile names such as R@faella without speaking the symbol.
    text = re.sub(r"(?<=[A-Za-zÀ-ÿ])@(?=[A-Za-zÀ-ÿ])", "a", text)
    return text


def _expand_common_chat_abbreviations(text: str) -> str:
    abbreviations = _load_abbreviations()
    if not abbreviations:
        return text
    for abbreviation in sorted(abbreviations, key=len, reverse=True):
        replacement = abbreviations[abbreviation]
        pattern = rf"(?<![\wÀ-ÿ]){re.escape(abbreviation)}(?![\wÀ-ÿ])"
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _load_abbreviations() -> dict[str, str]:
    global _ABBREVIATIONS_CACHE, _ABBREVIATIONS_MTIME_NS
    try:
        stat = TTS_ABBREVIATIONS_FILE.stat()
    except OSError:
        _ABBREVIATIONS_CACHE = {}
        _ABBREVIATIONS_MTIME_NS = -1
        return {}
    if _ABBREVIATIONS_CACHE and stat.st_mtime_ns == _ABBREVIATIONS_MTIME_NS:
        return _ABBREVIATIONS_CACHE
    try:
        data = json.loads(TTS_ABBREVIATIONS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    _ABBREVIATIONS_CACHE = {
        str(key).strip().casefold(): str(value).strip()
        for key, value in data.items()
        if str(key).strip() and str(value).strip()
    }
    _ABBREVIATIONS_MTIME_NS = stat.st_mtime_ns
    return _ABBREVIATIONS_CACHE
