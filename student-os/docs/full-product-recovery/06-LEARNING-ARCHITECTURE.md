# 06 — Learning Architecture: learning and practice readiness

**Source of truth.** Every status claim below is taken from the Phase A forensic evidence file
(area `learning`, with supporting entries from areas `api` and `routes`). Where this document
departs from that evidence, it says so explicitly and cites the repository line that disproves the
audit note. Where the audit is silent, this document says "not established by the audit" rather
than filling the gap.

**Path convention.** File paths are given as the evidence gives them, relative to the `student-os`
repository root (e.g. `apps/api/src/...` means
`/home/user/ahmed-workspace/student-os/apps/api/src/...`).

**Status vocabulary.** `CONNECTED_AND_WORKING`, `BACKEND_ONLY`, `FRONTEND_ONLY`, `PARTIAL`,
`BLOCKED_BY_EXTERNAL_SERVICE`, `BLOCKED_BY_DEPLOYMENT`, `BLOCKED_BY_PRODUCT_DECISION`, `MISSING`,
`DEAD_CODE`, `PREVIEW_ONLY`.

---

## 1. Summary of findings

| Capability | Status | Anchor citation |
| --- | --- | --- |
| Topics hierarchy browsing (Topics tab) | CONNECTED_AND_WORKING | `apps/mobile/app/(tabs)/topics.tsx:44-49`; `apps/api/src/modules/academic/academic.routes.ts:94,111,124` |
| Topic detail (progress, `canPractice`, knowledge list) | CONNECTED_AND_WORKING | `apps/mobile/app/topic/[id].tsx:45-48`; `apps/api/src/modules/knowledge/knowledge.routes.ts:201-241` |
| Practice session start (question fetch) | CONNECTED_AND_WORKING | `apps/api/src/modules/learning/practice.routes.ts:33-52`; `apps/api/src/http/app.ts:139` |
| Practice answer submit (verdict / explanation / evidence) | CONNECTED_AND_WORKING | `apps/api/src/modules/learning/practice.routes.ts:54-76`; `apps/api/src/modules/learning/practice.service.ts:173-320` |
| Progress and weakness rollup (`learning_progress`) | CONNECTED_AND_WORKING | `apps/api/src/modules/learning/signals.service.ts:145-158`; `packages/core/src/learning/weakness.ts:46-65` |
| Learning events taxonomy | CONNECTED_AND_WORKING | `apps/api/migrations/0005_learning.sql:375-410`; `apps/api/src/modules/learning/signals.service.ts:48-101` |
| Saved-items loop (save → signal → read back) | PARTIAL in the audit; the read-back half is now present in the repository (§8) | `apps/api/src/modules/content/content.service.ts:558-589`; `apps/mobile/app/saved.tsx:32` |
| Learn tab `meaningfulActionsThisWeek` | BACKEND_ONLY (computed, contracted, never rendered) | `apps/api/src/modules/knowledge/topics.service.ts:150,185`; `packages/contracts/src/knowledge/knowledge.contract.ts:239` |
| Spaced repetition / review queues | MISSING (dormant schema; documented refusal) | `apps/api/migrations/0005_learning.sql:279-295`; `docs/design-handoff/FINAL-FREEZE.md:127` |
| **Practice question supply (quiz authoring)** | **MISSING — no authoring route exists anywhere** | `apps/api/scripts/seed-demo.ts:169-225`; `apps/api/src/modules/learning/practice.repository.ts:27-33` |
| Profile contribution score | PARTIAL (display wired, value is a DDL constant) | `apps/api/migrations/0002_academic_hierarchy.sql:178,188` |
| Preview-mode parity for the learning surface | PREVIEW_ONLY | `apps/mobile/src/preview/preview-mode.ts:40-48`; `apps/mobile/src/preview/fixture-transport.ts:136-156` |

The one-line reading: **the learning machinery is built and connected; the learning content is
not.** Every mechanism from browsing a topic to grading an answer to re-ranking the feed is wired
end to end and covered by an integration suite. What does not exist is any in-product way to put a
question in front of a student, and that is a product decision the owner has to make rather than a
defect an engineer can close.

