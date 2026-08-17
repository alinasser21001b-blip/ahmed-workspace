# MASTER IMPLEMENTATION COMMAND

For a fresh builder session. DO NOT EXECUTE IN THE CRITIC SESSION.

---
STUDENT OS — CRITIQUE-DRIVEN CORRECTION PASS

MODE: BUILDER
BRANCH: claude/student-preview (continue; do not merge; do not touch production)

STEP 0 — LOAD:
- Skills (from branch claude/install-uiux-animated-skills-a18r6n,
  .claude/skills/): better-accessibility, better-layout, better-typography,
  better-ui, motion-design, fixing-motion-performance, interface-design,
  emil-design-eng. Advisory only: the frozen handoff wins every conflict
  (documented conflicts: no spring/overshoot/scale, no blur transitions, no
  Tailwind/motion-react stack from baseline-ui — do not adopt).
- Read, in order: docs/product-critique/00→11,
  docs/design-handoff/{FINAL-FREEZE,FRAME-MAP,01,04,05,06,07,08,09,10,22,23},
  docs/design-handoff/02-REPO-TRUTH.md, BLOCKED_CAPABILITIES.md.

STEP 1 — EXECUTE docs/product-critique/10-IMPLEMENTATION-ORDERS.md
sections in this dependency order:
  01_GLOBAL_SYSTEM → 17_CONTENT_EMPTY_STATES → 13_ARABIC_RTL(truncation)
  → 02..12 (screen passes, any order within) → 14_MOTION → 15/16 → 18_FINAL_QA.
Systemic causes before screen polish. Static correct before motion.

RULES:
- Frozen design over any skill; repo truth over any wish; honest blocked
  states over fake capability.
- No new colours, faces, durations, or components outside the frozen grammar.
- Fixtures only via @sos/contracts types.
- Every screenshot-judged change re-captured at 390 en+ar (+ desktop where
  relevant) AFTER 01_GLOBAL_SYSTEM lands.

GATES (all must pass before reporting):
  typecheck · lint · unit · integration · preview journey · deployed-preview
  acceptance · a11y audit (extended) · rtl audit (extended) · motion
  regression (extended) · visual-gate (extended) · 360/390/desktop ·
  reduced-motion.
Do not weaken a test to pass it. New assertions named in the orders are
required additions.

DEPLOY: fixture preview to the student-os-preview Netlify site only (git push
triggers it; the EXPO_PUBLIC_PREVIEW_MODE guard routes its production context
to the fixture build). NEVER student-os-uob-stage5. No merge.

RETURN: per-order completion table · new capture set · flags
  CRITIQUE_ORDERS_COMPLETE, FIXTURE_WORLD_V2, CHROME_REMOVED,
  BIDI_TRUNCATION_FIXED, SPARSE_STATES_DESIGNED, MOTION_GENERALIZED,
  CI_STATUS, PREVIEW_URL, CURRENT_HEAD — then STOP for owner review.
---
