"""Brain-core integration tests (SQLite temp file)."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [
    str(ROOT / "services" / "api"),
    str(ROOT / "services" / "brain"),
    str(ROOT / "services" / "production"),
    str(ROOT / "services" / "ingest"),
    str(ROOT / "services" / "market"),
    str(ROOT / "packages" / "model_gateway"),
    str(ROOT / "packages" / "furniture_language"),
    str(ROOT / "packages" / "design_dna"),
]

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_tmp.name}"
os.environ["STORAGE_LOCAL"] = "true"
os.environ["LOCAL_MEDIA_DIR"] = tempfile.mkdtemp()
os.environ["TENANT_ID"] = "00000000-0000-0000-0000-000000000001"

from app.core.config import get_settings

get_settings.cache_clear()

from app.db.models import Base, DomainEvent, MediaAsset
from app.db.session import SessionLocal, engine
from app.services.storage import storage
from brain.graph import GraphPort
from brain.memory import MemoryService
from brain.processor import EventProcessor
from brain.similarity import SimilarityEngine
from design_dna import DesignDNA
from ingest.whatsapp import WhatsAppCloudAPIAdapter, WhatsAppExportAdapter
from model_gateway import build_gateway
from production.service import ProductionService
from app.services.agents import AgentRuntime

TENANT = uuid.UUID("00000000-0000-0000-0000-000000000001")
_DB_READY = False


def run(coro):
    global _DB_READY

    async def _wrap():
        global _DB_READY
        if not _DB_READY:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            _DB_READY = True
        return await coro

    return asyncio.run(_wrap())


def test_export_parse_creates_events():
    async def _t():
        async with SessionLocal() as session:
            adapter = WhatsAppExportAdapter(session, TENANT)
            text = (
                "3/8/2024, 10:00 - أحمد الورشة: محتاجين موافقة على القماش المخمل للسفرة #241\n"
                "3/8/2024, 10:05 - المالك: لا أحب هذا النوع من القماش\n"
            )
            result = await adapter.import_export(text, conversation_key="ahmed")
            await session.commit()
            assert result["events"] >= 2

    run(_t())


def test_processor_decision_preference_timeline():
    async def _t():
        async with SessionLocal() as session:
            gateway = build_gateway()
            processor = EventProcessor(session, TENANT, gateway)
            event = DomainEvent(
                tenant_id=TENANT,
                source="export",
                event_type="message",
                occurred_at=datetime.now(timezone.utc),
                conversation_key="ahmed",
                participant_key="أحمد الورشة",
                payload={
                    "text": "السفرة #241 تحت التشطيب ومحتاجين موافقة على القماش",
                    "sender_name": "أحمد الورشة",
                },
                processed=False,
            )
            session.add(event)
            await session.flush()
            result = await processor.process_event(event)
            await session.commit()
            assert any(a["type"] == "decision" for a in result["actions"])
            graph = GraphPort(session, TENANT)
            decisions = await graph.open_decisions()
            assert len(decisions) >= 1
            pieces = await graph.find_nodes(node_type="FurniturePiece", limit=20)
            assert any("241" in (p.name or "") or "order-241" in (p.name or "") for p in pieces)
            orders = await graph.find_nodes(node_type="Order", limit=20)
            assert any("241" in (o.name or "") for o in orders)

    run(_t())


def test_memory_recall_on_velvet_dislike():
    async def _t():
        async with SessionLocal() as session:
            mem = MemoryService(session, TENANT)
            await mem.remember_preference(
                polarity="dislikes",
                target_summary="قماش مخمل",
                dna_traits={"fabric_family": "velvet"},
            )
            recalls = await mem.recall_for_traits({"fabric_family": "velvet"})
            await session.commit()
            assert recalls
            assert "رفضت" in recalls[0]["message_ar"]
            graph = GraphPort(session, TENANT)
            owner = await mem.owner_node()
            nb = await graph.get_neighborhood(
                owner.id, edge_types=["HAS_PREFERENCE", "OWNER_REJECTS"], depth=1
            )
            assert nb["edges"]

    run(_t())


def test_resolve_decision_writes_edges():
    async def _t():
        async with SessionLocal() as session:
            gateway = build_gateway()
            graph = GraphPort(session, TENANT)
            piece = await graph.upsert_node(
                "FurniturePiece", name="chair test", external_key="piece:test:chair"
            )
            decision = await graph.upsert_node(
                "Decision",
                name="review: chair",
                external_key="decision:test:resolve",
                status="open",
                properties={
                    "type": "review",
                    "subject": "chair",
                    "piece_id": str(piece.id),
                    "urgency": "high",
                },
            )
            await graph.upsert_edge(piece.id, decision.id, "BLOCKED_BY")
            svc = ProductionService(session, TENANT, gateway)
            result = await svc.resolve_decision(decision.id, "reject", note="مش عاجبني")
            await session.commit()
            assert result["ok"]
            refreshed = await graph.get_node(decision.id)
            assert refreshed and refreshed.status == "resolved"
            prefs = await MemoryService(session, TENANT).list_preferences()
            assert any("chair" in (p.get("target_summary") or "") for p in prefs)

    run(_t())


def test_image_pipeline_dna_and_similarity():
    async def _t():
        async with SessionLocal() as session:
            gateway = build_gateway()
            processor = EventProcessor(session, TENANT, gateway)
            data = b"\x89PNG\r\n\x1a\n" + os.urandom(1200)
            key = f"tests/{uuid.uuid4()}.png"
            storage.put_bytes(key, data, content_type="image/png")
            event = DomainEvent(
                tenant_id=TENANT,
                source="manual",
                event_type="media_upload",
                occurred_at=datetime.now(timezone.utc),
                conversation_key="mohamed",
                participant_key="محمد",
                payload={"text": "كنبة فرنسي بتاج", "sender_name": "محمد"},
                processed=False,
            )
            session.add(event)
            await session.flush()
            media = MediaAsset(
                tenant_id=TENANT,
                kind="image",
                storage_key=key,
                content_type="image/png",
                sha256=storage.sha256(data),
                byte_size=len(data),
                event_id=event.id,
            )
            session.add(media)
            await session.flush()
            result = await processor.process_media(media, event)
            await session.commit()
            assert result.get("dna")
            assert result.get("decision_id")
            assert result.get("design_id")
            dna = DesignDNA.from_vision_dict(result["dna"])
            sim = SimilarityEngine(session, TENANT)
            matches = await sim.similar_to_dna(dna, limit=5)
            assert matches

    run(_t())


def test_cloud_webhook_text_event():
    async def _t():
        async with SessionLocal() as session:
            adapter = WhatsAppCloudAPIAdapter(session, TENANT)
            payload = {
                "entry": [
                    {
                        "changes": [
                            {
                                "value": {
                                    "contacts": [
                                        {"wa_id": "201000000000", "profile": {"name": "ورشة علي"}}
                                    ],
                                    "messages": [
                                        {
                                            "from": "201000000000",
                                            "id": f"wamid.{uuid.uuid4()}",
                                            "timestamp": "1710000000",
                                            "type": "text",
                                            "text": {"body": "محتاج موافقة على اللون الذهبي"},
                                        }
                                    ],
                                }
                            }
                        ]
                    }
                ]
            }
            result = await adapter.receive_webhook(payload)
            await session.commit()
            assert result["events"] == 1

    run(_t())


def test_search_agent_filters():
    async def _t():
        async with SessionLocal() as session:
            runtime = AgentRuntime(session, TENANT, build_gateway())
            graph = GraphPort(session, TENANT)
            await graph.upsert_node(
                "DesignDNA",
                name="DNA chair royal",
                external_key="dna:test:royal-chair",
                properties={
                    "dna": {
                        "furniture_type": "chair",
                        "style_family": "royal",
                        "crown_shape": "broken_pediment",
                    }
                },
            )
            await session.commit()
            result = await runtime.search_agent({"query": "كرسي ملكي بتاج"})
            assert result["ok"]
            assert result["parsed_filters"].get("furniture_type") == "chair"
            assert result["design_dna_hits"] or result["parsed_filters"]

    run(_t())


def test_webhook_signature_dev_allows_empty_secret():
    assert WhatsAppCloudAPIAdapter.verify_signature(b"{}", None) is True
