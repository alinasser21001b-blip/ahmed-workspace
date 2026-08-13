# ADR-0013 — Five provenance classes, and no invented confidence score

**Status:** accepted (Phase 5)

## Context

Academic information needs to carry where it came from. A student reading an
explanation of neonatal jaundice at 2am before an exam needs to be able to tell
the difference between *someone in my cohort wrote this*, *this is what the
textbook says on page 412*, and *three people have since corrected this*.

The tempting shortcut is a single number — a trust score, a confidence, a
quality rating — computed from whatever is at hand and shown as a badge. It is
tempting because it renders in one component and sorts in one `ORDER BY`.

It is also unfalsifiable. A student cannot argue with 0.72. They cannot tell
whether it means "well sourced" or "popular", and neither can we six months
later when we try to improve it. Worse, once a score exists, every later system
— ranking, retrieval, a future agent — will consume it as though it meant
something specific.

## Decision

**Five provenance classes, each backed by a distinct, inspectable record.**
No score.

| Class | Means | Stored as |
| --- | --- | --- |
| **Author claim** | A student said this. The default, and not a criticism. | `content_items.author_id` — already exists |
| **Source-backed** | This is attributed to a textbook, lecture, guideline or paper. | `content_sources` — a row per citation, with what a reader would look up |
| **Community correction** | Someone challenged it, and the author or a moderator ruled. | `content_corrections`, with a lifecycle: proposed → accepted / rejected / withdrawn |
| **System-derived** | The system computed this from data, deterministically. | `content_topics.source = 'moderator'` for curation; `topic_relations.source = 'derived'` with the co-tag `strength` that produced it |
| **Model-derived** | A model asserted this. | `content_topics.source = 'ai'` with `confidence` — reserved in Phase 0, still unused, and **kept** |

Two rules follow, and they are the load-bearing part:

**1. Quality is derived at read time from facts, never stored.**

What a reader sees is: *cites 2 sources · 1 accepted correction · marked helpful
by 6 students · answer accepted*. Each is a count of rows a student can click
into. There is no float anywhere. Ranking may compute from the same facts in
SQL, exactly as the feed already computes its score from columns — the
computation is in the query, visible in the repository, and changeable without a
backfill.

**2. A model-derived claim never renders as an author claim.**

`content_topics.source` exists so that when an AI eventually classifies content,
the tag is visibly the model's opinion rather than the student's. Phase 5 sets
nothing to `'ai'`, but every read path that surfaces topics must already carry
the source through, so that adding a classifier later is a producer change and
not a UI change. A system that silently merges the two can never be
un-merged.

## Consequences

- Three provenance classes are now representable that were not: source-backed,
  community correction, system-derived. That is the substrate a future learning
  agent needs to weigh evidence rather than count likes.
- Correction gets a lifecycle and an accountable resolver, which means an
  accepted correction is a *fact about the content* rather than a comment
  someone might scroll past.
- No badge, no percentage, nothing to explain away. The cost is that the UI must
  show several small facts instead of one big number, and that ranking has to
  state its arithmetic. Both are the right cost.
- If a stored score is ever genuinely needed — for a query that cannot compute
  it in time — it is added as a **cache of a stated formula**, with the formula
  in code and a test that the cache matches it. Not as a new source of truth.
