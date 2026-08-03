from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import SubscriptionStatus
from app.models import Subscription, SubscriptionPlan, User


async def seed_plans(session: AsyncSession) -> None:
    result = await session.execute(select(SubscriptionPlan))
    if result.scalars().first():
        return
    plans = [
        SubscriptionPlan(
            code="basic",
            name_ar="أساسي",
            name_en="Basic",
            price_iqd=5000,
            packs_per_month=10,
            features={"anki": False, "mindmap": False, "quiz": False, "automation": False},
        ),
        SubscriptionPlan(
            code="pro",
            name_ar="احترافي",
            name_en="Pro",
            price_iqd=12000,
            packs_per_month=30,
            features={"anki": True, "mindmap": True, "quiz": True, "automation": False},
        ),
        SubscriptionPlan(
            code="ultimate",
            name_ar="شامل",
            name_en="Ultimate",
            price_iqd=20000,
            packs_per_month=0,
            features={"anki": True, "mindmap": True, "quiz": True, "automation": True},
        ),
    ]
    session.add_all(plans)


async def get_plan_by_code(session: AsyncSession, code: str) -> SubscriptionPlan | None:
    result = await session.execute(select(SubscriptionPlan).where(SubscriptionPlan.code == code))
    return result.scalar_one_or_none()


async def get_active_subscription(session: AsyncSession, user_id: uuid.UUID) -> Subscription | None:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(Subscription)
        .options(selectinload(Subscription.plan))
        .where(
            Subscription.user_id == user_id,
            Subscription.status == SubscriptionStatus.ACTIVE,
            Subscription.expires_at > now,
        )
    )
    return result.scalar_one_or_none()


async def can_create_pack(session: AsyncSession, user: User) -> tuple[bool, str | None, Subscription | None]:
    sub = await get_active_subscription(session, user.id)
    if not sub:
        return False, "SUBSCRIPTION_REQUIRED", None
    limit = sub.plan.packs_per_month
    if limit > 0 and sub.packs_used >= limit:
        return False, "QUOTA_EXCEEDED", sub
    return True, None, sub


async def activate_subscription(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    plan: SubscriptionPlan,
) -> Subscription:
    now = datetime.now(timezone.utc)
    existing = await get_active_subscription(session, user_id)
    if existing:
        existing.status = SubscriptionStatus.CANCELLED
        existing.updated_at = now

    sub = Subscription(
        user_id=user_id,
        plan_id=plan.id,
        status=SubscriptionStatus.ACTIVE,
        starts_at=now,
        expires_at=now + timedelta(days=30),
        packs_used=0,
    )
    session.add(sub)
    await session.flush()
    return sub
