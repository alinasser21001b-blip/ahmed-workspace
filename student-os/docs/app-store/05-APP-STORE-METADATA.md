# App Store Metadata Pack (Draft)

Prepared from what the shipped binary actually does — nothing here describes a feature that is not real and reachable in this branch.

## App name

**Student OS** — matches `app.json`'s `name`, under Apple's 30-character limit.

## Subtitle (candidate, ≤30 chars)

"Notes, feed, and study groups" (30 chars) — or, shorter and more direct: **"Your medical school, social."** (28 chars). Pick based on how the account owner wants to position it against the other candidate description below.

## Primary category recommendation

**Education.** The app's core loop (topics, practice questions, learning progress, classrooms, lectures) is squarely educational; the social layer (feed, groups, messaging) is in service of that, not the other way round. Secondary category candidate: **Social Networking** — set only if the account owner wants the social surfaces foregrounded in App Store search as well.

## Description draft

> Student OS is a study platform built for medical students — where course notes, discussion, and practice questions live in one place, organized by your actual curriculum.
>
> • **Learn by topic.** Every topic page collects the explanations, corrections, and citations your cohort has written about it — durable, not buried in a feed.
> • **Practice with real feedback.** Answer topic-linked practice questions and see exactly where you're weak, backed by a transparent scoring model — no black-box AI grading.
> • **Study with your cohort.** Groups, classrooms, and direct messaging keep discussion inside your actual academic community — filtered to your university, college, and stage.
> • **Provenance you can trust.** Every explanation shows where it came from and whether it's been corrected — because in medicine, where information comes from matters as much as what it says.
>
> Report and block are built in, and moderation runs on every post before it's published.

This draft describes only features present and reachable in the current codebase — no AI tutor, no recommendation engine, no adaptive curriculum (all explicitly out of scope per the product's own phase discipline, see `docs/00-PRODUCT-ARCHITECTURE.md`).

## Keywords draft

`medical school, study, med student, notes, flashcards, practice questions, study group, nursing school, clinical, exam prep`

(Comma-separated, under App Store Connect's 100-character keyword field limit — count before submitting; trim if over.)

## Support URL

`EXTERNAL_OWNER_ACTION_REQUIRED` — see `SUPPORT_REQUIREMENTS.md`.

## Privacy Policy URL

`EXTERNAL_OWNER_ACTION_REQUIRED` — see `SUPPORT_REQUIREMENTS.md` and `PRIVACY_POLICY_DRAFT.md`.

## Copyright

`© 2026 EXTERNAL_OWNER_ACTION_REQUIRED: legal entity name. All rights reserved.`

## Review notes (for the App Store Connect "Notes for Review" field)

See `06-APP-REVIEW-NOTES.md` — copy its reviewer-journey section directly into this field, since Guideline 2.3.1(a) requires new functionality to be "described with specificity" there.

## Screenshots

`WAITING_FOR_DESIGN_FINAL` — not generated in this pass. Claude Design's concurrent visual work is the source for what the shipped UI will actually look like; generating screenshots against the current, pre-redesign UI would produce App Store assets that immediately misrepresent the shipped app (Guideline 2.3 — "accurately reflect the app's core experience").
