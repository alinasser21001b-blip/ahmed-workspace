from typing import Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.session import get_db
from app.models import PaymentRequest, User
from app.schemas.api import (
    CreatePackRequest,
    CreatePackResponse,
    ErrorResponse,
    HealthResponse,
    PaymentProofRequest,
    PaymentRequestCreate,
    PaymentRequestResponse,
    StudyPackResponse,
    UserProfileResponse,
    UserResponse,
    UserUpdateRequest,
    UserUpsertRequest,
    ArtifactResponse,
    SubscriptionResponse,
    PlanResponse,
)
from app.services.packs import (
    confirm_payment,
    create_pack,
    create_payment_request,
    get_pack,
    list_user_packs,
    payment_instructions,
)
from app.services.storage import storage
from app.services.subscriptions import can_create_pack, get_active_subscription, seed_plans
from app.services.users import get_user_by_telegram, update_user, upsert_user
from app.workers.enqueue import enqueue_job
import redis.asyncio as redis

router = APIRouter(prefix="/internal")


def _user_response(user: User) -> UserResponse:
    return UserResponse.model_validate(user)


def _pack_response(pack, with_urls: bool = False) -> StudyPackResponse:
    artifacts = []
    for a in pack.artifacts:
        url = storage.presigned_url(a.storage_key) if with_urls else None
        artifacts.append(
            ArtifactResponse(
                artifact_type=a.artifact_type,
                storage_key=a.storage_key,
                download_url=url,
                mime_type=a.mime_type,
            )
        )
    return StudyPackResponse(
        id=pack.id,
        title=pack.title,
        topic=pack.topic,
        input_type=pack.input_type,
        status=pack.status,
        error_message=pack.error_message,
        created_at=pack.created_at,
        completed_at=pack.completed_at,
        artifacts=artifacts,
    )


@router.get("/health", response_model=HealthResponse)
async def health(db: AsyncSession = Depends(get_db)):
    db_status = "ok"
    redis_status = "ok"
    storage_status = "ok"
    try:
        await db.execute(select(1))
    except Exception:
        db_status = "error"
    try:
        r = redis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
    except Exception:
        redis_status = "error"
    try:
        storage.ensure_bucket()
    except Exception:
        storage_status = "error"
    status = "ok" if all(x == "ok" for x in [db_status, redis_status, storage_status]) else "degraded"
    return HealthResponse(status=status, db=db_status, redis=redis_status, storage=storage_status)


@router.post("/users/upsert")
async def users_upsert(body: UserUpsertRequest, db: AsyncSession = Depends(get_db)):
    await seed_plans(db)
    user, is_new = await upsert_user(
        db, telegram_id=body.telegram_id, username=body.username, full_name=body.full_name
    )
    await db.commit()
    sub = await get_active_subscription(db, user.id)
    allowed, _, active_sub = await can_create_pack(db, user)
    packs_limit = active_sub.plan.packs_per_month if active_sub else None
    packs_used = active_sub.packs_used if active_sub else 0
    return UserProfileResponse(
        user=_user_response(user),
        subscription=SubscriptionResponse.model_validate(active_sub) if sub else None,
        packs_used=packs_used,
        packs_limit=packs_limit if packs_limit else None,
        is_new=is_new,
    )


@router.patch("/users/{user_id}")
async def users_update(user_id: str, body: UserUpdateRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "User not found"})
    await update_user(db, user, body.model_dump(exclude_unset=True))
    await db.commit()
    return {"user": _user_response(user)}


@router.get("/users/by-telegram/{telegram_id}", response_model=UserProfileResponse)
async def users_by_telegram(telegram_id: int, db: AsyncSession = Depends(get_db)):
    user = await get_user_by_telegram(db, telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "User not found"})
    sub = await get_active_subscription(db, user.id)
    _, _, active_sub = await can_create_pack(db, user)
    packs_limit = active_sub.plan.packs_per_month if active_sub else None
    packs_used = active_sub.packs_used if active_sub else 0
    return UserProfileResponse(
        user=_user_response(user),
        subscription=SubscriptionResponse.model_validate(sub) if sub else None,
        packs_used=packs_used,
        packs_limit=packs_limit if packs_limit else None,
    )


