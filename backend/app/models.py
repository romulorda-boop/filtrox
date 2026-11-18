from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Mapping


VideoSource = Literal["xvideos"]


def _timestamp_text(value: datetime | str) -> str:
    return value.isoformat() if isinstance(value, datetime) else str(value)


@dataclass(frozen=True, slots=True)
class HistoryItem:
    """Private, account-scoped watch-history row returned by the repository."""

    video_id: str
    url: str
    source: VideoSource
    played_at: str

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> HistoryItem:
        return cls(
            video_id=str(row["video_id"]).strip(),
            url=str(row["video_url"]),
            source="xvideos",
            played_at=_timestamp_text(row["played_at"]),
        )

    def as_dict(self) -> dict[str, str]:
        return {
            "video_id": self.video_id,
            "url": self.url,
            "source": self.source,
            "played_at": self.played_at,
        }


@dataclass(frozen=True, slots=True)
class FavoriteItem:
    """Private, account-scoped favorite row returned by the repository."""

    video_id: str
    url: str
    source: VideoSource
    created_at: str

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> FavoriteItem:
        return cls(
            video_id=str(row["video_id"]).strip(),
            url=str(row["video_url"]),
            source="xvideos",
            created_at=_timestamp_text(row["created_at"]),
        )

    def as_dict(self) -> dict[str, str]:
        return {
            "video_id": self.video_id,
            "url": self.url,
            "source": self.source,
            "created_at": self.created_at,
        }
