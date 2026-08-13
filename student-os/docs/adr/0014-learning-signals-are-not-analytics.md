# ADR-0014 — Learning signals are a separate channel from analytics, and AI is optional

**Status:** accepted (Phase 5)

## Context

The product's premise is that accumulated student behaviour eventually makes the
system better at helping students learn. That premise fails in a specific,
common way: everything gets logged into one event table, and by the time anyone
tries to learn from it, the table contains `button_clicked`, `screen_viewed`,
`post_read` and `quiz_completed` side by side, with no way to say which of them
meant anything.

The failure is not the volume. It is that the distinction between *the user
touched the software* and *the user learned something* was never recorded, and
cannot be reconstructed afterwards.

Phase 0 anticipated half of this: `learning_events` exists with a
`learning_event_kinds` reference table carrying `is_meaningful`, so the
definition of a meaningful learning action is a row rather than a constant.
Nothing has ever written to it.

## Decision

**Five channels, kept apart, each answering a different question.**

| Channel | Question | Store |
| --- | --- | --- |
| **A · Social** | Who relates to whom? | `follows`, `blocks`, `mutes`, `reactions(like, celebrate, curious)` |
| **B · Content** | Did this person encounter this object? | `content_views`, `bookmarks` |
| **C · Learning** | Did something happen that plausibly advanced learning? | `learning_events`, gated by `learning_event_kinds.is_meaningful` |
| **D · Quality** | Is this knowledge good, and who says so? | `reactions(helpful, insightful)`, `comments.is_accepted`, `content_sources`, `content_corrections` |
| **E · Telemetry** | What did the software do? | `analytics_events` |

`domain_events` is orthogonal to all five: it is a delivery outbox (ADR-0010),
not an observation of anything.

Three rules enforce the separation:

1. **A view is not a learning event.** Opening a post is channel B. It becomes
   channel C only when a rule says so, and that rule lives in
   `learning_event_kinds` as data — so changing what counts as learning is an
   `UPDATE`, not a deploy, and the north-star metric's definition is auditable.

2. **A learning event is written inside the transaction that caused it.** Same
   discipline as the outbox. A signal describing a write that rolled back is
   worse than a missing signal, because it is silently wrong and nothing will
   ever contradict it.

3. **Channel D is never collapsed into channel A.** `helpful` and `like` are
   both reactions and are not the same statement. One is a judgement about
   correctness, the other about affinity. Ranking may use both; it must never
   add them together.

**And the architectural consequence: AI is optional.**

The first intelligence in this system is arithmetic over structured data the
community produced — co-tag frequency between topics, accuracy per topic,
source counts, accepted corrections, revisit patterns. Every one of those is
computable in SQL, explainable to a student in a sentence, and testable with a
fixture.

An LLM, an embedding, a vector index or an agent may be added later **above**
this substrate. None of them may become a dependency of it. Concretely, that
means no table added in Phase 5 stores a model output as its primary value, and
every derived edge carries the `source` that produced it (ADR-0013), so a model
can later contribute rows without becoming indistinguishable from the
deterministic ones.

## Consequences

- The north-star metric becomes computable for the first time, because
  `learning_events` finally has producers.
- `learning_progress` and the already-tested `computeWeakness` get real inputs,
  which means the feed's academic ranking terms stop being multiplied by zero.
- Adding a signal is cheap (a row in `learning_event_kinds`) and adding a
  *channel* is expensive (a design decision recorded here). That asymmetry is
  intentional: the failure mode this ADR exists to prevent is one more `INSERT`
  into whichever table was nearest.
- We accept that some genuinely meaningful learning goes unrecorded — a student
  who reads a resource carefully and closes the app emits only channel B. Under-
  claiming is the correct direction to be wrong in a system whose whole
  proposition is that its signals mean something.
