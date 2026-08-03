"""Async job enqueue helpers — sensors never block on cortex processing."""

from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


async def enqueue_process_pending() -> bool:
    """Best-effort enqueue of cortex processing. Returns False if Redis unavailable."""
    try:
        from arq import create_pool
        from arq.connections import RedisSettings
        from urllib.parse import urlparse

        u = urlparse(settings.redis_url)
        redis = await create_pool(
            RedisSettings(
                host=u.hostname or "localhost",
                port=u.port or 6379,
                database=int((u.path or "/0").strip("/") or 0),
            )
        )
        await redis.enqueue_job("process_pending_events")
        await redis.aclose()
        return True
    except Exception as exc:  # noqa: BLE001 — local/SQLite demos often have no Redis
        logger.debug("enqueue_process_pending skipped: %s", exc)
        return False
