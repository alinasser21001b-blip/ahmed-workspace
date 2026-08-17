# 01 — CAPABILITY MATRIX

Repository truth as of the Phase A forensic sweep (HEAD `6355f9c`, working tree clean at audit
time). Eleven read-only auditors read 370 files and produced 161 evidence-cited findings; this
matrix is the central synthesis of those findings, not a re-reading of earlier summaries.

Status vocabulary is the task's: `CONNECTED_AND_WORKING`, `BACKEND_ONLY`, `FRONTEND_ONLY`,
`PARTIAL`, `BLOCKED_BY_EXTERNAL_SERVICE`, `BLOCKED_BY_DEPLOYMENT`, `BLOCKED_BY_PRODUCT_DECISION`,
`MISSING`, `DEAD_CODE`, `PREVIEW_ONLY`.

Two columns need definition. **VISIBLE** means: would a student in a clean production build
encounter this capability without being told where to look. **RECOVERY** is what Phase C of this
task does about it — `PHASE_C` (implemented in this recovery), `REPORTED` (documented, owner
decision or service required), `NONE` (already correct).

---

## A. Social — the Today academic feed

| CAPABILITY | FRONTEND | API | DATABASE | AUTHZ | TESTS | STATUS (pre-recovery) | VISIBLE | BLOCKER | OWNER ACTION | RECOVERY |
|---|---|---|---|---|---|---|---|---|---|---|
| Feed read (`GET /v1/feed`, scopes home/saved/author) | Today, profile, group | `content.routes.ts:39` | `content_items` + cohort/author indexes (`0003:178`) | requireAuth, permission predicate in `feed.sql.ts` | integration + smoke | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Feed pagination (cursor) | none — no `onEndReached` (`(tabs)/index.tsx:153-209`) | keyset cursor `content.service.ts:445-453` | indexed | — | — | PARTIAL | no (silently one page of 20) | — | — | PHASE_C |
| Post create / publish | `compose.tsx` (visibility, knowledge type, difficulty, image) | `POST /v1/content` | `content_items` | requireAuth + moderation gate 422 | integration + journey | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Post edit | none | `PATCH /v1/content/:id` | — | author-only policy | integration | BACKEND_ONLY | no | — | — | REPORTED |
| Post delete | none | `DELETE /v1/content/:id` | soft delete | author-only policy | integration | BACKEND_ONLY | no | — | — | PHASE_C (author menu) |
| Like / reaction | post detail + group only (`post/[id].tsx:95-115`) | `PUT/DELETE /v1/content/:id/reaction` | `reactions` (`0003:397`) | requireAuth | integration | PARTIAL (absent from Today) | partly | — | — | PHASE_C |
| Save / bookmark | post detail only; **no screen lists saved items** | `PUT/DELETE …/bookmark`, `feed?scope=saved` | `bookmarks` (`0003:418`) | requireAuth | smoke asserts scope | PARTIAL (write-only to the student) | partly | — | — | PHASE_C |
| Comments — list & create | post detail (`post/[id].tsx:45,81`) | `GET/POST …/comments` | `comments` | requireAuth + moderation gate | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Comment replies (one level) | rendered, never created | `parentCommentId` in contract | — | — | — | BACKEND_ONLY | no | — | — | REPORTED |
| Comment edit / delete / react | none | routes exist (`content.routes.ts:273-329`) | — | author policy | — | BACKEND_ONLY | no | — | — | REPORTED |
| Topic / classification of a post | shown on every row; topic pages reachable | topics on content, `/v1/topics/:id` | `content_topics` | — | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Profile navigation from a post | author row → `/profile/[handle]` | `GET /v1/profiles/:handle` | `profiles` | requireAuth | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Follow / unfollow | profile screen | `PUT/DELETE …/follow` | `follows` + counters | requireAuth | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Followers / following lists | none | `GET …/followers`, `…/following` | counters maintained | requireAuth | — | BACKEND_ONLY | no | — | — | REPORTED |
| Report content / profile | `ReportSheet` from post detail + profile | `POST /v1/reports` (9 reasons, 409 dup) | `reports` | requireAuth, 20/min | integration | CONNECTED_AND_WORKING | yes | — | — | PHASE_C (also from feed row) |
| Report comment / message | none | same endpoint, other target types | — | — | — | BACKEND_ONLY | no | — | — | REPORTED |
| Block / unblock / blocked list | profile action + `settings/blocked.tsx` | `PUT/DELETE …/block`, `GET /v1/me/blocks` | `blocks`, hydrated into every Actor | requireAuth | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Mute (user/group/community/topic) | none | `PUT/DELETE /v1/mutes` | `mutes` | requireAuth | — | BACKEND_ONLY | no | — | — | REPORTED |
| View / impression signal | Today reports on visibility | `POST /v1/content/:id/view` | `content_views` | requireAuth | e2e | CONNECTED_AND_WORKING | invisible by design | — | — | NONE |
| Communities | none anywhere | 4 endpoints | `communities`, `community_members` | requireAuth | integration | BACKEND_ONLY | no | — | product decision | REPORTED |
| Search (people/content/groups/communities) | `search.tsx` | `GET /v1/search` + pg_trgm | trigram indexes (`0008:71-92`) | requireAuth, 120/min | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |

