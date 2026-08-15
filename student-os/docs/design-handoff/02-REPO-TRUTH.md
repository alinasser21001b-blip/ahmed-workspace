# Repository truth

Audited at `main` / `8d7541ddd7e4`, then **re-checked against merged `main` (tree `aadae41ee191`) on 2026-08-15** after the engineering branch merged. This file overrides any status claimed elsewhere in the handoff or in the design frames. Where the two passes disagree, the re-check in § *Post-merge re-check* wins — it read the merged tree, not the audit marker.

## Reconciliation of every Turn 1–5 finding

### 1. follow/unfollow uses group join/leave terminology
- **Repo truth:** `profile/[handle].tsx` renders the follow control from the `groups.join` / `groups.leave` translation keys. `Relationship` and the follow/unfollow routes are real (`social.routes.ts`).
- **Final design treatment:** dedicated keys `social.follow` / `social.following` / `social.unfollow`. The control reads "Follow" when not following and "Following" (outlined) when following; unfollow is a confirm on the "Following" control, not a second button.
- **Impact:** two new translation keys per locale, one string swap. No contract change.
- **Owner:** mobile.
- **Status:** DESIGN_READY_CODE_REQUIRED.

### 2. Duplicated resume/continue between Home and Learn
- **Repo truth:** both surfaces can independently surface the same practisable topic. No dedupe rule exists.
- **Final design treatment:** Learn owns the resume band. Home shows it **only** when the learner has an open attempt (`attemptId` with unanswered questions) and never otherwise; when both would render, Home suppresses. One rule, stated in `11-HOME.md`.
- **Impact:** a suppression condition in the Home query/selector.
- **Owner:** mobile.
- **Status:** DESIGN_READY_CODE_REQUIRED.

### 3. Group vs Classroom distinction in Search
- **Repo truth:** `SearchResults` returns `groups` and `communities`. Classrooms are not a result type at all, so today there is no collision — the confusion is between study groups and communities.
- **Final design treatment:** separate section headings with distinct nouns — "Study groups" (member-formed, membership policy) and "Communities" (official/topic-scoped, carries an "Official" label). When classroom search lands, a third heading "Classrooms" with course code as its metadata line.
- **Impact:** heading copy plus the Official label; no new component.
- **Owner:** mobile.
- **Status:** SUPPORTED_NOW for groups/communities; the classroom heading is BLOCKED (see 5).

### 4. Search cannot return Topics
- **Repo truth:** confirmed. `search.tsx` handles people, content, groups, communities. No topic branch, no topic search endpoint.
- **Final design treatment:** design contract written in `16-SEARCH.md` §deferred — a "Topics" section, rows of topic name + course metadata + coverage fraction where the viewer has one. **Not to be rendered before the capability exists.**
- **Impact:** search endpoint + index + result union member + client section.
- **Owner:** backend, then mobile.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY. P0 — this is the single largest architectural gap; the topic graph that Learn, Topic and Practice are built on is unreachable from the screen whose job is navigation.

### 5. Search cannot return Classrooms
- **Repo truth:** confirmed absent.
- **Final design treatment:** contract in `16-SEARCH.md` §deferred. Row is classroom title + course code + member count; the viewer's membership state decides the destination (room vs join view).
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY. P1.

### 6. Notifications: schema and vocabulary without producer, route or client
- **Repo truth:** `domain-events.ts` carries the event enum and `NOTIFICATION_RULES` including collapse windows; migration 0006 adds tables; push-token storage exists. There is **no producer draining the outbox, no API route, and no client screen**.
- **Final design treatment:** full tray grammar specified in `19-NOTIFICATIONS.md`, including the two deliberate silences (group removal, rejected correction).
- **Impact:** event producer, outbox drain, list + read-state routes, client route, push registration.
- **Owner:** backend first.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY. Push-token storage existing is **not** evidence of a working push system.

### 7. Structured message references
- **Repo truth:** `messaging.contract.ts` message body plus deletion timestamp. No reference/attachment union for topics, posts, classrooms or sources.
- **Final design treatment:** none drawn. `SharedAcademicReference` is specified in `09-COMPONENTS.md` as a **contract-only** component so the shape is agreed before backend work.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY. P2.

