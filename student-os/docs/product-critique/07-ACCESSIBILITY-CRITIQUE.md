# Accessibility critique

The 14-check audit passes; this reviews what the audit cannot see.

## Confirmed strengths
44 px targets throughout (including the once-24 px back control); names on all
controls; selection state exposed (`aria-checked` fix); worded verdicts and
message states (greyscale-safe); polite live regions; modal focus ownership;
composer removed—not disabled—when read-only; destructive flow (deletion)
gated by typed confirmation + password with distinct failure branches.

## Findings
1. **Web keyboard focus is UA-default (P1, RC-07).** The search pill shows the
   browser ring inside the designed shape; buttons rely on default outlines.
   Nothing in the token set defines a focus treatment. Keyboard users get an
   undesigned experience on the surface the pilot actually uses (web).
2. **Reading order on Today (P2).** Banner → feedback link → masthead: a
   screen-reader user hears scaffolding before the product every time (RC-01).
3. **Dynamic type / device screen reader: UNVERIFIED.** All evidence is
   DOM-level. One VoiceOver pass on a real phone must be recorded before the
   pilot report claims accessibility.
4. **Practice footer overlay (P2):** content scrolls under the pinned footer
   with no end-of-scroll cue; low-vision users may not know text is clipped.
5. Contrast: paper/ink pairs comfortably exceed 4.5:1; muted-on-paper roles
   pass at metadata size; no failing pair found in sampled screens.
