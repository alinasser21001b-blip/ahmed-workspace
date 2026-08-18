# 02 — INTENDED PRODUCT VS CURRENT WEBSITE

Companion to `01-CAPABILITY-MATRIX.md`. That document inventories capabilities; this one asks a
different question — **what was Student OS meant to be, and what does a student actually meet?**

Sources of truth, in order:

1. The Phase A forensic evidence file (eleven read-only auditors, HEAD `6355f9c`, working tree
   clean at audit time). Every status claim below carries a `file:line` citation copied from it.
2. The owner's product documents: `00-PRODUCT-ARCHITECTURE.md`, `04-UX-ARCHITECTURE.md`,
   `05-ROADMAP.md`, `docs/design-handoff/`, `docs/product-critique/`.

Status vocabulary is the task's: `CONNECTED_AND_WORKING`, `BACKEND_ONLY`, `FRONTEND_ONLY`,
`PARTIAL`, `BLOCKED_BY_EXTERNAL_SERVICE`, `BLOCKED_BY_DEPLOYMENT`, `BLOCKED_BY_PRODUCT_DECISION`,
`MISSING`, `DEAD_CODE`, `PREVIEW_ONLY`. Where the audit is silent, this document says
*not established by the audit* rather than guessing.

> **Baseline note.** This document describes the audited baseline (`6355f9c`). Phase C recovery
> work is landing in the working tree while it is being written; where a row has demonstrably
> changed since the audit, the change is stated inline with its own citation and marked
> *[in-flight]*. Nothing else in this document has been re-verified against a moving tree.

---

## 1. What Student OS was intended to be, in the owner's terms

### 1.1 One graph, not three products

The founding sentence is that this is a **social learning operating system** for a single dense
student cohort, and that "social interaction, communication, content, and learning are the **same
graph** viewed from different angles" (`00-PRODUCT-ARCHITECTURE.md:9-16`). The rule that settles
scope arguments is stated in one line: **knowledge is the social object**
(`00-PRODUCT-ARCHITECTURE.md:24`). This is "an *academic social learning network*, not a social
network with educational content on it. The social layer exists to move knowledge between people"
(`00-PRODUCT-ARCHITECTURE.md:26-29`).

That intent rules four things out permanently rather than deferring them: a general-interest or
entertainment-first feed, a virality or influencer model, engagement mechanics aimed at screen
time, and short-form video as anything other than micro-learning attached to an academic context
(`00-PRODUCT-ARCHITECTURE.md:33-39`, `215-225`).

It also imposes a domain shape that is **not** `Users → Posts → Comments` but
`Users → Academic Context → Knowledge → Interaction → Learning Signals → Recommendations → AI`
(`00-PRODUCT-ARCHITECTURE.md:63-70`), and a north-star metric of Weekly Active Learners counted
from `learning_events`, explicitly excluding screen time and scroll depth
(`00-PRODUCT-ARCHITECTURE.md:227-238`).

### 1.2 Arabic-first, not Arabic-capable

Arabic is the primary language and the default; English is secondary; direction is resolved once
at startup and applied before first paint (`04-UX-ARCHITECTURE.md:114-121`). The repository takes
this seriously enough that the Arabic catalogue is the key set of record and English is compile-
checked against it — CONNECTED_AND_WORKING at `src/i18n/ar.ts:7`, `src/i18n/en.ts:10`, with 518/518
key parity verified, true CLDR six-category Arabic plurals at
`packages/core/src/text/arabic.ts:126-135`, and IBM Plex Sans Arabic 400/500/600 bundled and
render-blocking at `app/_layout.tsx:15-17,53-63`.

### 1.3 The Today tab is a primary academic social feed — owner decision, non-negotiable

This is the decision that governs the largest gap in this document. Today is not a digest, not a
notice board and not a reading-only editorial page: it is the product's **primary academic social
feed**, and the social loop is expected to close on it. The sentence now appears verbatim in the
product code as `app/(tabs)/index.tsx:23` — *"Today — the primary academic social feed (owner
decision, non-negotiable)."*

The frozen design handoff, written before that decision was recorded, specifies the opposite
posture for the same screen: Home has "no dominant action, and that is correct: reading is the
action", with difficulty and helpful counts moved off the row and onto post detail
(`docs/design-handoff/11-HOME.md`, Dominant action and Hierarchy sections). The shipped baseline
implements the handoff, not the owner decision — see §2 (Today) and §3.1.

The parts of the editorial grammar that the owner decision does **not** overturn are equally
explicit and remain binding: sections are "classification statements, not engagement buckets",
there are no cards, and no per-item relevance explanation, engagement metric or trending label is
supported data (`docs/design-handoff/11-HOME.md`, Unsupported data and Hierarchy sections). A
social feed in this product means the reader can act on knowledge in place; it does not mean an
engagement surface.

### 1.4 The intended screen set

`04-UX-ARCHITECTURE.md:50-68` contracts a screen map running from sign-in through feed, composer,
post detail, community and group detail, conversation, topic, Learn, classroom, lecture hub, quiz
player, reels, learning profile and an admin console. `docs/design-handoff/03-SCREEN-INVENTORY.md`
narrows that to a frozen 39 screens and screen-states for V1. The tab shell is the "frozen five" —
Today, Topics, Learn, Rooms, Chat (`docs/design-handoff/04-NAVIGATION.md:25`), which the shipped
app implements exactly: CONNECTED_AND_WORKING at `app/(tabs)/_layout.tsx:104-138`.

