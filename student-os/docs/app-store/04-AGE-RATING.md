# Age Rating Preparation

Apple's age-rating system now uses 4+/9+/13+/16+/18+ tiers with an expanded questionnaire covering in-app controls, capabilities, medical/wellness topics, and violent themes (confirmed live from Apple Developer News this session; developer response deadline for the new questions is **January 31, 2026**). This document prepares the evidence the account owner needs to answer that questionnaire truthfully — it does not assign a final rating, which is Apple's own computed output from the answers.

## User-generated content

**Present.** Posts, comments, questions, direct/group messaging — all reviewable in `apps/api/src/modules/content/` and `apps/api/src/modules/messaging/`. As of this branch:

- A server-side moderation gate runs before every UGC write (`packages/core/src/moderation/moderation.ts`), refusing unambiguous slurs, threats and sexual harassment.
- Reporting and blocking are both reachable from the shipped client.
- No age-gating or content-visibility control beyond what an academic cohort's `visibility` scoping already provides (stage/college/university/course/community/group/followers/private).

## Messaging

**Present, unmoderated in real time (no profanity filter runs on read, only on write).** Direct and group messaging exist. The moderation gate covers message *creation*; there is no separate "mute a conversation permanently" beyond the existing mute/block primitives.

## Medical / clinical content

**Present, and this is the product's core subject matter — a medical-student study platform.** The content is educational (lecture notes, case discussions, practice questions), not diagnostic or prescriptive. Audited: neither i18n catalogue contains language suggesting the app diagnoses, treats, or replaces clinical judgment (`00-READINESS-AUDIT.md §8`). This is the correct answer to the questionnaire's medical/wellness-topic question — the app **discusses** medical topics academically; it does not **provide** medical services, measurements, or advice to be acted on.

## Mature or graphic content

The moderation gate's own design doc (`moderation.ts`) is explicit that legitimate medical curriculum content (forensic medicine, toxicology, psychiatry, trauma, sexual health) is NOT filtered and is expected to appear — this is an educational context for adult medical students, not a general-audience app. The questionnaire should reflect that the app's subject matter includes references to violence, injury, and sexual-health topics in an academic/clinical framing, without depicting graphic imagery (there is no video/image content pipeline beyond static photo uploads users control themselves).

## Unrestricted web access

**Not present.** No `WebView` component, no in-app browser, no unrestricted external-link rendering was found in `apps/mobile/src` or `apps/mobile/app`. Support/privacy/terms links open via `Linking.openURL`, which hands off to the OS browser — this is the standard, reviewer-accepted pattern and is not "unrestricted web access" in the sense the questionnaire means (an embedded browser rendering arbitrary content inside the app).

## Moderation controls available to the account owner (operator-side, not user-side)

`GET/POST /v1/moderation/reports` — a queue an administrator can triage, resolve, and act on (warn/remove/suspend/ban), gated through `isPlatformAdmin`. This is the evidence for "does the app have moderation tools" in the questionnaire.

## What the account owner still decides

The final numeric age tier (13+ vs 16+ vs 18+) is Apple's computed output from the honest answers above, entered in App Store Connect. Given UGC + messaging + academic medical content discussing sensitive clinical topics, a rating in the **17+/18+** range is the more defensible default than a lower one — but this document prepares the evidence, not the final selection, per the instruction not to invent the rating.
