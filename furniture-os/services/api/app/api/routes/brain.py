from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort
from brain.memory import MemoryService
from brain.processor import EventProcessor
from brain.similarity import SimilarityEngine
from design_dna import DesignDNA
from furniture_language import parse as lang_parse
from ingest.whatsapp import WhatsAppCloudAPIAdapter, WhatsAppExportAdapter
from market.ports import MarketArtifact, market_stub
from production.service import ProductionService

from app.core.config import settings
from app.db.models import DomainEvent, MediaAsset
from app.db.session import get_db
from app.services.agents import AgentRuntime
from app.services.gateway import get_gateway
from app.services.storage import storage

router = APIRouter()


def tenant_uuid() -> uuid.UUID:
    return uuid.UUID(settings.tenant_id)


# ---------- Health / meta ----------


@router.get("/health")
async def health():
    return {"status": "ok", "product": "Furniture Intelligence OS", "role": "AI Brain"}


@router.get("/meta/ontology")
async def ontology():
    from brain.graph import EDGE_TYPES, NODE_TYPES
    from design_dna import FurnitureType, StyleFamily, ProductionStage

    return {
        "node_types": sorted(NODE_TYPES),
        "edge_types": sorted(EDGE_TYPES),
        "furniture_types": [e.value for e in FurnitureType],
        "style_families": [e.value for e in StyleFamily],
        "stages": [e.value for e in ProductionStage],
    }


# ---------- Language ----------


@router.post("/language/parse")
async def language_parse(body: dict[str, str]):
    q = body.get("text") or body.get("query") or ""
    parsed = lang_parse(q)
    return parsed.model_dump()


# ---------- Graph ----------


class NodeIn(BaseModel):
    node_type: str
    name: str = ""
    external_key: str | None = None
    status: str = "active"
    properties: dict[str, Any] = Field(default_factory=dict)


class EdgeIn(BaseModel):
    src_id: uuid.UUID
    dst_id: uuid.UUID
    edge_type: str
    properties: dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0


@router.post("/graph/nodes")
async def create_node(body: NodeIn, db: AsyncSession = Depends(get_db)):
    g = GraphPort(db, tenant_uuid())
    node = await g.upsert_node(
        body.node_type,
        name=body.name,
        external_key=body.external_key,
        status=body.status,
        properties=body.properties,
    )
    await db.commit()
    return {"id": str(node.id), "node_type": node.node_type, "name": node.name}


