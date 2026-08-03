"""Domain event cortex — Language → Entity resolve → DNA → Graph → Decisions/Memory/Timelines."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort
from brain.memory import MemoryService
from brain.similarity import SimilarityEngine
from design_dna import DesignDNA
from furniture_language import FurnitureLanguage
from model_gateway import ModelGateway

from app.db.models import DomainEvent, MediaAsset, StateDelta, TimelineEvent


class EventProcessor:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID, gateway: ModelGateway):
        self.session = session
        self.tenant_id = tenant_id
        self.gateway = gateway
        self.graph = GraphPort(session, tenant_id)
        self.memory = MemoryService(session, tenant_id)
        self.similarity = SimilarityEngine(session, tenant_id)
        self.lang = FurnitureLanguage()

    async def process_event(self, event: DomainEvent) -> dict[str, Any]:
        text = (event.payload or {}).get("text") or (event.payload or {}).get("body") or ""
        parsed = self.lang.parse(text)
        result: dict[str, Any] = {"event_id": str(event.id), "actions": []}

        workshop = await self._resolve_participant(event)
        piece, order = await self._resolve_piece(event, parsed, workshop)

        if parsed.preference_polarity:
            target = text[:200] or "عنصر غير مسمى"
            traits = self.lang.normalize_to_dna_fields(text)
            pref = await self.memory.remember_preference(
                polarity=parsed.preference_polarity,
                target_summary=target,
                dna_traits=traits,
                evidence={"event_id": str(event.id)},
            )
            result["actions"].append({"type": "preference", "preference": pref})

        decision_type = parsed.decision_type
        if not decision_type and any(
            x in text for x in ("موافقة", "استنى", "waiting", "وافق", "شوف العينة", "العينة")
        ):
            decision_type = "review"

        if decision_type:
            decision = await self._open_decision(
                decision_type=decision_type,
                text=text,
                event=event,
                piece=piece,
                workshop=workshop,
            )
            result["actions"].append(
                {
                    "type": "decision",
                    "decision_id": str(decision.id),
                    "decision_type": decision_type,
                    "memory_recalls": (decision.properties or {}).get("memory_recalls") or [],
                }
            )

        # LLM enrichment (stub or real) — also opens decisions the lexicon missed
        if text.strip():
            llm = await self.gateway.complete(
                [
                    {
                        "role": "system",
                        "content": (
                            "You are an experienced classical furniture production manager. "
                            "Extract JSON decisions/preferences/entities from WhatsApp production chatter. "
                            "Respond JSON only."
                        ),
                    },
                    {"role": "user", "content": text},
                ],
                response_json=True,
            )
            try:
                enriched = json.loads(llm.content)
            except json.JSONDecodeError:
                enriched = {}
            result["llm"] = enriched
            for pref in enriched.get("preferences") or []:
                await self.memory.remember_preference(
                    polarity=pref.get("polarity") or "dislikes",
                    target_summary=pref.get("target") or text[:120],
                    dna_traits=self.lang.normalize_to_dna_fields(text),
                    evidence={"event_id": str(event.id), "via": "llm"},
                    confidence=float(pref.get("confidence") or 0.6),
                )
            if not decision_type:
                for dec in enriched.get("decisions") or []:
                    dtype = dec.get("type") or "review"
                    decision = await self._open_decision(
                        decision_type=dtype,
                        text=text,
                        event=event,
                        piece=piece,
                        workshop=workshop,
                        external_key=f"decision:llm:{event.id}:{dtype}",
                        urgency=dec.get("urgency") or "high",
                        confidence=float(dec.get("confidence") or 0.6),
                    )
                    result["actions"].append(
                        {
                            "type": "decision",
                            "decision_id": str(decision.id),
                            "decision_type": dtype,
                            "via": "llm",
                        }
                    )
                    break  # one LLM decision per event is enough

        # Production timeline signal from stage lexicon
        stage = parsed.filters.get("stage")
        if stage and (piece or order):
            if piece:
                await self._timeline(
                    subject_type="FurniturePiece",
                    subject_id=piece.id,
                    kind="production",
                    label=f"Stage signal: {stage}",
                    stage=stage,
                    occurred_at=event.occurred_at,
                    evidence_event_id=event.id,
                )
                props = dict(piece.properties or {})
                props["stage"] = stage
                piece.properties = props
                piece.status = stage
                await self._delta(
                    "stage",
                    f"{piece.name} entered {stage}",
                    entity_type="FurniturePiece",
                    entity_id=piece.id,
                )
            if order:
                await self._timeline(
                    subject_type="Order",
                    subject_id=order.id,
                    kind="production",
                    label=f"Order stage signal: {stage}",
                    stage=stage,
                    occurred_at=event.occurred_at,
                    evidence_event_id=event.id,
                    properties={"piece_id": str(piece.id) if piece else None},
                )
                oprops = dict(order.properties or {})
                oprops["last_stage"] = stage
                order.properties = oprops
                order.status = stage

        event.processed = True
        await self.session.flush()
        return result

    async def process_media(self, media: MediaAsset, event: DomainEvent | None = None) -> dict[str, Any]:
        from app.services.storage import storage

        data = await storage.get_bytes(media.storage_key)
        result: dict[str, Any] = {"media_id": str(media.id)}

        if media.kind == "image":
            vision = await self.gateway.analyze_image(
                data,
                prompt=(
                    "Extract classical furniture Design DNA as JSON: furniture_type, style_family, "
                    "colors, wood, fabric, stage, carving_type, legs_shape, crown_shape, arm_style, "
                    "fabric_pattern, confidence, keywords"
                ),
            )
            dna = DesignDNA.from_vision_dict(vision.structured or {})
            caption = (event.payload or {}).get("text") if event else ""
            if caption:
                fields = self.lang.normalize_to_dna_fields(caption)
                raw = dna.model_dump()
                raw.update({k: v for k, v in fields.items() if v})
                dna = DesignDNA.from_vision_dict(raw)

            media.dna = dna.model_dump()
            media.phash = storage.sha256(data)[:16]

            dna_node = await self.graph.upsert_node(
                "DesignDNA",
                name=f"DNA {dna.furniture_type.value} {dna.style_family.value}",
                external_key=f"dna:media:{media.id}",
                properties={"dna": dna.model_dump()},
                confidence=dna.overall_confidence,
                provenance={"media_id": str(media.id)},
            )
            # Canonical Design identity for design-life timeline
            design = await self.graph.upsert_node(
                "Design",
                name=f"{dna.style_family.value} {dna.furniture_type.value}",
                external_key=f"design:{dna.furniture_type.value}:{dna.style_family.value}:{dna.crown_shape or 'x'}",
                properties={
                    "furniture_type": dna.furniture_type.value,
                    "style_family": dna.style_family.value,
                    "crown_shape": dna.crown_shape,
                },
                confidence=dna.overall_confidence,
            )
            await self.graph.upsert_edge(design.id, dna_node.id, "HAS_DNA")
            # Design-life: first_seen only once per Design
            from brain.timeline import list_timeline

            existing_tl = await list_timeline(self.session, self.tenant_id, design.id, kind="design_life")
            stage_label = "adapted" if existing_tl else "first_seen"
            await self._timeline(
                subject_type="Design",
                subject_id=design.id,
                kind="design_life",
                label=stage_label,
                stage=stage_label,
                occurred_at=event.occurred_at if event else datetime.now(timezone.utc),
                evidence_event_id=event.id if event else None,
                properties={"media_id": str(media.id)},
            )

            media_node = await self.graph.upsert_node(
                "MediaAsset",
                name=media.storage_key,
                external_key=f"media:{media.id}",
                properties={"kind": media.kind, "media_id": str(media.id)},
            )
            media.node_id = media_node.id
            await self.graph.upsert_edge(media_node.id, dna_node.id, "HAS_DNA")
            await self.graph.upsert_edge(media_node.id, design.id, "EVIDENCED_BY")

            emb = await self.gateway.embed_texts([dna.to_search_text()])
            await self.similarity.index_vector(
                "node", dna_node.id, emb.vectors[0], model=emb.model, meta={"kind": "dna"}
            )
            img_emb = await self.gateway.embed_image(data)
            await self.similarity.index_vector(
                "media", media.id, img_emb.vectors[0], model=img_emb.model, meta={"kind": "image"}
            )

            # Persist top similar designs as SIMILAR_TO edges
            matches = await self.similarity.similar_to_dna(dna, emb.vectors[0], limit=5)
            await self.similarity.link_similar(dna_node.id, matches, min_score=0.4)

            workshop = None
            piece = None
            if event:
                workshop = await self._resolve_participant(event)
                parsed = self.lang.parse(caption or "")
                piece, _order = await self._resolve_piece(event, parsed, workshop)
                if piece:
                    await self.graph.upsert_edge(piece.id, dna_node.id, "HAS_DNA")
                    await self.graph.upsert_edge(piece.id, design.id, "INSTANCE_OF")

            decision = await self.graph.upsert_node(
                "Decision",
                name=f"review sample: {dna.furniture_type.value}",
                external_key=f"decision:media:{media.id}",
                status="open",
                properties={
                    "type": "review",
                    "subject": dna.furniture_type.value,
                    "urgency": "high",
                    "media_id": str(media.id),
                    "dna": dna.model_dump(),
                    "memory_recalls": await self.memory.recall_for_traits(
                        {
                            "fabric_family": dna.fabric_family,
                            "style_family": dna.style_family.value,
                            "carving_type": dna.carving_type,
                        }
                    ),
                    "workshop_id": str(workshop.id) if workshop else None,
                    "piece_id": str(piece.id) if piece else None,
                },
                confidence=dna.overall_confidence,
            )
            await self.graph.upsert_edge(decision.id, dna_node.id, "EVIDENCED_BY")
            if piece:
                await self.graph.upsert_edge(piece.id, decision.id, "BLOCKED_BY")
            if workshop:
                await self.graph.upsert_edge(decision.id, workshop.id, "MENTIONED_IN_EVENT")
            await self._delta(
                "sample",
                f"New sample uploaded — {dna.furniture_type.value} ({dna.style_family.value})",
                severity="critical",
                entity_type="Decision",
                entity_id=decision.id,
            )
            result["dna"] = dna.model_dump()
            result["decision_id"] = str(decision.id)
            result["design_id"] = str(design.id)

        elif media.kind == "audio":
            asr = await self.gateway.transcribe(data, language="ar")
            media.transcript = asr.transcript
            if event:
                event.payload = dict(event.payload or {})
                event.payload["text"] = asr.transcript
                result["transcript"] = asr.transcript
                # Process text once here; caller should skip if event.processed
                result["followup"] = await self.process_event(event)

        elif media.kind == "video":
            # Phase 1: treat first bytes as image-like stub keyframe via vision if possible
            # Full keyframe extraction deferred to Phase 2
            result["note"] = "video_queued_for_keyframe_phase2"
            if event and not (event.payload or {}).get("text"):
                event.payload = dict(event.payload or {})
                event.payload["text"] = "فيديو تقدم إنتاج — يحتاج مراجعة"

        await self.session.flush()
        return result

    async def _open_decision(
        self,
        *,
        decision_type: str,
        text: str,
        event: DomainEvent,
        piece,
        workshop,
        external_key: str | None = None,
        urgency: str | None = None,
        confidence: float = 0.7,
    ):
        subject = piece.name if piece else (workshop.name if workshop else "unknown")
        urgency = urgency or ("high" if decision_type in ("approve", "reject", "review") else "normal")
        traits = self.lang.normalize_to_dna_fields(text)
        recalls = await self.memory.recall_for_traits(traits) if traits else []
        decision = await self.graph.upsert_node(
            "Decision",
            name=f"{decision_type}: {subject}",
            external_key=external_key or f"decision:{event.id}",
            status="open",
            properties={
                "type": decision_type,
                "subject": subject,
                "urgency": urgency,
                "text": text[:1000],
                "memory_recalls": recalls,
                "delay_hours": _delay_hours(event),
                "workshop_id": str(workshop.id) if workshop else None,
                "piece_id": str(piece.id) if piece else None,
            },
            confidence=confidence,
            provenance={"event_id": str(event.id), "source": event.source},
        )
        if workshop:
            await self.graph.upsert_edge(decision.id, workshop.id, "MENTIONED_IN_EVENT")
        if piece:
            await self.graph.upsert_edge(piece.id, decision.id, "BLOCKED_BY")
        await self._delta(
            "decision",
            f"Open decision ({decision_type}) — {subject}",
            severity="critical" if urgency == "high" else "info",
            entity_type="Decision",
            entity_id=decision.id,
        )
        return decision

    async def _resolve_participant(self, event: DomainEvent):
        key = event.participant_key or event.conversation_key
        if not key:
            return None
        name = (event.payload or {}).get("sender_name") or key
        return await self.graph.upsert_node(
            "Workshop",
            name=name,
            external_key=f"wa:{key}",
            properties={"phone_or_key": key},
            provenance={"source": event.source},
        )

    async def _resolve_piece(self, event: DomainEvent, parsed, workshop):
        text = (event.payload or {}).get("text") or ""
        order_m = re.search(r"#?\b(\d{2,5})\b", text)
        furniture = parsed.filters.get("furniture_type")
        if not furniture and not order_m:
            return None, None
        name_parts = []
        if furniture:
            name_parts.append(str(furniture))
        if order_m:
            name_parts.append(f"order-{order_m.group(1)}")
        name = " ".join(name_parts) or "piece"
        ext = f"piece:{event.conversation_key}:{name}"
        piece = await self.graph.upsert_node(
            "FurniturePiece",
            name=name,
            external_key=ext,
            properties={"furniture_type": furniture, "from_event": str(event.id)},
            provenance={"source": event.source},
        )
        order = None
        if order_m:
            order = await self.graph.upsert_node(
                "Order",
                name=f"Order #{order_m.group(1)}",
                external_key=f"order:{order_m.group(1)}",
                properties={"order_number": order_m.group(1)},
            )
            await self.graph.upsert_edge(piece.id, order.id, "BELONGS_TO_ORDER")
        if workshop:
            await self.graph.upsert_edge(piece.id, workshop.id, "BUILT_BY")
        return piece, order

    async def _timeline(self, **kwargs):
        te = TimelineEvent(tenant_id=self.tenant_id, **kwargs)
        self.session.add(te)
        await self.session.flush()
        return te

    async def _delta(
        self,
        category: str,
        summary: str,
        *,
        severity: str = "info",
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
    ):
        d = StateDelta(
            tenant_id=self.tenant_id,
            category=category,
            summary=summary,
            severity=severity,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        self.session.add(d)
        await self.session.flush()
        return d


def _delay_hours(event: DomainEvent) -> float | None:
    occurred = event.occurred_at
    if not occurred:
        return None
    if occurred.tzinfo is None:
        occurred = occurred.replace(tzinfo=timezone.utc)
    return round((datetime.now(timezone.utc) - occurred).total_seconds() / 3600, 2)
