# Data Model

> Constitution §89.C. The **migrations are the source of truth**
> (`apps/api/migrations/*.sql`); this document explains the decisions behind
> them. 78 tables across seven migrations.

## 1. Conventions

| Convention | Rule |
| --- | --- |
| Primary keys | `uuid` + `gen_random_uuid()`. Sequential ids leak volume and enable enumeration. Exceptions: `audit_log`, `analytics_events` use `bigserial` (append-only, never exposed). |
| Time | `timestamptz` everywhere. No naive timestamps. |
| Deletion | Soft (`deleted_at`) for anything a user authored; hard for join rows. |
| Naming | `snake_case` in SQL, `camelCase` at the API boundary, translated in repositories. |
| Enums | Postgres enums for closed vocabularies; reference tables where the set must change without a migration (`learning_event_kinds`). |
| Bilingual | `name_ar` + `name_en` on every academic entity. The server never guesses locale. |

## 2. The three graphs, as tables

```
SOCIAL          users · profiles · follows · blocks · mutes
                communities · community_members · groups · group_members
                conversations · conversation_members · messages

CONTENT         content_items ─┬─ post/reel/question/poll/resource/announcement details
                               ├─ content_media · content_topics · content_links
                               └─ comments · reactions · bookmarks

ACADEMIC        universities → colleges → programs → stages
                academic_years · courses → subjects → topics
                course_enrollments · classrooms · classroom_members
                lectures · materials · assignments · quizzes

LEARNING        learning_events · learning_event_kinds
                learning_progress · lecture_progress
                quiz_attempts · quiz_answers · flashcard_progress

AI              ai_sessions · ai_messages · ai_sources · ai_usage_daily

PLATFORM        files · notifications · notification_preferences · push_tokens
                reports · moderation_actions · audit_log · analytics_events
                sessions · privacy_settings · user_presence
```

## 3. The decisions worth defending

### 3.1 `content_items` — one spine, not six tables

Post, reel, question, poll, resource, announcement and live all share:
author, academic context, container, visibility, counters, timestamps. They
differ only in payload.

Modelling them as one spine plus `*_details` tables buys three things that
separate tables cannot:

1. **The feed is one indexed query.** Six tables would mean a `UNION ALL` of
   six differently-shaped selects, re-sorted in memory, paginated
   approximately.
2. **Real foreign keys on interactions.** `reactions`, `comments`,
   `bookmarks`, `reports` and `content_topics` all reference `content_items(id)`.
   The alternative — a `(target_type, target_id)` pair — cannot have a foreign
   key at all, so orphaned rows are a matter of time.
3. **One definition of visibility.** The permission filter is written once. Six
   tables means six copies of the filter, and the fifth copy is where the leak
   is.

The cost is that a query for one kind carries a `kind = 'reel'` predicate and a
join to a details table. That is a cheap, indexed cost.

### 3.2 Academic context is denormalised onto content — on purpose

`content_items` carries `university_id … subject_id` rather than deriving them
from the author's current profile. A student who moves from stage 4 to stage 5
must not retroactively drag last year's posts into this year's cohort feed.
**Content keeps the context it was published into.**

### 3.3 Containers are hard boundaries

`content_items` allows at most one of `community_id`, `group_id`,
`classroom_id` (CHECK constraint). The policy layer treats group and classroom
membership as a gate that a broader `visibility` value cannot open. Communities
are softer because they are discovery surfaces.

### 3.4 Exactly-one-target CHECKs instead of polymorphic ids

`reactions` (content / comment / message) and `reports` (seven target types)
use nullable foreign keys plus a CHECK that exactly one is set. Verbose, and
worth it: referential integrity survives, and a deleted post cannot leave live
reports pointing at nothing.

### 3.5 Messaging: `seq`, `client_message_id`, `last_read_seq`

Three columns carry the entire delivery contract:

| Column | Guarantees |
| --- | --- |
| `messages.seq` (unique per conversation) | ordering and gap replay after reconnect |
| `messages.client_message_id` (unique per conversation) | idempotent retries — a dropped response cannot duplicate a message |
| `conversation_members.last_read_seq` | read receipts **and** unread counts, derived not stored |

`conversations.last_seq` is the row locked to allocate the next `seq`, which
also serialises concurrent writes to one conversation.

### 3.6 Question-level quiz results

