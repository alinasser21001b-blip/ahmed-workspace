# Design principles

Seven rules. Each is testable, and each has a failure mode it exists to prevent.

## 1. Type carries hierarchy; containers do not

Knowledge is text. A screen is built from an editorial heading, body, and hairline rules — not from nested cards. **Test:** if removing every border and background left the hierarchy readable, the screen passes.

*Prevents:* the Turn 1 baseline, where a card was the only structure on the screen and eleven pills could stack above the body text.

## 2. Exactly one dominant action per screen

At most one filled ink control is visible at a time. Everything else is an outlined control, a plain row, or text. **Test:** count filled controls in a screenshot. More than one is a defect.

*Corollary for the two Learn entry paths:* the topic row is a plain row with a chevron; Quick Practice is the ink band. They differ in intent — the row is for understanding context, the band is for a learner who already knows what to practise — so only the band is filled.

## 3. Metadata has one voice

13px/20 sentence case, weight 500, `#6E6A60`. Every fact on every screen. **Test:** no interface text below 13px anywhere, and no uppercase-mono metadata.

*Prevents:* the identity depending on 10–11px uppercase Latin mono, which has no Arabic equivalent and measured ≈3.6:1 contrast.

## 4. Teal means provenance and nothing else

A source, a citation, a locator. Not success, not a correct answer, not a CTA, not online status, not a sent message. **Test:** grep every teal usage and name its semantic. See `07-COLOUR.md`.

## 5. No state depends on colour alone

Every state carries a word or a shape as well as a hue. **Test:** convert a screenshot to greyscale; every state must remain identifiable.

*This is why* a correct answer is ink with the word "Correct" and a checkmark, not green.

## 6. Relationships are drawn only where they carry information

The relationship primitive is for parent/child, type, and co-occurrence between topics. It is not for classroom rosters, message threads, settings, or search results — a membership list is a list. **Test:** could this be a plain list without losing meaning? Then it is a plain list.

## 7. The product never claims more than it observes

It counts answers. It does not know what a student knows. Copy says "answered", "correct", "signal", "small sample" — never "mastered", "ready", "you are weak in". **Test:** every learner-facing sentence must map to a field in `topicProgressSchema`. See `19`.

## Practice is the one mode switch

Practice removes the tab bar and takes an ink header band. Nothing else in the product does either. That is what makes it mean something. Full dark inversion was tested and rejected — see `20-PRACTICE` §rejected.
