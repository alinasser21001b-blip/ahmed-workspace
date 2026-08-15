# Spacing, layout, responsive

## Scale

The 4 pt scale in `tokens.ts` is unchanged: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48.

| Measure | Value | Note |
| --- | --- | --- |
| Screen gutter | 20 | not on the 4 pt scale, and deliberate: 16 crowds a 30 px serif title, 24 wastes a 360 px screen |
| Practice gutter | 22 | the stem needs a slightly narrower measure |
| Row vertical padding | 11 | with `minHeight` doing the real work |
| Section gap | 16 | between a section title and the previous block |
| Section title → first row | 4–6 | the title belongs to its rows |
| Control spacing | 10 | between adjacent actions |
| Modal top | 8 | Compose and other modals sit close to the top |
| Footer action block | 14 top, 28–30 bottom | plus safe-area inset |

## Vertical rhythm

Screens are built as: **status bar → header block → 2 px ink rule → content → optional ink band → tab bar.**

The 2 px rule under the header is the product's most repeated signature. It appears on Learn, Topic, Classroom, Notifications, Messages list and Search. It does not appear inside Practice, where the ink band replaces it.

## Scrolling

One scroll container per screen, between the header and the tab bar. Rules:

- The tab bar never scrolls.
- A screen's dominant action either scrolls with the content (Learn's band, Home's band) or is pinned in a footer (Practice, Compose, Auth). Never both patterns on one screen.
- No nested scroll views. The member avatar row on Classroom is a wrapping row, not a horizontal scroller.
- Practice scrolls the stem and options together; the Check control is pinned.

## Safe area

`SafeAreaProvider` is already mounted at root. Top inset is consumed by the status-bar row; bottom inset is **added to** the tab bar height and to every pinned footer. Practice, having no tab bar, adds the bottom inset to its footer padding (28 → 28 + inset).

The ink header band in Practice must extend behind the status bar and paint it — the band's own background covers the inset area, so the status-bar glyphs switch to light. That is the one place the design paints into the top inset.

## 360 px — formalised

Design width is 390. The floor is 360. What happens at 360:

| Behaves | How |
| --- | --- |
| **Wraps** | screen titles, knowledge body, option labels, source lines, classroom titles, Arabic headings, chip rows |
| **Truncates** | conversation preview (one line), display name in a row, handle before name |
| **Scrolls** | the single content container |
| **Never shrinks** | 13 px metadata floor, 44 px targets, the practice stem, the dominant action's 54 px height |
| **Stays visible** | the pinned Check / Publish / Sign in control; the practice progress row and counter; the header title |
| **May fall below the fold** | the fourth practice option, the knowledge index on Topic, the privacy line on Learn |

## Extreme content — the full matrix

At 360 px with the largest supported text step (≈1.35×), all verified in Turn 5 §4b:

| Content | Result |
| --- | --- |
| Four-option practice question | stem takes 6 lines (Latin) / 7 (Arabic); option D below the fold; nothing clips; footer reachable |
| Long Arabic heading (48 chars) | 3 lines, clears the rule |
| English textbook title inside Arabic | isolated LTR run wraps as a unit; punctuation stays attached |
| Long handle (30 chars, the schema max) | truncates before the display name does |
| Long classroom title | 3 lines, member/lecture metadata stays on its own line |
| Long search result | knowledge body wraps; the type heading is unaffected |
| Long message | bubble grows to 85% width then wraps; no horizontal scroll |
| Long compose classification | chip row wraps to 3 rows; the footer stays pinned |

**Density is never solved by reducing text below 13 px.** Accepting a scroll is the correct trade, and it is why Mobile Ergonomics scored 8 rather than 9.

## Responsive / tablet — RESOLVED: V1 is iPhone-only

**Decided.** `app.json` declares `ios.supportsTablet: false` in merged `main`. V1 ships to iPhone only, and **DESIGN_BLOCKER_IPAD is closed** — resolution 1 of the two that were on the table, taken by product decision and already carried by the repository.

What this settles: there is no 1024 pt specification to write and none to ask for. The phone column is the only layout. Stretching it across a tablet width was the failure mode the blocker existed to prevent, and turning `supportsTablet` off prevents it at the source rather than in a layout rule.

The record of what a tablet layout *would* have required is kept for whenever a tablet becomes a target — a max content measure (≈680 px) left-aligned to the reading edge, a two-pane split for list→detail on Messages / Classrooms / Search, and a decision on where the tab bar goes. **None of it is V1 scope, and none of it may be inferred as V1 scope.**

**Web** (`web.output: single`) has the same unresolved measure problem plus real keyboard navigation — see `23-ACCESSIBILITY.md`. Also DEFERRED_PRODUCT_DECISION.
