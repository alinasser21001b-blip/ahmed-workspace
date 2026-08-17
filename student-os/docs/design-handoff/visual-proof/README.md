# Visual proof — approved frame beside the running screen

Captured 2026-08-17 from commit `bfbddff`. `FINAL_HANDOFF_LOCKED = YES` ·
`DESIGN_CHANGED = NO`.

## What these are

`pairs/*.png` — one sheet per screen. **Left is the approved reference frame,
right is the current implementation.** Both halves are real renders at
**390 px**, captured in the same run by
`apps/mobile/e2e/visual-proof.mjs`.

The reference half is the frozen `reference/Student OS V2.dc.html` rendered in
Chromium at its drawn size, with its pinned dependencies (React 18.3.1, Babel
standalone 7.29.0, ionicons 7.4.0) and the real Google Fonts woff2 files served
locally — the sandbox cannot reach jsDelivr or unpkg, and Chromium's request
for the Google stylesheet fails even where curl succeeds. Without that wiring
the reference renders in system fonts with no icons, and typography could not
be judged at all. There are no raster exports of the design; the live page is
the only visual artefact, as `FRAME-MAP.md` records.

The individual halves are also kept at the top level as `<screen>-reference.png`
and `<screen>-implemented.png`.

## Frame identity

Per `FRAME-MAP.md`: **turns 3–5 only.** Turn 6 (faculty console) and turns 1–2
(history) were not opened.

| Sheet | Reference frame | Route | Spec |
| --- | --- | --- | --- |
| `home` | 3a[0] | `(tabs)/index` | `11` |
| `learn` | 3a[1] | `(tabs)/learn` | `12` |
| `topic` | 3a[2] | `topic/[id]` | `12` |
| `practice` | 3a[3] | `practice/[topicId]` | `13` |
| `classroom` | 5a[0] | `classrooms/[id]` | `14` |
| `messages` | 5b[0] | `(tabs)/chat` | `15` |
| `search` | 5c[0] | `search` | `16` |
| `profile` | 5d[0] | `profile/[handle]` | `17` |
| `compose` | 5d[1] | `compose` | `18` |
| `settings` | **none — never drawn** | `settings` | `21`, `24` |
| `home-ar` | 3b[0] | `(tabs)/index` | `22` |
| `learn-ar` | 3b[1] | `(tabs)/learn` | `22` |
| `topic-ar` | 3b[2] | `topic/[id]` | `22` |
| `practice-ar` | 3b[3] | `practice/[topicId]` | `22` |

`settings` has no left half. No frame for it exists — `FRAME-MAP.md`
§"Specified in writing, never drawn" lists privacy settings among the surfaces
specified in prose only. The sheet shows the implementation alone and says so,
rather than borrowing a lookalike from another turn.

## Reading the sheets honestly

Three classes of difference are expected and are **not** fidelity failures.
They are called out here so the owner is not left to guess which is which.

**1. Preview chrome.** The right half carries the black `Student OS Preview —
sample data` banner and its `Give feedback` control. That is preview-only
scaffolding, gated behind `EXPO_PUBLIC_PREVIEW_MODE`; it does not exist in a
production build and is not part of the design. It also displaces the content
down by its own height, so vertical positions differ by that much throughout.

**2. Fixture content.** The reference draws a nephrology dataset (Nephrotic
syndrome, Dr. Amjad Al-Rubaie, `3/7`); the preview world is an acid–base
dataset (Layla Hassan, `1 of 4`). Different words of different lengths wrap
differently. Judge composition, hierarchy and type — not which sentence is on
screen.

**3. Documented spec overrides.** Where a frame and a numbered spec disagree,
the spec wins (`FRAME-MAP.md`). Each override visible in these sheets:

| Sheet | Visible difference | Why the implementation is right |
| --- | --- | --- |
| `home` | Resume band is not pinned above the tab bar | `11` §Behaviour — it scrolls with content |
| `learn` | Start control is ink, not the frame's teal | `07` — teal is provenance only |
| `practice` | No `topic · choose one` eyebrow above the stem | `13` §74 entry is band + counter + stem + options; §108 puts classification metadata **after** the stem, never before |
| `practice` | Counter reads `1 of 4`, not `3/7` | `13` §74 specifies the `1 of N` form |
| `practice` | Progress segments are ink on the band, not teal | `07` — teal is provenance only |
| `messages` | Permanent "live delivery is unavailable" line, not "Reconnecting" | `BLOCKED_CAPABILITIES` — the host cannot hold a socket, so "reconnecting" would be untrue |

Everything else is the comparison the owner asked for.

## Reproducing

```
# reference on 8099, preview build on 8081, both local and fixture-only
node apps/mobile/e2e/visual-proof.mjs
```
