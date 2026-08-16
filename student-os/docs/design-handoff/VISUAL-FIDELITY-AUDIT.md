# Visual fidelity audit — implementation vs the approved reference

2026-08-16. `FINAL_HANDOFF_LOCKED = YES` · `DESIGN_CHANGED = NO`

## How this audit was produced

Not by opinion. The reference (`reference/Student OS V2.dc.html`) was rendered
in Chromium with its pinned CDN dependencies served from local copies of the
exact versions (ionicons 7.4.0, React 18.3.1 — the sandbox cannot reach
jsDelivr/unpkg, so they were fetched from the npm registry and served to the
page by request interception; Google Fonts loaded normally, so type fidelity
is judged from real Newsreader/IBM Plex rendering). Every 390 px phone shell
was screenshotted individually — 50 frames. The implementation was rendered
from the preview fixture build at the same width, both locales.

Frame identity follows `FRAME-MAP.md`: Turns 3–5 only; the spec wins over a
frame where they disagree; Turn 6 and Turns 1–2 were not consulted.

## The headline finding

**The implementation renders zero of the frozen typefaces.** No `fontFamily`
is set anywhere in the theme, so every screen renders in the platform system
face. The reference is set in Newsreader (Latin display and knowledge body)
and IBM Plex Sans / Sans Arabic / Mono — the pairing that *is* the Academic
Editorial voice. This is why every screen fails visual recognition at a
glance while passing every functional test: the composition is often close,
but the voice is absent. `06-TYPOGRAPHY.md` and `tokens.json →
fontsToBundle` have specified the four families and static faces since
freeze; the loading was simply never implemented.

Second global finding: **the tab bar is not the frozen tab bar.**
`04-NAVIGATION.md` freezes five tabs — Today · Topics · Learn · Rooms · Chat
— and every approved frame draws them. The implementation ships Home ·
Groups · Create · Learn · Chat: "Create" occupies a tab the design gives to
Topics, and Rooms (classrooms) is missing from the shell entirely.

Everything below assumes those two corrections and lists what remains per
screen.

## Per-screen verdicts

Verdict key: `MATCH` — recognizably the approved frame.
`MATCH_WITH_SPEC_OVERRIDE` — differs from the drawn frame exactly where the
numbered spec overrides it (deviation named). `REQUIRES_CORRECTION` —
composition/typography work needed beyond the two global items.

### Home — frame 3a · spec `11` — REQUIRES_CORRECTION

