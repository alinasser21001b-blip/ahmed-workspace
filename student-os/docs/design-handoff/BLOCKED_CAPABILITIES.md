# Blocked capabilities

Audited at `main` / `8d7541ddd7e4`, **re-checked against merged `main` (tree `aadae41ee191`) 2026-08-15**. **15 blocked, 3 deferred, 1 external.** No document in this handoff may present any of these as implemented.

Rows 4 (report) and 5 (account deletion) left this list at the re-check: both ship in merged `main`. Row 18 (iPad) left it because the decision was made — `supportsTablet: false`. They are kept below, struck through, so the numbering that other documents cite stays stable.

## BLOCKED_BY_PRODUCT_CAPABILITY

| # | Capability | What exists | What is missing | Design contract | P |
| --- | --- | --- | --- | --- | --- |
| 1 | **Topic search** | topics, relations, normalisation | endpoint, index, result type | `16` §deferred | P0 |
| 2 | **Classroom search** | classrooms | endpoint, result type | `16` §deferred | P1 |
| 3 | **Notification delivery** | enum, `NOTIFICATION_RULES`, collapse windows, tables (0006), push-token storage, outbox | **producer, outbox drain, routes, client, push flow** | `19` (full) | P1, XL |
| ~~4~~ | ~~**Report content/user**~~ | **RESOLVED — SUPPORTED_NOW.** Request contract and `reports` table since Phase 3/6; moderator reader, server-side moderation and `ReportSheet.tsx` in merged `main` | — | `24` | closed |
| ~~5~~ | ~~**Account deletion**~~ | **RESOLVED — SUPPORTED_NOW.** `DELETE /v1/me/account`, hard delete, no retention window, counts-only receipt, client screen | two copy strings (P0) | `24` | closed |
| 6 | Structured message references | messages | reference union type | `09` `SharedAcademicReference` | P2 |
| 7 | Message attachments | post uploads (8 MB, 4 MIME) | conversation media field | none | P2 |
| 8 | Lecture ↔ Topic linkage | lectures, topics | the join | none | P2 |
| 9 | Lecture ↔ Practice | follows from 8 | — | none — no affordance drawn | P2 |
| 10 | Presence / online status | the *settings* `showOnlineStatus`, `showLastSeen` | a presence channel | none — **do not ship the toggles** | P2 |
| 11 | Prerequisite relations | `topic_relations` | prerequisite type + traversal | forbidden in `09` | — |
| 12 | Adaptive sequencing | bank order | any adaptation | forbidden | — |
| 13 | Recommendation engine | `rankWeakTopics`, `feed-ranking` — **rankings, not recommendations** | — | forbidden | — |
| 14 | Spaced repetition | `RECENCY_HALF_LIFE_DAYS` as a staleness weight | scheduler, intervals, due dates | forbidden | — |
| 15 | Mastery / readiness | nothing | — | forbidden in `13` | — |
| 16 | Study path / resume across topics | per-topic attempts | a path object | none | — |
| 17 | Causal weakness attribution | co-occurrence relations | inference | "Also appears in" is labelled derived | — |

## DEFERRED_PRODUCT_DECISION

| # | Decision | Why it is a decision, not a gap |
| --- | --- | --- |
| ~~18~~ | ~~**iPad**~~ | **DECIDED — V1 is iPhone-only.** `app.json` carries `supportsTablet: false`. DESIGN_BLOCKER_IPAD closed; no tablet layout is in scope. |
| 19 | **Follower counts** | `followerCount`/`followingCount` exist. Design omits them to keep contribution the only metric. Reversible by product decision. |
| 20 | **Compose drafts** | No persistence. A product feature, not a design omission. |
| 21 | **Dark theme** | `darkColors` exists and `userInterfaceStyle: automatic` is declared, but no dark screen has been reviewed. Review it or lock to light. |
| 22 | **Web target** | `web.output: single` is real; measure and keyboard behaviour unresolved. |

## EXTERNAL_RELEASE_DEPENDENCY

| # | Dependency |
| --- | --- |
| 23 | Privacy policy and Terms URLs, a support contact route, **and Arabic translations of both legal documents** — Arabic is the default locale, so English-only legal copy is the majority path. |

## Corrected from earlier turns — no longer blocked

| Previously claimed blocked | Truth |
| --- | --- |
| Resumable partial practice attempts | **Supported.** `practiceQuestion.answered`, `practiceAnswerResult.alreadyAnswered`, persistent `attemptId`. |
| Follower counts | **The fields exist.** Now a product decision (19). |
| Confidence data | **`confidence` and `weaknessScore` exist.** Displaying them as ability is forbidden; the data is not missing. |
| Block/unblock | **Implemented end to end.** `app/settings/blocked.tsx` plus profile entry points → SUPPORTED_NOW. |
| Report content/user | **Implemented.** The "nothing exists" claim was wrong at audit time — the request contract and table predate the audit by three phases. |
| Account deletion | **Implemented.** Hard delete with re-auth and a typed literal. The blocked entry is closed; what remains is copy, not capability. |
| Password reset | **Implemented** (`(auth)/forgot-password.tsx`, `reset-password.tsx`, migration 0016, `mailer.ts`) — never blocked. Specified at the contract-reconciliation pass as screens 38–39 in `20-AUTH-ONBOARDING.md`. |
