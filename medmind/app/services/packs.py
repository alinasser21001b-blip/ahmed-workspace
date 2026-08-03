from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import JobStatus, JobType, PackStatus, PaymentMethod, PaymentStatus
from app.core.utils import payment_reference
from app.models import PackJob, Payment, PaymentRequest, StudyPack, User
from app.services.users import log_audit
from app.services.subscriptions import activate_subscription, can_create_pack, get_plan_by_code


def hash_input(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def create_pack(
    session: AsyncSession,
    *,
    user: User,
    input_type: str,
    input_text: str | None,
    input_storage_key: str | None,
    title: str | None,
    idempotency_key: str,
) -> tuple[StudyPack | None, PackJob | None, str | None]:
    existing = await session.execute(select(StudyPack).where(StudyPack.idempotency_key == idempotency_key))
    pack = existing.scalar_one_or_none()
    if pack:
        job_result = await session.execute(
            select(PackJob).where(PackJob.study_pack_id == pack.id, PackJob.job_type == JobType.GENERATE_PACK)
        )
        return pack, job_result.scalar_one_or_none(), None

    in_progress = await session.execute(
        select(StudyPack).where(
            StudyPack.user_id == user.id,
            StudyPack.status.in_([PackStatus.QUEUED, PackStatus.PROCESSING]),
        )
    )
    if in_progress.scalar_one_or_none():
        return None, None, "PACK_IN_PROGRESS"

    allowed, error, sub = await can_create_pack(session, user)
    if not allowed:
        return None, None, error

    content_for_hash = input_text or input_storage_key or title or ""
    pack = StudyPack(
        user_id=user.id,
        subscription_id=sub.id if sub else None,
        title=title or "Study Pack",
        topic=title,
        input_type=input_type,
        input_storage_key=input_storage_key,
        input_hash=hash_input(content_for_hash),
        status=PackStatus.QUEUED,
        idempotency_key=idempotency_key,
    )
    session.add(pack)
    if sub:
        sub.packs_used += 1
    await session.flush()

    job = PackJob(study_pack_id=pack.id, job_type=JobType.GENERATE_PACK, status=JobStatus.PENDING)
    session.add(job)
    await log_audit(
        session,
        actor_type="user",
        actor_id=user.id,
        action="pack_created",
        entity_type="study_pack",
        entity_id=pack.id,
    )
    return pack, job, None


async def get_pack(session: AsyncSession, pack_id: uuid.UUID) -> StudyPack | None:
    result = await session.execute(
        select(StudyPack).options(selectinload(StudyPack.artifacts)).where(StudyPack.id == pack_id)
    )
    return result.scalar_one_or_none()


async def list_user_packs(session: AsyncSession, user_id: uuid.UUID, limit: int = 20, offset: int = 0):
    total_result = await session.execute(select(func.count()).select_from(StudyPack).where(StudyPack.user_id == user_id))
    total = total_result.scalar_one()
    result = await session.execute(
        select(StudyPack)
        .options(selectinload(StudyPack.artifacts))
        .where(StudyPack.user_id == user_id)
        .order_by(StudyPack.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all()), total


async def create_payment_request(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    plan_code: str,
    method: PaymentMethod,
) -> tuple[PaymentRequest | None, str | None]:
    plan = await get_plan_by_code(session, plan_code)
    if not plan:
        return None, "PLAN_NOT_FOUND"
    req = PaymentRequest(
        user_id=user_id,
        plan_id=plan.id,
        amount_iqd=plan.price_iqd,
        method=method,
        status=PaymentStatus.PENDING,
    )
    session.add(req)
    await session.flush()
    return req, None


def payment_instructions(req: PaymentRequest, plan_name: str) -> str:
    ref = payment_reference(str(req.id))
    return (
        f"الاشتراك: {plan_name} — {req.amount_iqd:,} IQD\n"
        f"رمز الطلب: {ref}\n\n"
        f"ZainCash / تحويل بنكي\n"
        f"ملاحظة التحويل: {ref}\n\n"
        f"بعد التحويل أرسل صورة الإيصال من /pay"
    )


async def confirm_payment(
    session: AsyncSession,
    *,
    request_id: uuid.UUID,
    admin_id: uuid.UUID | None,
) -> tuple[PaymentRequest | None, str | None]:
    result = await session.execute(
        select(PaymentRequest).options(selectinload(PaymentRequest.plan)).where(PaymentRequest.id == request_id)
    )
    req = result.scalar_one_or_none()
    if not req:
        return None, "NOT_FOUND"
    if req.status == PaymentStatus.CONFIRMED:
        return req, "PAYMENT_ALREADY_CONFIRMED"

    sub = await activate_subscription(session, user_id=req.user_id, plan=req.plan)
    req.status = PaymentStatus.CONFIRMED
    req.confirmed_by = admin_id
    req.confirmed_at = datetime.now(timezone.utc)
    payment = Payment(
        payment_request_id=req.id,
        user_id=req.user_id,
        subscription_id=sub.id,
        amount_iqd=req.amount_iqd,
    )
    session.add(payment)
    await log_audit(
        session,
        actor_type="admin",
        actor_id=admin_id,
        action="payment_confirmed",
        entity_type="payment_request",
        entity_id=req.id,
    )
    return req, None