Note that `04-UX-ARCHITECTURE.md:25` still names an older tab set (Home · Groups · Create · Learn ·
Chat). The navigation contract supersedes it; the discrepancy is documentation drift, not a
shipped defect.

### 1.5 The honest summary of the audit

The single most important finding of the Phase A sweep is that **Student OS has no fake
frontend**: `FRONTEND_ONLY` count is zero — no screen in this app calls an endpoint that does not
exist. The failure mode is the opposite one: a substantial, working, tested backend that the
interface never asks for. Every list in §3 should be read against that.

---

## 2. Intent vs current, per surface

| Surface | Intended (owner / design documents) | Current (audited baseline) | Status | Evidence |
|---|---|---|---|---|
| **Today** | The primary academic social feed; the social loop closes here (`app/(tabs)/index.tsx:23`). Classification sections, no cards, no engagement metrics (`design-handoff/11-HOME.md`). | Read-only editorial surface. Loads `GET /v1/feed?scope=home`, reports view impressions, navigates to post detail, author, search and compose. The row component exposes only `onPress`/`onPressAuthor` — **no like, save or comment control** — and the screen never requests page two. | PARTIAL | `app/(tabs)/index.tsx:40,46,55,110,122,188-199`; row component `src/components/knowledge/ContentGrammar.tsx:90-198`; no `onEndReached` at `app/(tabs)/index.tsx:153-209` |
| | | *[in-flight]* Phase C has since wired like, save, comment and cursor pagination onto this screen in the working tree. | — | `app/(tabs)/index.tsx:256-257,260,269-270` |
| **Topics** | Curriculum index — browse the academic hierarchy, evidence and progress deliberately live on Learn. | Loads `/v1/academic/courses` then topics per course; rows push `/topic/[id]`. Pure browse surface, as intended. | CONNECTED_AND_WORKING | `app/(tabs)/topics.tsx:44-49,128`; `apps/api/src/modules/academic/academic.routes.ts:94,111,124` |
| **Learn** | Evidence overview: focus topics, interests, **saved**, and this week's activity (`04-UX-ARCHITECTURE.md:62`). | Focus topics and the practice band work and refetch on focus. `savedCount` and `meaningfulActionsThisWeek` are fetched from `/v1/learn` and **rendered nowhere**; the `learn.savedCount` string exists in both catalogues with no call site. | PARTIAL | `app/(tabs)/learn.tsx:45,56-61,162,191,227`; server side `topics.service.ts:150-185`; unused key `src/i18n/en.ts:175`, `src/i18n/ar.ts:186` |
| **Rooms** | Study groups and classrooms as learning spaces, not member lists with chat attached (`00-PRODUCT-ARCHITECTURE.md:55-57`). | Loads mine-scoped classrooms and groups in parallel; both sections always render so the zero-rooms state keeps its entry affordances. Group create, join, roster and group feed all work. | CONNECTED_AND_WORKING | `app/(tabs)/rooms.tsx:43-46,112,123,146,156`; `app/group/[id].tsx:18-24,255,281,324` |
| **Chat** | Quietest surface in the product; new conversation reachable from Search → profile → **Message** (`design-handoff/15-MESSAGES.md`, Conversation list). | List, history, send, read state all work over plain HTTP with an idempotent outbox. **No screen creates a conversation**: `POST /v1/conversations` is called only by e2e scripts, and the profile screen has no Message action. Realtime is fully built on both ends but cannot run on the deployed host. | PARTIAL (core); BACKEND_ONLY (create); BLOCKED_BY_DEPLOYMENT (realtime) | `apps/api/src/modules/messaging/messaging.routes.ts:40,85,104,137`; create at `messaging.routes.ts:55-68` with callers only in `e2e/messaging.mjs:108`; `app/chat/[id].tsx:44-50,67-73`; host limit stated verbatim at `netlify/api/handler.mts:34-39` |
| **Profile** | Academic identity and the work behind it; contribution is the only number, and it is "contribution-based, never follower-derived" (`design-handoff/17-PROFILE.md`; `00-PRODUCT-ARCHITECTURE.md:206-210`). Secondary actions include **Message**. | Identity, interests, follow/unfollow, block with confirmation, report, and the author's posts all work. **Correction (round-2 review): the contribution score is no longer rendered at all** — it was removed from `app/profile/[handle].tsx` in Phase C (commit `5b6963a`; see the "THE NUMBER THAT IS NOT HERE" comment at lines 219-242 of that file) rather than being fixed to show a real value. `profiles.contribution_score` (DDL default 0, never written by any code) and its contract field/service mapping remain in the codebase as unread dead weight. There is no Message action, and no dedicated entry point to one's own profile. | PARTIAL | screen `app/profile/[handle].tsx:123,137,219-242,342`; dead column `apps/api/migrations/0002_academic_hierarchy.sql:178,188`; unread path `users.repository.ts:45` → `users.service.ts:60` (client never reads it) |
| **Compose** | Content must carry its intent — ask a question, explain, share a resource, present a case (`00-PRODUCT-ARCHITECTURE.md:49-54`). Modal, no drafts, dismiss loses the text (`design-handoff/04-NAVIGATION.md:80-82`). | Full composer: body, one image, visibility scope, knowledge type and difficulty, with knowledge types read from `@sos/core` so the client cannot offer a rejectable combination. It never sends `topicIds`, so author-chosen topic attachment happens through other flows. | CONNECTED_AND_WORKING | `app/compose.tsx:52,95,108-118,220-244`; `apps/api/src/modules/content/content.routes.ts:53-75`; knowledge types `app/compose.tsx:35-39` |
| **Practice** | The learning loop: Learn → Topic → Practice → evidence, with server-side grading and no mastery or spaced-repetition vocabulary (`design-handoff/13-PRACTICE.md`). | The best-wired feature in the repository. Attempt start/resume, answer submit, server-only grading in `@sos/core`, DB-enforced idempotency, progress and weakness roll-up, and a full integration suite. **But no route creates or publishes quizzes** — questions exist only because a demo seed script writes rows directly, so in a clean production database every topic's `canPractice` is false and the practice route 404s. | CONNECTED_AND_WORKING (loop); MISSING (question supply) | `apps/api/src/modules/learning/practice.routes.ts:33,54`; grading `packages/core/src/learning/grading.ts:51-80`; client `app/practice/[topicId].tsx:22-49,72,126-129,160`; seed-only supply `apps/api/scripts/seed-demo.ts:169-225`; gate `practice.repository.ts:27-33` |
| **Classrooms** | Instructor creates a classroom, students join by enrolment or code; roles are contextual (owner/admin/moderator/member) and never conflated with global role (`00-PRODUCT-ARCHITECTURE.md:165-175`). | Create (instructor-gated, server-minted join code), lookup, join, roster and the member/non-member split all work end to end and are tested. Only **owner** and **member** are reachable states: no endpoint promotes, demotes, bans or removes, and there is no archive, rename, rotate-code or transfer route. `DELETE /membership` (leave) exists with no screen calling it. | CONNECTED_AND_WORKING (core); MISSING (management) | `apps/api/src/modules/classrooms/classrooms.routes.ts:60-83,85-102,123-150,169-186`; role assignments only at `classrooms.service.ts:261-264,306`; orphaned gate `classrooms.service.ts:529-534`; leave route `classrooms.routes.ts:152-167` |
| **Lectures** | Lecture hub with material, summary, objectives, quiz, flashcards, discussion, reels and AI (`04-UX-ARCHITECTURE.md:64`); instructors create lectures and upload material (`00-PRODUCT-ARCHITECTURE.md:168`). | Reading, objectives, concepts, topics, signed material URLs, open member discussion and reading progress all work. **Lecture creation has no UI anywhere** — the endpoint is complete, gated and tested, but only e2e scripts call it, so an instructor using the shipped app can attach materials to a lecture they cannot create. Materials can only be images; the API's `externalUrl` material type has no input field. The `aiSummary` slot is present and null. | CONNECTED_AND_WORKING (reading); BACKEND_ONLY (authoring); PARTIAL (materials) | reading `app/lecture/[id].tsx:18-35,222,385`; authoring route `classrooms.routes.ts:210-238` with e2e-only caller `e2e/classroom-journey.mjs:213-224`; image-only sniffing `apps/api/src/platform/storage.ts:136-141`; `externalUrl` in contract at `packages/contracts/src/learning/classroom.contract.ts:182-196` |
| **Search** | Six result types: person, knowledge, group, community, topic, classroom (`design-handoff/04-NAVIGATION.md:85-93`). | Debounced trigram search over four result classes, with people, groups and content navigating correctly. Topic and classroom search have **no endpoint**, and the screen says so in-UI rather than faking it. Community results render, but the route tree contains no community screen. | CONNECTED_AND_WORKING (4 of 6); MISSING (topic, classroom) | `app/search.tsx:24-27,208,236,252,284`; `apps/api/src/modules/groups/groups.routes.ts:311-324`; blocked rows 1 and 2 in `design-handoff/BLOCKED_CAPABILITIES.md:11-12`; communities BACKEND_ONLY at `groups.routes.ts:47,66,81,96` |
| **Settings** | App-Review-driven surface: sign-out, blocked accounts, support and legal links, account deletion, and an honest statement that notifications are blocked. Privacy settings specified (`design-handoff/03-SCREEN-INVENTORY.md:56`). | Every listed row works, including a full account-deletion lifecycle with re-authentication. Its **only** entry is the gear or Edit-profile control on one's own profile, and own-profile has no dedicated entry point — no tab, no menu — so Settings is reachable only by encountering yourself in a feed row, a search result or a group roster. Privacy settings have no screen. | PARTIAL | `app/settings/index.tsx:53-59,63-78,112`; entries only at `app/profile/[handle].tsx:137,243`; deletion `app/settings/delete-account.tsx:43-57`; privacy endpoints without a client at `apps/api/src/modules/users/users.routes.ts:35,48,66,80,93,107,124` |

