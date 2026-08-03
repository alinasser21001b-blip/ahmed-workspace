"""ARQ worker — async media / event processing."""

from __future__ import annotations

import uuid

from arq import cron
from sqlalchemy import select

from app.core.config import settings
from app.db.models import DomainEvent, MediaAsset
from app.db.session import SessionLocal
from app.services.gateway import get_gateway
from brain.processor import EventProcessor


async def process_pending_events(ctx):
    tenant_id = uuid.UUID(settings.tenant_id)
    gateway = get_gateway()
    async with SessionLocal() as session:
        processor = EventProcessor(session, tenant_id, gateway)
        q = await session.execute(
            select(DomainEvent)
            .where(DomainEvent.tenant_id == tenant_id, DomainEvent.processed.is_(False))
            .order_by(DomainEvent.occurred_at.asc())
            .limit(50)
        )
        for event in q.scalars().all():
            mq = await session.execute(select(MediaAsset).where(MediaAsset.event_id == event.id))
            for media in mq.scalars().all():
                await processor.process_media(media, event)
            # Audio process_media already runs process_event; skip if marked done
            if not event.processed:
                await processor.process_event(event)
        await session.commit()
    return {"ok": True}


async def hourly_summary_job(ctx):
    from production.service import ProductionService

    tenant_id = uuid.UUID(settings.tenant_id)
    async with SessionLocal() as session:
        svc = ProductionService(session, tenant_id, get_gateway())
        summary = await svc.hourly_summary(hours=1)
        from app.db.models import StateDelta

        session.add(
            StateDelta(
                tenant_id=tenant_id,
                category="hourly_summary",
                summary=summary.get("narrative") or "Hourly summary generated",
                severity="info",
                properties=summary,
            )
        )
        await session.commit()
    return summary


class WorkerSettings:
    functions = [process_pending_events, hourly_summary_job]
    cron_jobs = [
        cron(process_pending_events, second={0, 30}),  # every 30s
        cron(hourly_summary_job, hour=None, minute=5),
    ]
    redis_settings = None  # set below


def _redis_settings():
    from arq.connections import RedisSettings
    from urllib.parse import urlparse

    u = urlparse(settings.redis_url)
    return RedisSettings(
        host=u.hostname or "localhost",
        port=u.port or 6379,
        database=int((u.path or "/0").strip("/") or 0),
    )


WorkerSettings.redis_settings = _redis_settings()
