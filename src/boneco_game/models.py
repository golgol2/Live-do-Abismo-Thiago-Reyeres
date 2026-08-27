from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


SegmentKind = Literal["speech", "micro_pause", "pause"]
ActorKind = Literal["main", "dj", "oracle", "guest", "user"]
SceneMode = Literal["idle", "talking", "walking", "laugh", "dance", "singing", "oracle", "dj", "manual"]


@dataclass(frozen=True)
class MicroSegment:
    kind: SegmentKind
    start: float
    end: float
    duration: float
    energy: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class SpeechJob:
    id: str
    actor: ActorKind
    text: str
    audio_path: str = ""
    timeline: list[MicroSegment] = field(default_factory=list)
    priority: int = 40
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "actor": self.actor,
            "text": self.text,
            "audio_path": self.audio_path,
            "timeline": [item.to_dict() for item in self.timeline],
            "priority": self.priority,
            "metadata": dict(self.metadata),
        }

