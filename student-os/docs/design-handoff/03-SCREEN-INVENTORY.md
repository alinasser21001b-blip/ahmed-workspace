# Screen inventory

39 screens and screen-states. Status per row; specification in the linked file. (37 at freeze; Forgot password and Reset password were specified at the contract-reconciliation pass, having shipped without a spec.)

## Core

| # | Screen | Route | Spec | Status |
| --- | --- | --- | --- | --- |
| 1 | Home / Today | `(tabs)/index` | `11` | SUPPORTED_NOW |
| 2 | Learn | `(tabs)/learn` | `12` | SUPPORTED_NOW |
| 3 | Topic | `topic/[id]` | `12` | SUPPORTED_NOW |
| 4 | Practice — entry / resume | `practice/[topicId]` | `13` | SUPPORTED_CONTRACT_NOT_UI (resume) |
| 5 | Practice — unanswered | ″ | `13` | SUPPORTED_NOW |
| 6 | Practice — selected | ″ | `13` | SUPPORTED_NOW |
| 7 | Practice — submitting | ″ | `13` | DESIGN_READY_CODE_REQUIRED |
| 8 | Practice — correct | ″ | `13` | SUPPORTED_NOW |
| 9 | Practice — incorrect + explanation | ″ | `13` | SUPPORTED_NOW |
| 10 | Practice — multi-select variant | ″ | `13` | DESIGN_READY_CODE_REQUIRED |
| 11 | Practice — true/false variant | ″ | `13` | DESIGN_READY_CODE_REQUIRED |
| 12 | Practice — submission failed | ″ | `13` | DESIGN_READY_CODE_REQUIRED |
| 13 | Practice — completion | ″ | `13` | SUPPORTED_NOW |
| 14 | Practice — exit / return | ″ | `13` | SUPPORTED_NOW |
| 15 | Post detail + correction thread | `post/[id]` | `16-CONTENT` in `11` | SUPPORTED_CONTRACT_NOT_UI |

## Academic and social

| # | Screen | Route | Spec | Status |
| --- | --- | --- | --- | --- |
| 16 | Classroom — member | `classrooms/[id]` | `14` | SUPPORTED_NOW |
| 17 | Classroom — non-member / join | ″ | `14` | SUPPORTED_NOW |
| 18 | Classroom list | `classrooms/index` | `14` | SUPPORTED_NOW |
| 19 | Lecture + materials | `lecture/[id]` | `14` | SUPPORTED_CONTRACT_NOT_UI |
| 20 | Group (distinct from classroom) | `group/[id]` | `14` §group | SUPPORTED_NOW |
| 21 | Messages list | `(tabs)/chat` | `15` | SUPPORTED_NOW |
| 22 | Conversation | `chat/[id]` | `15` | SUPPORTED_NOW |
| 23 | Search | `search` | `16` | SUPPORTED_NOW (4 of 6 types) |
| 24 | Profile — other | `profile/[handle]` | `17` | SUPPORTED_NOW |
| 25 | Profile — own | `profile/[handle]` self | `17` | SUPPORTED_NOW |
| 26 | Compose | `compose` (modal) | `18` | SUPPORTED_NOW |
| 27 | Notifications | *route absent* | `19` | BLOCKED_BY_PRODUCT_CAPABILITY |

## Identity

| # | Screen | Route | Spec | Status |
| --- | --- | --- | --- | --- |
| 28 | Sign in | `(auth)/sign-in` | `20` | SUPPORTED_NOW |
| 29 | Sign up | `(auth)/sign-up` | `20` | SUPPORTED_NOW |
| 30 | Onboarding steps 1–4 (hierarchy) | `(onboarding)` | `20` | SUPPORTED_NOW |
| 31 | Onboarding step 5 (profile) | ″ | `20` | SUPPORTED_NOW |
| 32 | Session restoration | `index` | `20` | SUPPORTED_NOW |

## Settings, trust, compliance

| # | Screen | Route | Spec | Status |
| --- | --- | --- | --- | --- |
| 33 | Privacy settings | *route absent* | `24` | SUPPORTED_CONTRACT_NOT_UI |
| 34 | Block / unblock | `app/settings/blocked.tsx`, `profile/[handle].tsx`, `ActionSheet.tsx` | `24` | SUPPORTED_NOW |
| 35 | Report content / user | `ReportSheet.tsx` in `post/[id].tsx`, `profile/[handle].tsx` | `24` | SUPPORTED_NOW — modal is the V1 contract |
| 36 | Account deletion | `app/settings/delete-account.tsx` | `24` | SUPPORTED_NOW — 7-state lifecycle specified; copy strings outstanding (P0) |
| 37 | Support + legal links | `app/settings/index.tsx` | `24` | EXTERNAL_RELEASE_DEPENDENCY (rows ship; URLs are the dependency) |

### Added at the contract-reconciliation pass

Shipped in merged `main` without a specification; specified in the frozen grammar rather than left as debt.

| # | Screen | Route | Spec | Status |
| --- | --- | --- | --- | --- |
| 38 | Forgot password | `app/(auth)/forgot-password.tsx` | `20` | SUPPORTED_NOW |
| 39 | Reset password | `app/(auth)/reset-password.tsx` | `20` | SUPPORTED_NOW |

### Shipped, still unspecified

| Screen | Route | Status |
| --- | --- | --- |
| Settings root | `app/settings/index.tsx` | SUPPORTED_NOW. Its three groups are specified where they belong — deletion entry in `24` §Account deletion state 1, support rows in `24` §Support and legal, blocked-accounts row in `24` §Block — so no separate screen file is needed. Not counted. |

## System states — apply to every screen above

Specified once in `21-SYSTEM-STATES.md`: loading, empty, error, offline, restricted/forbidden, deleted/unavailable content, validation failure, network failure, retry, keyboard-visible, large text, 360 px, Arabic/RTL.

A screen is not implementable until its row in `21` is satisfied. A screen without states is an incomplete screen.
