# Implementation orders — for a separate builder session

Compiled by the critic pass at head `e1109cd`. Nothing here was executed.
Every order: SOURCE_OF_TRUTH = frozen handoff first, repo truth for
capability; DO_NOT invent backend; STOP if a frozen rule conflicts with
another frozen rule — escalate per FINAL-FREEZE §Stop condition.
Execute in the numbered order; each section names its dependencies.

---
## 01_GLOBAL_SYSTEM
OBJECTIVE: De-contaminate the student build (RC-01, RC-05) and design the two
missing global treatments (web focus, notice posture).
ROOT_CAUSE: RC-01, RC-05, RC-07.
DEPENDENCIES: none — first.
DO:
- Shrink the preview banner to one compact single-locale-at-a-time line
  (auto by UI language); mount it so it never renders inside Practice
  (`practice/*` full-screen modal) and sits after the masthead in reading
  order for assistive tech, visually above.
- Remove `/motion-samples` from the student bundle (separate internal flag or
  build-time exclusion; the preview flag is NOT sufficient — students receive
  the preview).
- Rename the fixture persona “Preview Student” → a neutral name (e.g. “Sara
  Al-Amin”), handle included; no rendered content signed by scaffolding.
- Define ONE focus treatment in tokens (2 px ink offset ring on paper; inverse
  on ink surfaces) and apply via the shared components; suppress the UA ring
  where the designed one renders (search pill first).
- Notice posture: at most one system notice visible per screen. Chat's
  connection line moves inline above the composer, metadata size, no border
  band; Settings' notifications copy stays (it is the right home).
DO_NOT: change tokens' colours/type; touch production build path; weaken any
honesty fact.
VISUAL_ACCEPTANCE: Practice shows zero chrome; Today reading order is
masthead-first; no UA focus ring anywhere; max one notice per screen.
TESTS: visual-gate extended with banner-absence-in-practice + focus-ring
assertions; a11y audit unchanged-green.
STOP_CONDITION: any change that would also alter the production (non-preview)
bundle's behaviour beyond the focus treatment.

## 02_TODAY
OBJECTIVE: Today answers “what should I do now” with pilot data.
ROOT_CAUSE: RC-02, RC-04. DEPENDENCIES: 17 (fixture world) for judgement.
DO: verify resume band renders with the enlarged world; one-line context line
at 390 (shorten fixture strings, not the type); sparse rule: feed < 4 items →
pull the low-evidence/practice invitation block up (composition already
exists on Learn — reuse, don't invent).
VISUAL_ACCEPTANCE: no two-line context; dominant action present; void < 30 %.

## 03_TOPICS
OBJECTIVE: Reads as a curriculum. ROOT_CAUSE: RC-02/04 + local spacing.
DO: breathing room subtitle↔rule↔course header per 08-SPACING (one spacing
step each); with full world, multiple courses; sparse rule: single course →
course header + evidence summary line per topic row (data exists in Learn's
endpoint — repo truth, no new backend).
DO_NOT: add cards, add per-row progress bars (frozen grammar).
VISUAL_ACCEPTANCE: 390 Arabic screenshot no longer majority-void; hierarchy
subtitle < header < rows reads in a squint test.

## 04_LEARN
OBJECTIVE: Keep; add the missing identity separation from Topics.
DO: nothing structural; ensure ready-band always first with full world.
DEPENDENCIES: 14 (survivor transition lands here).

## 05_PRACTICE
OBJECTIVE: Protect. ROOT_CAUSE: RC-01 (banner) fixed globally.
DO: end-of-scroll cue above the pinned footer (hairline + 12 px paper fade,
no shadow, no gradient decoration beyond the fade); nothing else.
VISUAL_ACCEPTANCE: identical to current except the cue; frozen frames hold.

## 06_ROOMS
OBJECTIVE: From decorative to useful-at-a-glance. ROOT_CAUSE: RC-03/04/02.
DO: fix mixed-script truncation (see 13); rows carry one status line the data
already has (last lecture / member count); sparse rule: one classroom → show
its most-recent lecture inline (data exists); Browse/Create become the
standard SectionHeader-trailing actions they already are elsewhere — verify
44 px.
DO_NOT: invent activity indicators; no unread counts the backend lacks.

## 07_CHAT
OBJECTIVE: Reliability as a feeling. ROOT_CAUSE: RC-05, RC-02.
DO: connection line per 01; thread density from world (17); keep worded
states exactly.

## 08_SEARCH
OBJECTIVE: Reach + polish. ROOT_CAUSE: RC-07, RC-03, IA.
DO: entry points from Topics and Learn headers (glyph, same as Home);
designed focus ring (01); truncation fix (13); “Preview Student” gone via 01.
DO_NOT: fake topic/classroom search; the deferred line stays.

## 09_PROFILE
OBJECTIVE: Numbers explain themselves. ROOT_CAUSE: RC-08.
DO: one metadata sentence under the score, from existing copy keys pattern
(“answers and posts your cohort found useful” — write via i18n, both
locales); nothing else.

## 10_COMPOSE
OBJECTIVE: none — hold. Verify banner removal only.

## 11_SETTINGS
OBJECTIVE: hold; notices per 01.

## 12_AUTH
OBJECTIVE: “Forgot password?” reads as an action: align trailing on the
password label row (frozen grammar allows trailing metadata links); nothing
else.

## 13_ARABIC_RTL
OBJECTIVE: RC-03 + content language.
DO: fix mixed-script single-line truncation in the shared row (ellipsis must
land at the logical end; test both scripts, both locales); RTL-aware send
glyph (mirror like the back arrow); fixture corpus rebalanced Arabic-dominant
with Latin clinical runs (with 17).
RTL_ACCEPTANCE: no leading-ellipsis line anywhere; rtl-audit extended with a
mixed-name truncation assertion.

## 14_MOTION
OBJECTIVE: Ship the approved language where it's missing (RC-06).
DEPENDENCIES: all static orders done first.
DO: Learn→Topic survivor transition per approved sample 1 (enter 220,
row is the only mover); tab selection feedback per 10-COMPONENT-STATES
(120 ms opacity — no scale); nothing new beyond the five samples.
TESTS: motion-regression extended for the transition (settle, interrupt,
reduced).

## 15_ACCESSIBILITY
DO: designed focus states verified (01); one recorded VoiceOver device pass;
Practice scroll cue announced (“more below” via existing patterns).

## 16_WEB_RESPONSIVE
DO: canvas holds (no change); hover states for row chevrons/links within
tokens; keyboard: Escape closes Report modal (verify), arrow-free tab order
sane.

## 17_CONTENT_EMPTY_STATES
OBJECTIVE: The pilot world (RC-02) — the biggest single lever.
DO: expand fixtures to: 2 courses / 8–10 topics with evidence spread; 6–8 feed
items (Arabic-dominant, clinical Latin runs); 2 classrooms + 2 groups (names
that truncate are a feature — test material); 12–15-message conversation with
all six states exercised; 4–5 profiles. All via `@sos/contracts` types — the
compiler stays the gate. Sparse rules (02/03/06/07) are then designed against
truth.
DO_NOT: fixture anything the backend can't produce.

## 18_FINAL_QA
DO: full battery + visual-gate + extended assertions above; fresh visual
proof pairs for changed screens; re-run this critique's evidence captures;
deploy PREVIEW site only; stop before merge for owner review.
