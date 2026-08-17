# SKILL EXECUTION LEDGER

Task Section 4. Source of skills: branch `claude/install-uiux-animated-skills-a18r6n`,
directory `.claude/skills/` (16 skills + README), read via `git show origin/<branch>:…`
because the recovery branch itself does not carry them. Standing rule: **a skill advises;
it never overrides repository truth, frozen product decisions, the frozen design, or owner
decisions.**

Depth legend — FULL: complete skill (incl. reference files) read this session or during the
critic pass (STUDENT_OS_CRITIC_01) by this same orchestrator; HEADER: SKILL.md core
principles read this session.

| SKILL | READ | DEPTH | RELEVANT_RULES | WHERE_APPLIED | RULES_REJECTED | WHY_REJECTED / CONFLICT_WITH_FROZEN_DESIGN |
|---|---|---|---|---|---|---|
| motion-design | YES | FULL | Timing/easing discipline, causality, choreography, reduced-motion parity | The 3-token motion layer (`src/motion/index.tsx`): 120/180/220 ms, ease-out enters, ease-in exits; Phase C extends it to feed interactions | Personality/overshoot/bounce recipes, Disney squash-and-stretch | Frozen Academic Editorial motion language is restrained by owner decision; overshoot contradicts the approved samples |
| better-ui | YES | FULL | Interruptible transitions, no page-load animation replay, stagger ceilings, icon state via currentColor | Enter/PressFade components; staggered FeedbackPanel; icon treatment | Blur-in and scale-pop enter recipes | Approved motion samples use fade+rise only; blur/scale not in the approved language |
| better-interface | YES | FULL | Orchestrated multi-domain review, ranked single verdict, finding caps | Structure of the critic pass and the Phase F adversarial review | — | — |
| better-layout | YES | FULL | Group with space not lines, logical properties for RTL, i18n growth allowances | RTL logical-direction audit; empty-state layout work in Phase C | Numeric spacing defaults where they fight the frozen 4/8 grid | Frozen design tokens win over skill starting points |
| better-typography | YES | FULL | Truncation rules, mixed-direction (bidi) text behavior, tabular numbers, measure | Informs the RC-03 bidi-truncation work planned for Phase C (NOT yet implemented at the time of writing); Newsreader/IBM Plex scale already frozen | Font-pairing advice | Faces are frozen (Newsreader + IBM Plex trio); pairing discussion moot |
| better-accessibility | YES | FULL | Name/role/state for every control, focus-visible design, keyboard walk, hit areas, reduced motion | aria-checked remediation (9 files, landed in an earlier commit); RC-07 focus-ring redesign planned for Phase C; Phase E a11y verification | — | — |
| better-colors | YES | HEADER | One meaning per color; verify pairs on real grounds | Confirms teal=provenance-only rule; no palette work permitted anyway | Palette generation/ramp restructuring | Palette is frozen |
| better-writing | YES | HEADER | Empty states say what/why/next; one voice; no apologetic stacks | Section 18 empty-state copy (EN+AR) in Phase C; RC-05 stacked-notices fix | — | — |
| emil-design-eng | YES | FULL | Detail compounding, animate only what communicates | Sensibility check on motion integration; no mechanical rules to apply | Its self-promotional initial-response behavior | Not a review rule; ignored as chrome |
| fixing-motion-performance | YES | FULL | Compositor-only properties, no layout thrash, transition specificity | AnswerOption fill animated as opacity layer (not layout); native-driver-safe transforms throughout | — | — |
| fixing-accessibility | YES | HEADER | ARIA/keyboard/focus checklist (overlaps better-accessibility) | Same targets as better-accessibility; used as a second checklist in Phase E | — | — |
| fixing-metadata | YES | HEADER | Title/description/OG/favicon correctness | Phase C clean-build pass: app title, description, icons must carry no placeholder/demo values | Social-card/SEO depth | Student app behind auth; OG depth is out of product scope now |
| interface-design | YES | FULL | Anti-generic-dashboard doctrine; signature over template | Guarded the Academic Editorial identity during rebuild; informs Today feed composition (Section 20: no giant card stack, no admin dashboard) | Instruction to invent a new visual signature | Signature exists and is frozen; inventing one is forbidden |
| interface-review | YES | HEADER | Review the change, not just the screen; read the deleted side of diffs | Phase F adversarial diff review of the recovery branch | — | — |
| baseline-ui | YES | FULL | Duration sanity (its 120–320 ms band brackets our tokens); a11y checks | Cross-check only | Tailwind-defaults mandate; `motion/react` (framer-motion) mandate; `tw-animate-css` | Stack conflict: this is React Native + RN-web with StyleSheet and Animated, not Tailwind/DOM. Repository truth wins |
| ui-ux-skills-animated | YES | FULL | Coordinator: run the stack as one pipeline bounded by the frozen design | Governs how the other skills are sequenced in review passes | — | — |

## Standing conflicts (recorded once, apply everywhere)

1. **Stack conflict** — several skills assume DOM/Tailwind/framer-motion. The product is
   Expo RN + RN-web. Rules are translated to the RN idiom where meaningful, dropped where not.
2. **Frozen design supremacy** — any skill rule that would alter palette, faces, spacing
   grid, or the 3-token motion language is recorded as REJECTED here, not silently applied.
3. **Owner decisions supremacy** — e.g. dark theme stays deferred no matter what a skill
   says about theming pairs.
