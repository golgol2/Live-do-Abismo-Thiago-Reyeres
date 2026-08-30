from __future__ import annotations

import random
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from boneco_game.core.settings import ASSETS_DIR, DEFAULT_AVATAR
from boneco_game.services.live_text import clamp_text, display_name, gift_display_name, make_platform_safe, normalize_tts_text


PHRASES_DIR = ASSETS_DIR / DEFAULT_AVATAR / "frases"
NICKNAMES_MASC_FILE = PHRASES_DIR / "presentes_apelidos_masculino.txt"
NICKNAMES_FEM_FILE = PHRASES_DIR / "presentes_apelidos_feminino.txt"
PHRASES_MASC_FILE = PHRASES_DIR / "presentes_fallback_masculino.txt"
PHRASES_FEM_FILE = PHRASES_DIR / "presentes_fallback_feminino.txt"
JOINERS_FILE = PHRASES_DIR / "presentes_complementos.txt"
NAMES_MASC_FILE = PHRASES_DIR / "nomes_masculinos.txt"
NAMES_FEM_FILE = PHRASES_DIR / "nomes_femininos.txt"

MASCULINE = "masculine"
FEMININE = "feminine"
_recent_picks: dict[str, list[str]] = {}

_FALLBACK_MASC_NICKNAMES = (
    "calabresudo",
    "farofudo",
    "abismudo",
    "amassadinho",
    "desengoncado",
    "bronqueado",
    "patetudo",
)
_FALLBACK_FEM_NICKNAMES = (
    "calabresuda",
    "farofuda",
    "abismuda",
    "amassadinha",
    "desengoncada",
    "bronqueada",
    "patetuda",
)
_FALLBACK_JOINERS = (
    "vai com calma",
    "tá tirando onda",
    "aí você me quebra",
    "qual foi",
    "mete essa não",
    "olha o proceder",
    "segura a onda",
    "não complica meu lado",
)
_BLOCKED_SUFFIX_WORDS_RE = re.compile(
    r"\b(?:obrigad|valeu|presente|gastar|dinheiro|inferno|capeta|dem[oô]nio|diabo|satan[aá]s?)\b",
    flags=re.IGNORECASE,
)


def gift_fallback_text(username: object, gift_name: object, repeat_count: object = 1, *, max_chars: int = 150) -> str:
    name = display_name(username)
    gift = gift_quantity_phrase(gift_name, repeat_count)
    repeat = _repeat_count(repeat_count)
    gender = MASCULINE if repeat > 1 else gift_gender(gift_name)
    templates = _phrase_templates(gender)
    if not templates:
        fallback = f"{name}, {gift} me tirou do eixo"
        return append_gift_nickname_suffix(fallback, name, max_chars=max_chars)

    values = {
        "usuario": name,
        "presente": gift,
        "gift": gift,
        "qtd": str(repeat),
        "raiva": str(max(1, min(10, repeat))),
    }
    for template in _shuffled_templates(f"gift_phrase:{gender}", templates):
        rendered = _render_template(template, values)
        rendered = append_gift_nickname_suffix(rendered, name, max_chars=max_chars)
        if rendered and len(rendered) <= max_chars:
            return rendered

    rendered = _render_template(templates[0], values)
    return append_gift_nickname_suffix(rendered, name, max_chars=max_chars)


def gift_quantity_phrase(gift_name: object, repeat_count: object = 1) -> str:
    repeat = _repeat_count(repeat_count)
    gift = pluralize_gift_name(gift_name, repeat)
    if repeat > 1:
        return f"esse lote de {repeat} {gift}"
    article = "a" if gift_gender(gift_name) == FEMININE else "o"
    return f"{article} {gift}"


def pluralize_gift_name(gift_name: object, repeat_count: object = 1) -> str:
    gift = clamp_text(gift_display_name(gift_name), 40) or "item"
    if _repeat_count(repeat_count) <= 1:
        return gift
    key = _normalize_key(gift)
    if key in {"rose", "rosa"}:
        return "Rosas"
    if gift.casefold().endswith("s"):
        return gift
    if gift.casefold().endswith("ão"):
        return f"{gift[:-2]}ões"
    if gift.casefold().endswith("m"):
        return f"{gift[:-1]}ns"
    return f"{gift}s"