---

## 2. The topics hierarchy

Status: **CONNECTED_AND_WORKING**.

The Topics tab loads the courses for the signed-in student's stage and then the topics inside each
course, grouping topics per course and pushing each row to the topic detail screen
(`apps/mobile/app/(tabs)/topics.tsx:44-49`, row navigation at
`apps/mobile/app/(tabs)/topics.tsx:128`). The backing routes are the academic reference-data reads
`GET /v1/academic/courses` and `GET /v1/academic/topics?courseId=`
(`apps/api/src/modules/academic/academic.routes.ts:94,111,124`), mounted under `/v1/academic` in the
single Fastify app (`apps/api/src/http/app.ts:130`).

The academic surface is eight GET routes, all deliberately public because the pre-authentication
onboarding wizard consumes them (`apps/api/src/modules/academic/academic.routes.ts:29,41,54,67,80,93,110,123`).
The hierarchy tables — universities, colleges, programs, stages, academic years, courses, subjects,
topics — come from `apps/api/migrations/0002_academic_hierarchy.sql:20-243`. Two of those routes,
`/academic-years` and `/courses/:courseId/subjects`, have no client caller; the audit records them
as unused but harmless reads (area `api`, academic hierarchy finding).

The Topics tab is a pure browse surface. Evidence and progress deliberately live on the Learn tab
rather than here (`app/(tabs)/topics.tsx:44-48,128`, area `routes`).

---

## 3. Topic detail

Status: **CONNECTED_AND_WORKING**.

The topic screen issues two reads in parallel, `GET /v1/topics/:id` and
`GET /v1/topics/:id/knowledge` (`apps/mobile/app/topic/[id].tsx:45-48`), served by
`apps/api/src/modules/knowledge/knowledge.routes.ts:201-241`. The service assembles the viewer's own
progress and the `canPractice` flag (`apps/api/src/modules/knowledge/topics.service.ts:41-96`), with
viewer progress read from `learning_progress`
(`apps/api/src/modules/knowledge/topics.repository.ts:158-181`) and the knowledge list filtered by
the verbatim feed permission predicate (`apps/api/src/modules/knowledge/topics.repository.ts:92-155`).

Two properties are worth recording because they are the kind of thing that usually rots:

- **The Practise button cannot disagree with the route behind it.** `canPractice` is computed by
  `hasPracticableQuestions` (`apps/api/src/modules/learning/practice.repository.ts:97-116`), which
  uses the same SQL predicate the practice route itself uses. The client only renders the Practise
  action when the flag is true (`apps/mobile/app/topic/[id].tsx:117-137`).
- **The screen refetches on focus**, so returning from a practice session shows fresh counts rather
  than the numbers the student left behind (`apps/mobile/app/topic/[id].tsx:60-65`).

The topic screen is reachable from the Topics tab, the Learn tab, profile interest badges, lecture
topic rows, post-card topic chips, and the practice screen's exit
(`app/topic/[id].tsx:45-50,97,134,203`, area `routes`).

---

## 4. The practice loop, end to end

### 4.1 Opening an attempt

Status: **CONNECTED_AND_WORKING**.

`POST /v1/topics/:topicId/practice` (`apps/api/src/modules/learning/practice.routes.ts:33-52`,
registered at `apps/api/src/http/app.ts:139`) opens or resumes an attempt. The method is
deliberately POST rather than GET because the call has an effect: it creates or resumes attempt
state. `startSession` performs the attempt upsert, emits the `quiz_started` signal, and returns the
question set (`apps/api/src/modules/learning/practice.service.ts:97-151`). Resumption is enforced by
a partial unique index — a second tap resumes the same attempt rather than starting a parallel one
(`apps/api/src/modules/learning/practice.repository.ts:137-168`, against the
`quiz_attempts_one_active` index).

The answer key never leaves the server at this stage: the SQL projection for session questions omits
`is_correct` entirely (`apps/api/src/modules/learning/practice.repository.ts:187-214`).

Attempts are pinned to their topic (`apps/api/migrations/0014_practice_topic.sql:24-25`), which makes
cross-topic grading structurally impossible rather than merely unlikely.

