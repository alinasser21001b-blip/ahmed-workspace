# Phase 5 Architecture Audit — Knowledge & Learning Foundation

> Written before any Phase 5 code. Read against the actual migrations, policy,
> repositories, contracts and client, not from memory of what was intended.
>
> Baseline: `12beb3d` on `claude/student-social-learning-os-9o3l2n`.
> 182 unit + 143 integration tests green, 10 migrations, 80 tables.

## 0. The headline

**The schema is already knowledge-shaped.** That is the single most important
finding, and it changes what Phase 5 is.

`content_items` is not a social-post table with academic fields bolted on. It
carries university → college → program → stage → course → subject on every row,
denormalised at creation time on purpose, plus a container, a visibility, and a
`language` column nobody has populated yet. `content_topics` already records
*who* classified a piece of content (`source: author | ai | moderator`) and with
what `confidence`. `content_links` already models a typed edge from content to a
lecture, quiz, topic, group or study session. `topics` already has
`parent_topic_id`, so Subject → Topic → Subtopic exists.

So Phase 5 is **not** a schema rewrite. What is missing is narrower and sharper
than "a knowledge model":

1. an axis for **what a piece of content academically *is*** — distinct from the
   payload shape it renders as;
2. **provenance** — a source is nowhere in the schema, so every claim is
   currently an author claim with no way to say otherwise;
3. **correction** as a first-class relationship rather than a comment;
4. **topic-to-topic relationships**, which is where "related concepts" and the
   beginnings of a knowledge graph live;
5. **producers for `learning_events`** — the table exists, the taxonomy exists,
   `is_meaningful` exists, and exactly one of a dozen kinds is ever written
   (a substantive comment). Everything else the product could honestly observe
   goes unrecorded;
6. **any Learn surface at all** — the tab is a shell with a dead button.

Three new tables and three columns cover 1–4. Items 5 and 6 are wiring and
product, not schema.

---

## 1. EXISTS · REUSABLE

Everything below is built, tested and load-bearing. Phase 5 extends it and does
not duplicate it.

### 1.1 The content spine

| Object | What it already gives Phase 5 |
| --- | --- |
| `content_items` | One row per knowledge object, with **academic context already denormalised** (`university_id … subject_id`), container, visibility, counters, soft delete. `kind` ∈ post / reel / question / poll / resource / announcement / live. A `language` column exists and is **never populated** — free capacity. |
| `*_details` tables | `question_details` (title, `answer_count`, `accepted_comment_id`, `is_resolved`), `resource_details`, `poll_details`, `announcement_details`, `reel_details`. The Q&A shape the new direction wants is **already modelled** and unused by the API. |
| `content_topics` | `(content_id, topic_id, source, confidence)` — a **provenance-aware classification edge**. `source ∈ author \| ai \| moderator` was written in Phase 0 for exactly the reason Phase 5 now needs it. |
| `content_links` | `(from_content_id, to_kind, to_id, relation)`, `to_kind ∈ content \| lecture \| quiz \| group \| classroom \| topic \| study_session`. The knowledge-relation edge, already typed and indexed both ways. **Unused.** |
| `content_media`, `files` | Object-storage references with academic placement and signed-URL access. |
| `comments` | `is_accepted`, `parent_id`, counters. Answers-to-questions is already expressible. |

### 1.2 The academic hierarchy

`universities → colleges → programs → stages`, `academic_years`,
`courses → subjects → topics`, and **`topics.parent_topic_id`** for subtopics.
`course_enrollments` exists with a status. Every node carries `name_ar` and
`name_en`. Nothing about medicine or Baghdad appears outside the seed.

This is the taxonomy the new direction asks for. It does not need to be built.

### 1.3 The learning substrate — built in Phase 0, still empty

