# Implementation plan

Priorities: **P0** product truth, safety, core loop · **P1** coherent launch UX · **P2** post-launch. Complexity S/M/L/XL. No time estimates.

## P0

| # | Item | Scope | Files | Backend | Migration | Contract | Components | Tests | RTL risk | A11y risk | Size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Token reconciliation** | rename `learning`→`provenance`, re-point call sites to ink, add paper ramp + 3 semantic roles, delete `micro` | `src/theme/tokens.ts` + every screen | no | no | no | — | snapshot per screen | low | **high** — contrast regressions if partially applied | M |
| 2 | **Register the Practice route** | `fullScreenModal`, no tab bar | `app/_layout.tsx` | no | no | no | — | nav test | low | low | S |
| 3 | **Practice loop + all states** | 3 question kinds, 6 states, resume, submit-failure, evidence delta | `app/practice/[topicId].tsx`, `src/state/practice.ts`, `src/components/practice/*` | no | no | no | PracticeHeader, Stem, AnswerOption, FeedbackPanel | state-machine unit + Detox loop | med | **high** — announcement order | L |
| 4 | **Evidence copy discipline** | ban mastery/confidence wording; render server `lowConfidence`; never compute a threshold | Learn, Topic, Practice, i18n | no | no | no | EvidenceFraction | copy lint / review | med | low | S |
| 5 | **Refetch on return from Practice** | invalidate topic + learn queries | practice state, both screens | no | no | no | — | Detox: delta visible after return | low | low | S |
| 6 | **Search: Topics** | endpoint, index over `sos_normalize_arabic`, result union, client section | `app/search.tsx`, api search module, migration | **yes** | **yes** | **yes** | SearchResultRow | api + client | med | low | L |
| ~~7~~ | ~~**Account deletion**~~ **DONE** | shipped in merged `main`; two copy strings remain (P0) | `app/settings/delete-account.tsx`, `modules/account/*` | done | done | done | — | integration tests exist | — | — | **XS (copy only)** |
| ~~8~~ | ~~**Report content/user**~~ **DONE** | shipped; **the modal is the V1 contract** — `24` updated, no route to build | `src/components/ReportSheet.tsx`, `modules/moderation/*` | done | done | done | — | api + client | — | — | **closed** |
| ~~9~~ | ~~**iPad decision**~~ **DECIDED** | `supportsTablet: false` — V1 is iPhone-only, already in `app.json` | `app.json` | no | no | no | — | — | — | — | **done** |
| 9a | **Deletion copy correction** | `settings.deleteAccount.body` promises message erasure the backend does not perform; add the survives line | `src/i18n/en.ts`, `ar.ts` | no | no | **yes** | — | copy review | **high** | low | **XS, P0** |
| 9b | **`micro` call-site removal** | `micro` is **retired**; re-point both call sites to 13/20 metadata and delete the token with item 1 | `settings/index.tsx`, `settings/delete-account.tsx`, `src/theme/tokens.ts` | no | no | no | — | visual | low | low | **XS, P0** |
| 9c | **Deletion lifecycle states** | implement the seven states from `24` on the two existing routes; add the support link on the generic failure branch; delete `confirmTitle` | `app/settings/delete-account.tsx`, `src/i18n/*` | no | no | no | — | manual | low | med | **S** |
| 9d | **Password-reset conformance** | conform both shipped screens to `20` §Forgot/Reset — sent-state focus + live region, deep-link token pre-fill, error mapping | `app/(auth)/forgot-password.tsx`, `reset-password.tsx` | no | no | no | — | manual | med | med | **S** |
| 9e | **Final copy edits** | delete `settings.deleteAccount.confirmTitle`; set the three standardised reset strings ("reset link or code") in both locales | `src/i18n/en.ts`, `ar.ts` | no | no | no | — | copy review | low | low | **XS, P0** |
| 10 | **Accessibility device pass** | VoiceOver (ar + en) and TalkBack over the loop, Compose, Conversation | — | no | no | no | — | manual | — | — | M |
| 11 | **Arabic plural audit** | every count through `selectPlural` | `src/i18n/ar.ts`, all surfaces | no | no | no | — | unit per phrase | **high** | low | M |

## P1

| # | Item | Files | Backend | Components | RTL risk | Size |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | Home/Learn resume dedupe (suppression rule) | Home selector | no | — | low | S |
| 13 | Follow/unfollow semantics + keys | `profile/[handle].tsx`, i18n | no | RelationshipAction | low | S |
| 14 | Group / Classroom / Community differentiation | search + both detail screens, i18n | no | SearchSectionHeader | low | M |
| 15 | Editorial rebuild of Home | `(tabs)/index.tsx`, retire `KnowledgeBadges` | no | ContentGrammar, ProvenanceLine | med | L |
| 16 | Learn + Topic rebuild | both screens | no | EvidenceFraction, RelationshipPrimitive, TopicRow | med | L |
| 17 | Message states 4–6 (queued, delivered, read) | `chat/[id].tsx`, outbox | partial (receipts) | MessageBubble | low | M |
| 18 | Restricted composer removal (not disable) | `chat/[id].tsx` | no | Composer | low | S |
| 19 | Compose classification visibility + validation | `compose.tsx` | no | ChipPicker, ValidationMessage | med | M |
| 20 | Classroom member/non-member split | `classrooms/[id].tsx` | no | ClassroomActivityRow | low | M |
| 21 | Privacy settings UI (5 shippable fields) | `settings/privacy.tsx` | no | AcademicRow | low | M |
| 22 | Block/unblock UI | profile overflow + dialog | no | — | low | S |
| 23 | Font loading + script-aware display | root, `Text.tsx` | no | EditorialHeading | **high** | M |
| 24 | Search: Classrooms | search module, client | **yes** | SearchResultRow | med | M |
| 25 | Notifications execution path | producer, outbox drain, routes, client, push | **yes** | NotificationRow | med | **XL** |
| 26 | Support + legal links, Arabic legal copy | settings; external | external | — | low | S + external |
| 27 | Dark theme review or lock to light | tokens, `app.json` | no | — | low | M |

## P2

| # | Item | Backend | Size |
| --- | --- | --- | --- |
| 28 | Structured message references (`SharedAcademicReference`) | **yes** | L |
| 29 | Message attachments | **yes** | M |
| 30 | Compose drafts | **yes** (or local) | M |
| 31 | Lecture ↔ Topic linkage | **yes** | M |
| 32 | Lecture ↔ Practice ("practise this lecture") | **yes**, depends on 31 | M |
| 33 | Post detail + correction thread UI | no | M |
| 34 | Topic picker in Compose (depends on 6) | no | M |
| 35 | Presence, then `showOnlineStatus`/`showLastSeen` toggles | **yes** | L |
| 36 | Web target: measure + keyboard pass | no | M |

## Sequencing notes

- **1 before 15, 16, 19.** Rebuilding a screen on the old token names guarantees a second pass.
- **2 before 3.** The route must exist.
- **6 before 34.** A topic picker needs topic search.
- **31 before 32.**
- **9 before any launch build.** It is a one-line change or a design phase; either way it must be decided, not defaulted.
- **11 alongside 15, 16, 20** — those screens introduce most of the new counted strings.
- **7 and 8 are Apple gating.** They are P0 for submission regardless of UX priority.

## Not on this plan, deliberately

Mastery, confidence percentages, readiness, adaptive sequencing, prerequisites, recommendation, spaced repetition. They are not backlog items pending capacity — they are product claims the design is built to refuse. Adding one is a product decision with a design consequence, not a feature ticket.