---

## 3. The six lists

### 3.1 FEATURES LOST IN UI

Capabilities the backend serves and the design specifies, which the interface does not offer.

| # | Feature | What is missing | Status | Evidence |
|---|---|---|---|---|
| 1 | **Like, save and comment on the Today feed** | The feed row component exposes only `onPress` and `onPressAuthor`; the screen never calls `feed.toggleReaction` or `feed.toggleBookmark`, while `PUT/DELETE /v1/content/:id/reaction` and `…/bookmark` are live and used from post detail. Every act costs one screen. *[in-flight: wired in the working tree at `app/(tabs)/index.tsx:256-257,260`]* | PARTIAL | `src/components/knowledge/ContentGrammar.tsx:90-198`; `app/(tabs)/index.tsx:40`; endpoints `content.routes.ts:133-162,166-195` |
| 2 | **Feed pagination** | Backend keyset cursor and hook `loadMore` both exist; no feed screen has `onEndReached`, so Today shows one page of 20 and profile/group feeds show one page each. *[in-flight: `app/(tabs)/index.tsx:269-270`]* | PARTIAL | cursor `content.service.ts:445-453,508-516`; hook `src/state/useFeed.ts:45,162`; absence at `app/(tabs)/index.tsx:153-209` |
| 3 | **A screen that lists saved items** | Saving works and emits a per-topic `knowledge_saved` learning signal in-transaction; `feed?scope=saved` is served and `useFeed('saved')` is supported, but no screen calls it. The bookmark is write-only from the student's point of view. | PARTIAL | write path `content.service.ts:558-599`; scope `content.service.ts:489-501`, `feed.sql.ts:322-326`; sole call site `app/(tabs)/index.tsx:40`; e2e-only read `e2e/smoke.mjs:193` |
| 4 | **Learn's saved and weekly-activity counts** | `savedCount` and `meaningfulActionsThisWeek` are computed server-side, carried in the contract, asserted by the smoke test, and rendered by no pixel. | PARTIAL | `topics.service.ts:150-185`; `packages/contracts/src/knowledge/knowledge.contract.ts:237`; `e2e/smoke.mjs:550` |
| 5 | **Comment replies** | One-level replies exist in the contract and are rendered if present, but the composer sends only `{body}` and there is no reply control, so no reply can be created. | BACKEND_ONLY | contract `interactions.contract.ts:48-56`; render `app/post/[id].tsx:232-245`; create `app/post/[id].tsx:81` |
| 6 | **Author edit and delete of a post** | Both routes exist with author-only policy and soft delete; `viewer.canEdit`/`canDelete` appear only in preview fixtures; the post-detail menu shows only for non-authors and offers only Report. | BACKEND_ONLY | `content.routes.ts:92-112,114-129`; menu `app/post/[id].tsx:173-196`; fixtures `src/preview/fixtures.ts:576,638` |
| 7 | **Four of the five reaction kinds** | The contract defines five kinds; the client only ever sends `kind:'like'`. | BACKEND_ONLY | `packages/contracts/src/social/content.contract.ts:22-28`; client `app/post/[id].tsx:95-115` |
| 8 | **A Message action on a profile** | Specified as a secondary action on the profile screen; the shipped screen offers Follow, Block and Report and nothing else. This is what makes conversation creation unreachable (§3.4). | MISSING | spec `design-handoff/17-PROFILE.md`, Secondary actions; grep of `app/profile/[handle].tsx` finds zero conversation/message references |
| 9 | **Profile navigation from post detail** | Post detail passes no `onAuthorPress` to the row, so tapping the author on a post's own page does nothing. Author navigation exists only on the Today row. | PARTIAL | `app/post/[id].tsx:208-212` vs `app/(tabs)/index.tsx:189` |
| 10 | **`externalUrl` lecture materials** | The materials contract accepts a link material; the upload form offers only an image picker. | BACKEND_ONLY | `packages/contracts/src/learning/classroom.contract.ts:182-196`; form `app/lecture/[id].tsx:118-164` |
| 11 | **Leaving a classroom** | `DELETE /v1/classrooms/:id/membership` exists with an owner-cannot-leave rule enforced in policy; no mobile screen calls it. | BACKEND_ONLY | route `classrooms.routes.ts:152-167`; policy `packages/core/src/policy/classroom.policy.ts:147-153` |
| 12 | **Author-chosen topics at compose time** | `createPostRequest` accepts `topicIds`; the composer offers only knowledge type and difficulty and never sends them. | PARTIAL | `content.contract.ts:126-146`; `app/compose.tsx:220-244` |
| 13 | **Home's resume band** | Specified as Home's only dominant action, suppressed when Learn's band applies. No endpoint exposes an open attempt, so the rule resolves to "never shown". | MISSING | spec `design-handoff/11-HOME.md`, resume rule; absence recorded in-code at `app/(tabs)/index.tsx:43-46` |