### 8. Message attachments
- **Repo truth:** `files.contract.ts` supports upload for posts — `MAX_IMAGE_BYTES` 8 MB, `MAX_MEDIA_PER_POST` 4, four MIME types validated by magic bytes. Conversations have no media field.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY. P2.

### 9. Compose draft behaviour
- **Repo truth:** no draft persistence. Text is in component state.
- **Final design treatment:** no "saved" affordance, no draft list, no restore promise. Offline state says "Your text is kept here" — true only for the mounted screen, and the copy is deliberately scoped to "here".
- **Status:** DEFERRED_PRODUCT_DECISION — drafts are a product feature, not a design gap.

### 10. Prerequisite semantics
- **Repo truth:** `topic_relations` exists; no prerequisite type and no traversal.
- **Final design treatment:** relationship labels are limited to "Part of", "Types", "Seen with". "Study this first", "recommended next" and any dependency language are forbidden. See `18-RELATIONSHIP` in `09-COMPONENTS.md`.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY.

### 11. Resumable partial Practice attempts — **CORRECTED, now supported**
- **Repo truth:** `practiceQuestionSchema.answered` exists expressly "so the client can resume rather than re-ask"; `practiceAnswerResultSchema.alreadyAnswered` reports a no-op re-submission; `attemptId` identifies the attempt.
- **Final design treatment:** re-entering a topic with an open attempt resumes at the first unanswered question. Answered questions are not re-asked. A re-submission returning `alreadyAnswered: true` shows the stored result and **must not** animate an evidence delta, because no counter moved.
- **Impact:** client must persist/resume `attemptId` and honour `answered`.
- **Owner:** mobile.
- **Status:** SUPPORTED_CONTRACT_NOT_UI. Previously and wrongly listed as blocked.

### 12. Lecture → Topic linkage
- **Repo truth:** `classroom.contract.ts` lectures carry materials; no topic linkage.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY. P2.

### 13. Lecture → Practice linkage
- **Repo truth:** follows from 12 — practice is reachable only from a topic.
- **Final design treatment:** no "practise this lecture" control anywhere.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY.

### 14. Learner-model claims
- **Repo truth:** `weakness.ts` computes `weaknessScore`, `confidence`, `accuracy`; `topicProgressSchema` returns `questionsSeen`, `questionsCorrect`, `weaknessScore`, `confidence`, `lowConfidence`, `lastActivityAt`. The file's own header states these are signals, not learning.
- **Final design treatment:** `19-LEARNING-EVIDENCE` in `13-PRACTICE.md`. Displayable: answered count, correct count, coverage, before/after pair, low-sample caveat. Not displayable: any of these as a percentage of ability, any word implying knowledge.
- **Status:** SUPPORTED_NOW for the permitted set.

### 15. Recommendation / adaptive behaviour
- **Repo truth:** `rankWeakTopics` orders topics by weakness × confidence and excludes samples under 5. That is a **ranking**, not a recommendation engine; there is no scheduler and no adaptive sequencing. `feed-ranking.ts` ranks the feed.
- **Final design treatment:** Learn may order topics by this ranking and must describe it factually ("Recent answers suggest difficulty"). No "recommended for you", no "next best topic".
- **Status:** SUPPORTED_NOW as ranking; adaptive sequencing BLOCKED_BY_PRODUCT_CAPABILITY.

### 16. Spaced repetition
- **Repo truth:** absent. `RECENCY_HALF_LIFE_DAYS = 14` is a staleness weight inside the weakness score, not a schedule.
- **Final design treatment:** no due counts, no review dates, no intervals, no streaks.
- **Status:** BLOCKED_BY_PRODUCT_CAPABILITY.

### 17. Mastery / confidence terminology
- **Repo truth:** no mastery field. `confidence` exists and means **how far the sample supports the score** — a property of the evidence, not of the learner.
- **Final design treatment:** the word "confidence" is banned from learner-facing copy because it will be read as self-assurance. Surface it only as the low-sample sentence. "Mastery", "readiness", "score out of 100" are forbidden outright.
- **Status:** SUPPORTED_NOW under this naming discipline.