| Object | State |
| --- | --- |
| `learning_event_kinds` | 12 seeded kinds with a data-driven `is_meaningful` flag. The north-star definition is a **row, not a constant**. |
| `learning_events` | `(user, kind, course, topic, subject_ref_kind, subject_ref_id, value, metadata, occurred_at)`. Indexed for the north-star query. **One producer**: a substantive comment on academic content emits `academic_discussion_participated` from `comments.service`. Nothing else the product observes is recorded. |
| `learning_progress` | `(user, topic)` with `questions_seen/correct`, `weakness_score`, `confidence`. Deliberately named a *signal*. **Zero producers.** |
| `lecture_progress` | "Continue learning" state. Unused. |
| `quiz_*` | Question-level answers with `topic_id` per question — the granularity that makes topic performance possible. Unused. |
| `flashcard_*` | SM-2-shaped fields. Unused. |
| `classrooms`, `lectures`, `lecture_topics`, `materials`, `assignments` | Full structure. Unused. |
| `@sos/core/learning/weakness.ts` | `computeWeakness`, `rankWeakTopics`, with an explicit low-confidence band. Pure, unit-tested, **uncalled**. |

### 1.4 Interaction records that are already learning-signal inputs

| Object | Signal it can produce |
| --- | --- |
| `content_views` | One row per (user, content) with a repeat counter and a `completion` fraction — *did this student read this?* |
| `bookmarks` | With a `collection` column — saved knowledge, already foldered. |
| `reactions` | Five kinds: like, **helpful**, **insightful**, celebrate, curious. Two of those are quality judgements, not popularity. |
| `analytics_events` | Append-only telemetry, `name` + `properties`. |
| `domain_events` | The transactional outbox from the Phase 3 closure. |

### 1.5 Cross-cutting infrastructure

- **Authorization**: one policy layer (`@sos/core/policy`) with named, separate
  gates, applied identically by REST, feed and search. Any Phase 5 surface
  consumes it rather than adding a check.
- **Search**: pg_trgm over `*_norm` columns with justified Arabic normalisation
  (ADR-0009), permission-filtered in SQL.
- **Feed**: ranked keyset pagination with a SQL/TypeScript parity test.
- **i18n**: Arabic-primary catalogues, CLDR plurals, RTL verified by a
  232-check browser audit.
- **Events**: `emit()` inside the caller's transaction (ADR-0010), with
  `message.*`, `group.membership.*` and `content.*` kinds already defined.

---

## 2. MISSING

| # | Gap | Why it matters to the new direction |
| --- | --- | --- |
| M1 | **No knowledge-type axis.** `content_kind` is a *payload* discriminator (does it have a video? options? a file?). It cannot express that a post *is* an explanation, a summary, a study note, or a clinical case. | Without it the system cannot answer "show me explanations of this topic", and the classification pathway the direction requires has nowhere to land. |
| M2 | **No sources.** Nothing in the schema records where a claim came from. | Every statement is an author claim, and the AUTHOR CLAIM ↔ SOURCE-BACKED distinction the direction calls critical is not representable. |
| M3 | **No corrections.** `comments.is_accepted` marks a good answer; nothing marks a piece of knowledge as *corrected*. | COMMUNITY CORRECTION is the third provenance class, and it changes how a reader should trust content — a comment cannot carry that. |
| M4 | **No topic ↔ topic edges.** Only parent/child. | "Related concepts" and the first genuinely graph-shaped structure both need it. |
| M5 | **No educational metadata**: difficulty on content, exam relevance. (`difficulty_level` exists but only on quizzes.) | Deterministic filtering and later ranking need at least one difficulty axis. |
| M6 | **`content_items.language` is never written.** | A bilingual corpus cannot be filtered or ranked by language, and the Arabic/English split is the product's defining constraint. |
| M7 | **`learning_events` has one producer out of a dozen kinds.** Comments emit; saving, reading, answering, correcting and citing do not. | The north-star metric is uncomputable, `learning_progress` stays empty, and `computeWeakness` has nothing to weigh. The entire "signals accumulate" premise is currently inert. |
| M8 | **No topic surface, no Learn surfaces.** The Learn tab is a shell whose only control is `onPress: () => {}` — a dead button. | The direction names Topic as the most important navigation primitive; there is nowhere to navigate to. |
| M9 | **Only `kind: 'post'` is creatable.** The API has one `createPost`; question / resource / announcement are schema-only. | The classification pathway has to start at authoring. |

