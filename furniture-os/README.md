# Furniture Intelligence OS

**The AI Brain of the Furniture Business** — not a WhatsApp client, CRM, or media archive.

Channels (WhatsApp, catalogs, market sources) are sensors. The product is cumulative knowledge: entities, Design DNA, graph relationships, owner memory, and decisions.

## Architecture

```
apps/web                 Next.js PWA (entity / decision UI)
services/api             FastAPI gateway
services/brain           Knowledge Graph, DNA, Language, Memory, Similarity
services/production      Decisions, timelines, hourly summaries
services/ingest          WhatsApp Export + Cloud API sensors
services/market          Design-history contracts (stub until Phase 3)
packages/model_gateway   Provider-agnostic LLM / Vision / ASR / Embeddings
packages/furniture_language   Arabic/English craft lexicon
packages/design_dna      Design phenotype schema
```

## Quick start

### Local (SQLite + stub models — no Docker required)

```bash
cd furniture-os
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # defaults to SQLite + local media
export PYTHONPATH=services/api:services/brain:services/production:services/ingest:services/market:packages/model_gateway:packages/furniture_language:packages/design_dna
python scripts/seed_demo.py
uvicorn app.main:app --reload --app-dir services/api --port 8000
```

In another terminal:

```bash
cd apps/web && npm install && npm run dev -- --port 3001
```

- API docs: http://localhost:8000/docs
- Web UI: http://localhost:3001

### Docker (Postgres + Redis + MinIO)

```bash
cd furniture-os
docker compose up --build
# optional web profile:
docker compose --profile web up --build
```

## Owner experience

Two workspaces only — AI stays invisible:

1. **واتساب** — familiar chat list + thread. Cards show urgency, pending approvals, media insights. Full conversation one click away.
2. **السوق** — Pinterest-style visual feed (Egypt & Turkey). Quiet trend whispers, not BI charts.

Graph / DNA / memory / similarity / agents power both behind the scenes and are **not** in navigation.

## Under the hood (not user-facing)

- Entity-native graph, Design DNA, Furniture Language, owner memory
- WhatsApp export (+ zip/media) and Cloud API sensors with media download
- ARQ worker: pending-event cortex every 30s + hourly state summary
- Decisions, Piece/Order timelines, Design-life timeline, similarity edges
- Agents: Decision, Memory, Search, Similarity, Summary
- Market module contracts only (collectors in Phase 3)

## Tests

```bash
pytest tests/ -q
```