If no published quiz in an enrolled course covers the topic, the route returns 404 and the client
maps that to an empty state rather than an error
(`apps/mobile/app/practice/[topicId].tsx:85,182-192`). This is the graceful edge of the content
problem described in §10.

### 4.2 Server-side grading, verdict, explanation and evidence

Status: **CONNECTED_AND_WORKING**.

`POST /v1/practice/attempts/:attemptId/answers`
(`apps/api/src/modules/learning/practice.routes.ts:54-76`) runs the whole submission as one
transaction: lock, grade, insert once, roll up, close
(`apps/api/src/modules/learning/practice.service.ts:173-320`).

- **Correctness is decided in exactly one place.** `gradeSelection` in the shared core package is the
  only correctness decider (`packages/core/src/learning/grading.ts:51-80`). The client never sends a
  verdict, and the integration suite asserts that a client-declared verdict is ignored
  (`apps/api/test/practice.integration.test.ts:135-1063`).
- **Idempotency is enforced by the database**, not by application care: `insertAnswerOnce` uses
  `ON CONFLICT DO NOTHING` against the `(attempt_id, question_id)` primary key
  (`apps/api/src/modules/learning/practice.repository.ts:316-341`). Retries — including the retry of
  a final answer after the attempt has closed — return the stored verdict and move nothing
  (`apps/api/src/modules/learning/practice.service.ts:215-254`).
- **The response carries the teaching payload**: `isCorrect`, `correctOptionIds`, `explanation`,
  `alreadyAnswered`, `attemptCompleted` and before/after progress
  (`packages/contracts/src/learning/practice.contract.ts:99-123`). The client renders the explanation
  and the before/after evidence in a feedback panel
  (`apps/mobile/app/practice/[topicId].tsx:306-324`) and an evidence delta on completion
  (`apps/mobile/app/practice/[topicId].tsx:223-228`).
- **The attempt closes itself** when the topic's question set is answered, emitting the meaningful
  `quiz_completed` event once (`apps/api/src/modules/learning/practice.service.ts:367-388`).

The mobile screen implements the documented state machine as a full-screen modal with the tab bar
unmounted (`apps/mobile/app/practice/[topicId].tsx:22-49,160`;
`apps/mobile/app/_layout.tsx:111-114`), forbidding double submission and answer changes after the
reveal. It exits by replacing to the topic screen (`apps/mobile/app/practice/[topicId].tsx:160`).

Short-answer questions are filtered out in SQL rather than in the client, on the stated ground that a
question the server would refuse to grade must never appear in a session
(`apps/api/src/modules/learning/practice.repository.ts:27-33` and the surrounding comment).

### 4.3 Progress and weakness rollup

Status: **CONNECTED_AND_WORKING**.

On a genuine insert — and only then — the service touches topic progress, recomputes weakness and
stores it (`apps/api/src/modules/learning/practice.service.ts:264-288`). The single writer of
`learning_progress` is `signals.service.ts:145-158`; the table and its weakness index come from
`apps/api/migrations/0005_learning.sql:414-434`.

The weakness formula lives once, in the shared core:
`0.7 × inaccuracy + 0.3 × staleness`, with confidence expressed as `seen / 20` and a
`MIN_QUESTIONS_FOR_CONFIDENCE` of 5 (`packages/core/src/learning/weakness.ts:46-65`, constant at
line 30). Services write back what the function returns and re-derive display values from raw
counts, so a stale stored score cannot misreport to the student
(`apps/api/src/modules/knowledge/topics.service.ts:149-187`).

Three consumers are live:

1. Learn tab focus topics, ordered by the stored weakness score
   (`apps/api/src/modules/knowledge/topics.repository.ts:259-277`;
   `apps/mobile/app/(tabs)/learn.tsx:79-121,157-219`, where low-confidence topics render as a dashed
   group and the grouping comes from the server's `lowConfidence`, never from client-side maths).
2. The topic page's viewer progress block (§3).
3. The feed ranking's weak-topic boost — a `matches_weak_topic` term with a threshold of
   `weakness_score >= 0.5` (`apps/api/src/modules/content/feed.sql.ts:372-376` and `:121`).

The audit records a deliberate negative property, asserted by test: social engagement does not move a
topic's learning signal. Commenting, liking and saving never touch `learning_progress`
(`apps/api/test/practice.integration.test.ts:1062-1063`).

---

## 5. The learning events taxonomy

Status: **CONNECTED_AND_WORKING**.

The taxonomy is a reference table plus an events table
(`apps/api/migrations/0005_learning.sql:375-410`), with `practice_question_answered` seeded as
`is_meaningful = false` in a later migration (`apps/api/migrations/0013_practice.sql:43-45`). Signals
are written through one typed union and one insert path
(`apps/api/src/modules/learning/signals.service.ts:48-101`), and the events service throws rather
than swallowing a failure, so a learning record cannot silently drop
(`apps/api/src/modules/analytics/events.service.ts:46-72`).

Producers, as recorded by the audit:

| Signal | Producer | Meaningful? |
| --- | --- | --- |
| `quiz_started` | `practice.service.ts:114-123` | see reference table |
| `practice_question_answered` | `practice.service.ts:290-298` | no (`0013_practice.sql:43-45`) |
| `quiz_completed` | `practice.service.ts:378-386` | yes |
| `knowledge_saved` | `content.service.ts:579-584` | see reference table |
| `knowledge_opened` | `content.service.ts:619-623` | deliberately not meaningful |

The consumer is `countMeaningfulActions`, which joins `is_meaningful` from the reference table rather
than hard-coding a list (`apps/api/src/modules/knowledge/topics.repository.ts:314-328`). The design
property the audit highlights is that "meaningful" is data, not code: it is a row you can change,
and the split prevents metric inflation by tapping. Signals are always written inside the
transaction of the action they describe.

---

## 6. The Learn tab

Status: **CONNECTED_AND_WORKING** for the focus-topic surface it renders.

The Learn tab loads `/v1/learn` on every focus, precisely so that returning from Practice shows
fresh evidence (`apps/mobile/app/(tabs)/learn.tsx:45,56-61`). It pushes to
`/practice/[topicId]` from the ink band (`:162`), to `/topic/[id]` from topic rows (`:99,191`), and
carries a permanent row to `/classrooms` (`:227`). The backing route is
`GET /v1/learn` (`apps/api/src/modules/knowledge/knowledge.routes.ts:245`), assembled in
`apps/api/src/modules/knowledge/topics.service.ts:149-187`.

### 6.1 Fetched-but-unrendered payload fields

The `/v1/learn` payload carries two counters beyond the focus topics:

- `savedCount` (`packages/contracts/src/knowledge/knowledge.contract.ts:237`, computed via
  `countBookmarks` at `apps/api/src/modules/knowledge/topics.repository.ts:297-304` and mapped at
  `topics.service.ts:150,184`).
- `meaningfulActionsThisWeek` (`packages/contracts/src/knowledge/knowledge.contract.ts:239`, mapped
  at `apps/api/src/modules/knowledge/topics.service.ts:150,185`).

The audit found **both** fetched and rendered by nothing, with the smoke test the only consumer
(`apps/mobile/e2e/smoke.mjs:550`) and the i18n key `learn.savedCount` unreferenced by any screen
(`apps/mobile/src/i18n/en.ts:175`, `apps/mobile/src/i18n/ar.ts:186`).

**Correction on `savedCount`.** The repository now renders it. `apps/mobile/app/(tabs)/learn.tsx:233-253`
shows a Saved row that states the count when it is non-zero and omits it when it is zero, with the
in-file comment at `:222-229` describing the field as having been "fetched and thrown away on every
visit" until that change. The audit's note is therefore superseded for this field; see §8.

**`meaningfulActionsThisWeek` remains BACKEND_ONLY.** A repository-wide search for the identifier
finds it only in the contract (`packages/contracts/src/knowledge/knowledge.contract.ts:239`) and the
service (`apps/api/src/modules/knowledge/topics.service.ts:150,185`). No mobile screen references it.
The server computes it, the contract carries it, and no pixel shows it. Whether it should be shown —
and as what — is not established by the audit.

The i18n key `learn.savedCount` ("Saved knowledge" / "المعرفة المحفوظة",
`apps/mobile/src/i18n/en.ts:175`) is still unreferenced; the Saved row uses a different key,
`learn.saved.open` (`apps/mobile/src/i18n/en.ts:304`). That leaves one dead string, not a broken
surface.

---

## 7. The saved-items loop — write half

Status of the write half: **CONNECTED_AND_WORKING**.

Bookmarking is a real, transactional learning signal. The bookmark toggle
(`apps/mobile/app/post/[id].tsx:117-123`, hook plumbing at
`apps/mobile/src/state/useFeed.ts:132-155`) calls `PUT`/`DELETE /v1/content/:contentId/bookmark`
(`apps/api/src/modules/content/content.routes.ts:164-194`), and `addBookmark` records a
`knowledge_saved` event per tagged topic inside the same transaction
(`apps/api/src/modules/content/content.service.ts:558-589`, fan-out at
`apps/api/src/modules/learning/signals.service.ts:115-128`). Untagged content still emits one
context-free event.

---

## 8. The saved-items loop — read-back half

**Audit finding (PARTIAL):** the saved feed scope was served by the API
(`apps/api/src/modules/content/content.service.ts:489-501`;
`apps/api/src/modules/content/feed.sql.ts:322-326`) and supported by the hook
(`apps/mobile/src/state/useFeed.ts:32`), but the only call site was `useFeed('home')`
(`apps/mobile/app/(tabs)/index.tsx:40`), and no screen listed a student's saved items. The audit
classified the scope and hook support as dead affordances awaiting a screen.

**Repository state now contradicts that finding, and the disproving lines are:**

- `apps/mobile/app/saved.tsx:32` — `const feed = useFeed('saved');`, a real second call site.
- `apps/mobile/app/saved.tsx:14-27` — the file's own doc comment states the purpose: "the read-back
  half of the bookmark", noting that `GET /v1/feed?scope=saved` was previously "served by the API,
  supported by the feed hook, exercised by the smoke test, and rendered by nothing".
- `apps/mobile/app/(tabs)/learn.tsx:239` — the Learn tab's Saved row pushes `/saved`.
- `apps/mobile/app/_layout.tsx:95` — `<Stack.Screen name="saved" />` registers the route in the root
  stack.

The loop as it now stands is therefore closed for saving: save → `knowledge_saved` signal →
`savedCount` on `/v1/learn` → a Saved screen that lists the items and lets the student unsave them
in the same grammar as the Today feed. The remaining unrendered field from the audit's finding is
`meaningfulActionsThisWeek` (§6.1).

This document does not assert that the Saved screen has been exercised against a live server; the
audit predates it, and no test evidence for it appears in the evidence file. Its runtime behaviour is
not established by the audit.

---

## 9. Spaced repetition — dormant schema, not a feature

Status: **MISSING**, and deliberately so.

`flashcard_progress` carries SM-2-shaped columns — `ease_factor`, `interval_days`, `repetitions`,
`due_at` — plus a due index, with the migration itself commenting that they are unused in V1
(`apps/api/migrations/0005_learning.sql:279-295`). A search for `flashcard` across the API source
returns zero files: no routes, no services, no repositories, for decks, cards or progress.

The absence is documented as a product refusal rather than a backlog item:
`docs/design-handoff/BLOCKED_CAPABILITIES.md:24` lists spaced repetition as forbidden;
`docs/design-handoff/FINAL-FREEZE.md:127` records "spaced repetition | does not exist | never"; and
`docs/design-handoff/13-PRACTICE.md:134` bans the surrounding vocabulary ("due for review",
"spaced-repetition interval", "streak").

The only recency mechanism in the product is the staleness term inside `computeWeakness`
(`packages/core/src/learning/weakness.ts:57-59`). It influences ranking. It schedules nothing, and it
must not be described to students as a review schedule.

The columns are best read as an intentional bet that a future V2 is a code change rather than a
migration. Nothing in the shipped product depends on them.

---

## 10. The practice content supply problem

Status: **MISSING** — and this is the single most consequential finding in this document.

### 10.1 What the evidence shows

- **No API route creates or publishes a quiz.** A search for `quiz` across the API source matches
  only the practice, signals and analytics modules; there is no authoring surface (area `learning`,
  "Practice question supply" finding).
- **The only writer of questions is the demo seed script.**
  `apps/api/scripts/seed-demo.ts:169-225` inserts rows directly into `quizzes`, `quiz_questions` and
  `quiz_options` with raw SQL. The script's own comment states the reason plainly: "there is no route
  to go through… not a quiz composer".
- **The practice route only serves published quizzes in an enrolled course.**
  `PRACTICABLE_QUIZ` (`apps/api/src/modules/learning/practice.repository.ts:27-33`) requires
  `published_at IS NOT NULL`, restricts to the student's enrolled courses, and excludes classroom-
  and group-scoped quizzes outright.
- **Therefore, in a fresh production database with no seeded quizzes, `canPractice` is false for
  every topic and `POST /v1/topics/:topicId/practice` returns 404 everywhere.** The client handles
  this gracefully with an empty state (`apps/mobile/app/practice/[topicId].tsx:85,182-192`), so the
  app does not break — it is simply empty.

The practice machinery described in §4 is real and tested. It has nothing to operate on.

### 10.2 Why this is a product decision, not a bug

There is no engineering change that makes questions appear. The missing element is an answer to a
question only the owner can answer: **who authors the practice questions, under what review, and with
what accountability for their correctness?**

The plausible shapes, none of which the audit endorses or rules out, are:

1. **Instructor authoring** — a staff-only composer route, plausibly parallel to the existing
   staff-gated classroom/lecture surfaces (`apps/api/src/modules/classrooms/classrooms.routes.ts:210,259`),
   with `published_at` as the review gate the schema already implies.
2. **Central editorial authoring** — an internal tool writing the same rows the seed writes, keeping
   the API free of a public authoring surface. Note that the existing admin routes are already
   BACKEND_ONLY with the demo seed as their sole caller
   (`apps/api/src/modules/admin/admin.routes.ts:29,50,68,101`; `apps/api/scripts/seed-demo.ts:669`),
   so "internal tool" currently means curl.
3. **Licensed or imported question banks** — an ingestion path rather than an authoring path, with
   whatever licensing and provenance obligations that carries.
4. **Student-contributed questions with review** — which would interact with the moderation and
   correction surfaces, and which the audit does not evaluate.

Each of these has different cost, different editorial liability, and different implications for the
academic credibility of the product. Choosing among them is the owner's call. Until it is made, the
Practice tab is a working machine with an empty hopper, and no amount of engineering closes that gap.

### 10.3 What is not an acceptable fix

**Generating practice questions with a language model, or otherwise fabricating them, is not an
acceptable way to close this gap.** The seeded content is medical — the demo set includes questions
on nephrotic syndrome (`apps/api/scripts/seed-demo.ts:226`) — and the audience is
medical students. Fabricated or unreviewed clinical questions carry the risk of teaching wrong
medicine to people who will practise it. A question that is plausible, well-formatted and wrong is
worse than no question at all, because the whole design of the loop — server-authoritative grading,
an explanation shown after the reveal, a weakness score that steers the feed — exists to make the
student trust the verdict. That trust is exactly what fabricated content would spend.

The correct interim position is the current one: `canPractice` is honestly false, the empty state is
honest, and the product says nothing it has not earned. Note that this same discipline is already
observed in the seed script, which pointedly refuses to write `learning_progress` "or the demo would
be showing a number the product did not earn" (`apps/api/scripts/seed-demo.ts:180-182`).

### 10.4 What the seed already settles

One useful consequence of the seed's design: it writes rows exactly as an authoring path would —
`published_at` set, a topic edge on every question so performance can roll up, and the answer key
living only in `quiz_options.is_correct` where the grader reads it
(`apps/api/scripts/seed-demo.ts:169-225`). Whoever builds the authoring path therefore has a working
reference for the row shape, and the loop behind it needs no change. The decision is editorial, not
architectural.

---

## 11. The contribution score

Status: **PARTIAL** — the display pipe is fully connected; the value is a DDL default that nothing
ever writes.

The number shown as the headline figure on a student's profile is
`profiles.contribution_score`. It is created in
`apps/api/migrations/0002_academic_hierarchy.sql:178` as
`contribution_score integer NOT NULL DEFAULT 0`, with a non-negativity check at `:188`. The audit
records that a search of the API source, migrations and scripts finds **zero** `UPDATE` or `INSERT`
statements touching the column — the only `profiles` updates in the repository are the follower and
following counters (`apps/api/src/modules/social/social.repository.ts:21-51`) and display fields
(`apps/api/src/modules/users/users.repository.ts:137-141`). A direct search of the repository
confirms only four occurrences: the migration DDL and check, the repository row type and select list
(`apps/api/src/modules/users/users.repository.ts:30,45`), and the service mapping
(`apps/api/src/modules/users/users.service.ts:60`) — reads and schema, no writes.

The read path, by contrast, is complete: `PROFILE_SELECT`
(`apps/api/src/modules/users/users.repository.ts:45`) → service mapping
(`apps/api/src/modules/users/users.service.ts:60`) → contract
(`packages/contracts/src/users/users.contract.ts:42`) → the profile screen's headline number
(`apps/mobile/app/profile/[handle].tsx:197-207`).

The consequences are exact:

- In any real deployment, every user's contribution score is **0, permanently**. There is no
  server-side computation, no trigger, no batch job and no seed.
- The non-zero values people have seen (12, and 120/25) exist only in preview fixtures
  (`apps/mobile/src/preview/fixtures.ts:249,1161`), which is precisely why the defect survived design
  review: the fixtures fabricate the one number production cannot produce.
- The migration's own comment declares an intent that no code implements — contribution-based
  reputation, never follower-derived (`apps/api/migrations/0002_academic_hierarchy.sql:176-177`).
- The product critique's "unexplained integer" (RC-08,
  `docs/product-critique/01-SYSTEMIC-FAILURES.md:58-60`) is literally unexplainable to a student,
  because it is a constant.

