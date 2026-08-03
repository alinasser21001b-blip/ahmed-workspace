"""SQLAlchemy models — entities first; messages are evidence events."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

EMBED_DIM = 384


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(200), default="Owner")
    role: Mapped[str] = mapped_column(String(50), default="owner")


class GraphNode(Base, TimestampMixin):
    """Polymorphic entity node in the knowledge graph."""

    __tablename__ = "graph_nodes"
    __table_args__ = (UniqueConstraint("tenant_id", "node_type", "external_key", name="uq_node_ext"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    node_type: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(500), default="")
    external_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="active", index=True)
    properties: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    provenance: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)


class GraphEdge(Base, TimestampMixin):
    __tablename__ = "graph_edges"
    __table_args__ = (
        Index("ix_edges_src_type", "tenant_id", "src_id", "edge_type"),
        Index("ix_edges_dst_type", "tenant_id", "dst_id", "edge_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    src_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_nodes.id", ondelete="CASCADE"))
    dst_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_nodes.id", ondelete="CASCADE"))
    edge_type: Mapped[str] = mapped_column(String(64), index=True)
    properties: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    valid_from: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    provenance: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)


class DomainEvent(Base, TimestampMixin):
    """Sensor evidence — not the unit of UI truth."""

    __tablename__ = "domain_events"
    __table_args__ = (Index("ix_events_tenant_time", "tenant_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    source: Mapped[str] = mapped_column(String(64))
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    conversation_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    participant_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    raw_ref: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    processed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    processing_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class MediaAsset(Base, TimestampMixin):
    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    storage_key: Mapped[str] = mapped_column(String(1000))
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    phash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    byte_size: Mapped[int] = mapped_column(Integer, default=0)
    transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    dna: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    node_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid(as_uuid=True), ForeignKey("graph_nodes.id"), nullable=True)
    event_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid(as_uuid=True), ForeignKey("domain_events.id"), nullable=True)
    provenance: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)


class EmbeddingRow(Base, TimestampMixin):
    __tablename__ = "embeddings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    owner_type: Mapped[str] = mapped_column(String(64), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    model: Mapped[str] = mapped_column(String(128))
    dim: Mapped[int] = mapped_column(Integer, default=EMBED_DIM)
    vector: Mapped[List[float]] = mapped_column(JSON)
    meta: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)


class TimelineEvent(Base, TimestampMixin):
    __tablename__ = "timeline_events"
    __table_args__ = (Index("ix_timeline_subject", "tenant_id", "subject_type", "subject_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    subject_type: Mapped[str] = mapped_column(String(64))
    subject_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True))
    kind: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(500))
    stage: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    properties: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)
    evidence_event_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid(as_uuid=True), nullable=True)


class StateDelta(Base, TimestampMixin):
    __tablename__ = "state_deltas"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    category: Mapped[str] = mapped_column(String(64), index=True)
    summary: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(32), default="info")
    entity_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(Uuid(as_uuid=True), nullable=True)
    properties: Mapped[Dict[str, Any]] = mapped_column(JSON, default=dict)


class RawPayload(Base, TimestampMixin):
    __tablename__ = "raw_payloads"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
    tenant_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), index=True)
    source: Mapped[str] = mapped_column(String(64))
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON)
    storage_key: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