### 3.2 FEATURES LOST IN NAVIGATION

Screens that exist and work, but that a student cannot reliably reach.

| # | Feature | Navigation defect | Status | Evidence |
|---|---|---|---|---|
| 1 | **Your own profile** | There is no "me" tab and no avatar menu. A student reaches their own profile only by meeting themselves in a feed author row, a search result or a group roster. | PARTIAL | `app/profile/[handle].tsx:123,137,220,243,342`; entry points enumerated at `app/(tabs)/index.tsx:189`, `app/search.tsx:208`, `app/group/[id].tsx:255` |
| 2 | **Settings, blocked accounts, account deletion** | All three work, and all three inherit defect 1: their only door is the gear or Edit-profile control on own-profile. | PARTIAL | `app/settings/index.tsx:53-59,112`; entries only at `app/profile/[handle].tsx:137,243` |
| 3 | **Starting a conversation** | Chat's empty state routes to Search, Search routes to a profile, and the profile has no Message action — the escape hatch dead-ends. | BACKEND_ONLY | `app/(tabs)/chat.tsx:118` → `app/search.tsx:208` → `app/profile/[handle].tsx` (no message affordance); endpoint `messaging.routes.ts:55-68` |
| 4 | **Reset password** | The screen works, but no in-app link reaches it. It is deep-link or URL-only, and the email that would carry the link depends on an unwired mailer. | PARTIAL / BLOCKED_BY_EXTERNAL_SERVICE | screen `app/(auth)/reset-password.tsx:17-19,29-34,44`; mailer stub `apps/api/src/platform/mailer.ts:33-39` |
| 5 | **Topic and classroom search results** | Search supports four of six specified result types; topics and classrooms have no endpoint, so those destinations are unreachable from Search by design and the screen says so. | MISSING | `app/search.tsx:24-27`; `design-handoff/BLOCKED_CAPABILITIES.md:11-12` |
| 6 | **Communities** | Four community endpoints exist and search renders a community section, but the route tree contains no community screen — the root Stack registers 29 route screens and none is a community surface. | BACKEND_ONLY | endpoints `groups.routes.ts:47,66,81,96`; search section `app/search.tsx:252`; route table `app/_layout.tsx:84-122` |
| 7 | **Notifications** | Specified in full (`design-handoff/19-NOTIFICATIONS.md`) with destinations mapped; the route is absent and Settings states the absence honestly rather than showing a dead bell. | MISSING | `design-handoff/03-SCREEN-INVENTORY.md:40`; honest statement `app/settings/index.tsx:63-78` |
| 8 | **`/motion-samples`** | No in-app link exists anywhere, even in preview builds; it is URL-only, exercised by an e2e script. See §3.6 — this one is a defect that reachability makes worse, not better. | PREVIEW_ONLY | `app/motion-samples.tsx:16,126-137`; sole visitor `e2e/motion-samples.mjs:96` |