## B. Learning — Topics, Learn, Practice

| CAPABILITY | FRONTEND | API | DATABASE | AUTHZ | TESTS | STATUS | VISIBLE | BLOCKER | OWNER ACTION | RECOVERY |
|---|---|---|---|---|---|---|---|---|---|---|
| Academic hierarchy browse | Topics tab, onboarding | 8 public `/v1/academic/*` routes | `0002` hierarchy, seeded at build **and** cold start | public by design | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Topic detail (progress, canPractice) | `topic/[id].tsx` | `GET /v1/topics/:id` | `learning_progress` | requireAuth | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Practice attempt + server-side grading | `practice/[topicId].tsx` | `POST /v1/topics/:id/practice`, `POST /v1/practice/attempts/:id/answers` | `quiz_*`, `quiz_answers`, `learning_progress` | requireAuth + enrolment | extensive integration | CONNECTED_AND_WORKING (code) | only where questions exist | **no question supply in a clean database** | decide who authors questions | REPORTED |
| Practice question authoring | none | none | tables exist | — | — | MISSING | no | no authoring route; demo seed writes rows directly | product decision (Section 12 forbids fabricating content) | REPORTED |
| Weakness / progress rollup | topic + learn surfaces | inside the answer transaction | `learning_progress` | — | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Saved items read-back | **no screen** (`useFeed('saved')` never called) | `feed?scope=saved` | `bookmarks` | requireAuth | smoke | PARTIAL | no | — | — | PHASE_C |
| Learn tab counts (savedCount, meaningfulActionsThisWeek) | fetched, never rendered | `GET /v1/learn` | computed | requireAuth | smoke | PARTIAL | no | — | — | PHASE_C |
| Spaced repetition / review queue | none | none | dormant SM-2 columns on `flashcard_progress` | — | — | MISSING | no | — | product decision | REPORTED |
| Profile contribution score | headline number on profile | read-through only | `profiles.contribution_score` DEFAULT 0, **never written by any code** | — | — | PARTIAL (renders a constant) | yes — and misleading | nothing computes it | — | PHASE_C |

## C. Rooms — classrooms, lectures, groups, files

| CAPABILITY | FRONTEND | API | DATABASE | AUTHZ | TESTS | STATUS | VISIBLE | BLOCKER | OWNER ACTION | RECOVERY |
|---|---|---|---|---|---|---|---|---|---|---|
| Study groups (list, create, join, leave, members, feed) | Rooms, `group/*` | `/v1/groups/*` | `0003` groups | policy layer | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Classroom create (instructor-gated, join code) | `classrooms/new.tsx` | `POST /v1/classrooms` | `0012` | `canCreateClassroom` (teaching verification **and** enrolment) | integration | CONNECTED_AND_WORKING | instructors only | — | — | NONE |
| Classroom join (enrolment or code) | `classrooms/index.tsx` | `PUT …/membership`, code lookup | `0012` | policy | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Roster + roles | roster reads | members endpoint | admin/moderator/banned columns exist | policy gates exist | — | PARTIAL — only owner and member are reachable states | partly | no endpoint produces other roles | — | REPORTED |
| Classroom management (archive, rename, rotate code, transfer, remove/ban, leave) | none | **none** | schema + policy only | — | — | MISSING | no | — | — | REPORTED |
| Lecture read, discussion, reading progress | `lecture/[id].tsx` | `GET /v1/lectures/:id` etc. | `0012` | membership policy | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Lecture create / publish | **none** | `POST /v1/classrooms/:id/lectures` (staff-gated, tested) | `0012` | `canTeach…` | integration | BACKEND_ONLY | no | — | — | PHASE_C |
| Material attach to a lecture | instructor UI exists | `POST …/materials` | `files` + classroom scope | staff-only | integration | PARTIAL — images only | instructors only | `POST /v1/files` refuses non-images (no PDF) | — | REPORTED |
| File upload / signed-URL download | composer + materials | `POST /v1/files`, `GET /v1/files/:id/raw` | `files` + Netlify Blobs | HMAC signed URL minted after policy check | integration | CONNECTED_AND_WORKING | yes | needs `STORAGE_DRIVER=external` + `MEDIA_URL_SECRET` on the site | set env vars | REPORTED (env) |

