# Repository instructions

## Trigger phrase: `use the UI/UX skills animated`

When the owner writes **`use the UI/UX skills animated`**, invoke the
`ui-ux-skills-animated` skill (`.claude/skills/ui-ux-skills-animated/SKILL.md`) and follow it.

It means: **use ALL relevant installed UI/UX + motion skills together as one review /
implementation stack** —

1. `motion-design` (LottieFiles)
2. `better-interface` / `better-ui`
3. `better-typography`
4. `better-layout`
5. `better-accessibility`
6. `emil-design-eng`
7. `fixing-motion-performance`
8. `baseline-ui`

An individual skill may be omitted **only** when it clearly does not apply to the task at hand — say
which and why. The owner does not have to name the skills again.

Execution order is the eight steps in the skill: intent → visual fidelity → motion direction → UI
polish → typography and layout → accessibility → performance → verification (English, Arabic/RTL,
360 px, 390 px, `prefers-reduced-motion`).

Before implementing significant motion, emit the motion spec block the skill defines (`TRIGGER`,
`FROM_STATE`, `TO_STATE`, `ANIMATED_PROPERTIES`, `DURATION_OR_SPRING`, `EASING`, `PURPOSE`,
`INTERRUPT_BEHAVIOR`, `REDUCED_MOTION_FALLBACK`, `RTL_CONSIDERATION`, `PERFORMANCE_RISK`).

## Design authority

Skills are advisory. They do **not** outrank, in this order:

1. `student-os/docs/design-handoff/`
2. `student-os/docs/design-handoff/FINAL-FREEZE.md` — `DESIGN_SYSTEM_LOCKED = YES`,
   `FINAL_HANDOFF_LOCKED = YES`
3. the approved visual reference
4. current repository / backend truth

If a skill recommends something that conflicts with the frozen Student OS design, reject that
recommendation and say so. Do not redesign the frozen design without the owner's approval.

Student OS motion is already frozen to three durations — `motion.instant` 120 ms, `motion.enter`
220 ms, `motion.settle` 180 ms, platform easing, all three to 0 ms under reduced motion
(`student-os/apps/mobile/src/theme/tokens.ts`, `docs/design-handoff/05-TOKENS.md` §6). No decorative
motion, no celebration on a correct answer, no evidence-counter tween, no skeleton shimmer.

## Installed skills

`.claude/skills/` is checked in, so every session and every clone gets the same set. Provenance and
reinstall instructions: `.claude/skills/README.md`; pinned sources: `skills-lock.json`.
