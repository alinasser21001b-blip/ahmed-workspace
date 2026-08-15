# Tokens — source of truth and reconciliation

## The rule

`apps/mobile/src/theme/tokens.ts` **remains the single runtime source of truth.** `tokens.json` in this folder is the design-side record for tooling and review; it does not ship and it does not compete. Where the two disagree, apply the diff below to `tokens.ts` and regenerate nothing — there is no build step and no second system.

Do not add a `tokens.json` import to the app. Do not create a parallel theme file.

## What carries over unchanged

| Token | Value | Keep because |
| --- | --- | --- |
| `palette.indigo700` | `#2C3A82` | becomes the structure role |
| `palette.teal600` | `#178774` | becomes the provenance role, contrast-safe on paper |
| `palette.neutral900` | `#14181F` | ink, text and dominant action |
| `spacing` | 2/4/8/12/16/24/32/48 | the 4 pt scale is correct and complete |
| `radius.sm/md/lg/pill` | 6/10/14/999 | sufficient; `xl: 20` becomes unused |
| `typography.caption` | 13/20 | **this is the metadata role.** Weight moves 400 → 500 |
| `typography.body` | 16/26 | body text |
| `MIN_TOUCH_TARGET` | 44 | binding |
| `shadow.sheet` | as-is | modals only |

## Required changes to `tokens.ts`

### 1. Rename the `learning` role to `provenance` — **breaking, and the point**

```
- /** Reserved for learning actions only — study, quiz, continue. */
- learning: string;
- learningSoft: string;
+ /** Reserved for provenance and citation semantics only. Never success, never a CTA. */
+ provenance: string;
+ provenanceSoft: string;
```

`lightColors.provenance = palette.teal600` (was `teal500`; 600 measures ≈4.6:1 on paper, 500 does not reach 4.5). `provenanceSoft: '#F1F6F4'`.
`darkColors.provenance = palette.teal400`, `provenanceSoft: 'rgba(47,191,168,0.16)'`.

**Every existing `colors.learning` call site must be re-pointed, not renamed in place.** A learning action — Practise, Start, Continue — becomes `colors.text` on `colors.surface`, i.e. the dominant-action treatment. Only a source line, a citation, or "Cites N sources" may use `colors.provenance`.

This is the highest-risk change in the handoff and the one most likely to be silently undone. The token comment is the guard.

### 2. Add the warm neutral ramp

The shipped neutrals are cool (`#F7F8FA`, `#DEE2E9`). The editorial hierarchy needs a paper ground. Add, do not replace, so dark theme and any un-migrated screen keep working:

```
paper0:   '#FFFFFF'   // raised surface: fields, bubbles, practice reading body
paper50:  '#FCFBF9'   // app ground
paper100: '#F5F4F0'   // selected row fill
paper200: '#E3E1DC'   // hairline border
paper300: '#DCD8CF'   // control border
paper400: '#C6C1B3'   // chevron, disabled glyph
paper500: '#A9A497'   // caption-about-a-caption only
paper600: '#6E6A60'   // metadata
paper700: '#3C3A34'   // secondary body
```

Then in `lightColors`: `background: paper50`, `surface: paper0`, `border: paper200`, `borderStrong: paper300`, `textMuted: paper600`, `textSecondary: paper700` (new).

### 3. Add three semantic roles

```
structure:  indigo700   // relationship labels, roles, unread, links
attention:  '#B4531F'   // offline, reconnecting, evidence-updated. NOT an error.
challenged: '#9B3A40'   // challenged claim, incorrect answer, validation error
challengedSoft: '#FBF1F1'
```

`danger` stays for destructive actions (account deletion, block) and is **not** the same role as `challenged`. Two reds, two meanings, both documented in `07-COLOUR.md`.

### 4. Type roles to add

`display` and `title` currently assume one font family. Add script-aware roles — see `06-TYPOGRAPHY.md` for the full table:

```
displaySerif   { 32 / 38 / 500 }   Latin only
displayArabic  { 30 / 46 / 600 }   Arabic only
metadata       { 13 / 20 / 500 }   both — supersedes caption for interface facts
numeric        { 15 / 22 / 500 }   mono, tabular
```

**Delete `typography.micro` (11/16/600).** It is the retired 11 px metadata role and its continued existence is how it comes back — merged `main` proves it, having added two new call sites after the freeze. **Retired means final UI must not use it**; the remaining call sites are implementation debt, not a live token. Re-point them to the 13/20 metadata role, then delete the token in the same change so the next new screen cannot reach for it.

### 5. Elevation

This system does not use shadows for content. `shadow.card` must not be applied to any surface in the final design — a hairline border does that work. Keep `shadow.sheet` for modals only.

The frames in `Student OS V2.dc.html` show a drop shadow on each device frame; that is the canvas presenting a phone, not a product style.

### 6. Motion

No motion tokens exist and almost none are needed. Add exactly three:

```
motion.instant  120 ms   // control press feedback
motion.enter    220 ms   // modal and full-screen presentation
motion.settle   180 ms   // feedback panel reveal after submission
```

Easing: platform default. **No decorative motion**, no celebratory animation on a correct answer, no evidence-counter tween — the delta is a state change, and animating it dramatises a number the product is deliberately understating. Honour `prefers-reduced-motion` / `isReduceMotionEnabled` by dropping to 0 ms.
