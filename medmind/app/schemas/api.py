from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

from app.core.constants import (
    ArtifactType,
    PackStatus,
    PaymentMethod,
    PaymentStatus,
    Specialty,
    SubscriptionStatus,
)


class ErrorResponse(BaseModel):
    error_code: str
    message: str


class UserUpsertRequest(BaseModel):
    telegram_id: int
    username: Optional[str] = None
    full_name: Optional[str] = None


class UserUpdateRequest(BaseModel):
    specialty: Optional[Specialty] = None
    study_year: Optional[int] = Field(None, ge=1, le=7)
    university: Optional[str] = None
    email: Optional[EmailStr] = None
    locale: Optional[str] = None
    consent: Optional[bool] = None


class PlanResponse(BaseModel):
    code: str
    name_ar: str
    name_en: str
    price_iqd: int
    packs_per_month: int
    features: Dict[str, Any]

    model_config = {"from_attributes": True}


class SubscriptionResponse(BaseModel):
    id: uuid.UUID
    status: SubscriptionStatus
    starts_at: Optional[datetime]
    expires_at: Optional[datetime]
    packs_used: int
    plan: PlanResponse

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    id: uuid.UUID
    telegram_id: int
    telegram_username: Optional[str]
    full_name: Optional[str]
    email: Optional[str]
    specialty: Specialty
    university: Optional[str]
    study_year: Optional[int]
    locale: str
    referral_code: str
    consent_at: Optional[datetime]
    is_blocked: bool

    model_config = {"from_attributes": True}


class UserProfileResponse(BaseModel):
    user: UserResponse
    subscription: Optional[SubscriptionResponse]
    packs_used: int
    packs_limit: Optional[int]
    is_new: bool = False


class ArtifactResponse(BaseModel):
    artifact_type: ArtifactType
    storage_key: str
    download_url: Optional[str] = None
    mime_type: Optional[str] = None

    model_config = {"from_attributes": True}


class StudyPackResponse(BaseModel):
    id: uuid.UUID
    title: str
    topic: Optional[str]
    input_type: str
    status: PackStatus
    error_message: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]
    artifacts: List[ArtifactResponse] = []

    model_config = {"from_attributes": True}


class CreatePackRequest(BaseModel):
    user_id: uuid.UUID
    input_type: Literal["pdf", "text", "topic"]
    input_storage_key: Optional[str] = None
    input_text: Optional[str] = None
    title: Optional[str] = None


class CreatePackResponse(BaseModel):
    study_pack: StudyPackResponse
    job_id: uuid.UUID


class PaymentRequestCreate(BaseModel):
    user_id: uuid.UUID
    plan_code: str
    method: PaymentMethod


class PaymentRequestResponse(BaseModel):
    id: uuid.UUID
    amount_iqd: int
    method: PaymentMethod
    status: PaymentStatus
    reference_code: str
    instructions: str

    model_config = {"from_attributes": True}


class PaymentProofRequest(BaseModel):
    provider_ref: Optional[str] = None
    agent_code: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    db: str
    redis: str
    storage: str
