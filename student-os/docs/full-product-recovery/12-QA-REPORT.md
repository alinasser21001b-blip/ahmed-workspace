# 12 — QA REPORT

Section 27/28's required journeys, run against the real API and real builds
(not mocks), plus the visual QA pass Section 28 requires as human inspection —
not a substitute for it. Every number below is a suite actually executed during
this recovery, not a projection.

---

## Automated suites — final state

All commands run from `student-os/`, against a local Postgres
(`studentos_e2e`), the real API on `:4000`, a real (non-preview) web build, and
a preview fixture build, as noted.

| Suite | Target | Result |
|---|---|---|
| `pnpm --filter @sos/api test` (unit) | — | **332/332 passed** |
| `pnpm --filter @sos/api test:integration` | disposable `studentos_test` | **293/293 passed** |
| `pnpm --filter @sos/mobile test` (unit) | — | **42/42 passed** |
| `first-journey.mjs` | real build, real API, Arabic | **passed** — sign-up, onboarding, post, comment, like, save, study group, search |
| `social-journey.mjs` (new) | real build, real API, Arabic | **passed** — the owner-specified Today loop end to end |
| `messaging.mjs` | real build, real API, two browsers | **passed** — send survives a dropped socket, read state converges |
| `classroom-journey.mjs` | real build, real API | **passed** — join, lecture, content, outsider refused |
| `rtl-audit.mjs` | real build, real API, EN+AR | **352/352 passed** |
| `bidi-truncation.mjs` (new) | preview build, EN+AR | **108/108 passed** |
| `preview-journey.mjs` | preview build, 360px, EN+AR | **96/96 passed** |
| `a11y-audit.mjs` | preview build | **14/14 passed** |
| `motion-regression.mjs` | preview build | **228/228 passed** |
| `visual-gate.mjs` | preview build, dark-browser + desktop | **174/174 passed** |
| `deployed-preview.mjs` | preview build, network watch | **132/132 passed** |
| `bundle-cleanliness.mjs` (new) | real build | **16/16 passed** — no fixture identity, no developer copy, correct shell |
| `bundle-cleanliness.mjs --preview` (new) | preview build | **6/6 passed** — fixture world present, shell correct |

Every one of these is now wired into `.github/workflows/ci.yml`
(`journey` and `preview-ui` jobs) — not just runnable by hand.

## Journeys, mapped to Section 27's exact wording

**SOCIAL** — sign in → Today → create post → see post → like → unlike →
comment → save → unsave → profile → report → block.
Covered by `social-journey.mjs` in full, plus `first-journey.mjs` for the
account/onboarding path leading into it.

**LEARNING** — Topics → Learn → Topic → Practice → answer → feedback →
evidence → completion.
Covered by `first-journey.mjs` and `preview-journey.mjs` (practice, verdict,
evidence delta). **Caveat carried into `09-EXTERNAL-SERVICES.md`**: this
proves the loop works when questions exist. A fresh production database has
none — that is a content-authoring gap, not a test gap, and is not something
this recovery fabricates data to hide.

**CLASSROOM** — join/open → lecture → content/resource.
Covered by `classroom-journey.mjs`, including the outsider-refused negative
case.

**INSTRUCTOR** — verified instructor → classroom → create lecture → publish →
student access.
**Not automated.** `08-CLASSROOM-LECTURE-READINESS.md` records why: lecture
creation has a tested endpoint and no interface anywhere in the app, so there
is no UI path for a test to drive. This is reported as `BACKEND_ONLY`, not
quietly skipped.

**MESSAGING** — conversation → send → retry → receive/reload.
Covered by `messaging.mjs`, including a real dropped-socket recovery.

**ARABIC** — representative social + learning + messaging path, in Arabic.
`first-journey.mjs` and `social-journey.mjs` run entirely in Arabic by
default, on the stated principle that Arabic is where layout bugs actually
surface. `rtl-audit.mjs` and `bidi-truncation.mjs` cover the rest of Section
22's specific requirements (bidi truncation, mixed-script correctness).

## Visual QA — Section 28

`visual-qa.mjs` (new) captured six configurations against the real build with
a real seeded account: 360/390/desktop × EN/AR, nine principal screens each —
54 screenshots. Machine-detectable checks (horizontal overflow, direction
mismatch, empty headings) all passed; the screenshots were then inspected by
hand, as Section 28 requires.

**What the human pass found that no suite did:**

1. The provenance rule (2px teal citation border) sat on the physical left in
   the Arabic interface, detached from the right-aligned text it marks.
   React-native-web resolves every logical style (`borderStart`,
   `paddingStart`) against a direction *context* that nothing in the app had
   ever set, so it defaulted to `ltr` everywhere. Fixed by setting `dir` at
   the theme root — see `28bbdf3`.
2. An early version of the bidi-truncation fix, applied too broadly, moved a
   full stop to the wrong end of an English paragraph inside the Arabic feed
   (`.Second line` instead of `Second line.`). Caught before it shipped,
   fixed by restricting isolation to single-line truncated text — the only
   place the defect it fixes actually occurs.

Both defects were real, neither was caught by any automated gate, and both are
now fixed and covered going forward (`bidi-truncation.mjs` for the second;
the first has no dedicated assertion yet — recorded as a residual gap below).

## Known gaps in this QA pass

- **No automated check for logical-property direction resolution** (the
  provenance-border class of bug). It was caught by eye, not by a script.
  A future pass could assert computed `border-*-color` against the expected
  physical side per locale.
- **Instructor journeys are unautomated** because the UI does not exist yet.
- **Visual QA covered nine screens**, not the full app; compose, classroom
  and lecture detail were captured but not exhaustively inspected frame by
  frame.
- **Desktop screenshots were reviewed at one width** (1440px); no tablet
  breakpoint was captured.
- **The 35 `preview.feedback.*` translation-catalogue strings still ship as
  literal text inside a real (non-preview) bundle** — found by the
  adversarial pass, not this QA pass. The metro resolver removes the
  feedback form and its write path (`recordFeedback`, verified absent) and
  the banner's own copy, but the i18n catalogue is one object shared by
  every build, so individual key values like `"This is a preview built for
  students to judge…"` remain readable via bundle inspection even though no
  route or component in a real build ever renders them. `bundle-cleanliness.mjs`
  deliberately does not check for these — its own comments explain why — but
  that exclusion was not previously stated as a residual gap against the
  owner's "zero preview material" rule. It is one now: fully fixing it would
  need per-route catalogue splitting, which has not been done.
- **A P0 was found and fixed during this QA pass, not before it**: blocking
  a user sent no request body, the server correctly rejected every attempt
  with 400, and the client's catch block swallowed the failure silently — so
  confirming a block looked identical whether it worked or not. The original
  `social-journey.mjs` did not catch this because it stopped at asserting the
  confirmation dialog was visible rather than clicking confirm and checking
  the result. Both are now fixed: `toggleBlock` sends `{}` like its sibling
  `toggleBookmark` already did, and the test clicks confirm and asserts the
  blocked-state text actually renders (which only happens after a fresh
  server read). See `13-BEFORE-AFTER.md` for detail. A second real defect
  found the same way — Today's `loadMore` had no re-entrancy guard, so a
  fast scroll could fire two requests for the same cursor and duplicate
  posts in the feed — is fixed the same way, with a synchronous in-flight
  ref guard in `useFeed.ts`.