### 3.3 FEATURES HIDDEN BY PREVIEW MODE

The preview gate is a build-time constant read once at module scope, inlined at export time, and
fails closed: CONNECTED_AND_WORKING at `src/preview/preview-mode.ts:40-48`, with unit coverage at
`__tests__/preview-gate.test.ts:32-84`.

**The most important entry in this list is the one that is not here.** No production feature is
gated behind the preview flag. In a real build the flag only decides whether the API transport is
replaced by an in-memory fixture world; every social, learning, classroom and messaging feature
uses the real transport unconditionally (`src/state/session.tsx:152-160`,
`src/api/client.ts:69-94`). What follows is therefore short, and is about things visible **only**
in preview, not features withheld from students.

| # | Thing | Behaviour outside preview | Status | Evidence |
|---|---|---|---|---|
| 1 | **A non-zero contribution score** | Preview fixtures fabricate 12 and 120/25, and production renders the DDL default 0 for every user forever — this is exactly why the always-zero defect survived design review. **Correction (round-2 review): the score is no longer rendered at all** — Phase C removed it from the profile screen (commit `5b6963a`) rather than computing a real value, so the gap this row describes is now "no number shown", not "a false number shown". | REMOVED (the display) / MISSING (a real computation, if the owner wants the number back) | `app/profile/[handle].tsx:219-242`; dead column `migrations/0002_academic_hierarchy.sql:178` |
| 2 | **The five motion prototypes** | Functional only in preview; a real build renders a refusal sentence in hardcoded English (§3.6). | PREVIEW_ONLY | `app/motion-samples.tsx:126-137` |
| 3 | **The preview feedback form** | Anonymous rating form stored in local storage; a production deep link reaches a properly localised one-sentence explanation. This is the best-behaved preview surface in the repository. | PREVIEW_ONLY | `app/preview-feedback.tsx:81-92`; store gate `src/preview/feedback-store.ts:55`; banner entry `src/preview/PreviewBanner.tsx:29,49` |
| 4 | **The preview banner** | Provably inert in a real build — `previewBannerLabel()` folds to null before any JSX. | PREVIEW_ONLY | `src/preview/PreviewBanner.tsx:28-29`; `src/preview/preview-mode.ts:54-55` |
| 5 | **Classroom create and join-by-code in preview** | Deliberately fail in preview (403 and 404 from the fixture transport) while reads render. Production behaviour is the opposite and correct. | PREVIEW_ONLY | `src/preview/fixture-transport.ts:235-268` |
| 6 | **The realtime socket in preview** | Never constructed in preview builds; status stays `offline` with the same banner production shows. Correctly inverted gate — it removes behaviour only in preview. | PREVIEW_ONLY | `src/state/realtime.tsx:76-89` |

