# ADR-0012 — Knowledge type is a second axis, not an extension of content kind

**Status:** accepted (Phase 5)

## Context

The product is an academic social learning system, not a social network with
course material on it. The direction that follows from that is: *every useful
piece of academic content should become structured, classifiable data.*

`content_items.kind` already exists — `post | reel | question | poll | resource |
announcement | live` — and the obvious move is to extend it: add `explanation`,
`summary`, `note`, `case`, and be done.

That move is wrong, and it is worth writing down why, because it will look
attractive again later.

`kind` answers a **rendering** question. It decides which `*_details` table to
join and which card the client draws: does this object have a video file? poll
options? an attached document? It is a payload discriminator, and the whole
`content_items` spine (ADR-0002) is built around it.

"Is this an explanation or a clinical case?" is not a rendering question. Both
are plain text. Both render identically. They differ in what they *are*
academically — which is the axis every Phase 5 surface needs to filter, group
and rank on.

The two axes cross. A clinical case can be a `post` or a `resource`. A
`question` is always a question. A `resource` can be a reference or a summary.
One enum cannot express a cross product without becoming a list of pairs.

## Decision

Add `content_items.knowledge_type`, a second nullable enum, alongside `kind`.

```
kind            → how does this render?        (client, details join)
knowledge_type  → what is this, academically?  (search, topics, ranking, retrieval)
```

Values: `question`, `explanation`, `summary`, `note`, `case`, `resource`,
`reference`, `correction`, `discussion`.

Where the two genuinely coincide — `kind = 'question'` — the create path sets
both consistently rather than deriving one from the other at read time, so a
query filtering on `knowledge_type` never has to know about `kind`.

**Nullable, deliberately.** Content published before Phase 5 has no knowledge
type, and backfilling a guess would manufacture classification data that looks
authored. Unclassified content still appears everywhere; it simply cannot be
filtered by type. The gap is visible rather than papered over.

## Consequences

- One column, no join, on the hottest table in the product. Filtering by
  knowledge type costs an index, not a join per row.
- The authoring UI must ask what the student is publishing. That is a product
  cost and the point of the exercise: a system that does not know what its
  content *is* cannot route, rank or retrieve it usefully, and no amount of
  later machine learning recovers information that was never captured.
- Adding a value is a migration (Postgres enum). That is the correct friction
  for a taxonomy that everything else keys on — unlike `learning_event_kinds`,
  which is a reference table precisely because its membership is meant to change
  without a deploy.
- `reel` and `live` remain in `kind` and gain no `knowledge_type` treatment.
  They are not part of the product's centre of gravity and this ADR does not
  make them so.
