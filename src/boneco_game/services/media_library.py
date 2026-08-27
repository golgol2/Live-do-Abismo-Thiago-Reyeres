from __future__ import annotations

import random
from pathlib import Path

from boneco_game.core.settings import ASSETS_DIR


VIDEO_EXTENSIONS = {".webm", ".mp4", ".mov", ".mkv"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".ogg", ".flac", ".m4a"}
IMAGE_EXTENSIONS = {".png", ".webp", ".jpg", ".jpeg"}


def avatar_dir(avatar: str) -> Path:
    return ASSETS_DIR / Path(avatar).name


def list_media(directory: Path, extensions: set[str]) -> list[Path]:
    directory = Path(directory)
    if not directory.exists():
        return []
    return sorted(path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in extensions)


def list_avatar_videos(avatar: str, mode: str) -> list[Path]:
    root = avatar_dir(avatar)
    candidates: list[Path] = []
    for folder in (root / mode, root / mode / "camera1", root / mode / "camera2"):
        candidates.extend(list_media(folder, VIDEO_EXTENSIONS))
    return sorted(dict.fromkeys(candidates))


def pick_avatar_video(avatar: str, mode: str, *, avoid: str = "") -> Path | None:
    videos = list_avatar_videos(avatar, mode)
    if not videos:
        return None
    filtered = [item for item in videos if str(item) != avoid]
    return random.choice(filtered or videos)

