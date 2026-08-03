"""Production Intelligence — decisions, timelines, hourly summaries from entity state."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort
from brain.memory import MemoryService
from model_gateway import ModelGateway

from app.db.models import StateDelta, TimelineEvent


class ProductionService:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID, gateway: ModelGateway | None = None):
        self.session = session
        self.tenant_id = tenant_id
        self.graph = GraphPort(session, tenant_id)
        self.memory = MemoryService(session, tenant_id)
        self.gateway = gateway

    async def decisions_inbox(self, limit: int = 50) -> list[dict[str, Any]]:
        decisions = await self.graph.open_decisions(limit=limit)
        out = []
        for d in decisions:
            props = d.properties or {}
            recalls = props.get("memory_recalls") or []
            out.append(
                {
                    "id": str(d.id),
                    "name": d.name,
                    "type": props.get("type"),
                    "subject": props.get("subject"),
                    "urgency": props.get("urgency", "normal"),
                    "text": props.get("text"),
                    "delay_hours": props.get("delay_hours"),
                    "workshop_id": props.get("workshop_id"),
                    "piece_id": props.get("piece_id"),
                    "media_id": props.get("media_id"),
                    "memory_recalls": recalls,
                    "memory_warning": recalls[0]["message_ar"] if recalls else None,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
            )
        urgency_rank = {"high": 0, "critical": 0, "normal": 1, "low": 2}
        out.sort(key=lambda x: (urgency_rank.get(x.get("urgency") or "normal", 9), x.get("created_at") or ""))
        return out

    async def resolve_decision(self, decision_id: uuid.UUID, resolution: str, note: str = "") -> dict[str, Any]:
        node = await self.graph.get_node(decision_id)
        if not node or node.node_type != "Decision":
            return {"ok": False, "error": "not_found"}
        props = dict(node.properties or {})
        props["resolution"] = resolution
        props["resolution_note"] = note
        props["resolved_at"] = datetime.now(timezone.utc).isoformat()
        node.properties = props
        node.status = "resolved"

        owner = await self.memory.owner_node()
        edge_type = "APPROVED_BY_OWNER" if resolution == "approve" else "REJECTED_BY_OWNER"
        if resolution in {"approve", "reject"}:
            await self.graph.upsert_edge(
                node.id,
                owner.id,
                edge_type,
                properties={"note": note},
                confidence=1.0,
                provenance={"source": "owner_resolve"},
            )

        # Clear blockers pointing at this decision
        await self.graph.close_edges(dst_id=decision_id, edge_type="BLOCKED_BY")

        piece_id = props.get("piece_id")
        if piece_id:
            try:
                pid = uuid.UUID(str(piece_id))
            except ValueError:
                pid = None
            if pid:
                stage = "approved" if resolution == "approve" else "rejected"
                self.session.add(
                    TimelineEvent(
                        tenant_id=self.tenant_id,
                        subject_type="FurniturePiece",
                        subject_id=pid,
                        kind="production",
                        label=f"Decision {resolution}: {props.get('subject') or node.name}",
                        stage=stage,
                        occurred_at=datetime.now(timezone.utc),
                        properties={"decision_id": str(decision_id), "note": note},
                    )
                )

        if resolution == "reject":
            dna_traits = props.get("dna") or {}
            if isinstance(dna_traits, dict) and "dna" in dna_traits:
                dna_traits = dna_traits["dna"]
            # Flatten enum-like values
            flat = {}
            if isinstance(dna_traits, dict):
                for k, v in dna_traits.items():
                    if isinstance(v, dict) and "value" in v:
                        flat[k] = v["value"]
                    else:
                        flat[k] = v
            await self.memory.remember_preference(
                polarity="dislikes",
                target_summary=props.get("subject") or node.name,
                dna_traits=flat,
                evidence={"decision_id": str(decision_id)},
                related_node_id=decision_id,
            )

        self.session.add(
            StateDelta(
                tenant_id=self.tenant_id,
                category="decision_resolved",
                summary=f"Decision {resolution}: {props.get('subject') or node.name}",
                severity="info",
                entity_type="Decision",
                entity_id=decision_id,
            )
        )
        await self.session.flush()
        return {"ok": True, "id": str(decision_id), "status": "resolved", "resolution": resolution}

    async def production_timeline(self, subject_id: uuid.UUID) -> list[dict[str, Any]]:
        q = await self.session.execute(
            select(TimelineEvent)
            .where(
                TimelineEvent.tenant_id == self.tenant_id,
                TimelineEvent.subject_id == subject_id,
                TimelineEvent.kind == "production",
            )
            .order_by(TimelineEvent.occurred_at.asc())
        )
        return [
            {
                "id": str(t.id),
                "label": t.label,
                "stage": t.stage,
                "occurred_at": t.occurred_at.isoformat() if t.occurred_at else None,
                "properties": t.properties or {},
            }
            for t in q.scalars().all()
        ]

    async def hourly_summary(self, hours: int = 1) -> dict[str, Any]:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        q = await self.session.execute(
            select(StateDelta)
            .where(StateDelta.tenant_id == self.tenant_id, StateDelta.created_at >= since)
            .order_by(StateDelta.created_at.desc())
        )
        deltas = list(q.scalars().all())
        open_decisions = await self.decisions_inbox(limit=20)
        critical = [d for d in open_decisions if d.get("urgency") == "high"]

        bullets = [d.summary for d in deltas[:20]]
        if not bullets:
            bullets = ["No entity state changes in this window."]

        stages = {}
        for d in deltas:
            if d.category == "stage":
                stages[d.summary] = stages.get(d.summary, 0) + 1

        summary = {
            "window_hours": hours,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "production_updates": bullets,
            "stage_signals": stages,
            "open_decisions": len(open_decisions),
            "critical_actions": [
                {"id": c["id"], "name": c["name"], "memory_warning": c.get("memory_warning")}
                for c in critical[:5]
            ],
            "estimated_delays": sum(1 for c in open_decisions if (c.get("delay_hours") or 0) > 2),
        }

        if self.gateway:
            llm = await self.gateway.complete(
                [
                    {
                        "role": "system",
                        "content": "Write a short executive production summary for a furniture factory owner. Arabic+English ok. Be concrete.",
                    },
                    {"role": "user", "content": str(summary)},
                ]
            )
            summary["narrative"] = llm.content
        else:
            summary["narrative"] = "\n".join(f"• {b}" for b in bullets[:8])

        return summary

    async def supplier_profile(self, supplier_id: uuid.UUID) -> dict[str, Any]:
        state = await self.graph.state_of(supplier_id)
        if not state.get("exists"):
            return {"ok": False}
        nb = state.get("neighbors") or []
        pieces = [n for n in nb if n.get("node_type") == "FurniturePiece"]
        return {
            "ok": True,
            "supplier": state["entity"],
            "related_pieces": pieces,
            "relation_count": len(state.get("relations") or []),
            "specialization_hint": (state["entity"].get("properties") or {}).get("specialization"),
        }
