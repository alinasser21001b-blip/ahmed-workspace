---
name: ui-ux-skills-animated
description: >-
  Coordinator for this repository's UI/UX + motion review stack. Runs the installed motion-design,
  better-interface, better-ui, better-typography, better-layout, better-accessibility,
  emil-design-eng, fixing-motion-performance and baseline-ui skills together as one pipeline,
  bounded by the frozen Student OS design. Use whenever the owner says "use the UI/UX skills
  animated" (the registered trigger phrase), or asks for animation, transition, micro-interaction,
  motion polish, interaction review or motion performance work on any surface in this repository.
  Triggers on: use the UI/UX skills animated, UI/UX skills animated, animate this, motion review,
  transition polish, interaction polish, make this feel better, reduced motion, RTL animation.
---

# UI/UX Skills — Animated

One invocation, one stack. The owner should never have to name the individual skills again.

## Trigger phrase

```
use the UI/UX skills animated
```

That phrase means: **run every relevant skill below as a single review/implementation stack, in the
order given.** Omit an individual skill only when it clearly does not apply to the surface in front
of you, and say which one you omitted and why.

## The stack

Run in this order. All are installed repo-local under `.claude/skills/`.

| # | Skill | Role in the stack |
| --- | --- | --- |
| 1 | `motion-design` | Motion direction: timing, easing, choreography, causality, entrance/exit, loading/success/error motion, reduced motion. Implementation-agnostic — consult **before** writing code. |
| 2 | `better-interface` | Coordinator for the `better-*` family; routes the surface to each domain and consolidates one ranked verdict. |
| 3 | `better-ui` | UI polish, micro-interactions, enter/exit, hover/press detail, motion restraint. |
| 4 | `better-typography` | Type rhythm, hierarchy, wrapping, measure, numerals. |
| 5 | `better-layout` | Grouping, alignment, reading order, density, breakpoints, logical/RTL direction. |
| 6 | `better-accessibility` | Reduced motion, focus, screen readers, keyboard, hit areas. |
| 7 | `emil-design-eng` | Animation polish and motion review. |
| 8 | `fixing-motion-performance` | Compositor-friendly properties, layout-thrash prevention, scroll-linked motion cost. |
| 9 | `baseline-ui` | Catches generic / AI-looking UI regressions. |

Also installed and available when the task reaches them, but not part of the default stack:
`better-colors`, `better-writing`, `interface-review` (change-scoped review; `disable-model-invocation`,
so invoke it explicitly), `fixing-accessibility`, `interface-design`, `fixing-metadata`.

`interface-design` is for intent and hierarchy only. **Never use it to redesign the frozen Student OS
design** without the owner's explicit approval.

## Execution order

**Step 1 — Intent.** What is this interaction communicating? Name it in one sentence before touching
timing.

**Step 2 — Visual fidelity.** Preserve the existing/frozen Student OS visual design. Read the
relevant `student-os/docs/design-handoff/` screen document first.

**Step 3 — Motion direction.** `motion-design` decides timing, easing, choreography and causality —
within the frozen token set below.

**Step 4 — UI polish.** `better-ui` / `better-interface` / `baseline-ui`.

**Step 5 — Typography and layout.** `better-typography` / `better-layout`: rhythm, hierarchy,
wrapping, density.

**Step 6 — Accessibility.** `better-accessibility`: reduced motion, focus, screen readers,
keyboard/web accessibility, touch target size (≥ `MIN_TOUCH_TARGET` = 44).

**Step 7 — Performance.** `fixing-motion-performance`. Prefer properties that stay on the
compositor. Avoid layout animation and expensive re-renders.

**Step 8 — Verification.** Test the interaction in **English**, **Arabic / RTL**, **360 px**,
**390 px**, and **`prefers-reduced-motion` / `isReduceMotionEnabled`**.

## Student OS motion rules

These override generic skill suggestions.

- Do **not** redesign the frozen design.
- Do **not** add animation for decoration alone.
- Do **not** turn the academic product into a flashy entertainment interface.
- Motion should feel calm, precise, academic and intentional.
- No bouncing elements without a functional reason.
- No exaggerated spring overshoot.
- No endless ambient animation on learning surfaces.
- No parallax merely for visual novelty.
- Avoid motion that competes with reading.

Every animation must serve at least one of:

- clarify hierarchy
- show causality
- preserve spatial continuity
- confirm an action
- guide attention
- reduce perceived latency

If it serves none of these, it does not ship.

## Frozen motion facts (repository truth — not negotiable by a skill)

From `student-os/docs/design-handoff/05-TOKENS.md` §6 and
`student-os/apps/mobile/src/theme/tokens.ts`:

```
motion.instant  120 ms   // control press feedback
motion.enter    220 ms   // modal and full-screen presentation
motion.settle   180 ms   // feedback panel reveal after submission
```

**Three durations, and no more.** Easing is the **platform default** — do not introduce a custom
cubic-bézier or a spring curve without owner approval.