@router.post("/packs", response_model=CreatePackResponse, status_code=202)
async def create_study_pack(
    body: CreatePackRequest,
    db: AsyncSession = Depends(get_db),
    idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key"),
):
    result = await db.execute(select(User).where(User.id == body.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "User not found"})
    if user.is_blocked:
        raise HTTPException(status_code=403, detail={"error_code": "USER_BLOCKED", "message": "User blocked"})

    key = idempotency_key or f"{body.user_id}:{body.input_type}:{body.input_text or body.input_storage_key}"
    pack, job, error = await create_pack(
        db,
        user=user,
        input_type=body.input_type,
        input_text=body.input_text,
        input_storage_key=body.input_storage_key,
        title=body.title,
        idempotency_key=key,
    )
    if error == "SUBSCRIPTION_REQUIRED":
        raise HTTPException(status_code=403, detail={"error_code": error, "message": "Active subscription required"})
    if error == "QUOTA_EXCEEDED":
        raise HTTPException(status_code=402, detail={"error_code": error, "message": "Monthly quota exceeded"})
    if error == "PACK_IN_PROGRESS":
        raise HTTPException(status_code=409, detail={"error_code": error, "message": "Pack already in progress"})
    await db.commit()
    if job:
        await enqueue_job(str(job.id))
    return CreatePackResponse(study_pack=_pack_response(pack), job_id=job.id if job else pack.id)


@router.get("/packs/{pack_id}", response_model=StudyPackResponse)
async def get_study_pack(pack_id: str, db: AsyncSession = Depends(get_db)):
    pack = await get_pack(db, pack_id)
    if not pack:
        raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "Pack not found"})
    return _pack_response(pack, with_urls=True)


@router.get("/users/{user_id}/packs")
async def user_packs(user_id: str, limit: int = 20, offset: int = 0, db: AsyncSession = Depends(get_db)):
    packs, total = await list_user_packs(db, user_id, limit, offset)
    return {"packs": [_pack_response(p, with_urls=True) for p in packs], "total": total}


@router.post("/files/upload")
async def upload_file(user_id: str = Query(...), file: UploadFile = File(...)):
    data = await file.read()
    max_size = settings.max_pdf_size_mb * 1024 * 1024
    if len(data) > max_size:
        raise HTTPException(status_code=413, detail={"error_code": "INPUT_TOO_LARGE", "message": "File too large"})
    import uuid as uuid_mod
    import hashlib

    uid = uuid_mod.UUID(user_id)
    pack_id = uuid_mod.uuid4()
    key = storage.input_key(uid, pack_id, file.filename or "original.pdf")
    storage.upload_bytes(key, data, file.content_type or "application/pdf")
    return {"storage_key": key, "input_hash": hashlib.sha256(data).hexdigest(), "page_count": None}


@router.post("/payments/request", response_model=PaymentRequestResponse, status_code=201)
async def payment_request(body: PaymentRequestCreate, db: AsyncSession = Depends(get_db)):
    req, error = await create_payment_request(db, user_id=body.user_id, plan_code=body.plan_code, method=body.method)
    if error:
        raise HTTPException(status_code=404, detail={"error_code": error, "message": "Plan not found"})
    await db.commit()
    await db.refresh(req, ["plan"])
    from app.core.utils import payment_reference
    ref = payment_reference(str(req.id))
    return PaymentRequestResponse(
        id=req.id,
        amount_iqd=req.amount_iqd,
        method=req.method,
        status=req.status,
        reference_code=ref,
        instructions=payment_instructions(req, req.plan.name_ar),
    )


@router.post("/admin/payments/{request_id}/confirm")
async def admin_confirm_payment(request_id: str, db: AsyncSession = Depends(get_db)):
    req, error = await confirm_payment(db, request_id=request_id, admin_id=None)
    if error == "NOT_FOUND":
        raise HTTPException(status_code=404, detail={"error_code": error, "message": "Payment not found"})
    if error == "PAYMENT_ALREADY_CONFIRMED":
        raise HTTPException(status_code=409, detail={"error_code": error, "message": "Already confirmed"})
    await db.commit()
    return {"payment_request_id": req.id, "status": req.status.value}


@router.post("/admin/payments/{request_id}/reject")
async def admin_reject_payment(request_id: str, reason: str = "", db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(PaymentRequest).where(PaymentRequest.id == request_id))
    req = result.scalar_one_or_none()
    if not req:
        raise HTTPException(status_code=404, detail={"error_code": "NOT_FOUND", "message": "Payment not found"})
    from app.core.constants import PaymentStatus
    req.status = PaymentStatus.REJECTED
    req.admin_note = reason
    await db.commit()
    return {"payment_request_id": req.id, "status": req.status.value}