One consequence deserves stating plainly: the preview build is what reviewers and the owner have
been looking at, and it is the only build in which the profile score, a full-looking feed and a
populated classroom exist. The product-critique pass reached the same conclusion from the other
direction — the fixture world is "too thin and half-English to carry judgement"
(`docs/product-critique/01-SYSTEMIC-FAILURES.md`, RC-02).

### 3.4 FEATURES EXISTING ONLY IN BACKEND

Complete, authorised and in most cases tested server-side, with no client call path at all.

| # | Capability | Endpoint(s) | Status | Evidence |
|---|---|---|---|---|
| 1 | **Create a conversation** | `POST /v1/conversations` | BACKEND_ONLY | `messaging.routes.ts:55-68`; callers only `e2e/messaging.mjs:108`, `e2e/rtl-audit.mjs:213` |
| 2 | **Create a lecture** | `POST /v1/classrooms/:id/lectures`, staff-gated, draft-capable | BACKEND_ONLY | `classrooms.routes.ts:210-238`; service gate `classrooms.service.ts:444-475`; e2e-only caller `e2e/classroom-journey.mjs:213-224` |
| 3 | **Communities** | four endpoints, with tables and membership | BACKEND_ONLY | `groups.routes.ts:47,66,81,96`; `migrations/0003_social_and_content.sql:90,119` |
| 4 | **Moderation queue and moderator actions** | `GET /v1/moderation/reports` and resolution routes, admin-gated | BACKEND_ONLY | `apps/api/src/modules/account/account.routes.ts:59,77,98,122`; `migrations/0015_moderation_and_deletion.sql:45,98,142` |
| 5 | **Admin instructor verification** | `PUT /v1/admin/users/:id/verification` — the only path that grants teaching eligibility | BACKEND_ONLY | `apps/api/src/modules/admin/admin.routes.ts:29,50,68,101`; used by `apps/api/scripts/seed-demo.ts:669` |
| 6 | **Privacy settings** | `GET/PATCH /v1/me/privacy` | BACKEND_ONLY | `apps/api/src/modules/users/users.routes.ts:66,80` |
| 7 | **Followers and following lists** | paginated list endpoints | BACKEND_ONLY | `apps/api/src/modules/social/social.routes.ts:105-147` |
| 8 | **Mutes (user, group, community, topic)** | `PUT/DELETE /v1/mutes`, honoured in the feed query | BACKEND_ONLY | `social.routes.ts:149-181`; honoured at `content.service.ts:488-492`, `feed.sql.ts:33-40` |
| 9 | **Post edit and delete** | `PATCH`/`DELETE /v1/content/:id` | BACKEND_ONLY | `content.routes.ts:92-112,114-129` |
| 10 | **Comment edit, delete and reactions** | three routes; the whole per-comment interaction surface | BACKEND_ONLY | `content.routes.ts:273-293,295-310,312-342` |
| 11 | **Reporting a comment or a message** | same `POST /v1/reports` endpoint, other target types | BACKEND_ONLY | targets `interactions.contract.ts:97-101`; `ReportSheet` imported only by `app/post/[id].tsx` and `app/profile/[handle].tsx` |
| 12 | **Saved feed scope** | `GET /v1/feed?scope=saved` | BACKEND_ONLY | `content.service.ts:489-501`; `feed.sql.ts:322-326` |

### 3.5 FEATURES NEVER IMPLEMENTED

Absent on both ends. Some are deliberate refusals — those are marked as decisions, not gaps.