## Platform truth

| Fact | Source | Consequence |
| --- | --- | --- |
| `supportsTablet: false` | `app.json` (merged `main`, line 33) | **V1 is iPhone-only.** The product decision is made and the repo already carries it, so DESIGN_BLOCKER_IPAD is closed. A tablet layout is not a design target and phone-at-tablet-width is not shippable. |
| `orientation: portrait` | `app.json` | Landscape is not a design target. |
| `web.output: single` | `app.json` | A web target exists; keyboard focus rules in `23` apply there. |
| Locale resolves to `ar` unless device is `en` | `app/_layout.tsx` | **Arabic is the default.** Any Arabic defect is a majority-path defect. |
| `signupRequest.locale` defaults `'ar'` | `auth.contract.ts` | Same. |
| Direction applied once before first paint | `app/_layout.tsx` | No runtime direction flip. A language switch requires a reload — do not design a live toggle. |
| `MIN_TOUCH_TARGET = 44` | `tokens.ts` | Binding minimum; `23` raises it to 48 for list rows. |
| Grading only in `@sos/core` | `grading.ts` | Client never sends or pre-computes correctness. |
| `correctOptionIds` revealed only after answering | `practice.contract.ts` | No option may hint at correctness pre-submission. |
| Empty selection is a valid answer | `practice.contract.ts` | Submit must be enabled with nothing selected. See `13`. |
| Question kinds: `mcq_single`, `mcq_multi`, `true_false` | `practice.contract.ts` | Three kinds to design, not one. `short_answer` is excluded server-side. |
| Six message states | `message-state.ts` | queued, sending, sent, delivered, read, failed. |
| Retry: 5 attempts, exponential from 1 s, cap 30 s | `message-state.ts` | Failed is terminal until retried. |
| Arabic has six plural categories | `arabic.ts` | Counts must go through `selectPlural`, never concatenation. |
| Arabic search folds hamza/ta-marbuta/alef-maqsura/tatweel/digits | `arabic.ts` | Tashkeel and alef-madda fall below the 0.15 similarity floor — a real empty-result cause. |
| No Arabic stemming or root analysis | `arabic.ts` | كتاب/كتب do not match. Empty-state copy must not promise smart search. |
| Block/unblock implemented, **and now has UI** | `social.*`, `app/settings/blocked.tsx`, `app/profile/[handle].tsx`, `src/components/ActionSheet.tsx` | SUPPORTED_NOW. The blocked-accounts list exists; block/unblock is reachable from the profile. |
| **Report implemented** | `POST /v1/reports` (contract since Phase 3), `GET/POST /v1/moderation/reports`, `src/components/ReportSheet.tsx`, `packages/core/src/moderation/moderation.ts`, migration 0015 | SUPPORTED_NOW. The earlier "nothing exists" claim was wrong in both passes — see § *Post-merge re-check*. |
| **Account deletion implemented** | `DELETE /v1/me/account`, `account.{routes,service,repository}.ts`, `packages/contracts/src/users/account.contract.ts`, `app/settings/delete-account.tsx`, migration 0015 | SUPPORTED_NOW. Hard delete, no retention window. Behaviour and the copy it forces are in `24-APP-STORE-SURFACES.md`. |
| Password reset implemented | `app/(auth)/forgot-password.tsx`, `reset-password.tsx`, migration 0016, `platform/mailer.ts` | SUPPORTED_NOW, **and now specified** — `20-AUTH-ONBOARDING.md` §Forgot password, §Reset password. |
| Settings root exists | `app/settings/index.tsx` | SUPPORTED_NOW. Account / Support &amp; privacy / Delete account groups. |
| Privacy settings contract exists | `users.contract.ts` | SUPPORTED_CONTRACT_NOT_UI. |
| `verificationLevel`, `teachingEligible` | `auth`/`users` contracts | The instructor shield and teaching affordances are real. |
| `followerCount`, `followingCount` exist | `users.contract.ts` | Omission is a product decision — record it, do not call it blocked. |