@router.get("/graph/nodes")
async def list_nodes(
    node_type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    g = GraphPort(db, tenant_uuid())
    nodes = await g.find_nodes(node_type=node_type, status=status, name_ilike=q, limit=limit)
    return {
        "items": [
            {
                "id": str(n.id),
                "node_type": n.node_type,
                "name": n.name,
                "status": n.status,
                "properties": n.properties,
            }
            for n in nodes
        ]
    }


@router.get("/graph/nodes/{node_id}")
async def get_node_state(node_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    g = GraphPort(db, tenant_uuid())
    return await g.state_of(node_id)


@router.post("/graph/edges")
async def create_edge(body: EdgeIn, db: AsyncSession = Depends(get_db)):
    g = GraphPort(db, tenant_uuid())
    edge = await g.upsert_edge(
        body.src_id, body.dst_id, body.edge_type, properties=body.properties, confidence=body.confidence
    )
    await db.commit()
    return {"id": str(edge.id), "edge_type": edge.edge_type}


@router.get("/graph/neighborhood/{node_id}")
async def neighborhood(node_id: uuid.UUID, depth: int = 1, db: AsyncSession = Depends(get_db)):
    g = GraphPort(db, tenant_uuid())
    return await g.get_neighborhood(node_id, depth=depth)


# ---------- Memory ----------


class PreferenceIn(BaseModel):
    polarity: str = "dislikes"
    target_summary: str
    dna_traits: dict[str, Any] = Field(default_factory=dict)


@router.post("/memory/preferences")
async def save_preference(body: PreferenceIn, db: AsyncSession = Depends(get_db)):
    mem = MemoryService(db, tenant_uuid())
    pref = await mem.remember_preference(
        polarity=body.polarity, target_summary=body.target_summary, dna_traits=body.dna_traits
    )
    await db.commit()
    return pref


@router.get("/memory/preferences")
async def list_preferences(db: AsyncSession = Depends(get_db)):
    mem = MemoryService(db, tenant_uuid())
    return {"items": await mem.list_preferences()}


@router.post("/memory/recall")
async def recall(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    mem = MemoryService(db, tenant_uuid())
    traits = body.get("dna_traits") or {}
    if body.get("text"):
        from furniture_language import normalize_to_dna_fields

        traits.update(normalize_to_dna_fields(body["text"]))
    return {"recalls": await mem.recall_for_traits(traits)}


# ---------- Production ----------


@router.get("/production/decisions")
async def decisions(db: AsyncSession = Depends(get_db)):
    svc = ProductionService(db, tenant_uuid(), get_gateway())
    return {"items": await svc.decisions_inbox()}


class ResolveIn(BaseModel):
    resolution: str  # approve | reject | defer
    note: str = ""


@router.post("/production/decisions/{decision_id}/resolve")
async def resolve_decision(decision_id: uuid.UUID, body: ResolveIn, db: AsyncSession = Depends(get_db)):
    svc = ProductionService(db, tenant_uuid(), get_gateway())
    result = await svc.resolve_decision(decision_id, body.resolution, body.note)
    await db.commit()
    if not result.get("ok"):
        raise HTTPException(404, "Decision not found")
    return result


@router.get("/production/timeline/{subject_id}")
async def timeline(subject_id: uuid.UUID, kind: str | None = None, db: AsyncSession = Depends(get_db)):
    if kind == "design":
        from brain.timeline import list_timeline

        items = await list_timeline(db, tenant_uuid(), subject_id, kind="design_life")
        return {
            "items": [
                {
                    "id": str(t.id),
                    "label": t.label,
                    "stage": t.stage,
                    "occurred_at": t.occurred_at.isoformat() if t.occurred_at else None,
                    "properties": t.properties or {},
                }
                for t in items
            ]
        }
    svc = ProductionService(db, tenant_uuid())
    return {"items": await svc.production_timeline(subject_id)}


@router.get("/production/summary")
async def summary(hours: int = Query(1, ge=1, le=168), db: AsyncSession = Depends(get_db)):
    svc = ProductionService(db, tenant_uuid(), get_gateway())
    return await svc.hourly_summary(hours=hours)


@router.get("/production/suppliers/{supplier_id}")
async def supplier(supplier_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    svc = ProductionService(db, tenant_uuid())
    return await svc.supplier_profile(supplier_id)


# ---------- Ingest ----------


@router.post("/ingest/whatsapp/export")
async def ingest_export(
    conversation_key: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    text = (await file.read()).decode("utf-8", errors="replace")
    adapter = WhatsAppExportAdapter(db, tenant_uuid())
    result = await adapter.import_export(text, conversation_key=conversation_key, source_name=file.filename or "export")
    await db.commit()
    return result


@router.post("/ingest/whatsapp/export/process")
async def process_pending(limit: int = 100, db: AsyncSession = Depends(get_db)):
    """Process unprocessed DomainEvents + linked media through the brain cortex."""
    gateway = get_gateway()
    processor = EventProcessor(db, tenant_uuid(), gateway)
    q = await db.execute(
        select(DomainEvent)
        .where(DomainEvent.tenant_id == tenant_uuid(), DomainEvent.processed.is_(False))
        .order_by(DomainEvent.occurred_at.asc())
        .limit(limit)
    )
    events = list(q.scalars().all())
    results = []
    for event in events:
        # media first if linked
        mq = await db.execute(select(MediaAsset).where(MediaAsset.event_id == event.id))
        for media in mq.scalars().all():
            results.append(await processor.process_media(media, event))
        results.append(await processor.process_event(event))
    await db.commit()
    return {"processed": len(events), "results": results}


@router.get("/ingest/whatsapp/webhook")
async def wa_verify(
    hub_mode: str | None = Query(None, alias="hub.mode"),
    hub_verify_token: str | None = Query(None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(None, alias="hub.challenge"),
):
    if hub_mode == "subscribe" and hub_verify_token == settings.whatsapp_verify_token:
        return int(hub_challenge or "0")
    raise HTTPException(403, "Verification failed")


@router.post("/ingest/whatsapp/webhook")
async def wa_webhook(payload: dict[str, Any], db: AsyncSession = Depends(get_db)):
    adapter = WhatsAppCloudAPIAdapter(db, tenant_uuid())
    result = await adapter.receive_webhook(payload)
    await db.commit()
    return result


# ---------- Media / DNA / Similarity ----------


@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    caption: str = Form(""),
    workshop_name: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    suffix = (file.filename or "upload.bin").split(".")[-1].lower()
    kind = "image" if suffix in {"jpg", "jpeg", "png", "webp"} else "audio" if suffix in {"ogg", "opus", "mp3", "wav"} else "video" if suffix in {"mp4", "mov"} else "document"
    key = f"uploads/{uuid.uuid4()}.{suffix}"
    storage.ensure_bucket()
    storage.put_bytes(key, data, content_type=file.content_type or "application/octet-stream")
    event = DomainEvent(
        tenant_id=tenant_uuid(),
        source="manual",
        event_type="media_upload",
        occurred_at=datetime.now(timezone.utc),
        conversation_key=workshop_name or "manual",
        participant_key=workshop_name or "owner",
        payload={"text": caption, "sender_name": workshop_name or "Owner"},
        processed=False,
    )
    db.add(event)
    await db.flush()
    media = MediaAsset(
        tenant_id=tenant_uuid(),
        kind=kind,
        storage_key=key,
        content_type=file.content_type,
        sha256=storage.sha256(data),
        byte_size=len(data),
        event_id=event.id,
        provenance={"filename": file.filename},
    )
    db.add(media)
    await db.flush()
    processor = EventProcessor(db, tenant_uuid(), get_gateway())
    result = await processor.process_media(media, event)
    if caption:
        result["event"] = await processor.process_event(event)
    else:
        event.processed = True
    await db.commit()
    return {"media_id": str(media.id), "result": result}


@router.post("/similarity/query")
async def similarity_query(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    runtime = AgentRuntime(db, tenant_uuid(), get_gateway())
    return await runtime.similarity_agent(body)


# ---------- Search / Agents ----------


@router.post("/search")
async def search(body: dict[str, Any], db: AsyncSession = Depends(get_db)):
    runtime = AgentRuntime(db, tenant_uuid(), get_gateway())
    return await runtime.search_agent(body)


@router.get("/agents")
async def list_agents(db: AsyncSession = Depends(get_db)):
    runtime = AgentRuntime(db, tenant_uuid(), get_gateway())
    return {"agents": runtime.list_agents()}


@router.post("/agents/{name}")
async def run_agent(name: str, body: dict[str, Any] | None = None, db: AsyncSession = Depends(get_db)):
    runtime = AgentRuntime(db, tenant_uuid(), get_gateway())
    result = await runtime.run(name, body or {})
    await db.commit()
    return result


# ---------- Owner workspaces (WhatsApp + Market) — AI invisible ----------


@router.get("/workspace/brief")
async def workspace_brief(db: AsyncSession = Depends(get_db)):
    from app.services.workspace import WorkspaceService

    return await WorkspaceService(db, tenant_uuid()).brief()


@router.get("/workspace/conversations")
async def workspace_conversations(
    filter: str = Query("all"),
    db: AsyncSession = Depends(get_db),
):
    from app.services.workspace import WorkspaceService

    mode = filter if filter in {"all", "needs_you", "waiting", "media"} else "all"
    return {"items": await WorkspaceService(db, tenant_uuid()).conversations(filter_mode=mode)}


@router.get("/workspace/conversations/{conversation_id}")
async def workspace_conversation_thread(conversation_id: str, db: AsyncSession = Depends(get_db)):
    from app.services.workspace import WorkspaceService

    return await WorkspaceService(db, tenant_uuid()).conversation_thread(conversation_id)


@router.get("/workspace/market/feed")
async def workspace_market_feed(
    limit: int = Query(60, ge=1, le=120),
    region: str | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from app.services.workspace import WorkspaceService

    return await WorkspaceService(db, tenant_uuid()).market_feed(limit=limit, region=region, q=q)


@router.get("/workspace/market/pins/{pin_id}")
async def workspace_market_pin(pin_id: str, db: AsyncSession = Depends(get_db)):
    from app.services.workspace import WorkspaceService

    result = await WorkspaceService(db, tenant_uuid()).market_pin(pin_id)
    if not result.get("ok"):
        raise HTTPException(404, "Pin not found")
    return result


# ---------- Market contracts ----------


@router.post("/market/ingest")
async def market_ingest(artifacts: list[MarketArtifact]):
    return await market_stub.ingest(artifacts)


@router.get("/market/trends/weekly")
async def market_trends():
    return (await market_stub.weekly_narrative()).model_dump()


@router.get("/market/designs/{design_id}/timeline")
async def market_design_timeline(design_id: str):
    points = await market_stub.design_timeline(design_id)
    return {"items": [p.model_dump() for p in points]}