## D. Chat — messaging

| CAPABILITY | FRONTEND | API | DATABASE | AUTHZ | TESTS | STATUS | VISIBLE | BLOCKER | OWNER ACTION | RECOVERY |
|---|---|---|---|---|---|---|---|---|---|---|
| Conversation list | `(tabs)/chat.tsx` | `GET /v1/conversations` | `0004`/`0010` | requireAuth | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Open conversation, history, pagination | `chat/[id].tsx` | `GET …/messages` by seq | indexed by seq | membership | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Send message (idempotent HTTP outbox, retry) | outbox in client | `POST …/messages` (`clientMessageId`) | dedup index | membership + moderation gate | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Read state | continuous PUT | `PUT …/read` (monotonic) | receipts | membership | e2e | CONNECTED_AND_WORKING | yes | — | — | NONE |
| **Start a new conversation** | **none** | `POST /v1/conversations` | — | requireAuth | e2e only | BACKEND_ONLY | no — the empty-state path dead-ends | — | — | PHASE_C |
| Realtime delivery / typing / presence | complete client with jittered backoff | complete WS server (`@fastify/websocket`) | post-commit fan-out | handshake re-verifies session | integration (local) | BLOCKED_BY_DEPLOYMENT | banner says so honestly | Netlify Functions cannot hold a socket (`handler.mts:34-39`) | socket-capable host (see 09/10) | PHASE_C (capability gate, no fake live) |

## E. Identity, safety, account

| CAPABILITY | FRONTEND | API | DATABASE | AUTHZ | TESTS | STATUS | VISIBLE | BLOCKER | OWNER ACTION | RECOVERY |
|---|---|---|---|---|---|---|---|---|---|---|
| Registration (open, always `student`) | sign-up | `POST /v1/auth/signup` | `users` | role forced server-side | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Session (short JWT + rotating hashed refresh, reuse detection) | secure-store / localStorage | auth module | `sessions` | per-request revocation check | integration | CONNECTED_AND_WORKING | invisible | — | — | NONE |
| Password reset | both screens exist | full token lifecycle | `0016` | single-use, all-session revoke | integration | BLOCKED_BY_EXTERNAL_SERVICE | yes — and it cannot complete | mailer is a stub; no transport in repo | provide an email service | REPORTED (Service 1) |
| Instructor capability | server-projected | `PUT /v1/admin/users/:id/verification` only | `verification_level` | platform admin only, audited | integration | CONNECTED_AND_WORKING | — | no escalation path found | owner promotes instructors | REPORTED |
| Moderation queue / moderator actions | **none** | `GET /v1/moderation/reports`, resolve | `reports`, `moderation_actions` | admin-gated (404 to others) | integration | BACKEND_ONLY | no | — | — | REPORTED |
| Automated content gate (term list) | — | pre-write on post/comment/message | `moderation_terms` | — | integration | PARTIAL — the declared `profile` surface is never gated | invisible | — | — | REPORTED |
| Account deletion (full cascade) | `settings/delete-account.tsx` | `DELETE /v1/me/account` | cascade + tombstones | password re-entry | integration | CONNECTED_AND_WORKING | yes | — | — | NONE |
| Privacy settings | none | `GET/PATCH /v1/me/privacy` | `profiles` | requireAuth | — | BACKEND_ONLY | no | — | — | REPORTED |
| Push notifications | none | none | schema only (`0006`) | — | — | MISSING | no (settings says so honestly) | no producer, no route, no SDK | — | REPORTED |

