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



def remove_live_audio_sink() -> list[str]:
    """Remove todos os module-null-sink do projeto para evitar estado residual entre lives."""
    removed: list[str] = []
    output = _pactl_stdout(["list", "short", "modules"])
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        module_id = parts[0].strip()
        description = "\t".join(parts[1:])
        if (
            "module-null-sink" not in description
            or f"sink_name={LIVE_AUDIO_SINK}" not in description
        ):
            continue
        result = subprocess.run(
            ["pactl", "unload-module", module_id],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            removed.append(module_id)
    return removed


def reset_live_audio_sink() -> tuple[str, str, str]:
    """Recria o sink de áudio da live para começar cada transmissão com estado limpo."""
    remove_live_audio_sink()
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        if LIVE_AUDIO_MONITOR not in list_pulse_sources():
            break
        time.sleep(0.05)
    return ensure_live_audio_sink()

def create_live_audio_sink_session(session_id: str = "") -> tuple[str, str, str]:
    """Cria um null-sink exclusivo para esta transmissão."""
    import os
    import re

    clean = re.sub(
        r"[^A-Za-z0-9_]+",
        "_",
        str(session_id or "").strip(),
    ).strip("_")

    if not clean:
        clean = f"{os.getpid()}_{int(time.time() * 1000)}"

    sink_name = f"{LIVE_AUDIO_SINK}_{clean}"[:120]
    monitor_name = f"{sink_name}.monitor"

    module = subprocess.run(
        [
            "pactl",
            "load-module",
            "module-null-sink",
            f"sink_name={sink_name}",
            (
                "sink_properties="
                f"device.description={LIVE_AUDIO_DESCRIPTION}_{clean}"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    module_id = module.stdout.strip()

    if module.returncode != 0 or not module_id:
        return "", "", ""

    deadline = time.monotonic() + 2.5

    while time.monotonic() < deadline:
        if monitor_name in list_pulse_sources():
            # Pequeno assentamento do grafo PipeWire/Pulse.
            time.sleep(0.20)
            return monitor_name, sink_name, module_id
        time.sleep(0.05)

    subprocess.run(
        ["pactl", "unload-module", module_id],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )

    return "", "", ""


def is_project_audio_source(audio_source: str) -> bool:
    source = str(audio_source or "").strip()

    if not source.endswith(".monitor"):
        return False

    sink_name = source[:-len(".monitor")]

    return (
        sink_name == LIVE_AUDIO_SINK
        or sink_name.startswith(f"{LIVE_AUDIO_SINK}_")
    )


def wait_live_audio_sinks_removed(timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + max(0.1, float(timeout))

    while time.monotonic() < deadline:
        project_sources = [
            source
            for source in list_pulse_sources()
            if is_project_audio_source(source)
        ]

        if not project_sources:
            return True

        time.sleep(0.05)

    return not any(
        is_project_audio_source(source)
        for source in list_pulse_sources()
    )

def player_sink_for_audio_source(audio_source: str) -> str:
    source = str(audio_source or "").strip()
    if not is_project_audio_source(source):
        return ""
    return source[:-len(".monitor")]


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