---

## 3. CONFLICTING

These are places where what exists actively pulls against the new direction. All
four are worth naming; not all four need fixing in Phase 5.

### C1 — The feed ranks on engagement · **must be addressed**

`FEED_WEIGHTS` includes `engagement`, applied in SQL as
`ln(1 + like_count + comment_count * 2)`. That is a popularity term, and the
direction states plainly that popularity must not be a primary ranking signal.

It is not the *largest* weight — cohort, enrolled-course and weak-topic terms
already exist — but it is currently the only term with any data behind it,
because the academic terms depend on `learning_progress` and `profile_interests`
that nothing populates. **In practice the feed today ranks mostly on
popularity and recency.** Fixing this is a Phase 5 dependency, not a nicety.

### C2 — `reel` and `live` are first-class content kinds · **leave alone**

`content_kind` includes both, and `learning_event_kinds` seeds `reel_viewed` and
`reel_completed`. The direction says reels are not a core primitive.

The enum values cost nothing and are unused; removing them would be a migration
with no benefit. But the **feed's `academicKind` bonus currently rewards
`reel`**, which is a real (if dormant) nudge toward the product we are defining
ourselves against. That one list is worth correcting.

### C3 — Three event channels, no written distinction · **must be documented**

`analytics_events`, `learning_events` and `domain_events` all exist and are
genuinely different things, but nothing in the repository says so, and the next
person adding an event has no rule to follow. The direction explicitly asks for
a principled A/B/C/D/E separation. Four of the five channels already exist —
what is missing is the statement of which is which, and one new channel for
quality/correction signals.

### C4 — `content_topics.source` allows `'ai'` · **keep, and honour it**

Written in Phase 0. There is no AI, so nothing sets it. This is not a conflict
to remove: it is exactly the FUTURE MODEL-DERIVED provenance class the direction
requires, already reserved. Phase 5 must make sure the *reader* can tell the
difference, rather than silently treating an AI tag as an author tag.

---

## 4. SHOULD BE DEFERRED

Explicitly out of Phase 5, with the reason rather than a shrug.

| Deferred | Why |
| --- | --- |
| LLM, AI API, embeddings, vector DB, semantic search | Directed out, and correctly: none of them can be evaluated until there is structured data to retrieve over. Building retrieval before the corpus is building the roof first. |
| Recommendation engine | Needs signals that do not exist yet. Phase 5 produces the signals; ranking on them comes after there is enough data to tell a good ranking from a bad one. |
| A stored "quality score" | The direction warns against inventing a confidence number, and it is right. Quality in Phase 5 is **derived at read time from facts** (does it cite a source? was an answer accepted? is there an accepted correction? how many *distinct* readers marked it helpful?) — never a stored opaque float. |
| Quizzes, flashcards, assignments, live sessions | Tables exist; surfacing them is Phases 7+. Phase 5 does not need them to prove the substrate. |
| Classrooms as a full experience | The container exists. Phase 5 uses **Topic** as the navigation primitive because the direction names it as such; classrooms follow. |
| Notifications UI | Phase 8. The outbox already accumulates events. |
| Reels, any video surface | Directed out. |
| A knowledge-graph visualisation | The edges must exist and be trusted before anything draws them. |

---

## 5. The five interaction channels, separated

The direction asks for a principled distinction rather than one generic event
table. Here is the rule, with what already implements it:

| # | Channel | Question it answers | Store | Status |
| --- | --- | --- | --- | --- |
| **A** | Social interaction | Who relates to whom? | `follows`, `blocks`, `mutes`, `reactions(like, celebrate, curious)` | exists |
| **B** | Content interaction | Did this person encounter this object? | `content_views`, `bookmarks` | exists |
| **C** | Learning interaction | Did something happen that plausibly advanced learning? | `learning_events` (+ `is_meaningful`) | exists · **one producer of twelve kinds** |
| **D** | Quality / correction | Is this knowledge *good*, and who says so? | `reactions(helpful, insightful)`, `comments.is_accepted`, **`content_corrections` (new)**, **`content_sources` (new)** | partly missing |
| **E** | System telemetry | What did the software do? | `analytics_events` | exists |

