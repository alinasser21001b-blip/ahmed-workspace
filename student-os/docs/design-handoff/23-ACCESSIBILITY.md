# Accessibility contract

## Targets

| Element | Minimum |
| --- | --- |
| Any interactive element | **44** (`MIN_TOUCH_TARGET`, binding) |
| List and navigation rows | 48 |
| Practice answer options | 56 |
| Dominant action | 54 |
| Tab bar item | 48 |
| Retry glyph on a failed message | 44 |

A row whose visual height is smaller must extend its target with `hitSlop`. The Turn 3 relation rows were 20–24 px and were corrected to 44 for exactly this reason.

## Dynamic Type

Every text role scales. Nothing is on a fixed height. Content may fall below the fold; **nothing may clip, overlap, or become unreachable.** Verified at the largest supported step at 360 px for Practice, Compose, Learn and Conversation.

Never reduce text below 13 px to win space — the answer is a scroll.

## Contrast

Measured table in `07-COLOUR.md`. Everything that carries a fact is ≥ 4.5:1. `textFaint` (2.4:1) is decorative only and never carries a standalone fact.

## No state by colour alone

Enumerated in `07` §greyscale test. Every state has a word, a glyph, or a structural difference. Answer options are distinguishable under monochrome, deuteranopia and protanopia.

## Screen-reader labels and reading order

- Screen titles are `accessibilityRole="header"`; section titles are headers too, so heading navigation works.
- A content row is **one** accessibility element, not five — a feed item reads classification → body → provenance → author → status in that order.
- MetadataLine parts join with commas in the label, never the visual `·`.
- Decorative elements are `accessible={false}`: tick bands, relation connectors, progress segments, day separators, avatar initials where the name is adjacent.
- Numbers are spoken as numbers: "4 of 8", "page 2521".
- Icon-only controls always carry a label: back, close, search, compose, retry, send.
- The verification shield is labelled ("verified instructor") — never colour or glyph alone.

## Practice — the required announcement order

On question load: **question number → stem → options.** Classification metadata ("Nephrotic syndrome · choose one") is announced **after** the stem, never before it. Decorative metadata before the question is the specific failure this rule prevents.

On submission, focus moves to the verdict label and `announceForAccessibility` speaks, in order:

1. verdict — "Incorrect" / "Correct"
2. the correct answer — "Correct answer: Minimal change disease"
3. the learner's answer — "Your answer: Membranous nephropathy"
4. the explanation, in full
5. the evidence change — "Answered on this topic: was 4 of 7, now 4 of 8"
6. the low-sample caveat while `lowConfidence`

Option labels after reveal append ", correct answer" or ", your answer, incorrect". Selection state uses `accessibilityState.checked` with `role="radio"` (single/boolean) or `"checkbox"` (multi).

## Focus

- **Modal focus** — Compose and Practice trap focus; the first focusable element is the close control, so an assistive-technology user can always leave.
- **Focus order** follows visual order; no `accessibilityViewIsModal` gaps.
- **On error** focus moves to the message, which is also a polite live region.
- **On navigation** focus moves to the new screen's title.
- **Focus ring** 2 px ink, 2 px offset, on every interactive component. Never a platform default and never browser blue. Applies to the web target. (iPad is not a V1 target — `supportsTablet: false`.)

## Announcements

Polite for: search results updating, new incoming messages, relationship-action results, validation errors. **Assertive for nothing** — an assertive announcement interrupts reading, and this product is mostly reading. The one candidate, practice feedback, is handled by moving focus instead.

## Disabled controls

Disabled uses `paper400` fill with a paper label — **not** reduced opacity, which fails contrast. `accessibilityState={{disabled: true}}` is always set. A control that is disabled because of permission is **removed and replaced by a reason** instead (see RestrictedState).

## Forms

Every field has a bound label (never placeholder-as-label). Rules are stated **before** submission, under the field. Errors are attached to the field that caused them, announced politely, and never delivered as a toast or a dialog.

## Reduced motion

Honour `AccessibilityInfo.isReduceMotionEnabled` by setting all three motion tokens to 0 ms. Nothing in the product depends on animation to convey meaning, so this is a safe collapse.

## Keyboard (web target)

`web.output: single` means the web build is real. Tab order follows visual order; every interactive element is reachable and shows the focus ring; Escape dismisses Compose and exits Practice; Enter submits a focused form. Not verified on the web build — listed as a QA task in `26`.

## Verification status

The spec is complete. **Device verification is outstanding** and is an engineering QA task, not a missing specification: a VoiceOver pass (iOS, Arabic and English) and a TalkBack pass over the learning loop, Compose and Conversation. Listed as P0 QA in `26-IMPLEMENTATION-PLAN.md`.
