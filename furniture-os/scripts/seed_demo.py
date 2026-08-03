#!/usr/bin/env python3
"""Seed demo graph entities for local UI exploration."""

from __future__ import annotations

import asyncio
import sys
import uuid
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

from app.core.config import settings
from app.db.session import SessionLocal, engine, Base
from brain.graph import GraphPort
from brain.memory import MemoryService
from design_dna import DesignDNA, FurnitureType, StyleFamily
from ingest.whatsapp import WhatsAppExportAdapter
from brain.processor import EventProcessor
from app.services.gateway import get_gateway


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    tenant = uuid.UUID(settings.tenant_id)
    async with SessionLocal() as session:
        g = GraphPort(session, tenant)
        mem = MemoryService(session, tenant)

        workshop = await g.upsert_node("Workshop", name="Ahmed Workshop", external_key="wa:Ahmed Workshop")
        carpenter = await g.upsert_node("Workshop", name="Mohamed Carpenter", external_key="wa:Mohamed Carpenter")
        await g.upsert_node("Supplier", name="Supplier Wood", external_key="wa:Supplier Wood")

        dna = DesignDNA(
            furniture_type=FurnitureType.SOFA,
            style_family=StyleFamily.ROYAL,
            crown_shape="broken_pediment",
            carving_type="french",
            fabric_family="velvet",
            wood_species="beech",
            overall_confidence=0.9,
        )
        dna_node = await g.upsert_node(
            "DesignDNA",
            name="Royal carved sofa DNA",
            external_key="dna:demo:sofa",
            properties={"dna": dna.model_dump()},
        )
        piece = await g.upsert_node(
            "FurniturePiece",
            name="Royal sofa sample",
            external_key="piece:demo:sofa",
            status="upholstery",
            properties={"furniture_type": "sofa", "stage": "upholstery"},
        )
        await g.upsert_edge(piece.id, workshop.id, "BUILT_BY")
        await g.upsert_edge(piece.id, dna_node.id, "HAS_DNA")

        await mem.remember_preference(
            polarity="dislikes",
            target_summary="مخمل لامع رخيص",
            dna_traits={"fabric_family": "velvet"},
        )

        export_path = ROOT / "data" / "exports" / "sample_ahmed_workshop.txt"
        adapter = WhatsAppExportAdapter(session, tenant)
        text = export_path.read_text(encoding="utf-8")
        await adapter.import_export(text, conversation_key="Ahmed Workshop", source_name="sample")

        processor = EventProcessor(session, tenant, get_gateway())
        from sqlalchemy import select
        from app.db.models import DomainEvent

        events = (
            await session.execute(
                select(DomainEvent).where(DomainEvent.processed.is_(False)).order_by(DomainEvent.occurred_at)
            )
        ).scalars().all()
        for event in events:
            await processor.process_event(event)

        await session.commit()
        print(f"Seeded tenant {tenant}")
        print(f"Workshop={workshop.id} piece={piece.id} carpenter={carpenter.id}")
        print(f"Processed {len(events)} export events")


if __name__ == "__main__":
    asyncio.run(main())