Two rules that keep them apart, and that Phase 5 will enforce in code review:

1. **A view is not a learning event.** Opening a post is channel B. It becomes
   channel C only when a rule says so — and that rule lives in
   `learning_event_kinds`, as data.
2. **A learning event is never written outside the transaction that caused it.**
   Same discipline as the outbox: a signal describing a write that rolled back
   is worse than no signal, because it is silently wrong.

`domain_events` is orthogonal to all five: it is a *delivery* mechanism, not an
observation.

---

## 6. Proposed Phase 5 domain model

Three tables and three columns. Every one justified below; anything I could not
justify is in §4.

### 6.1 `content_items.knowledge_type` — the academic intent axis

```sql
CREATE TYPE knowledge_type AS ENUM (
  'question', 'explanation', 'summary', 'note',
  'case', 'resource', 'reference', 'correction', 'discussion'
);
ALTER TABLE content_items ADD COLUMN knowledge_type knowledge_type;
```

**Why a second axis rather than extending `content_kind`.** They answer
different questions and cross each other:

|  | `content_kind` (exists) | `knowledge_type` (new) |
| --- | --- | --- |
| Answers | *How does this render?* Does it have a video, options, a file? | *What is this, academically?* |
| Consumed by | the client's card renderer, the `*_details` join | search filters, topic pages, ranking, future retrieval |
| Example | a `post` | that is an `explanation` — or a `case`, or a `correction` |

A clinical case and a summary are both `kind = 'post'` and are not the same
knowledge. Collapsing them would mean the taxonomy could never distinguish them
without a migration.

Nullable, because Phase 2 content predates it and backfilling a guess would
manufacture data. Unclassified content still works everywhere; it simply cannot
be filtered by type.

### 6.2 `content_items.difficulty` and a populated `language`

```sql
ALTER TABLE content_items ADD COLUMN difficulty difficulty_level;  -- existing enum
-- language: the column already exists; Phase 5 populates it.
```

`difficulty_level` (`easy|medium|hard`) already exists for quizzes — reused, not
redefined. `language` is derived **deterministically** from the body's script
distribution (Arabic codepoints vs Latin, with a `mixed` outcome), computed in
`@sos/core` so it is pure and testable, and stored. No detection library, no
model, no guessing that cannot be explained.

### 6.3 `content_sources` — provenance

