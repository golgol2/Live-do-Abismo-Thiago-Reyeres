from __future__ import annotations

import re
import unicodedata

from boneco_game.core.settings import BLACKLIST_FILE


_BLACKLIST_CACHE: set[str] = set()
_BLACKLIST_MTIME_NS = -1
_OUTPUT_FILTER_EXCLUSIONS = {
    "manda",
    "mande",
    "mandar",
    "manda salve",
    "manda um salve",
    "manda beijo",
    "me manda beijo",
    "manda oi pro",
    "manda oi pra",
    "manda oi para",
    "mandou uma",
    "enviou",
    "enviou um",
    "me da",
    "me dá",
    "dinheiro",
}


def has_blocked_term(text: object) -> bool:
    normalized = _norm(text)
    if not normalized:
        return False
    terms = _load_blacklist()
    if not terms:
        return False
    return _matches_terms(normalized, terms)


def has_blocked_output_term(text: object) -> bool:
    normalized = _norm(text)
    if not normalized:
        return False
    terms = _load_blacklist()
    if not terms:
        return False
    return _matches_terms(normalized, terms - {_norm(term) for term in _OUTPUT_FILTER_EXCLUSIONS})


def has_low_value_noise_pattern(text: object) -> bool:
    raw = str(text or "").strip()
    if not raw:
        return True
    normalized = _norm(raw)
    if len(raw) > 180:
        return True
    words = re.findall(r"[A-Za-zÀ-ÿ0-9]+", raw)
    if not words:
        return True
    if any(len(word) >= 25 for word in words):
        return True
    if re.search(r"([^\w\sÀ-ÿ])\1+", raw):
        return True
    if re.fullmatch(r"(?:kk+|rs+|\d+|\W+)", normalized.replace(" ", "")):
        return True
    if len(words) >= 3 and len(set(word.casefold() for word in words)) == 1:
        return True
    return False


def _load_blacklist() -> set[str]:
    global _BLACKLIST_CACHE, _BLACKLIST_MTIME_NS
    try:
        stat = BLACKLIST_FILE.stat()
    except OSError:
        _BLACKLIST_CACHE = set()
        _BLACKLIST_MTIME_NS = -1
        return set()
    if _BLACKLIST_CACHE and stat.st_mtime_ns == _BLACKLIST_MTIME_NS:
        return _BLACKLIST_CACHE
    try:
        lines = BLACKLIST_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        lines = []
    terms = set()
    for line in lines:
        clean = line.split("#", 1)[0].strip()
        if clean:
            terms.add(_norm(clean))
    _BLACKLIST_CACHE = terms
    _BLACKLIST_MTIME_NS = stat.st_mtime_ns
    return terms


def _norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").casefold())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.replace("0", "o").replace("1", "i").replace("3", "e").replace("4", "a").replace("@", "a")
    text = re.sub(r"[^0-9a-zà-ÿ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _matches_terms(normalized: str, terms: set[str]) -> bool:
    compact = normalized.replace(" ", "")
    for term in terms:
        if not term:
            continue
        if " " in term:
            if term in normalized:
                return True
            continue
        if re.search(rf"\b{re.escape(term)}\b", normalized):
            return True
        if len(term) >= 4 and term in compact:
            return True
    return False
