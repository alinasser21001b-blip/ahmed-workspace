# Student OS — design handoff

**Status:** FINAL — locked. No further design rounds. Every documentation decision this handoff owns is closed; what remains is implementation and QA.
**Audited repository:** `alinasser21001b-blip/ahmed-workspace`, branch `main`.
**Re-checked against merged `main`** on 2026-08-15, after the engineering branch merged: tree `aadae41ee191`, four commits past the audit marker `8d7541ddd7e4`. The re-check moved six status claims and rewrote the account-deletion copy against the shipped implementation. **No visual decision changed.** Detail in `CHANGELOG.md` § *Post-merge reconciliation*.
**Visual reference:** `Student OS V2.dc.html` (Turns 1–5). Reference evidence only — see `28`/`FRAME-INDEX.md`. **The specification is these documents, not the frames.**

## Package contents — 35 files

Package root: `student-os/docs/design-handoff/`. Drop it in at that path; nothing outside it is required.

| Group | Count | Files |
| --- | --- | --- |
| Numbered specification | 27 | `00-README.md` · `01-DESIGN-PRINCIPLES` · `02-REPO-TRUTH` · `03-SCREEN-INVENTORY` · `04-NAVIGATION` · `05-TOKENS` · `06-TYPOGRAPHY` · `07-COLOUR` · `08-SPACING-LAYOUT` · `09-COMPONENTS` · `10-COMPONENT-STATES` · `11-HOME` · `12-LEARN-TOPIC` · `13-PRACTICE` · `14-CLASSROOM` · `15-MESSAGES` · `16-SEARCH` · `17-PROFILE` · `18-COMPOSE` · `19-NOTIFICATIONS` · `20-AUTH-ONBOARDING` · `21-SYSTEM-STATES` · `22-RTL-ARABIC` · `23-ACCESSIBILITY` · `24-APP-STORE-SURFACES` · `25-DESIGN-TO-CODE` · `26-IMPLEMENTATION-PLAN` |
| Cross-cutting records | 5 | `ACCEPTANCE-TESTS.md` (88 tests, 51 P0) · `BLOCKED_CAPABILITIES.md` · `CHANGELOG.md` · `FINAL-FREEZE.md` (the flags) · `FRAME-INDEX.md` |
| Machine-readable tokens | 1 | `tokens.json` — design-side record. **Never import at runtime**; the runtime source of truth is `apps/mobile/src/theme/tokens.ts` |
| Visual reference | 2 | `reference/Student OS V2.dc.html` (Turns 1–6 frames) + `reference/support.js`, the runtime it needs. Open the HTML directly in a browser; both files must sit in the same folder |

**The specification is the documents, not the frames.** Where a frame and a document disagree, the document wins — the frames include exploratory Turn 6 material that is explicitly not specification (see `FRAME-INDEX.md`).

**Where to check status, in one place:** `02-REPO-TRUTH.md` is the only authority on what exists. `BLOCKED_CAPABILITIES.md` separates blocked from implemented — 15 blocked, 3 deferred, 1 external, with report and account deletion recorded as closed and no longer blocked.

## Read in this order

| If you are | Read |
| --- | --- |
| Implementing a screen | `03` inventory → the screen's own file (`11`–`21`) → `25-DESIGN-TO-CODE.md` |
| Setting up the theme | `05-TOKENS.md`, `tokens.json`, `06`, `07`, `08` |
| Building components | `09-COMPONENTS.md`, `10-COMPONENT-STATES.md` |
| Working on Arabic | `22-RTL-ARABIC.md` first, then the screen file |
| Planning the sprint | `26-IMPLEMENTATION-PLAN.md`, `BLOCKED_CAPABILITIES.md` |
| Writing tests | `ACCEPTANCE-TESTS.md` |
| Checking what is real | `02-REPO-TRUTH.md` — the only authority on implementation status |

## The five status labels

Every feature carries exactly one. They are never merged, and a mockup existing is never evidence of support.

- **SUPPORTED_NOW** — the repository supports the behaviour today, client included.
- **SUPPORTED_CONTRACT_NOT_UI** — backend/contract exists; the production client does not expose it.
- **DESIGN_READY_CODE_REQUIRED** — design final, client code required, no backend blocker.
- **BLOCKED_BY_PRODUCT_CAPABILITY** — required backend/domain capability does not exist.
- **DEFERRED_PRODUCT_DECISION** — a product owner must decide before implementation.
- **EXTERNAL_RELEASE_DEPENDENCY** — legal, Apple, infrastructure, credentials.

## Four corrections this audit forced

The repository disagreed with statements made earlier in the design session. The repository wins. Full detail in `CHANGELOG.md`.

1. **`followerCount` and `followingCount` exist** in `profileSchema`. Omitting them from Profile is now a recorded product decision, not a capability limit.
2. **The low-sample threshold is 5, not 12.** `MIN_QUESTIONS_FOR_CONFIDENCE = 5`, saturation 20. The client must never compute it — render the server's `lowConfidence` boolean.
3. **Resumable partial attempts are supported.** `practiceQuestion.answered` and `practiceAnswerResult.alreadyAnswered` exist specifically so a client can resume. Previously listed as blocked.
4. **`weaknessScore` and `confidence` are real fields.** What is forbidden is presenting them as ability. See `19` — the learning-evidence contract.

## Contract reconciliation — read this before implementing

Three contract mismatches are closed: **Report is a modal** (`ReportSheet.tsx`; no pushed route is to be built), **account deletion's seven lifecycle states** are specified across its two existing routes, and **both password-reset screens** are specified in the frozen auth grammar (screens 38–39). `typography.micro` is **retired** — final UI must not use it, and the two remaining call sites are debt to remove. Detail in `CHANGELOG.md` § *Contract reconciliation*.

## Six corrections the post-merge re-check forced

Report, account deletion, a settings root, the blocked-accounts list and password reset are **implemented in merged `main`** — this handoff previously recorded the first two as absent. `ios.supportsTablet` is now `false`, which closes DESIGN_BLOCKER_IPAD. Statuses in `02-REPO-TRUTH.md`; the deletion copy in `24-APP-STORE-SURFACES.md`.

## Non-negotiable locked direction

Academic Editorial hierarchy · one dominant action per screen · relationship primitives only where relations carry information · 13/20 sentence-case metadata · mono for numerals and references only · teal for provenance only · no state carried by colour alone · script-specific Arabic typography · no card-heavy UI · no decorative graphs · no invented learning intelligence · Practice as a distinct focus mode · truthful evidence · Arabic designed natively.

Reopen only on a demonstrated accessibility or implementation blocker, with evidence, minimum correction, and a `CHANGELOG.md` entry.
