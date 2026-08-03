"""AI Memory — owner preferences and standing rules on the graph."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort


class MemoryService:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.graph = GraphPort(session, tenant_id)
        self.tenant_id = tenant_id

    async def remember_preference(
        self,
        *,
        polarity: str,
        target_summary: str,
        dna_traits: dict[str, Any] | None = None,
        evidence: dict[str, Any] | None = None,
        confidence: float = 0.8,
    ) -> dict[str, Any]:
        """polarity: likes | dislikes | never | prefers"""
        key = f"pref:{polarity}:{target_summary.lower().strip()[:120]}"
        pref = await self.graph.upsert_node(
            "Preference",
            name=f"{polarity}: {target_summary}",
            external_key=key,
            status="active",
            properties={
                "polarity": polarity,
                "target_summary": target_summary,
                "dna_traits": dna_traits or {},
                "evidence": evidence or {},
            },
            confidence=confidence,
            provenance={"source": "owner_memory"},
        )
        return {
            "id": str(pref.id),
            "polarity": polarity,
            "target_summary": target_summary,
            "dna_traits": dna_traits or {},
        }

    async def recall_for_traits(self, dna_traits: dict[str, Any], limit: int = 10) -> list[dict[str, Any]]:
        prefs = await self.graph.find_nodes(node_type="Preference", status="active", limit=100)
        hits: list[dict[str, Any]] = []
        for p in prefs:
            traits = (p.properties or {}).get("dna_traits") or {}
            if not traits and not dna_traits:
                continue
            overlap = 0
            for k, v in traits.items():
                if dna_traits.get(k) == v and v not in (None, "", "unknown"):
                    overlap += 1
            # Also match target_summary keywords loosely against trait values
            summary = ((p.properties or {}).get("target_summary") or "").lower()
            for v in dna_traits.values():
                if isinstance(v, str) and v and v.lower() in summary:
                    overlap += 1
            if overlap > 0:
                hits.append(
                    {
                        "id": str(p.id),
                        "name": p.name,
                        "polarity": (p.properties or {}).get("polarity"),
                        "target_summary": (p.properties or {}).get("target_summary"),
                        "overlap": overlap,
                        "message_ar": _recall_message(p.properties or {}),
                    }
                )
        hits.sort(key=lambda x: x["overlap"], reverse=True)
        return hits[:limit]

    async def list_preferences(self, limit: int = 50) -> list[dict[str, Any]]:
        prefs = await self.graph.find_nodes(node_type="Preference", limit=limit)
        return [
            {
                "id": str(p.id),
                "name": p.name,
                "polarity": (p.properties or {}).get("polarity"),
                "target_summary": (p.properties or {}).get("target_summary"),
                "dna_traits": (p.properties or {}).get("dna_traits"),
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in prefs
        ]


def _recall_message(props: dict[str, Any]) -> str:
    polarity = props.get("polarity")
    target = props.get("target_summary") or "هذا الأسلوب"
    if polarity == "dislikes":
        return f"سبق أن رفضت هذا النوع: {target}"
    if polarity == "likes":
        return f"سبق أن أعجبك هذا النوع: {target}"
    if polarity == "never":
        return f"قاعدة ثابتة: تجنب {target}"
    return f"تفضيل مسجّل: {target}"