The screen faithfully renders a number nothing ever earns. Two honest resolutions exist — define and
implement what contribution means, or remove the number until it means something — and choosing
between them is a product decision, not a repair. The audit establishes the defect; it does not
prescribe the remedy.

---

## 12. Preview-mode parity

Status: **PREVIEW_ONLY**.

The entire learn/topic/practice surface has a parallel fixture implementation, used only when the
bundle is exported with `EXPO_PUBLIC_PREVIEW_MODE=1`. The flag is a build-time constant that fails
closed (`apps/mobile/src/preview/preview-mode.ts:40-48`), and the fixture transport handles
`/v1/learn`, `/v1/topics/:id`, `/v1/topics/:id/knowledge`, `/v1/topics/:id/practice` and
`/v1/practice/attempts/:id/answers` (`apps/mobile/src/preview/fixture-transport.ts:136-156`).
Production builds go through the real API via the injected-transport seam in `ApiClient`
(`apps/mobile/src/api/client.ts:69-94`).

The audit's assessment is that this is gating done correctly. The caveat is the one recorded in §11:
the fixtures recompute weakness locally (`apps/mobile/src/preview/fixtures.ts:387,468-474`) and
fabricate a non-zero contribution score (`:249,1161`) — the one number production cannot produce.
Preview parity is a demonstration aid, and it must not be read as evidence that a surface works
against a live server.

---

## 13. What this audit does not establish

- Whether the Saved screen (§8) behaves correctly against a live server; it postdates the audit and
  no test evidence for it appears in the evidence file.
- Whether `meaningfulActionsThisWeek` is intended for display, and in what form.
- Any target for what a contribution score should measure; only that nothing currently writes it.
- Any decision on question authorship, review workflow, or editorial ownership (§10) — the evidence
  establishes the absence, not the remedy.
- Runtime or deployment state of the practice routes in any environment; all findings here are
  repository-level.