`quiz_answers` is keyed `(attempt_id, question_id)` and `quiz_questions` carries
`topic_id`. A stored final score would make weakness detection, topic
performance and personalised review impossible to add later without a data
backfill that has no source data.

### 3.7 Learning events are data-driven

`learning_event_kinds.is_meaningful` defines the north-star metric (§84) as a
row, not a code constant. Changing what counts as a meaningful learning action
is an `UPDATE`, not a deploy.

### 3.8 Flashcards ship SM-2-shaped

`flashcard_progress` carries `ease_factor`, `interval_days`, `repetitions`,
`due_at` even though V1 only records seen/correct/incorrect. Spaced repetition
becomes a code change instead of a migration on a live table.

### 3.9 AI auditability exists before AI does

`ai_sessions`, `ai_messages`, `ai_sources`, `ai_usage_daily` are in Phase 0,
before a single model call ships. A row in `ai_sources` is *proof* a source was
retrieved and passed to the model — that is what makes the citation validator
able to reject a fabricated reference (§28) rather than merely discourage one.

### 3.10 Files carry an academic context

Added in `0007`. `canAccessFile` decides from the file's placement, but the
original `files` table had only an owner and a visibility — so a `stage`-visible
attachment had no stage to compare against and the policy could only answer
"owner or nobody". Denormalised at upload time, for the same reason content is.

`attached_at` marks the moment an upload is claimed by a post. Until then it is
owner-only, which means an upload that is never posted never becomes readable,
and orphaned uploads are cheap to find and sweep.

### 3.11 `content_views` is one row per viewer, not per impression

The feed's seen-penalty needs "has *this* student seen it?", which the aggregate
`view_count` cannot answer. An append-only impression log would be the
fastest-growing table in the product for no V1 benefit, so the table holds one
row per (user, content) with a repeat counter. `content_items.view_count` is
incremented only on the first view, so it stays a distinct-viewer count rather
than a refresh counter.

### 3.12 Sessions store hashes, never tokens

`sessions.token_hash` holds SHA-256 of an opaque refresh token.
`rotated_to_id` makes reuse of a rotated token detectable, which is the
mechanism behind the theft-detection path in `auth.service.ts`.

## 4. Indexing

Indexes are added for a named query, not by reflex. The load-bearing ones:

| Index | Query it exists for |
| --- | --- |
| `content_items_cohort_feed_idx (college_id, stage_id, created_at DESC) WHERE deleted_at IS NULL` | the cohort feed — the hottest read in the product |
| `profiles_cohort_idx (college_id, stage_id)` | "everyone in my cohort": member lists, suggestions, scope checks |
| `messages_seq_uniq (conversation_id, seq)` | ordering **and** gap replay |
| `messages_client_id_uniq (conversation_id, client_message_id)` | send idempotency |
| `notifications_unread_idx (user_id, created_at DESC) WHERE read_at IS NULL` | the unread badge, polled constantly |
| `learning_progress_weak_idx (user_id, weakness_score DESC NULLS LAST)` | the weak-topics surface |
| `quiz_attempts_one_active … WHERE status = 'in_progress'` | enforces one live attempt per quiz per user |
| `academic_years_one_current … WHERE is_current` | enforces one current year per university |

Partial indexes (`WHERE deleted_at IS NULL`) are used throughout: the vast
majority of reads exclude deleted rows, and there is no reason to index them.

## 5. Integrity enforced in the database

Constraints that the application must not be trusted to uphold alone:

- `content_items_single_container` — at most one container
- `reactions_exactly_one_target`, `reports_exactly_one_target`
- `learning_progress` — `questions_correct <= questions_seen`
- `quiz_attempts` — `score <= max_score`
- `profiles_handle_format` — `^[a-z0-9_]{3,30}$`, matching the Zod schema
- `follows_no_self`, `blocks_no_self`
- `communities_has_scope` — a community must sit somewhere in the hierarchy
- `materials_has_target` / `resource_has_target` — a resource must point at
  either a file or a URL

## 6. What is reserved but not built

Present in schema, unused in Phase 0, so that the feature is a code change:
`files.scan_status` (malware scanning), `live_sessions.recording_ref` and
`transcript_file_id` (post-live AI pipeline), `quizzes.origin` /
`flashcard_decks.origin` (AI provenance), `content_links` (the "what next?"
graph), `institutions`-shaped verification via `users.verification_level`.
