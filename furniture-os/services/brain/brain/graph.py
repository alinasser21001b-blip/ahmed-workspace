"""GraphPort — engines talk only to this for knowledge graph mutations/queries."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GraphEdge, GraphNode

# Canonical edge types from architecture
EDGE_TYPES = {
    "BUILT_BY",
    "SUPPLIED_BY",
    "USES_FABRIC",
    "USES_WOOD",
    "USES_MATERIAL",
    "HAS_COLOR",
    "HAS_DNA",
    "INSTANCE_OF",
    "VARIANT_OF",
    "BELONGS_TO_ORDER",
    "FOR_CUSTOMER",
    "PART_OF_SET",
    "HAS_JOB",
    "JOB_ASSIGNED_TO",
    "BLOCKED_BY",
    "APPROVED_BY_OWNER",
    "REJECTED_BY_OWNER",
    "SIMILAR_TO",
    "DERIVED_FROM",
    "FIRST_SEEN_IN",
    "TRENDING_AS",
    "EVIDENCED_BY",
    "MENTIONED_IN_EVENT",
    "OWNER_PREFERS",
    "OWNER_REJECTS",
    "HAS_PREFERENCE",
}

NODE_TYPES = {
    "FurniturePiece",
    "ProductionJob",
    "Order",
    "CustomerReference",
    "Supplier",
    "Workshop",
    "Material",
    "Fabric",
    "Wood",
    "Color",
    "Design",
    "DesignDNA",
    "Decision",
    "Preference",
    "MediaAsset",
}


class GraphPort:
    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID):
        self.session = session
        self.tenant_id = tenant_id

    async def upsert_node(
        self,
        node_type: str,
        *,
        name: str = "",
        external_key: str | None = None,
        status: str = "active",
        properties: dict[str, Any] | None = None,
        confidence: float = 1.0,
        provenance: dict[str, Any] | None = None,
        node_id: uuid.UUID | None = None,
    ) -> GraphNode:
        existing: GraphNode | None = None
        if node_id:
            existing = await self.session.get(GraphNode, node_id)
        elif external_key:
            q = await self.session.execute(
                select(GraphNode).where(
                    GraphNode.tenant_id == self.tenant_id,
                    GraphNode.node_type == node_type,
                    GraphNode.external_key == external_key,
                )
            )
            existing = q.scalar_one_or_none()

        if existing:
            if name:
                existing.name = name
            existing.status = status
            if properties:
                merged = dict(existing.properties or {})
                merged.update(properties)
                existing.properties = merged
            existing.confidence = confidence
            if provenance:
                merged_p = dict(existing.provenance or {})
                merged_p.update(provenance)
                existing.provenance = merged_p
            await self.session.flush()
            return existing

        node = GraphNode(
            id=node_id or uuid.uuid4(),
            tenant_id=self.tenant_id,
            node_type=node_type,
            name=name,
            external_key=external_key,
            status=status,
            properties=properties or {},
            confidence=confidence,
            provenance=provenance or {},
        )
        self.session.add(node)
        await self.session.flush()
        return node

    async def close_edges(
        self,
        *,
        src_id: uuid.UUID | None = None,
        dst_id: uuid.UUID | None = None,
        edge_type: str,
    ) -> int:
        """Soft-close matching open edges by setting valid_to."""
        stmt = select(GraphEdge).where(
            GraphEdge.tenant_id == self.tenant_id,
            GraphEdge.edge_type == edge_type,
            GraphEdge.valid_to.is_(None),
        )
        if src_id:
            stmt = stmt.where(GraphEdge.src_id == src_id)
        if dst_id:
            stmt = stmt.where(GraphEdge.dst_id == dst_id)
        rows = list((await self.session.execute(stmt)).scalars().all())
        now = datetime.now(timezone.utc)
        for e in rows:
            e.valid_to = now
        await self.session.flush()
        return len(rows)

    async def upsert_edge(
        self,
        src_id: uuid.UUID,
        dst_id: uuid.UUID,
        edge_type: str,
        *,
        properties: dict[str, Any] | None = None,
        confidence: float = 1.0,
        provenance: dict[str, Any] | None = None,
        valid_from: datetime | None = None,
    ) -> GraphEdge:
        q = await self.session.execute(
            select(GraphEdge).where(
                GraphEdge.tenant_id == self.tenant_id,
                GraphEdge.src_id == src_id,
                GraphEdge.dst_id == dst_id,
                GraphEdge.edge_type == edge_type,
                GraphEdge.valid_to.is_(None),
            )
        )
        existing = q.scalar_one_or_none()
        if existing:
            if properties:
                merged = dict(existing.properties or {})
                merged.update(properties)
                existing.properties = merged
            existing.confidence = confidence
            await self.session.flush()
            return existing

        edge = GraphEdge(
            tenant_id=self.tenant_id,
            src_id=src_id,
            dst_id=dst_id,
            edge_type=edge_type,
            properties=properties or {},
            confidence=confidence,
            provenance=provenance or {},
            valid_from=valid_from or datetime.now(timezone.utc),
        )
        self.session.add(edge)
        await self.session.flush()
        return edge

    async def get_node(self, node_id: uuid.UUID) -> GraphNode | None:
        node = await self.session.get(GraphNode, node_id)
        if node and node.tenant_id == self.tenant_id:
            return node
        return None

    async def find_nodes(
        self,
        *,
        node_type: str | None = None,
        status: str | None = None,
        name_ilike: str | None = None,
        property_filters: dict[str, Any] | None = None,
        limit: int = 50,
    ) -> list[GraphNode]:
        stmt: Select[tuple[GraphNode]] = select(GraphNode).where(GraphNode.tenant_id == self.tenant_id)
        if node_type:
            stmt = stmt.where(GraphNode.node_type == node_type)
        if status:
            stmt = stmt.where(GraphNode.status == status)
        if name_ilike:
            stmt = stmt.where(GraphNode.name.ilike(f"%{name_ilike}%"))
        # Fetch a wider window when property-filtering in Python (JSON filters aren't portable across SQLite/PG)
        fetch_limit = limit * 10 if property_filters else limit
        stmt = stmt.order_by(GraphNode.updated_at.desc()).limit(fetch_limit)
        rows = list((await self.session.execute(stmt)).scalars().all())
        if property_filters:
            filtered = []
            for n in rows:
                props = n.properties or {}
                if all(props.get(k) == v for k, v in property_filters.items()):
                    filtered.append(n)
                if len(filtered) >= limit:
                    break
            return filtered
        return rows[:limit]

    async def get_neighborhood(
        self, node_id: uuid.UUID, *, edge_types: list[str] | None = None, depth: int = 1
    ) -> dict[str, Any]:
        node = await self.get_node(node_id)
        if not node:
            return {"node": None, "edges": [], "neighbors": []}

        visited = {node_id}
        frontier = {node_id}
        edges: list[GraphEdge] = []
        neighbors: dict[uuid.UUID, GraphNode] = {}

        for _ in range(max(1, depth)):
            if not frontier:
                break
            stmt = select(GraphEdge).where(
                GraphEdge.tenant_id == self.tenant_id,
                or_(GraphEdge.src_id.in_(frontier), GraphEdge.dst_id.in_(frontier)),
                GraphEdge.valid_to.is_(None),
            )
            if edge_types:
                stmt = stmt.where(GraphEdge.edge_type.in_(edge_types))
            batch = list((await self.session.execute(stmt)).scalars().all())
            edges.extend(batch)
            next_frontier: set[uuid.UUID] = set()
            for e in batch:
                for nid in (e.src_id, e.dst_id):
                    if nid not in visited:
                        visited.add(nid)
                        next_frontier.add(nid)
            if next_frontier:
                ns = (
                    await self.session.execute(
                        select(GraphNode).where(
                            GraphNode.tenant_id == self.tenant_id, GraphNode.id.in_(next_frontier)
                        )
                    )
                ).scalars().all()
                for n in ns:
                    neighbors[n.id] = n
            frontier = next_frontier

        return {
            "node": _node_dict(node),
            "edges": [_edge_dict(e) for e in edges],
            "neighbors": [_node_dict(n) for n in neighbors.values()],
        }

    async def state_of(self, entity_id: uuid.UUID) -> dict[str, Any]:
        nb = await self.get_neighborhood(entity_id, depth=1)
        node = nb["node"]
        if not node:
            return {"exists": False}
        return {
            "exists": True,
            "entity": node,
            "status": node.get("status"),
            "properties": node.get("properties"),
            "relations": [
                {
                    "edge_type": e["edge_type"],
                    "direction": "out" if e["src_id"] == str(entity_id) else "in",
                    "other_id": e["dst_id"] if e["src_id"] == str(entity_id) else e["src_id"],
                }
                for e in nb["edges"]
            ],
            "neighbors": nb["neighbors"],
        }

    async def open_decisions(self, limit: int = 50) -> list[GraphNode]:
        return await self.find_nodes(node_type="Decision", status="open", limit=limit)

    async def path_query(
        self, src_id: uuid.UUID, dst_id: uuid.UUID, max_depth: int = 4
    ) -> list[list[str]]:
        """BFS paths as lists of node ids (string)."""
        from collections import deque

        queue: deque[tuple[uuid.UUID, list[uuid.UUID]]] = deque([(src_id, [src_id])])
        seen = {src_id}
        paths: list[list[str]] = []
        while queue:
            current, path = queue.popleft()
            if current == dst_id and len(path) > 1:
                paths.append([str(x) for x in path])
                continue
            if len(path) > max_depth:
                continue
            stmt = select(GraphEdge).where(
                GraphEdge.tenant_id == self.tenant_id,
                or_(GraphEdge.src_id == current, GraphEdge.dst_id == current),
                GraphEdge.valid_to.is_(None),
            )
            for e in (await self.session.execute(stmt)).scalars().all():
                nxt = e.dst_id if e.src_id == current else e.src_id
                if nxt in seen and nxt != dst_id:
                    continue
                seen.add(nxt)
                queue.append((nxt, path + [nxt]))
        return paths


def _node_dict(n: GraphNode | dict) -> dict[str, Any]:
    if isinstance(n, dict):
        return n
    return {
        "id": str(n.id),
        "node_type": n.node_type,
        "name": n.name,
        "status": n.status,
        "external_key": n.external_key,
        "properties": n.properties or {},
        "confidence": n.confidence,
        "provenance": n.provenance or {},
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


def _edge_dict(e: GraphEdge) -> dict[str, Any]:
    return {
        "id": str(e.id),
        "src_id": str(e.src_id),
        "dst_id": str(e.dst_id),
        "edge_type": e.edge_type,
        "properties": e.properties or {},
        "confidence": e.confidence,
    }
