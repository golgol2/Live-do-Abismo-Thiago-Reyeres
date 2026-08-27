from __future__ import annotations

import subprocess
import time


LIVE_AUDIO_SINK = "tiktok_live_pygame"
LIVE_AUDIO_MONITOR = f"{LIVE_AUDIO_SINK}.monitor"
LIVE_AUDIO_DESCRIPTION = "TikTokLivePygame"
LIVE_PLAYER_PULSE_PROPS = (
    "application.name=TikTokLivePlayer "
    "application.id=tiktok_live_player "
    "media.name=TikTokLivePlayer"
)


def ensure_live_audio_sink() -> tuple[str, str, str]:
    """Cria/reusa o sink virtual usado pelo projeto antigo para isolar o áudio da live."""
    if LIVE_AUDIO_MONITOR in list_pulse_sources():
        return LIVE_AUDIO_MONITOR, LIVE_AUDIO_SINK, ""
    module = subprocess.run(
        [
            "pactl",
            "load-module",
            "module-null-sink",
            f"sink_name={LIVE_AUDIO_SINK}",
            f"sink_properties=device.description={LIVE_AUDIO_DESCRIPTION}",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    module_id = module.stdout.strip()
    if module.returncode != 0 or not module_id:
        return "", "", ""
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        if LIVE_AUDIO_MONITOR in list_pulse_sources():
            return LIVE_AUDIO_MONITOR, LIVE_AUDIO_SINK, module_id
        time.sleep(0.05)
    subprocess.run(["pactl", "unload-module", module_id], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return "", "", ""


def player_sink_for_audio_source(audio_source: str) -> str:
    return LIVE_AUDIO_SINK if str(audio_source or "").strip() == LIVE_AUDIO_MONITOR else ""


def append_pulse_props(current: str, extra: str = LIVE_PLAYER_PULSE_PROPS) -> str:
    current = str(current or "").strip()
    extra = str(extra or "").strip()
    if not current:
        return extra
    if not extra:
        return current
    return f"{current} {extra}"


def list_pulse_sources() -> list[str]:
    output = _pactl_stdout(["list", "short", "sources"])
    sources: list[str] = []
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            sources.append(parts[1].strip())
    return sources


def list_pulse_sinks() -> list[str]:
    output = _pactl_stdout(["list", "short", "sinks"])
    sinks: list[str] = []
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            sinks.append(parts[1].strip())
    return sinks


def detect_default_monitor_source() -> str:
    info = _pactl_stdout(["info"])
    default_sink = ""
    for line in info.splitlines():
        if line.startswith("Default Sink:"):
            default_sink = line.split(":", 1)[1].strip()
            break
    sources = list_pulse_sources()
    if default_sink:
        monitor = f"{default_sink}.monitor"
        if monitor in sources:
            return monitor
    for source in sources:
        if source.endswith(".monitor"):
            return source
    return ""


def _pactl_stdout(args: list[str]) -> str:
    try:
        return subprocess.run(["pactl", *args], capture_output=True, text=True, check=False).stdout
    except OSError:
        return ""
