"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-07-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    """)

    specialty = postgresql.ENUM(
        "general_medicine", "pharmacy", "dentistry", "nursing", "medical_labs", "other",
        name="specialty", create_type=False,
    )
    subscription_status = postgresql.ENUM(
        "active", "expired", "cancelled", "pending_payment", name="subscriptionstatus", create_type=False
    )
    pack_status = postgresql.ENUM(
        "queued", "processing", "completed", "failed", "cancelled", name="packstatus", create_type=False
    )
    artifact_type = postgresql.ENUM(
        "summary_pdf", "summary_md", "mindmap_png", "mindmap_mmd", "keywords_txt", "keywords_json",
        "quiz_pdf", "quiz_json", "anki_apkg", "sources_md", "study_plan_json",
        name="artifacttype", create_type=False,
    )
    payment_status = postgresql.ENUM("pending", "confirmed", "rejected", "refunded", name="paymentstatus", create_type=False)
    payment_method = postgresql.ENUM(
        "zaincash", "bank_transfer", "qi_card", "agent_code", "manual", name="paymentmethod", create_type=False
    )
    job_type = postgresql.ENUM(
        "generate_pack", "deliver_pack", "send_quiz", "send_reminder", name="jobtype", create_type=False
    )
    job_status = postgresql.ENUM("pending", "running", "completed", "failed", "dead", name="jobstatus", create_type=False)

    for enum in [specialty, subscription_status, pack_status, artifact_type, payment_status, payment_method, job_type, job_status]:
        enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "subscription_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name_ar", sa.String(128), nullable=False),
        sa.Column("name_en", sa.String(128), nullable=False),
        sa.Column("price_iqd", sa.Integer(), nullable=False),
        sa.Column("packs_per_month", sa.Integer(), nullable=False),
        sa.Column("features", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("telegram_username", sa.String(256)),
        sa.Column("full_name", sa.String(256)),
        sa.Column("email", sa.String(256)),
        sa.Column("specialty", specialty, nullable=False),
        sa.Column("university", sa.String(256)),
        sa.Column("study_year", sa.SmallInteger()),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("is_blocked", sa.Boolean(), nullable=False),
        sa.Column("referral_code", sa.String(16), nullable=False, unique=True),
        sa.Column("referred_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("consent_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "admin_users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("subscription_plans.id"), nullable=False),
        sa.Column("status", subscription_status, nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("packs_used", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "idx_subscriptions_one_active",
        "subscriptions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "study_packs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subscription_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("subscriptions.id")),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("topic", sa.String(512)),
        sa.Column("input_type", sa.String(32), nullable=False),
        sa.Column("input_storage_key", sa.String(512)),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("status", pack_status, nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
        sa.Column("error_message", sa.Text()),
        sa.Column("metadata", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "pack_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("study_pack_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("study_packs.id"), nullable=False),
        sa.Column("artifact_type", artifact_type, nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger()),
        sa.Column("mime_type", sa.String(128)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("study_pack_id", "artifact_type"),
    )

    op.create_table(
        "pack_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("study_pack_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("study_packs.id"), nullable=False),
        sa.Column("job_type", job_type, nullable=False),
        sa.Column("status", job_status, nullable=False),
        sa.Column("attempts", sa.SmallInteger(), nullable=False),
        sa.Column("max_attempts", sa.SmallInteger(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("result", postgresql.JSONB()),
        sa.Column("error_message", sa.Text()),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "quiz_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("study_pack_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("study_packs.id"), nullable=False),
        sa.Column("score", sa.SmallInteger(), nullable=False),
        sa.Column("total", sa.SmallInteger(), nullable=False),
        sa.Column("answers", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "payment_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("plan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("subscription_plans.id"), nullable=False),
        sa.Column("amount_iqd", sa.Integer(), nullable=False),
        sa.Column("method", payment_method, nullable=False),
        sa.Column("status", payment_status, nullable=False),
        sa.Column("proof_storage_key", sa.String(512)),
        sa.Column("provider_ref", sa.String(256)),
        sa.Column("admin_note", sa.Text()),
        sa.Column("confirmed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("admin_users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("payment_request_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("payment_requests.id"), unique=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subscription_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("subscriptions.id"), nullable=False),
        sa.Column("amount_iqd", sa.Integer(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "user_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("daily_quiz_enabled", sa.Boolean(), nullable=False),
        sa.Column("daily_quiz_hour", sa.SmallInteger(), nullable=False),
        sa.Column("gmail_delivery_enabled", sa.Boolean(), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
    )

    op.create_table(
        "scheduled_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_type", sa.String(64), nullable=False),
        sa.Column("cron_expr", sa.String(64)),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True)),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("entity_type", sa.String(64)),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True)),
        sa.Column("metadata", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    for table in [
        "audit_logs", "scheduled_tasks", "user_settings", "payments", "payment_requests",
        "quiz_attempts", "pack_jobs", "pack_artifacts", "study_packs", "subscriptions",
        "admin_users", "users", "subscription_plans",
    ]:
        op.drop_table(table)