## Post-merge re-check — merged `main`, tree `aadae41ee191`, 2026-08-15

Four commits landed between the audited marker `8d7541ddd7e4` and merged `main`; 70 files under `student-os/` changed. The re-check read the merged tree. Six status claims in this handoff were stale, and one was wrong at audit time.

| # | Claim as frozen | Merged-`main` truth | New status |
| --- | --- | --- | --- |
| 18 | Account deletion: "nothing exists: no route, no endpoint, no job" | `DELETE /v1/me/account` with a re-auth + typed-`DELETE` gate, one transaction ending in `DELETE FROM users`, storage objects removed after commit, a counts-only receipt in `account_deletions` | SUPPORTED_NOW |
| 19 | Report: "no report table, route, reason enum or moderation queue" | **Wrong at audit time.** `account.contract.ts:77` and `docs/app-store/00-READINESS-AUDIT.md:42` both record the request contract and `reports` table as existing since Phase 3/6. Merged `main` adds the moderator reader and `ReportSheet.tsx` | SUPPORTED_NOW |
| 20 | `supportsTablet: true` → DESIGN_BLOCKER_IPAD | `app.json:33` is `false` | closed; V1 iPhone-only |
| 21 | Block/unblock: route absent | `app/settings/blocked.tsx` + profile entry points ship | SUPPORTED_NOW |
| 22 | Auth covers sign-in, sign-up, onboarding, session restore | Password reset ships as two further screens | SUPPORTED_NOW, undesigned |
| 23 | Settings routes "all new" | `app/settings/index.tsx` ships | SUPPORTED_NOW |

### Unchanged by the merge

Every blocked capability other than report and deletion is still blocked, and each was re-read rather than recalled: topic search and classroom search have no endpoint; notifications still have schema and rules with no producer, drain, route or client; structured message references, message attachments, lecture↔topic, lecture↔practice, presence, prerequisites, adaptive sequencing, recommendation, spaced repetition, mastery, study path and causal attribution are all still absent. The implementation debt list in `FINAL-FREEZE.md` is also unchanged: `practice/[topicId]` is still unregistered in `app/_layout.tsx`, `colors.learning` still carries learning actions, and `typography.micro` still exists.

### Contract mismatches found at the re-check — all three now closed

| Mismatch | Resolution | Where |
| --- | --- | --- |
| Report shipped as a `Modal`; the contract asked for a pushed route | **Contract changed to the modal.** V1 keeps `ReportSheet.tsx`; no new route. The original intent survives as three constraints on the modal: screen-filling, deliberate dismissal only, owns focus | `24` §Report |
| Deletion shipped two steps against a seven-step contract | **Lifecycle made explicit across two routes** — entry, warning, confirmation, processing, success, failure, retry/support, each binding on behaviour and copy, none requiring its own composition | `24` §Account deletion |
| Password reset shipped with no visual specification | **Specified** in the frozen auth grammar — routes, hierarchy, error mapping, RTL and accessibility behaviour, no new direction | `20` §Forgot password, §Reset password |

The typed confirmation being the literal `DELETE` rather than the handle is likewise closed: the implementation's reasoning (an untranslated literal keeps the API's meaning independent of `Accept-Language`) stands, and `24` is written to it.

### Implementation debt, not contradictions

1. **`micro` (11/16) is retired and must not be used by final UI.** `settings/index.tsx` and `settings/delete-account.tsx` render `variant="micro"`. These are **call sites to remove**, not a surviving token — re-point to the 13/20 metadata role and delete the token. `06-TYPOGRAPHY.md`, `05-TOKENS.md` §4. P0.

### Both open decisions closed

`settings.deleteAccount.confirmTitle` is **deleted** from `en.ts` and `ar.ts` — dead, and not promoted to a heading. Password-reset copy is standardised on the capability-neutral **"reset link or code"** across both screens, which settles the link-versus-code inconsistency without asserting a mail template. Deep-link pre-fill and typed-token entry are unchanged. **No open documentation decisions remain.**