| # | Feature | State | Status | Evidence |
|---|---|---|---|---|
| 1 | **Practice question authoring** | No route creates or publishes a quiz. The entire practice loop depends on rows written by a demo seed script; a clean production database yields `canPractice: false` everywhere and a 404 from the practice route. This is the single largest content blocker in the product. | MISSING | grep of `apps/api/src` finds no authoring route; `apps/api/scripts/seed-demo.ts:169-225`; gate `practice.repository.ts:27-33` |
| 2 | **Classroom management** | Archive, rename, rotate join code, transfer ownership, promote to admin or moderator, ban or remove a member — schema, contract and policy gates all exist; no route and no UI. Only owner and member are reachable states. | MISSING | roles in `migrations/0005_learning.sql:37-44`; unreferenced gate `classrooms.service.ts:529-534` |
| 3 | **Notification delivery and push** | Enum, rules, collapse windows, tables and push-token storage exist as reserved schema; producer, outbox drain, routes, client and push flow do not. | MISSING | `migrations/0006_ai_moderation_platform.sql:15,40,65,83,100,119,128`; `design-handoff/BLOCKED_CAPABILITIES.md:13` |
| 4 | **AI (Phase 6+)** | Tutor, examiner, librarian, curator — architecturally reserved with `ai_sources` in schema; no application code. The lecture screen carries an `aiSummary` slot that is null by contract. | MISSING | intent `00-PRODUCT-ARCHITECTURE.md:58-61`; reserved schema `migrations/0006_ai_moderation_platform.sql`; slot `app/lecture/[id].tsx` |
| 5 | **Reels / micro-learning video (Phase 8)** | Contracted in the screen map, not built. | MISSING | `04-UX-ARCHITECTURE.md:66`; `05-ROADMAP.md`, phase 8 |
| 6 | **Flashcards, assignments, study sessions, live sessions, polls, message receipts** | Tables exist with no route, service or repository. Deliberate reserved schema, written so a future phase is a code change only. | DEAD_CODE (schema) / MISSING (feature) | `migrations/0005_learning.sql:109,126,247,267,279,303,323,333,359`; `migrations/0003_social_and_content.sql:272-343`; `migrations/0010_messaging_delivery.sql:17-20` |
| 7 | **Spaced repetition / review queues** | SM-2-shaped columns lie dormant on `flashcard_progress` with zero application code. This is a **product refusal**, documented as forbidden, not a backlog item. | BLOCKED_BY_PRODUCT_DECISION | `migrations/0005_learning.sql:279-295`; `design-handoff/BLOCKED_CAPABILITIES.md:24`; `design-handoff/FINAL-FREEZE.md:127`; banned vocabulary `design-handoff/13-PRACTICE.md:134` |
| 8 | **Follower counts on the profile** | The fields exist and are maintained; the design omits them so contribution stays the only number. Reversible by an owner decision, and recorded as one. | BLOCKED_BY_PRODUCT_DECISION | `design-handoff/BLOCKED_CAPABILITIES.md:34`; `design-handoff/17-PROFILE.md`, Follower counts |
| 9 | **Topic search and classroom search endpoints** | Data and normalisation exist; endpoint, index and result type do not. | MISSING | `design-handoff/BLOCKED_CAPABILITIES.md:11-12` |
| 10 | **Message attachments, structured academic references, presence/online status** | Blocked capabilities 6, 7 and 10. Presence carries an explicit instruction not to ship the settings toggles that imply it. | MISSING | `design-handoff/BLOCKED_CAPABILITIES.md:16-17,20` |
| 11 | **Password-reset email delivery** | The whole token lifecycle exists and is tested; `deliverPasswordResetEmail` only logs `EXTERNAL_INFRASTRUCTURE_REQUIRED`, and no SMTP or provider key exists in config. The flow cannot complete without an owner-provided email service. | BLOCKED_BY_EXTERNAL_SERVICE | `apps/api/src/platform/mailer.ts:33-39`; routes `auth.routes.ts:80,107`; migration `0016_password_reset.sql:18` |
| 12 | **Realtime message delivery in production** | Server and client are both complete; the deployed host serves Fastify through `app.inject()` per request and cannot hold a socket, so the upgrade fails on every attempt. The client backs off forever and both chat screens carry a permanent honest banner. Fixing it means a socket-capable host, not a code change. | BLOCKED_BY_DEPLOYMENT | `netlify/api/handler.mts:34-39,295-303`; client `src/state/realtime.tsx:148-159`; banner copy `src/i18n/en.ts:476`, `ar.ts:492` |
| 13 | **App icons, splash and web favicon** | `app.json` declares no icon, splash, adaptive icon or favicon, and there is no assets directory; the exported web shell hardcodes `lang="en"` for an Arabic-default app. | MISSING | `apps/mobile/app.json` (no icon/splash/favicon keys); `dist/index.html:2` |
| 14 | **Non-image lecture materials** | `POST /v1/files` sniffs bytes and refuses anything that is not PNG, JPEG, GIF or WebP — so a lecture material can never be a PDF or a slide deck, which is what lecture materials usually are. | MISSING | `apps/api/src/platform/storage.ts:136-141`; `apps/api/src/modules/files/files.service.ts:42-110` |

### 3.6 FEATURES THAT SHOULD NOT EXIST

Present in the repository or the shipped artifact, serving no student.