Reference: serif masthead 32 with date line `Tuesday 15 August · Stage 3,
Medicine`; search + compose glyphs right-aligned to the masthead; 2 px rule;
`Classified to your topics` section header (structure colour) with the count
right-aligned; knowledge items with metadata line, **serif headline ~24**,
serif secondary paragraph, teal cites block, author row (avatar · name ·
shield · role · time); `Under challenge` group; **resume band pinned above
the tab bar** ("3 questions left on Acid–base / where you stopped on
Sunday" + inverse Practise).
Implementation deltas: all text in system sans; knowledge headline not serif
scale; section count absent; author row lacks the verification shield glyph;
date line format differs. (The frame draws the resume band at the foot,
but `11-HOME.md` §Behaviour says it *scrolls with content* — the
implementation's scrolling band is the spec-correct reading; recorded as an
override, not a defect.)

### Learn — frame 3a/4a · spec `12` — REQUIRES_CORRECTION

Reference: serif `Learn` 32 + sans dek; 2 px rule; ink band `Ready to
practise` with serif topic title and action (drawn teal — **spec override:
`07-COLOUR.md`, action is ink/inverse**); `Recent answers suggest difficulty`
section with **serif topic name + right-aligned mono fraction 5/12** (numerator
ink, denominator muted), metadata line, **segmented evidence bar** (filled ink
segments), `Also appears in` label-left/list-right two-column related block
with leader rules; `Not enough evidence to say` **dashed-border group** with
serif topic rows + mono fractions and one shared explanation; footer caption
`Study-activity signals, not a grade. Private to you.`
Implementation deltas: sans everywhere; fraction not mono-styled at role
weight; related-topics block laid out as plain rows (no label column, no
leader rules); low-evidence group present but border/spacing weight differs.

### Topic — frame 3a · spec `12` — REQUIRES_CORRECTION

Reference: back arrow + breadcrumb `Pediatrics / Renal / Glomerular disease`
(muted, single metadata run); **serif title 30**; serif dek; 2 px rule;
practise row — bold `3 questions unanswered`, caption `you answered 4 of 7 —
a signal, not a grade` with **mono 4 of 7**, action right (drawn teal — spec
override: ink); `How it connects` with **three labelled rows (Part of /
Types / Seen with), label structure-coloured left, value right, joined by a
leader rule — dashed rule for cohort-derived**, caption `dashed = found in
cohort content, not curated`; `Knowledge here` rows (serif label + mono count
+ chevron, hairline separated); knowledge preview: serif headline + teal
cites line.
Implementation deltas: sans; connects block rendered as plain rows without
the label/leader-line grammar; knowledge rows lack mono counts.

### Practice — frames 3a/4a/4b · spec `13` — REQUIRES_CORRECTION

Reference: **ink header band**: close glyph, **segmented progress bar in the
band** (answered segments filled, current white, rest dark), mono `3/7`
right; below: metadata crumb `Nephrotic syndrome · choose one`; **serif stem
24/34**; options as **lettered rows — A/B/C/D mono letter, serif-adjacent
option text, hairline separators; selected = paper100 fill + 2 px ink rules
above and below + trailing check**; footer **pinned** full-width ink `Check
answer`. (Progress segments drawn teal — spec override `07`: filled segments
are ink-on-band; teal is provenance only.)
Implementation deltas: header is not the ink band composition (progress +
count placement differ); stem is sans and smaller; options are boxed rows
rather than lettered hairline rows; selected state uses border box, not the
2 px rule + fill + check grammar.

### Classroom — frame 5a · spec `14` — REQUIRES_CORRECTION

Reference: back + crumb `Classrooms / Pediatrics 301`; **serif title 30**;
metadata `Pediatrics 301 · Dr. Amjad Al-Rubaie`; sans body description;
**role chip `You are a student here` (structure-coloured outline chip)**
beside `24 members · 9 lectures`; 2 px rule; `Members` section with
`See all 24` trailing; avatar row with `+18` dashed circle; `Lectures` rows —
`9 · Glomerular disease` with metadata `6 materials · 50 min · posted
yesterday` + chevron; **most-recent band pinned at the bottom** (`Most recent
· Glomerular disease` + inverse Open).
Implementation deltas: sans; role rendered as bare structure text, not the
outline chip; counts split across two metadata lines; most-recent band sits
above the lecture list in-flow instead of pinned last against the tab bar.

### Messages — frame 5b · spec `15` — MATCH_WITH_SPEC_OVERRIDE (after global fixes)

Reference: serif `Messages` 32; attention line directly under the title;
rows — avatar, bold name, preview (single line, `Omar: ` prefix for group
senders), time right, **structure-coloured unread count pill**; hairlines.
Implementation matches this composition. Two deviations, both spec-side:
the attention line reads the permanent "live delivery is unavailable" copy
rather than the frame's `Reconnecting…` — the frame predates
`BLOCKED_CAPABILITIES.md` (no socket exists on the production host, so
"reconnecting" would be a false promise); and unread is also carried by name
weight per `10-COMPONENT-STATES.md` (colour never alone). Remaining work is
global only (fonts, tab bar).

### Conversation — frame 5b · spec `15` — REQUIRES_CORRECTION

Reference: header — back, avatar, bold name, presence line (structure);
centred day caption; **other-party bubbles: surface with hairline border,
radius ~16, sender name muted inside**; own: ink, state word inside
bottom-trailing (`Sent` in band-muted; `Sending…` on a grey bubble;
`Failed ↻` challenged); **Unread divider: structure rule + label**; composer
— hairline top, rounded field with placeholder, **circular ink send button**.
Implementation deltas: bubble radius/inner-name treatment differ slightly;
day separators absent; sending state not rendered as the grey bubble
variant. Typing line is a spec override (no socket — never simulated).
Six states already worded per contract.

### Search — frame 5c/5h · spec `16` — REQUIRES_CORRECTION

Reference: top row is **back arrow + pill-shaped field** (search glyph,
query, clear glyph) — no screen title; section headers `People` / `Study
groups` / `Knowledge` / `Communities` (bold 13); people rows avatar + bold
name + `@handle · Stage 3`; group rows + chevron; knowledge results in
**serif body scale** with teal cites line + metadata; communities row with
**`Official` outline chip** (structure colour).
Implementation deltas: renders a `Search` TopBar title above a rectangular
field (reference has no title and a pill field); knowledge results in sans
body; official marker is text, not the chip.

### Profile — frame 5d · spec `17` — REQUIRES_CORRECTION

Reference: back + `@amjad_r` crumb; **avatar left, beside serif name 30**,
metadata `College of Medicine · Stage 3` under the name; sans bio; **mono
`142` large + `contribution score` caption on one baseline row**; 2 px rule;
`Interests` chips (hairline outline); **full-width outline `Following`
button**; `Posts` — metadata line, serif headline, teal cites.
Implementation deltas: identity block is centred/stacked rather than
avatar-beside-name; score not in mono at display scale; posts headline sans.

### Compose — frame 5d · spec `18` — REQUIRES_CORRECTION

Reference: **serif `New post` 32 + close glyph right** (modal header);
bordered rounded body field with mixed-script content; caption under field
(`Language is detected from what you write. You are not asked.`); `Who can
see this` chips (selected ink); `What kind of knowledge is this` + trailing
`optional`, caption `Tap it again to leave it unlabelled…`; `Difficulty`
chips; challenged error block with leading rule; **footer pinned: outline
`Image` button + ink `Publish` side by side**.
Implementation deltas: header/title treatment sans; footer actions not the
pinned two-button row (Image entry point sits elsewhere); captions partially
present.

### Auth (Sign in) — frame 5f/5h · spec `20` — MATCH after global fixes

Reference: serif `Sign in` 32 + sans dek; bold field labels; rounded
hairline inputs; error state — challenged input border + leading-rule
message under the field; full-width ink `Sign in`; `No account? Create one`
in structure bold; footer caption about the three failure messages.
The implementation (as of the auth-screen pass on this branch) has this
composition; the deltas are the global font work and the structure-coloured
link tone. Verified against 5f error state: implementation shows the same
leading-rule message grammar.

### Settings / compliance — no frame · specs `21`, `24` — MATCH_WITH_SPEC_OVERRIDE

`FRAME-MAP.md` lists these among "specified in writing, never drawn". The
written specs are the contract; the implementation was reviewed against them
in the P0/P1 pass. Only the global corrections apply. (Absence of a frame is
recorded here so nobody hunts for one.)

### Arabic / RTL — frames 3b, 5h · spec `22` — REQUIRES_CORRECTION (global only)

The reference composes Arabic natively in IBM Plex Sans Arabic 600 for
display; the implementation currently renders system Arabic at 400–700
platform mapping. Composition (masthead order, mixed-script runs,
Arabic-Indic counts, LTR join codes) already matches the frames; the missing
piece is the typeface and the per-script line-height table from `06`.

## Correction plan (this branch)

1. **Fonts** — load the frozen static faces via `expo-font`; express the
   `06-TYPOGRAPHY.md` role table in the theme with per-script resolution;
   knowledge body/serif roles wired into Home, Learn, Topic, Practice,
   Search-knowledge, Profile-posts.
2. **Tab bar** — the frozen five (Today · Topics · Learn · Rooms · Chat),
   74 px + inset, hairline top; Create leaves the bar (compose glyph on Home
   masthead is the entry, per frame 3a).
3. Screen-by-screen composition per the deltas above, in the priority order
   Home → Learn → Topic → Practice → Classroom → Messages → Conversation →
   Search → Profile → Compose → Auth → Settings.
4. Re-render both sides; visual proof pairs into
   `docs/design-handoff/visual-proof/`; verdicts updated in this file.

Nothing in this pass touches contracts, transports, state machines,
navigation gating, accessibility behaviour, or the RTL logic — composition
and typography only.

---

## Post-correction verdicts — 2026-08-16, after the fidelity pass

Every correction above was implemented on `claude/student-preview` and both
sides re-rendered. Pairs in `visual-proof/` ({screen}-reference.png against
{screen}-implemented.png, reference at 390 px, implementation at 390 px).

| Screen | Verdict | Notes |
| --- | --- | --- |
| Home | **MATCH_WITH_SPEC_OVERRIDE** | Serif masthead + knowledge voice + counts + author shield in. Overrides: resume band scrolls (`11` §Behaviour); fixture shows no open attempt, so no band in the shot. |
| Learn | **MATCH_WITH_SPEC_OVERRIDE** | Display-voice topic rows, mono fractions, dashed low-evidence group. Override: the frame's teal Start is drawn ink per `07`. |
| Topic | **MATCH** | Serif title, mono `N of M`, labelled leader-line connects rows, mono knowledge counts. |
| Practice | **MATCH_WITH_SPEC_OVERRIDE** | Ink band + segments + mono counter; serif stem 24/34; lettered hairline-row options with fill + 2 px rules + check. Override: segments ink-on-band, not the frame's teal (`07`). |
| Classroom | **MATCH** | Crumb, serif title, role chip, avatar row + dashed `+N`, numbered lectures, most-recent band at the foot of the scroll (`14` §Scrolling). |
| Messages | **MATCH_WITH_SPEC_OVERRIDE** | Serif title, unread pill + weight. Override: permanent no-realtime line instead of the frame's "Reconnecting" (`BLOCKED_CAPABILITIES`). |
| Conversation | **MATCH_WITH_SPEC_OVERRIDE** | Bubble grammar, worded states, structure unread divider, circular ink send. Overrides: no typing line (no socket), six worded states where the frame drew three (`15`). |
| Search | **MATCH** | Back + pill field, no screen title; four sections; knowledge results in the editorial voice. |
| Profile | **MATCH** | Avatar-beside-name serif identity, mono score on a baseline row, interest chips, outline relationship button, editorial posts. |
| Compose | **MATCH** | Serif `New post` + close; captions; ink chip selections; challenged error block; Image + Publish closing row. |
| Auth | **MATCH** | Serif title, bold labels, hairline inputs, leading-rule error, ink action, structure link. |
| Settings / deletion | **MATCH_WITH_SPEC_OVERRIDE** | No frame exists; verified against `21`/`24` as written. |
| Arabic / RTL | **MATCH** | IBM Plex Sans Arabic 600 display, per-script line heights, native composition — verified at 360/390 in the acceptance run. |

Verification on the corrected build: acceptance 132/132 (ar/en × 360/390),
accessibility 12/12, preview journey 96/96, typecheck/lint/unit suites green.

`VISUAL_FIDELITY_MATCH = YES` — with the named spec overrides, each of which
traces to a numbered spec rule that outranks the frame per `FRAME-MAP.md`.
