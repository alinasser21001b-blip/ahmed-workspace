# Design timeline helpers (production + design life-cycle)

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TimelineEvent


async def append_timeline(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    subject_type: str,
    subject_id: uuid.UUID,
    kind: str,
    label: str,
    stage: Optional[str] = None,
    properties: Optional[dict[str, Any]] = None,
    occurred_at: Optional[datetime] = None,
    evidence_event_id: Optional[uuid.UUID] = None,
) -> TimelineEvent:
    te = TimelineEvent(
        tenant_id=tenant_id,
        subject_type=subject_type,
        subject_id=subject_id,
        kind=kind,
        label=label,
        stage=stage,
        occurred_at=occurred_at or datetime.now(timezone.utc),
        properties=properties or {},
        evidence_event_id=evidence_event_id,
    )
    session.add(te)
    await session.flush()
    return te


async def list_timeline(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    subject_id: uuid.UUID,
    kind: Optional[str] = None,
) -> list[TimelineEvent]:
    stmt = (
        select(TimelineEvent)
        .where(TimelineEvent.tenant_id == tenant_id, TimelineEvent.subject_id == subject_id)
        .order_by(TimelineEvent.occurred_at.asc())
    )
    if kind:
        stmt = stmt.where(TimelineEvent.kind == kind)
    return list((await session.execute(stmt)).scalars().all())
