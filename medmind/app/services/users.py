from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_referral_code
from app.models import AuditLog, User, UserSettings


async def log_audit(
    session: AsyncSession,
    *,
    actor_type: str,
    actor_id: uuid.UUID | None,
    action: str,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    metadata: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_type=actor_type,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            log_metadata=metadata or {},
        )
    )


async def upsert_user(
    session: AsyncSession,
    *,
    telegram_id: int,
    username: str | None,
    full_name: str | None,
) -> tuple[User, bool]:
    result = await session.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()
    if user:
        user.telegram_username = username
        if full_name:
            user.full_name = full_name
        user.updated_at = datetime.now(timezone.utc)
        return user, False

    user = User(
        telegram_id=telegram_id,
        telegram_username=username,
        full_name=full_name,
        referral_code=generate_referral_code(),
    )
    session.add(user)
    await session.flush()
    session.add(UserSettings(user_id=user.id))
    await log_audit(
        session,
        actor_type="user",
        actor_id=user.id,
        action="user_created",
        entity_type="user",
        entity_id=user.id,
    )
    return user, True


async def update_user(session: AsyncSession, user: User, data: dict) -> User:
    if data.get("consent"):
        user.consent_at = datetime.now(timezone.utc)
        await log_audit(
            session,
            actor_type="user",
            actor_id=user.id,
            action="consent_given",
            entity_type="user",
            entity_id=user.id,
        )
    for field in ("specialty", "study_year", "university", "email", "locale"):
        if field in data and data[field] is not None:
            setattr(user, field, data[field])
    user.updated_at = datetime.now(timezone.utc)
    return user


async def get_user_by_telegram(session: AsyncSession, telegram_id: int) -> User | None:
    result = await session.execute(select(User).where(User.telegram_id == telegram_id))
    return result.scalar_one_or_none()