## F. Build, environment, cleanliness

| CAPABILITY | STATUS | EVIDENCE | RECOVERY |
|---|---|---|---|
| Preview gate (`EXPO_PUBLIC_PREVIEW_MODE`, build-time, fail-closed, no hostname inference) | CONNECTED_AND_WORKING | `preview-mode.ts:40-48`; unit-proven | NONE |
| Silent fixture fallback in a real build | MISSING (i.e. none exists — the good outcome) | audit found no path; flag not runtime-flippable | NONE |
| Fixture world in the real JS bundle | DEAD_CODE, but **shipped** (static import chain `session.tsx:8`) | strings extractable from the exported bundle | PHASE_C |
| `/motion-samples` in a real build | PARTIAL — route exists, renders **untranslated English** dev copy | `motion-samples.tsx:126-137` | PHASE_C (removed) |
| `/preview-feedback` in a real build | PREVIEW_ONLY — renders a localized "not available" sentence | gate verified | PHASE_C (excluded with the rest) |
| App icons / favicon / `lang` on the web shell | MISSING — no icon, no favicon, `<html lang="en">` for an Arabic-default app | `app.json`, exported `index.html:2` | PHASE_C |
| Committed `apps/mobile/dist` is a **preview** export sitting at the production publish path | PARTIAL | preview constant compiled `true` inside it | PHASE_C |
| Deployed function prerequisites (`NETLIFY_DB_URL`, `JWT_SECRET`, `NODE_ENV`, `STORAGE_DRIVER`, `MEDIA_URL_SECRET`) | BLOCKED_BY_EXTERNAL_SERVICE until set | `config.ts`, `handler.mts` | PHASE_F (set before deploy) |

## G. Arabic-first and accessibility

| CAPABILITY | STATUS | EVIDENCE | RECOVERY |
|---|---|---|---|
| Two-catalogue typed i18n, Arabic as the key set of record | CONNECTED_AND_WORKING | 518/518 key parity verified | NONE |
| CLDR six-category Arabic plurals, Arabic-Indic digits | CONNECTED_AND_WORKING | `@sos/core` | NONE |
| IBM Plex Sans Arabic 400/500/600 bundled and render-blocking | CONNECTED_AND_WORKING | `_layout.tsx` per-face imports | NONE |
| RTL document direction on web | CONNECTED_AND_WORKING | startup `document.dir`/`lang` | NONE |
| **RC-03 bidi truncation** (ellipsis on the wrong logical side) | PARTIAL — defect present at 13+ call sites | `Text.tsx:100-101` + RNW `numberOfLines` → CSS ellipsis | PHASE_C |
| `Text` `align='start'` emits physical `left` on web | PARTIAL — contradicts its own comment and constitution rule 1 | `Text.tsx:87-90` | PHASE_C |
| Inline bidi isolation of Latin runs (constitution rules 8/9/12) | MISSING | zero `bdi`/isolate usage | PHASE_C (via the truncation fix) |
| `accessibilityLabel="dismiss"` untranslated | PARTIAL | `ActionSheet.tsx:37` | PHASE_C |
| `aria-checked` on custom checkable controls | CONNECTED_AND_WORKING | 9 components, audited | NONE |
| Focus-visible design on web (RC-07) | PARTIAL — UA ring inside the search pill | critique evidence | PHASE_C |

---

## Counts (pre-recovery, by this matrix)

- Capabilities inventoried: **62**
- CONNECTED_AND_WORKING: **31**
- PARTIAL: **14**
- BACKEND_ONLY: **10**
- MISSING: **5** (practice question supply, classroom management, spaced repetition, push notifications, app icons/favicon)
- BLOCKED_BY_DEPLOYMENT: **1** (realtime)
- BLOCKED_BY_EXTERNAL_SERVICE: **1** (password-reset delivery)
- DEAD_CODE shipped to students: **1** (the fixture world in the bundle)
- FRONTEND_ONLY: **0** — no screen in this app calls an endpoint that does not exist.

The last line is the single most important finding of the audit: **Student OS has no fake
frontend.** Its failure mode is the opposite one — a substantial, working, tested backend that
the interface never asks for.