def gift_gender(gift_name: object) -> str:
    key = _normalize_key(gift_name)
    if _looks_feminine_gift_key(key):
        return FEMININE
    return MASCULINE


def append_gift_nickname_suffix(text: object, username: object, *, max_chars: int = 150) -> str:
    base = re.sub(r"\s+", " ", str(text or "")).strip()
    if not base:
        return ""

    suffix = gift_nickname_suffix(username)
    if not suffix:
        return clamp_text(base, max_chars)

    candidate = _join_suffix(base, suffix)
    if len(candidate) <= max_chars:
        return candidate

    base_limit = max_chars - len(suffix) - 2
    if base_limit < 24:
        return clamp_text(base, max_chars)

    short_base = _shorten_base(base, base_limit)
    if not short_base:
        return clamp_text(base, max_chars)
    return clamp_text(_join_suffix(short_base, suffix), max_chars)


def gift_nickname_suffix(username: object) -> str:
    gender = user_nickname_gender(username)
    if gender == FEMININE:
        article = "sua"
        nickname = _pick("nickname:feminine", _nicknames(FEMININE) or _FALLBACK_FEM_NICKNAMES)
    elif gender == MASCULINE:
        article = "seu"
        nickname = _pick("nickname:masculine", _nicknames(MASCULINE) or _FALLBACK_MASC_NICKNAMES)
    else:
        article = "seu"
        nickname = _pick("nickname:neutral", _neutral_nicknames())

    if not nickname:
        return ""

    if _normalize_key(nickname).startswith("cara de "):
        phrase = nickname
    else:
        phrase = f"{article} {nickname}"

    joiner = _pick("nickname_joiner", _joiners())
    if joiner:
        return f"{joiner} {phrase}!"
    return f"{phrase}!"


def user_nickname_gender(username: object) -> str:
    key = _normalize_key(username)
    if not key:
        return ""

    tokens = key.split()
    masc_names = _name_tokens(MASCULINE)
    fem_names = _name_tokens(FEMININE)

    for token in tokens:
        if token in fem_names:
            return FEMININE
        if token in masc_names:
            return MASCULINE

    for token in tokens:
        matched = _prefix_name_gender(token, masc_names, fem_names)
        if matched:
            return matched

    letters = re.sub(r"[^a-z]+", "", key)
    if not letters:
        return ""
    if letters.endswith("a") or (len(letters) >= 2 and letters[-2] == "a"):
        return FEMININE
    if letters.endswith("o") or (len(letters) >= 2 and letters[-2] == "o"):
        return MASCULINE
    return ""


@lru_cache(maxsize=2)
def _nicknames(gender: str) -> tuple[str, ...]:
    path = NICKNAMES_FEM_FILE if gender == FEMININE else NICKNAMES_MASC_FILE
    return _load_clean_lines(path)


@lru_cache(maxsize=2)
def _phrase_templates(gender: str) -> tuple[str, ...]:
    path = PHRASES_FEM_FILE if gender == FEMININE else PHRASES_MASC_FILE
    return _load_template_lines(path)


@lru_cache(maxsize=1)
def _joiners() -> tuple[str, ...]:
    loaded = _load_clean_lines(JOINERS_FILE)
    items = [item for item in (*loaded, *_FALLBACK_JOINERS) if not _BLOCKED_SUFFIX_WORDS_RE.search(item)]
    return _dedupe(items)


@lru_cache(maxsize=2)
def _name_tokens(gender: str) -> frozenset[str]:
    path = NAMES_FEM_FILE if gender == FEMININE else NAMES_MASC_FILE
    return frozenset(_normalize_key(item) for item in _load_clean_lines(path))


def _neutral_nicknames() -> tuple[str, ...]:
    candidates = [
        item
        for source in (_nicknames(MASCULINE), _nicknames(FEMININE))
        for item in source
        if _normalize_key(item).startswith("cara de ")
    ]
    return tuple(candidates) or _FALLBACK_MASC_NICKNAMES


