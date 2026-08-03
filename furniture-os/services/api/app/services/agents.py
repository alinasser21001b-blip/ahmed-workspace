"""Agent Runtime — manifest-based agents over shared brain tools."""

from __future__ import annotations

import uuid
from typing import Any, Callable, Awaitable

from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort
from brain.memory import MemoryService
from brain.similarity import SimilarityEngine
from design_dna import DesignDNA
from furniture_language import FurnitureLanguage
from model_gateway import ModelGateway
from production.service import ProductionService


AgentFn = Callable[..., Awaitable[dict[str, Any]]]


class AgentRuntime:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID, gateway: ModelGateway):
        self.session = session
        self.tenant_id = tenant_id
        self.gateway = gateway
        self.graph = GraphPort(session, tenant_id)
        self.memory = MemoryService(session, tenant_id)
        self.similarity = SimilarityEngine(session, tenant_id)
        self.production = ProductionService(session, tenant_id, gateway)
        self.lang = FurnitureLanguage()
        self.agents: dict[str, AgentFn] = {
            "decision": self.decision_agent,
            "memory": self.memory_agent,
            "search": self.search_agent,
            "similarity": self.similarity_agent,
            "summary": self.summary_agent,
        }

    def list_agents(self) -> list[dict[str, str]]:
        return [
            {"name": "decision", "description": "Open approvals/blockers from entity state"},
            {"name": "memory", "description": "Recall owner preferences"},
            {"name": "search", "description": "NL → Furniture Language → graph/DNA search"},
            {"name": "similarity", "description": "Design similarity grounded in suppliers"},
            {"name": "summary", "description": "Hourly executive brief from state deltas"},
        ]

    async def run(self, agent_name: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        fn = self.agents.get(agent_name)
        if not fn:
            return {"ok": False, "error": f"unknown_agent:{agent_name}"}
        return await fn(payload or {})

    async def decision_agent(self, payload: dict[str, Any]) -> dict[str, Any]:
        inbox = await self.production.decisions_inbox(limit=int(payload.get("limit") or 30))
        return {"ok": True, "agent": "decision", "decisions": inbox}

    async def memory_agent(self, payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("remember"):
            pref = await self.memory.remember_preference(
                polarity=payload.get("polarity") or "dislikes",
                target_summary=payload["remember"],
                dna_traits=payload.get("dna_traits") or self.lang.normalize_to_dna_fields(payload["remember"]),
            )
            return {"ok": True, "agent": "memory", "saved": pref}
        traits = payload.get("dna_traits") or self.lang.normalize_to_dna_fields(payload.get("query") or "")
        recalls = await self.memory.recall_for_traits(traits)
        prefs = await self.memory.list_preferences()
        return {"ok": True, "agent": "memory", "recalls": recalls, "preferences": prefs}

    async def search_agent(self, payload: dict[str, Any]) -> dict[str, Any]:
        query = payload.get("query") or ""
        parsed = self.lang.parse(query)
        filters = dict(parsed.filters)
        # Graph entity search
        node_type = None
        if filters.get("furniture_type"):
            node_type = "FurniturePiece"
        nodes = await self.graph.find_nodes(
            node_type=node_type,
            name_ilike=query[:80] if not filters else None,
            limit=30,
        )
        # Also search DesignDNA by property overlap
        dna_nodes = await self.graph.find_nodes(node_type="DesignDNA", limit=100)
        dna_hits = []
        for n in dna_nodes:
            dna = (n.properties or {}).get("dna") or {}
            score = 0
            for k, v in filters.items():
                if k == "colors":
                    continue
                if str(dna.get(k) or dna.get("furniture_type") or "").lower() == str(v).lower():
                    score += 1
                if k == "furniture_type" and str(dna.get("furniture_type", "")).lower() == str(v).lower():
                    score += 2
                if k == "style_family" and str(dna.get("style_family", "")).lower() == str(v).lower():
                    score += 2
                if k == "crown_shape" and dna.get("crown_shape"):
                    score += 2
            if score:
                dna_hits.append({"id": str(n.id), "name": n.name, "score": score, "dna": dna})
        dna_hits.sort(key=lambda x: x["score"], reverse=True)

        memory_boost = await self.memory.recall_for_traits(filters)

        return {
            "ok": True,
            "agent": "search",
            "query": query,
            "parsed_filters": filters,
            "spans": [s.model_dump() for s in parsed.spans],
            "entities": [
                {"id": str(n.id), "type": n.node_type, "name": n.name, "status": n.status, "properties": n.properties}
                for n in nodes
            ],
            "design_dna_hits": dna_hits[:20],
            "memory_boost": memory_boost,
        }

    async def similarity_agent(self, payload: dict[str, Any]) -> dict[str, Any]:
        dna_raw = payload.get("dna") or {}
        if payload.get("query"):
            dna_raw.update(self.lang.normalize_to_dna_fields(payload["query"]))
        dna = DesignDNA.from_vision_dict(dna_raw) if dna_raw else DesignDNA()
        vector = None
        if payload.get("embed_text") or dna.to_search_text():
            emb = await self.gateway.embed_texts([payload.get("embed_text") or dna.to_search_text()])
            vector = emb.vectors[0]
        matches = await self.similarity.similar_to_dna(dna, vector, limit=int(payload.get("limit") or 10))
        # Human-friendly supplier lines
        for m in matches:
            suppliers = m.get("suppliers") or []
            if suppliers:
                top = suppliers[0]
                m["grounding_ar"] = (
                    f"لدينا شيء مشابه عند {top['name']} بنسبة {int(m['score'] * 100)}٪"
                )
            else:
                m["grounding_ar"] = f"تشابه {int(m['score'] * 100)}٪ ضمن المعرفة الداخلية"
        return {"ok": True, "agent": "similarity", "matches": matches}

    async def summary_agent(self, payload: dict[str, Any]) -> dict[str, Any]:
        hours = int(payload.get("hours") or 1)
        summary = await self.production.hourly_summary(hours=hours)
        return {"ok": True, "agent": "summary", "summary": summary}