Already-decided prohibitions. A skill recommending any of these is wrong for this repository:

| Prohibited | Source |
| --- | --- |
| Celebratory animation on a correct answer | `05-TOKENS.md` §6 |
| Evidence-counter tween — the delta is a state change | `05-TOKENS.md` §6, `tokens.ts` |
| Shimmer on `LoadingSkeleton` (decorative motion) | `21-SYSTEM-STATES.md` |
| Full-screen spinner | `21-SYSTEM-STATES.md` |
| Scale transform or colour animation on press | `10-COMPONENT-STATES.md` |
| Ripple beyond the Android platform default | `10-COMPONENT-STATES.md` |
| Shadow on content (`shadow.card`); `shadow.sheet` is modal-only | `05-TOKENS.md` §5 |
| Toast/dialog for validation or error | `21-SYSTEM-STATES.md`, `23-ACCESSIBILITY.md` |
| Headers moving when the keyboard appears | `21-SYSTEM-STATES.md` |

Reduced motion: honour `AccessibilityInfo.isReduceMotionEnabled` (native) and
`prefers-reduced-motion` (web output) by dropping **all three tokens to 0 ms**. Per
`23-ACCESSIBILITY.md`, nothing in the product depends on animation to convey meaning, so this is a
safe collapse — which also means **no animation may be the sole carrier of state**.

## Stack reality (read before writing motion code)

`student-os/apps/mobile` is **Expo ~57 / React Native 0.86** with `react-native-web` for the web
output. There is **no `react-native-reanimated`, no `moti`, no `framer-motion`, no GSAP, no Lottie**
in `package.json`, and no `Animated` / `LayoutAnimation` call site in `src/` yet.

Consequences when translating skill advice, which is largely written for CSS/DOM:

- CSS advice (`transition`, `will-change`, `@media (prefers-reduced-motion)`, `clip-path`, scroll-driven
  animations) does not apply natively. Translate it, don't paste it.
- The compositor-friendly set here is **`opacity` and `transform`** via `Animated` with
  `useNativeDriver: true`. Animating `height`, `width`, `margin`, `padding`, `top`/`left` or
  `flex` runs on the JS thread and triggers layout — that is the layout thrash
  `fixing-motion-performance` is there to prevent.
- Screen/modal presentation should come from `expo-router` + `react-native-screens` platform
  transitions, tuned to `motion.enter`, not hand-rolled.
- Adding an animation dependency is a dependency decision, not a motion decision. Ask the owner.

RTL: Arabic is the **default locale**. Any directional motion must derive its sign from the resolved
writing direction, never from a hard-coded `+x`. Mirror per `22-RTL-ARABIC.md`, including the
directional glyphs it names (back arrow, chevrons, evidence-delta arrow, send glyph).

## Motion spec output

Before implementing any significant motion, document it in this exact shape and get it reviewed:

```
TRIGGER
FROM_STATE
TO_STATE
ANIMATED_PROPERTIES
DURATION_OR_SPRING
EASING
PURPOSE
INTERRUPT_BEHAVIOR
REDUCED_MOTION_FALLBACK
RTL_CONSIDERATION
PERFORMANCE_RISK
```

`PURPOSE` must name one of the six justifications above. `REDUCED_MOTION_FALLBACK` must be a real
end state, not "skip the animation".

## Priority interactions

Apply the stack to these first. The **Decided** column is already frozen — the stack refines the
rest, it does not reopen these.

| Interaction | Decided |
| --- | --- |
| Tab transitions | — |
| Home → Topic | `motion.enter`, platform push |
| Topic → Practice | `motion.enter`; Practice is the one mode switch (tab bar removed, ink header band) |
| Answer selection | `motion.instant`; no scale, no colour animation |
| Check Answer | `motion.instant` press feedback |
| Correct / incorrect reveal | `motion.settle` (180 ms); **no celebration**; state carries a word and a shape, never colour alone |
| Evidence change | **no tween** — state change only |
| Next-question transition | — |
| Practice completion | — |
| Modal / report transitions | `motion.enter`; report is a **modal**, not a pushed route |
| Compose submission | On failure the post is **not** cleared |
| Message send state | Six states exist; failed bubbles retry with backoff |
| Loading / empty / error transitions | Skeleton shaped like the incoming screen, **no shimmer, no spinner**; error is never a toast |

## Safety / design boundary

Skills are advisory tools. They do **not** outrank, in this order:

1. `student-os/docs/design-handoff/`
2. `student-os/docs/design-handoff/FINAL-FREEZE.md` (`DESIGN_SYSTEM_LOCKED = YES`,
   `FINAL_HANDOFF_LOCKED = YES`)
3. the approved visual reference
4. current repository / backend truth

If a skill recommends something that conflicts with the frozen design, **reject that
recommendation** and say so in the review output rather than silently splitting the difference.
Design reopens only on a demonstrated accessibility or implementation contradiction — with evidence,
the affected rule, the minimum correction, and a `CHANGELOG.md` entry.
