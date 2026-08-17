# Root causes

Schema per cause. DO_NOT_FIX_IN_THIS_TASK: true (all).

## P0

### RC-01 — Preview chrome contamination
SEVERITY: P0 · AFFECTED: every screen; Practice worst (focus-mode contract
broken); Today reading order; `/motion-samples` ships; “Preview Student”
authors content.
EVIDENCE: every capture in /tmp/critic-shots; en-04c shows the banner above
the Practice band.
WHY_SYSTEMIC: one component + one fixture identity + one route leak into 23
screens.
DOWNSTREAM: identity dilution, a11y reading order, emotional tone, dead
vertical space at 390.
LAYERS: implementation (banner mount point), product (what a pilot build is).
FIX_ORDER: first — every screenshot-judged fix after it is judged clean.

### RC-02 — Fixture world thin and half-English
SEVERITY: P0 · AFFECTED: Today, Topics, Rooms, Conversation, Profile, Search;
all Arabic first-impressions.
EVIDENCE: 3 topics/1 course; 2 rooms; 3 bubbles; EN explanation atop AR feed.
WHY_SYSTEMIC: the world is the material every composition is judged in.
DOWNSTREAM: RC-04 visibility, Arabic promise, usefulness scores, date-line
wrap.
FIX_ORDER: with RC-01, before sparse-state design is judged.

### RC-03 — Bidi truncation at the component level
SEVERITY: P0 · AFFECTED: Rooms group row, Search group row; any future
mixed-script single-line name.
EVIDENCE: leading-ellipsis lines in en-05-rooms, en-09-search.
WHY_SYSTEMIC: one shared row/Text usage (numberOfLines + bidi isolation)
renders every mixed name.
FIX_ORDER: independent; before Arabic sign-off.

### RC-04 — No designed sparse states
SEVERITY: P0 · AFFECTED: Topics, Rooms, Conversation, ChatList, Today-feed.
EVIDENCE: 60–85 % void captures.
WHY_SYSTEMIC: the grammar (masthead+rule+rows) has no rule for "2 rows"; every
thin screen fails identically.
DOWNSTREAM: “unfinished” perception; EmotionalQuality.
FIX_ORDER: after RC-02 (design against the full world, then the sparse rule).

### RC-05 — Stacked negative notices
SEVERITY: P0 · AFFECTED: ChatList, Conversation, Settings, plus banner.
EVIDENCE: ar-08 shows banner + attention line stacked above the thread.
WHY_SYSTEMIC: one copy-posture decision repeated; not a screen bug.
CONSTRAINT: facts must remain (BLOCKED_CAPABILITIES); redesign placement,
frequency, tone only.
FIX_ORDER: with RC-01.

## P1

### RC-06 — Motion under-generalized
AFFECTED: Learn→Topic, tab bar, general perceptibility. EVIDENCE:
06-MOTION-CRITIQUE table. FIX_ORDER: after static corrections (motion must
not mask layout work).

### RC-07 — Web affordances undesigned
AFFECTED: search field focus ring, all web focus/hover, desktop canvas.
EVIDENCE: en-09-search UA ring. FIX_ORDER: with screen polish; tokens must
gain one focus treatment, used everywhere.

## P2

### RC-08 — Unexplained numbers
AFFECTED: Profile score; (evidence fractions acceptable). FIX_ORDER: last.
