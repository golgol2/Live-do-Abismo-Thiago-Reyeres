from __future__ import annotations

import audioop
import json
import wave
from pathlib import Path

from boneco_game.models import MicroSegment


def analyze_audio_timeline(
    audio_path: Path,
    *,
    window_ms: int = 60,
    silence_threshold: float = 0.023,
    micro_pause_max: float = 0.35,
    min_speech_ms: int = 120,
    min_pause_ms: int = 60,
) -> list[MicroSegment]:
    """Gera a timeline de fala/pausa no mesmo formato usado no projeto antigo."""
    audio_path = Path(audio_path)
    with wave.open(str(audio_path), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        sample_width = wav_file.getsampwidth()
        channels = wav_file.getnchannels()
        total_frames = wav_file.getnframes()
        raw = wav_file.readframes(total_frames)

    if not raw or sample_rate <= 0 or sample_width <= 0:
        return [MicroSegment("pause", 0.0, 0.1, 0.1, 0.0)]

    max_amplitude = float(1 << (8 * sample_width - 1))
    window_frames = max(1, int(sample_rate * (window_ms / 1000.0)))
    window_bytes = window_frames * channels * sample_width
    windows: list[dict[str, float]] = []
    for offset in range(0, len(raw), window_bytes):
        chunk = raw[offset : offset + window_bytes]
        if not chunk:
            continue
        rms = audioop.rms(chunk, sample_width) / max_amplitude
        frame_count = len(chunk) / max(1, channels * sample_width)
        duration = frame_count / sample_rate
        windows.append({"duration": duration, "energy": rms})
    if not windows:
        return [MicroSegment("pause", 0.0, 0.1, 0.1, 0.0)]

    peak_energy = max(float(item["energy"]) for item in windows)
    dynamic_threshold = max(0.0035, peak_energy * 0.16)
    threshold = min(float(silence_threshold), dynamic_threshold)
    frames: list[dict[str, float | str]] = []
    for item in windows:
        rms = float(item["energy"])
        duration = float(item["duration"])
        kind = "speech" if rms >= threshold else "pause"
        if frames and frames[-1]["kind"] == kind:
            previous_duration = float(frames[-1]["duration"])
            total_duration = previous_duration + duration
            frames[-1]["energy"] = (
                (float(frames[-1].get("energy", 0.0)) * previous_duration) + (rms * duration)
            ) / total_duration
            frames[-1]["duration"] = total_duration
        else:
            frames.append({"kind": kind, "duration": duration, "energy": rms})

    merged = _merge_short_segments(
        frames,
        min_speech=min_speech_ms / 1000.0,
        min_pause=min_pause_ms / 1000.0,
    )
    if not merged:
        merged = [{"kind": "pause", "duration": 0.1, "energy": 0.0}]
    if all(str(item["kind"]) == "pause" for item in merged):
        total_duration = sum(float(item["duration"]) for item in merged)
        merged = [{"kind": "speech", "duration": max(0.1, total_duration), "energy": 0.0}]

    return _classify_micro_pauses(merged, micro_pause_max=micro_pause_max)


def write_audio_timeline_json(
    audio_path: Path,
    output_path: Path,
    **options: object,
) -> list[MicroSegment]:
    timeline = analyze_audio_timeline(audio_path, **options)
    payload = build_audio_timeline_payload(audio_path, timeline)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    return timeline


def build_audio_timeline_payload(audio_path: Path, timeline: list[MicroSegment]) -> dict[str, object]:
    segments = [segment.to_dict() for segment in timeline]
    timeline_end = max((float(item.get("end") or 0.0) for item in segments), default=0.0)
    speech_end = max(
        (float(item.get("end") or 0.0) for item in segments if item.get("kind") == "speech"),
        default=timeline_end,
    )
    trailing_mute_at = _compute_trailing_mute_at(segments, speech_end, timeline_end)
    return {
        "version": 2,
        "audio_file": str(audio_path),
        "segments": segments,
        "timeline_end": round(timeline_end, 4),
        "speech_end": round(speech_end, 4),
        "trailing_mute_at": round(trailing_mute_at, 4),
    }


def _compute_trailing_mute_at(segments: list[dict[str, object]], speech_end: float, timeline_end: float) -> float:
    last_speech_index = -1
    for index, item in enumerate(segments):
        if str(item.get("kind") or "") == "speech":
            last_speech_index = index
    if last_speech_index < 0:
        return timeline_end
    next_index = last_speech_index + 1
    if next_index < len(segments):
        try:
            return max(0.0, float(segments[next_index].get("start") or 0.0))
        except (TypeError, ValueError):
            pass
    return speech_end or timeline_end


def _merge_short_segments(
    frames: list[dict[str, float | str]],
    *,
    min_speech: float,
    min_pause: float,
) -> list[dict[str, float | str]]:
    merged: list[dict[str, float | str]] = []
    for item in frames:
        kind = str(item["kind"])
        duration = float(item["duration"])
        minimum = min_speech if kind == "speech" else min_pause
        if merged and duration < minimum:
            previous_duration = float(merged[-1]["duration"])
            total_duration = previous_duration + duration
            merged[-1]["energy"] = (
                (float(merged[-1].get("energy", 0.0)) * previous_duration)
                + (float(item.get("energy", 0.0)) * duration)
            ) / total_duration
            merged[-1]["duration"] = total_duration
            continue
        merged.append(dict(item))
    return merged


def _classify_micro_pauses(
    segments: list[dict[str, float | str]],
    *,
    micro_pause_max: float,
) -> list[MicroSegment]:
    result: list[MicroSegment] = []
    cursor = 0.0
    limit = max(0.0, float(micro_pause_max))
    for item in segments:
        duration = max(0.0, float(item.get("duration") or 0.0))
        if duration <= 0:
            continue
        raw_kind = str(item.get("kind") or "pause")
        if raw_kind == "speech":
            kind = "speech"
        elif duration <= limit:
            kind = "micro_pause"
        else:
            kind = "pause"
        start = cursor
        end = cursor + duration
        result.append(
            MicroSegment(
                kind=kind,
                start=round(start, 4),
                end=round(end, 4),
                duration=round(duration, 4),
                energy=round(float(item.get("energy") or 0.0), 6),
            )
        )
        cursor = end
    return result or [MicroSegment("pause", 0.0, 0.1, 0.1, 0.0)]