| # | Thing | Why it should not be there | Status | Evidence |
|---|---|---|---|---|
| 1 | **`/motion-samples` in a real build** | `expo-router` registers every file under `app/`, so the route resolves in production. Outside preview it renders **hardcoded English developer copy that bypasses `t()`** — "Motion samples" and "The motion prototypes are part of the preview build and are not available here" — in an app whose default locale is Arabic. The repository's own critique marks it P0 and orders removal. | PARTIAL / DEAD_CODE | `app/motion-samples.tsx:126-137` (title at :130, sentence at :131-133); default locale `app/_layout.tsx:67`; `docs/product-critique/11-CONTENT-TRUTH-AUDIT.md:11`; `docs/product-critique/03-DELETION-LIST.md:4` |
| 2 | **The entire fixture world inside the production bundle** | Metro folds constants only within a module and resolves static imports unconditionally, so the 1,279-line fixture world — "Preview Student", "Layla Hassan", "Omar Al-Khafaji", invented University of Baghdad posts and messages — plus the fixture transport and all five motion demos ship in every bundle a student downloads. Never rendered, but extractable from the artifact. | DEAD_CODE (shipped) | import chain `src/state/session.tsx:8` → `src/preview/fixture-transport.ts:2` → `src/preview/fixtures.ts:115-118,123-133`; confirmed by inspecting the exported bundle |
| 3 | **A preview export committed at the production publish path** | `apps/mobile/dist` is the directory `netlify.toml` publishes, and the committed artifact there is a **preview** build with the flag compiled true. Harmless on Netlify, which rebuilds — but anyone serving the repo's `dist/` directly ships the fixture preview to students. | PARTIAL | `netlify.toml:12-14`; `scripts/netlify-build.sh:31-34`; preview constant inside the committed bundle |
| 4 | **The S3 storage driver** | A driver whose constructor throws "not implemented". The only production storage path that exists is the Netlify Blobs driver; the S3 class is a shape with no behaviour. | DEAD_CODE | `apps/api/src/platform/storage.ts:67-86` vs the live driver at `netlify/api/handler.mts:87-115,136-137` |
| 5 | **Unreachable classroom policy paths** | `admin`, `moderator` and `banned` exist in schema, contract and policy — including `canManageClassroom`, `canManageClassroomMembership` and an exported `assertCanManage` — and **no endpoint can produce any of those states**. Policy that nothing can reach is policy nobody maintains. | DEAD_CODE | `classrooms.service.ts:529-534` (zero route callers); roles at `migrations/0005_learning.sql:37-44` |
| 6 | **`useFeed`'s unreachable interaction helpers** | Fully implemented optimistic like and save with rollback, plus `loadMore`, `prepend` and `replace`, invoked by no screen; post detail and the group page re-implement the same calls locally. *[in-flight: Phase C connects them at `app/(tabs)/index.tsx:256-257,269`]* | DEAD_CODE | `src/state/useFeed.ts:96-130,132-155,162,165-166` |
| 7 | **Orphaned i18n keys `app.name` and `app.tagline`** | The masthead renders the Latin literal "Student OS" — sanctioned by RTL rule 10 — which leaves the translated «منصة الطالب» with zero call sites, contradicting the rule it sits beside. | DEAD_CODE | literal at `app/(tabs)/index.tsx:101`; keys `src/i18n/ar.ts:9`, `src/i18n/en.ts:11` |
| 8 | **An untranslated accessibility label** | `accessibilityLabel="dismiss"` is announced in English to Arabic screen-reader users — the only untranslated a11y string found in an otherwise clean sweep. | PARTIAL | `src/components/ActionSheet.tsx:37` |
| 9 | **Repository clutter: a nested empty `apps/mobile/apps/mobile` tree** | Contains zero files. Not bundle content, but it is a trap for path-based tooling. | DEAD_CODE | audited directory tree, zero files under `apps/mobile/apps/mobile` |
| 10 | **Uncollected orphan uploads** | `listOrphanedFiles` has no callers, so never-attached uploads accumulate in the blob store indefinitely. | DEAD_CODE | `apps/api/src/modules/files/files.repository.ts:229-247` |

> **One unresolved conflict between auditors.** The pollution audit reports that the committed
> `apps/mobile/dist` is a preview export with the flag compiled true; the i18n audit reports that
> the same committed bundle contains no fixture strings and is therefore a non-preview build. Both
> claims are cited to the same artifact. This is **not established by the audit** and must be
> settled by inspecting the bundle before anything is deployed from it.

---

## 4. What this comparison concludes

1. **The gap is almost entirely an interface gap, not a capability gap.** The audit found zero
   `FRONTEND_ONLY` capabilities: no screen calls an endpoint that does not exist. Twelve capability
   groups are `BACKEND_ONLY` — complete, authorised, tested, and never asked for by any screen.
2. **Three absences break a first-run journey outright**, and none of them is a missing endpoint:
   a new account cannot start a conversation (`messaging.routes.ts:55-68`, no caller), an
   instructor cannot create a lecture (`classrooms.routes.ts:210-238`, no caller), and a clean
   database has no practice questions at all (`seed-demo.ts:169-225` is the only writer).
3. **One shipped number was false, and Phase C removed it rather than fixing it.** The profile
   contribution score was a `DEFAULT 0` column that no code in the repository ever writes
   (`migrations/0002_academic_hierarchy.sql:178`), previously rendered as the profile's headline
   figure. Preview fixtures made it look alive by fabricating a value
   (`src/preview/fixtures.ts:249,1161`); production always showed 0. Commit `5b6963a` deleted the
   render entirely (`app/profile/[handle].tsx:219-242`) rather than wiring a real computation — the
   correct near-term fix per this document's own §12 rule against showing a number nothing earned,
   though it leaves the underlying "what does contribution mean" product decision still open.
4. **The Today decision is the largest single item of design debt.** The owner's decision that
   Today is the primary academic social feed is recorded in code at `app/(tabs)/index.tsx:23`; the
   audited baseline implements the earlier read-only editorial specification, in which the feed row
   carries no like, save or comment control (`ContentGrammar.tsx:90-198`). Phase C is closing that
   gap in the working tree. The parts of the editorial grammar the decision does not overturn — no
   cards, no engagement metrics, classification rather than trending — remain binding.
5. **Preview mode is not hiding the product.** The gate is sound and gates nothing in production
   (`preview-mode.ts:40-48`, `session.tsx:152-160`). What preview mode did do was conceal the
   product's thinness from review, by fabricating the one number production cannot produce.
6. **Two blockers are not code.** Password-reset delivery needs an owner-provided email service
   (`mailer.ts:33-39`) and realtime messaging needs a socket-capable host
   (`netlify/api/handler.mts:34-39`). Both are stated honestly in the UI today, which is the
   correct posture; neither can be closed by writing more application code.
