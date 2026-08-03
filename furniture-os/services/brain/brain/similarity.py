"""Design Similarity Engine — DNA + embedding retrieval grounded in suppliers."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from brain.graph import GraphPort
from design_dna import DesignDNA
from model_gateway import cosine_similarity

from app.db.models import EmbeddingRow, GraphEdge, GraphNode, MediaAsset


class SimilarityEngine:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id
        self.graph = GraphPort(session, tenant_id)

    async def index_vector(
        self,
        owner_type: str,
        owner_id: uuid.UUID,
        vector: list[float],
        *,
        model: str,
        meta: dict[str, Any] | None = None,
    ) -> EmbeddingRow:
        q = await self.session.execute(
            select(EmbeddingRow).where(
                EmbeddingRow.tenant_id == self.tenant_id,
                EmbeddingRow.owner_type == owner_type,
                EmbeddingRow.owner_id == owner_id,
                EmbeddingRow.model == model,
            )
        )
        row = q.scalar_one_or_none()
        if row:
            row.vector = vector
            row.dim = len(vector)
            row.meta = meta or {}
        else:
            row = EmbeddingRow(
                tenant_id=self.tenant_id,
                owner_type=owner_type,
                owner_id=owner_id,
                model=model,
                dim=len(vector),
                vector=vector,
                meta=meta or {},
            )
            self.session.add(row)
        await self.session.flush()
        return row

    async def similar_to_dna(
        self,
        dna: DesignDNA,
        query_vector: list[float] | None = None,
        *,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        # Candidates: DesignDNA nodes + media with dna
        dna_nodes = await self.graph.find_nodes(node_type="DesignDNA", limit=200)
        media_q = await self.session.execute(
            select(MediaAsset).where(MediaAsset.tenant_id == self.tenant_id).limit(200)
        )
        media_rows = list(media_q.scalars().all())

        results: list[dict[str, Any]] = []

        for node in dna_nodes:
            other = DesignDNA.model_validate(node.properties.get("dna") or node.properties or {})
            trait_score = dna.trait_overlap_score(other)
            vec_score = 0.0
            if query_vector:
                emb = await self._get_embedding("node", node.id)
                if emb:
                    vec_score = cosine_similarity(query_vector, emb)
            score = 0.55 * trait_score + 0.45 * vec_score if query_vector else trait_score
            if score <= 0:
                continue
            grounded = await self._ground_suppliers(node.id)
            results.append(
                {
                    "score": round(score, 4),
                    "trait_score": round(trait_score, 4),
                    "vector_score": round(vec_score, 4),
                    "subject_type": "DesignDNA",
                    "subject_id": str(node.id),
                    "name": node.name,
                    "dna": other.model_dump(),
                    "explanation": _explain(dna, other),
                    "suppliers": grounded,
                }
            )

        for m in media_rows:
            if not m.dna:
                continue
            other = DesignDNA.from_vision_dict(m.dna)
            trait_score = dna.trait_overlap_score(other)
            vec_score = 0.0
            if query_vector:
                emb = await self._get_embedding("media", m.id)
                if emb:
                    vec_score = cosine_similarity(query_vector, emb)
            score = 0.55 * trait_score + 0.45 * vec_score if query_vector else trait_score
            if score <= 0:
                continue
            suppliers: list[dict[str, Any]] = []
            if m.node_id:
                suppliers = await self._ground_suppliers(m.node_id)
            results.append(
                {
                    "score": round(score, 4),
                    "trait_score": round(trait_score, 4),
                    "vector_score": round(vec_score, 4),
                    "subject_type": "MediaAsset",
                    "subject_id": str(m.id),
                    "name": m.storage_key,
                    "dna": other.model_dump(),
                    "explanation": _explain(dna, other),
                    "suppliers": suppliers,
                }
            )

        results.sort(key=lambda x: x["score"], reverse=True)
        # Deduplicate by subject
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for r in results:
            key = f"{r['subject_type']}:{r['subject_id']}"
            if key in seen:
                continue
            seen.add(key)
            unique.append(r)
            if len(unique) >= limit:
                break
        return unique

    async def link_similar(
        self,
        src_node_id: uuid.UUID,
        matches: list[dict[str, Any]],
        *,
        min_score: float = 0.5,
    ) -> int:
        """Persist top similarity hits as SIMILAR_TO edges with score + explanation."""
        linked = 0
        for m in matches:
            if (m.get("score") or 0) < min_score:
                continue
            if m.get("subject_type") != "DesignDNA":
                continue
            try:
                dst = uuid.UUID(str(m["subject_id"]))
            except (ValueError, KeyError):
                continue
            if dst == src_node_id:
                continue
            await self.graph.upsert_edge(
                src_node_id,
                dst,
                "SIMILAR_TO",
                properties={
                    "score": m.get("score"),
                    "explanation": m.get("explanation") or [],
                    "suppliers": m.get("suppliers") or [],
                },
                confidence=float(m.get("score") or 0.5),
                provenance={"source": "similarity_engine"},
            )
            linked += 1
        return linked

    async def _get_embedding(self, owner_type: str, owner_id: uuid.UUID) -> list[float] | None:
        q = await self.session.execute(
            select(EmbeddingRow).where(
                EmbeddingRow.tenant_id == self.tenant_id,
                EmbeddingRow.owner_type == owner_type,
                EmbeddingRow.owner_id == owner_id,
            )
        )
        row = q.scalar_one_or_none()
        return list(row.vector) if row else None

    async def _ground_suppliers(self, node_id: uuid.UUID) -> list[dict[str, Any]]:
        """Find Workshop/Supplier linked via piece/design neighborhood."""
        nb = await self.graph.get_neighborhood(node_id, depth=2)
        out: list[dict[str, Any]] = []
        for n in nb.get("neighbors") or []:
            if n.get("node_type") in ("Workshop", "Supplier"):
                out.append({"id": n["id"], "type": n["node_type"], "name": n["name"]})
        # Also search pieces that HAVE_DNA this node
        stmt = select(GraphEdge).where(
            GraphEdge.tenant_id == self.tenant_id,
            GraphEdge.dst_id == node_id,
            GraphEdge.edge_type == "HAS_DNA",
        )
        for e in (await self.session.execute(stmt)).scalars().all():
            piece_nb = await self.graph.get_neighborhood(e.src_id, edge_types=["BUILT_BY", "JOB_ASSIGNED_TO"], depth=1)
            for n in piece_nb.get("neighbors") or []:
                if n.get("node_type") in ("Workshop", "Supplier"):
                    out.append({"id": n["id"], "type": n["node_type"], "name": n["name"]})
        # unique
        seen: set[str] = set()
        uniq = []
        for s in out:
            if s["id"] in seen:
                continue
            seen.add(s["id"])
            uniq.append(s)
        return uniq


def _explain(a: DesignDNA, b: DesignDNA) -> list[str]:
    reasons = []
    if a.furniture_type == b.furniture_type and a.furniture_type.value != "unknown":
        reasons.append(f"same furniture_type={a.furniture_type.value}")
    if a.style_family == b.style_family and a.style_family.value != "unknown":
        reasons.append(f"same style_family={a.style_family.value}")
    for attr in ("crown_shape", "legs_shape", "carving_type", "arm_style", "fabric_family", "wood_species"):
        av = getattr(a, attr)
        bv = getattr(b, attr)
        if av and bv and av == bv:
            reasons.append(f"shared {attr}={av}")
    return reasons or ["weak visual/DNA proximity"]