```sql
CREATE TABLE content_sources (
  id          uuid PRIMARY KEY,
  content_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  kind        source_kind NOT NULL,   -- textbook | lecture | guideline | paper | website | other
  citation    text NOT NULL,          -- what a reader would look up
  url         text,
  file_id     uuid REFERENCES files(id),
  page_ref    text,                   -- "p. 412", "§3.2", "slide 14"
  added_by    uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

**Why it exists.** This is the entire AUTHOR CLAIM → SOURCE-BACKED distinction.
Without it there is no honest way to say one explanation is better founded than
another, and every later quality or trust computation would have to invent a
number instead of citing a fact.

**Why a table and not a text field.** A source is looked *up*: by content (what
backs this?), by url or file (what else cites this?), and later by topic (what
is this topic's canonical reading?). A free-text field answers only the first.

**Why `added_by` is separate from the content's author.** A classmate adding the
reference for someone else's explanation is a community contribution, and the
provenance record should say who made the claim about the source.

### 6.4 `content_corrections` — community correction as a relationship

```sql
CREATE TABLE content_corrections (
  id           uuid PRIMARY KEY,
  content_id   uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  proposed_by  uuid NOT NULL REFERENCES users(id),
  body         text NOT NULL,              -- what is wrong, and what is right
  source_id    uuid REFERENCES content_sources(id),  -- optional backing
  status       correction_status NOT NULL DEFAULT 'proposed',  -- proposed|accepted|rejected|withdrawn
  resolved_by  uuid REFERENCES users(id),  -- the ORIGINAL author, or a moderator
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

**Why not a comment.** Three reasons, and each alone would be enough:

1. A comment is a conversation turn; a correction is a **claim about the
   content's accuracy** that a future reader must see whether or not they read
   the thread.
2. A correction has a **lifecycle** — proposed, then accepted or rejected by the
   author. Comments have no such state, and `is_accepted` already means
   something else (this answer resolved this question).
3. An accepted correction should change how the content is presented and ranked.
   Deriving that from comment text is not possible without reading the text.

**Who may accept.** The content's author, or a moderator of its container.
Reusing `canDeleteContent`'s existing rank logic — no new authorization concept.

### 6.5 `topic_relations` — the first graph edge

```sql
CREATE TABLE topic_relations (
  from_topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  to_topic_id   uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relation      topic_relation NOT NULL,   -- related | prerequisite_of | part_of
  source        text NOT NULL,             -- curated | derived
  strength      real,                      -- derived edges only: co-tag frequency
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_topic_id, to_topic_id, relation)
);
```

**Why it exists.** `topics.parent_topic_id` gives a tree. Knowledge is not a
tree: neonatal jaundice relates to haemolysis, which sits under a different
subject entirely. "Related topics" on a topic page is the direction's own
example, and it needs an edge.

**Why `source` is on the row.** A curated edge (an instructor says X is a
prerequisite of Y) and a derived edge (X and Y are tagged together on 40 posts)
are different claims with different trust. Merging them would make the graph
unauditable — and this is precisely the SYSTEM-DERIVED provenance class.

**How derived edges are produced in Phase 5: deterministically.** A refresh
computes co-tag counts from `content_topics` and writes edges above a threshold.
No model, no embedding — arithmetic over data the community already produced.
This is the "intelligence without AI" the direction asks for, and it is
explainable to a student: *these appear together in your cohort's notes.*

### 6.6 What Phase 5 adds with **no** new table

- **Learning-event producers**, through the existing `recordLearningEvent`
  rather than a second insert path. `content_views`, `bookmarks`, accepted answers,
  accepted corrections and topic revisits emit into `learning_events` inside the
  transaction that caused them, using the existing data-driven taxonomy. Two new
  kinds are added as *rows*, not schema: `knowledge_saved`,
  `correction_accepted`.
- **`learning_progress` gets a writer** from question/answer activity, feeding
  the already-tested `computeWeakness`.
- **Quality, derived at read time** from `content_sources` count, accepted
  corrections, accepted-answer status, and distinct `helpful`/`insightful`
  reactors. Never stored, never opaque.
- **Q&A**, using `question_details` and `comments.is_accepted` as they already
  exist.

---

## 7. Boundaries

### Phase 5 WILL build

1. `knowledge_type`, `difficulty`, and a deterministically-derived `language` on
   the content spine, with authoring and filtering.
2. `content_sources` — add, list, and show provenance on content.
3. `content_corrections` — propose, accept, reject; visible on the content.
4. `topic_relations` — the table, a deterministic co-tag refresh, and related
   topics on the topic page.
5. **Topic as a navigation primitive**: a topic screen with overview, knowledge
   filtered by type, related topics, and its place in the hierarchy.
6. **Learning-signal producers** into `learning_events` and `learning_progress`.
7. A **Learn** surface that is real rather than a shell: my topics, saved
   knowledge, and continue-where-I-left-off — built only from signals that
   actually exist.
8. Question and resource authoring, so the classification pathway starts where
   content is created.
9. Deterministic search and feed filters over the new metadata.
10. A ranking correction: academic relevance ahead of engagement (C1).

### Phase 5 will NOT build

LLM · AI API · embeddings · vector database · semantic search · recommendation
engine · autonomous agent · stored quality scores · notifications UI · quizzes ·
flashcards · assignments · live sessions · classroom experience · reels or any
video surface · knowledge-graph visualisation · a second event table.

### Phase 5 will not touch

Messaging (Phase 4) in any behavioural way. The only shared surface is
`learning_events`, which messaging does not write to.

---

## 8. Exit criteria

Phase 5 is complete when a student can:

1. publish an explanation, classify it by knowledge type, topic and difficulty,
   and attach a source;
2. open a **topic** and see that knowledge, filtered by type, alongside related
   topics — through permission-filtered queries, in Arabic and English;
3. propose a correction to someone else's content, and have the author accept
   it, with the correction visible to every later reader;
4. save knowledge and find it again from the Learn surface;
5. and, having done those things, have the system hold **real learning signals**
   — `learning_events` rows with `is_meaningful` set, and `learning_progress`
   with a computed weakness score — where before it held none;

with every one of those steps refusing content the student may not see, proven
by a test at the API, feed and search level, and verified in a real browser in
both languages at both viewports.

---

## 9. Outcome — written after implementation

Recorded here rather than in a separate document, because an audit that
predicts and never reconciles is a plan, not an audit.

### Against the exit criteria

| # | Criterion | Where it is proven |
| --- | --- | --- |
| 1 | Publish, classify, cite | `knowledge.integration.test.ts`; `smoke.mjs` "a post carries the knowledge type it was given", "a classmate can cite someone else's explanation" |
| 2 | Topic as a place, filtered, permission-safe, bilingual | `topics.repository.knowledgeCounts` runs the feed's predicate verbatim; `rtl-audit.mjs` renders `/topic/:id` in ar and en at both viewports |
| 3 | Correction proposed, accepted, visible to later readers | `smoke.mjs` "an accepted correction changes the provenance"; the author is refused correcting their own content |
| 4 | Save, and find it again in Learn | `smoke.mjs` "saved knowledge is counted"; `/v1/learn` builds `savedCount` from `bookmarks` |
| 5 | Real learning signals where there were none | `smoke.mjs` "meaningful learning actions are counted", read through the `is_meaningful` join rather than a constant |

### What changed from the plan

Three things came out differently from the audit as first written, and are
corrected above rather than left to disagree with the code:

- **`learning_events` was not producerless.** The audit claimed zero producers.
  `recordLearningEvent` already existed in `analytics/events.service.ts` and was
  already called from `comments.service.ts`. The fix was to make
  `signals.service.record` **delegate** to it rather than add a second insert
  path — the opposite of what a "there is nothing here" reading would have
  produced, and the reason to check before building.
- **Phase 5 re-scoped itself.** It was sequenced as classrooms and lectures. The
  audit's own finding — that the schema is already knowledge-shaped but nothing
  classifies anything — meant rooms built first would have been rooms full of
  unclassified content. Classrooms move to 5b with their scope unchanged.
- **The composer asks for two fields, not four.** Topic and language were both
  planned as inputs. Language is derived from the body instead, and topics are
  left to the existing `topicIds` path: asking a student four questions before
  they can post is how a classification layer becomes a reason not to post.

### What was deferred, and is still deferred

Nothing from §4 was pulled forward. In particular there is no embedding, no
vector store, no recommendation engine and no model call anywhere in this phase.
`content_topics.source = 'ai'` and `topic_relations.source = 'derived'` exist and
are carried to the client — so the day a classifier ships, the UI already knows
how to say who classified what, and the merge that could never be undone never
happens.

### One regression, and what caused it

Five pre-existing integration tests went red mid-phase. The cause was not the
knowledge layer: `readFeed` in the test helpers requested the **ranked** feed at
`limit=20`, and the new classified fixtures ranked above the probes the older
tests were looking for. The fix was to default the helper to
`?scope=recent&limit=50`. Both scopes run the identical permission predicate, so
no test lost the security property it was written to assert — but it is worth
recording that a ranking change can break tests that are not about ranking.
