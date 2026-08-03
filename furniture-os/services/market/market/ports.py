"""Market Intelligence — design-history contracts (implementation deferred)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field


class MarketArtifact(BaseModel):
    """Normalized market observation before graph write."""

    source: str
    url: str | None = None
    title: str | None = None
    observed_at: datetime
    media_refs: list[str] = Field(default_factory=list)
    raw_tags: list[str] = Field(default_factory=list)
    factory_name: str | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)


class DesignTimelinePoint(BaseModel):
    design_id: str
    stage: str  # first_seen | adapted | spreading | trending | declining
    occurred_at: datetime
    originator: str | None = None
    evidence_refs: list[str] = Field(default_factory=list)
    notes: str | None = None


class TrendNarrative(BaseModel):
    period: str
    bullets: list[str]
    rising: list[str] = Field(default_factory=list)
    declining: list[str] = Field(default_factory=list)
    originators: list[str] = Field(default_factory=list)


class MarketIngestPort(Protocol):
    async def ingest(self, artifacts: list[MarketArtifact]) -> dict[str, Any]: ...


class TrendQueryPort(Protocol):
    async def design_timeline(self, design_id: str) -> list[DesignTimelinePoint]: ...

    async def weekly_narrative(self) -> TrendNarrative: ...


class MarketStub:
    """Contract-ready stub — no scrapers in MVP."""

    async def ingest(self, artifacts: list[MarketArtifact]) -> dict[str, Any]:
        return {
            "accepted": len(artifacts),
            "status": "queued_for_phase3",
            "message": "Market collectors not enabled in Production MVP. Schemas are shared with Design DNA / Graph.",
        }

    async def design_timeline(self, design_id: str) -> list[DesignTimelinePoint]:
        return []

    async def weekly_narrative(self) -> TrendNarrative:
        return TrendNarrative(
            period="n/a",
            bullets=["Market Intelligence module is contract-ready; collection starts in Phase 3."],
        )


market_stub = MarketStub()
