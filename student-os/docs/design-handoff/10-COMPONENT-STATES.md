# Component state matrix

`—` = not applicable. **Every non-default state must be identifiable without colour.**

| Component | default | pressed | focused | selected | disabled | loading | error | offline | RTL | large text | long content |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DominantAction | ink fill | opacity .85 | 2 px ink ring, 2 px offset | — | paper400 fill, paper label | spinner, width held | — | inert + banner above | label centred, unchanged | grows vertically | label wraps to 2 lines |
| SecondaryAction | 1.5 px outline | fill paper100 | ring | — | border paper300, label paper400 | spinner | — | inert | — | grows | wraps |
| AnswerOption | 1.5 px border | fill paper100 | ring | 2 px ink + paper100 + weight 500 | after submit: no press | — | — | selection kept, submit queued | letter leads, Arabic letters | grows freely | wraps, never truncates |
| ChipPicker chip | outline | fill paper100 | ring | ink fill + paper label | opacity .45 + no press | — | group border challenged | — | wraps from reading edge | chip grows | row wraps to 3 |
| FormField | 1 px border | — | 2 px ink border | — | paper100 fill | — | 1.5 px challenged + message | — | forceLTR fields stay LTR | field grows | scrolls internally |
| MessageBubble | surface + border | — | — | — | — | 60% opacity + "Sending…" | challenged "Failed" + retry | queued + "Queued" | own to reading end | grows | wraps at 85% |
| Composer | field + send | send opacity | 2 px ink | — | send inert when empty | — | — | queues, banner shown | send glyph mirrors | field grows to 5 lines | scrolls |
| AcademicRow | hairline top | fill paper100 | ring | — | label paper400 | skeleton | — | — | chevron flips | 48 → grows | content wraps |
| TopicRow | plain | fill paper100 | ring | — | — | skeleton | — | — | fraction word form | grows | name wraps 2 lines |
| ConversationRow | plain | fill paper100 | ring | — | — | skeleton | challenged preview | — | avatar leads | grows | preview truncates |
| NotificationRow | plain | fill paper100 | ring | — | — | skeleton | — | — | marker at reading edge | grows | sentence wraps |
| ProvenanceLine | teal rule | — | — | — | — | — | — | — | `borderInlineStart` flips | grows | title wraps, locator to own line |
| RelationshipPrimitive row | 44 px | fill paper100 | ring | — | — | — | — | — | label leads, connector trails | wraps to 2 lines, connector to 0 | overflow → "See all" |
| EvidenceFraction | mono fraction | — | — | — | — | skeleton | — | — | word form `٥ من ١٢` | grows | — |
| TabBar item | outline glyph | opacity | ring | filled glyph + 600 | — | — | — | — | order reverses | label wraps to 2 lines | — |
| PracticeHeader segment | `#3C3A34` | — | — | current `#8E8B82` | — | — | incorrect: challenged | — | fills from trailing edge | height fixed 4 px | segments compress, min 4 px wide |

## Focus rings

`2 px solid ink, 2 px offset` on every interactive component. Never a platform default ring, never the browser blue. Applies to the web target. (iPad is not a V1 target — `supportsTablet: false`.)

## Loading inside a control vs on a screen

A control that triggers a request holds its own width and swaps its label for a spinner. A screen that is fetching shows a LoadingSkeleton. **Never both at once**, and never a screen spinner over existing content — a refetch keeps the stale content visible and marks it with the attention rule.

## Pressed feedback is 120 ms and opacity only

No scale transform, no ripple beyond the platform default on Android, no colour animation. The pressed state exists to confirm the tap landed.