def _prefix_name_gender(token: str, masc_names: frozenset[str], fem_names: frozenset[str]) -> str:
    if len(token) < 5:
        return ""
    matches: list[tuple[int, str]] = []
    matches.extend((len(name), FEMININE) for name in fem_names if len(name) >= 3 and token.startswith(name))
    matches.extend((len(name), MASCULINE) for name in masc_names if len(name) >= 3 and token.startswith(name))
    if not matches:
        return ""
    matches.sort(reverse=True)
    return matches[0][1]


def _looks_feminine_gift_key(key: str) -> bool:
    tokens = set(str(key or "").split())
    feminine_tokens = {
        "rose",
        "rosa",
        "flower",
        "flowers",
        "flor",
        "flores",
        "tiara",
        "crown",
        "umbrella",
        "ball",
        "guitar",
        "capsule",
        "painting",
        "slide",
        "mask",
        "melody",
        "garland",
        "pearl",
        "pearls",
        "bouquet",
    }
    return bool(tokens.intersection(feminine_tokens)) or str(key or "").endswith("a")


def _load_clean_lines(path: Path) -> tuple[str, ...]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ()
    return _dedupe(line for line in lines if line.strip() and not line.lstrip().startswith("#"))


def _load_template_lines(path: Path) -> tuple[str, ...]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ()
    seen: set[str] = set()
    result: list[str] = []
    for line in lines:
        clean = re.sub(r"\s+", " ", str(line or "")).strip()
        if not clean or clean.lstrip().startswith("#"):
            continue
        key = _normalize_template_key(clean)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(clean)
    return tuple(result)


def _dedupe(items) -> tuple[str, ...]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        clean = make_platform_safe(normalize_tts_text(item)).strip(" ,.!?:;")
        key = _normalize_key(clean)
        if not clean or not key or key in seen:
            continue
        seen.add(key)
        result.append(clean)
    return tuple(result)


def _render_template(template: str, values: dict[str, str]) -> str:
    text = str(template or "")
    for key, value in values.items():
        text = text.replace("{" + key + "}", value)
    return _capitalize_sentences(make_platform_safe(normalize_tts_text(text)).strip())


def _shuffled_templates(category: str, items: tuple[str, ...]) -> tuple[str, ...]:
    first = _pick(category, items)
    rest = [item for item in items if item != first]
    random.shuffle(rest)
    return tuple([first, *rest]) if first else tuple(rest)


def _pick(category: str, items: tuple[str, ...]) -> str:
    choices = [item for item in items if item]
    if not choices:
        return ""
    recent = _recent_picks.setdefault(category, [])
    candidates = [item for item in choices if item not in recent]
    picked = random.choice(candidates or choices)
    recent.append(picked)
    del recent[:-10]
    return picked


def _join_suffix(base: str, suffix: str) -> str:
    clean_base = str(base or "").rstrip(" .,!?:;")
    clean_suffix = str(suffix or "").lstrip(" ,.!?:;")
    if not clean_base or not clean_suffix:
        return clean_base or clean_suffix
    return f"{clean_base}. {clean_suffix[:1].upper()}{clean_suffix[1:]}"


def _shorten_base(base: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(base or "")).strip(" .,!?:;")
    if len(text) <= limit:
        return text
    sentence_end = max(text.rfind(".", 0, limit), text.rfind("!", 0, limit), text.rfind("?", 0, limit))
    if sentence_end >= 18:
        return text[:sentence_end].strip(" .,!?:;")
    cut = text[:limit].rstrip(" ,.;:")
    word_cut = cut.rsplit(" ", 1)[0].rstrip(" ,.;:")
    return word_cut if len(word_cut) >= 18 else cut


def _capitalize_sentences(text: str) -> str:
    clean = str(text or "").strip()
    if not clean:
        return ""
    clean = clean[:1].upper() + clean[1:]

    def repl(match: re.Match[str]) -> str:
        return f"{match.group(1)} {match.group(2).upper()}"

    return re.sub(r"([.!?])\s+([a-zà-ÿ])", repl, clean)


def _repeat_count(value: object) -> int:
    match = re.search(r"\d+", str(value or ""))
    if not match:
        return 1
    try:
        return max(1, int(match.group(0)))
    except ValueError:
        return 1


def _normalize_key(value: object) -> str:
    text = normalize_tts_text(value).casefold()
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_template_key(value: object) -> str:
    text = str(value or "").casefold()
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"[^a-z0-9{}]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()
