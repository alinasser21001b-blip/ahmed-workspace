# Frame map — visual reference to production route

Added at the visual-packaging pass, 2026-08-16. **No design decision changed. `FINAL-FREEZE.md` is untouched.**

This file exists because engineering reported that the implementation does not visually match the approved design. It maps every drawn frame in the visual reference to the production route and state it depicts, so a discrepancy can be pointed at precisely.

## What the visual reference is

`reference/Student OS V2.dc.html` — one canvas-mode page, 29 drawn frames across six turns, byte-identical to the working file the design was approved from. It opens directly in a browser.

`reference/support.js` is its runtime and must sit beside it. Two remote dependencies load from the network: Google Fonts (Newsreader, IBM Plex Sans / Sans Arabic / Mono) and ionicons 7.4.0 from jsDelivr. **Offline, the type falls back to system fonts and icons do not render** — the layout still reads, but do not judge typographic fidelity from an offline open.

**There are no raster exports.** No PNG, JPG, SVG or PDF frame export exists in this project, at freeze or since. The live page is the only visual artefact, and it is complete — nothing was omitted from this package because nothing else exists.

## How to read a frame against the spec

**Frames are reference evidence, not specification.** Where a frame and a numbered spec file disagree, **the spec file wins.** Several frames predate corrections recorded in `CHANGELOG.md`; the deviations known at freeze are named in the table below. This rule is unchanged from `FRAME-INDEX.md` and is not relaxed by this document.

`FRAME-INDEX.md` remains the index of what each frame contains and its approval status. This file adds only the route mapping.

---

## Turn 6 — NOT PART OF THE FROZEN DESIGN

Frames `6a`–`6h` are a post-freeze exploration of a faculty console. They were drawn after the handoff was locked, they are not approved, and they map to **no production route** — most of what they draw has no backend at all (`6h` is the frame that says so). The reference page itself records that nothing in this turn edited `docs/design-handoff/`.

| ID | What it draws | Route | Status |
| --- | --- | --- | --- |
| 6a | Faculty console — reporting | none | EXPLORATION — not approved, no endpoint |
| 6b | Roster table + export menu | none | EXPLORATION — export does not exist in any layer |
| 6c | Moderation queue + roles / licence panel | none (moderation API exists; no console route) | EXPLORATION — queue is UI over a shipped API; licence panel has no backend |
| 6d | Alerts tray + live lecture, on the phone | `lecture/[id]` for the live half only | EXPLORATION — alerts have no delivery path (`19` is design-only) |
| 6e | Dark filtering, and the report in Arabic | none | EXPLORATION — dark theme is unreviewed (deferred) |
| 6h | What none of this has — the blocked list for turn 6 | — | Read this before costing any turn-6 frame |

**Do not build from turn 6.** If a console is wanted, it needs its own design pass and its own product decisions.

---

## Turns 1–5 — the frozen design

### Turn 3 — the approved direction

| ID | Screens drawn | Lang | Route(s) | Spec | Notes |
| --- | --- | --- | --- | --- | --- |
| 3a | Home, Learn, Topic, Practice, Practice-incorrect | EN | `(tabs)/index`, `(tabs)/learn`, `topic/[id]`, `practice/[topicId]` | `11`–`13` | **The approved system.** Teal on the correct state and the CTA predates the colour correction — teal is provenance only; see `07`. |
| 3b | Same five screens, composed for Arabic | AR | ″ | `22` | Approved. Not a mirror of 3a — composed natively. Arabic-Indic interface counts, Latin clinical values. |
| 3c | RTL decision log, §46 scorecard, blocked list | — | — | `22`, `CHANGELOG` | Rationale, not a screen. |

### Turn 4 — the learning loop

| ID | Screens drawn | Lang | Route(s) | Spec | Notes |
| --- | --- | --- | --- | --- | --- |
| 4a | Learn → Topic → Practice → answer → feedback → updated state, clickable | EN + AR | `(tabs)/learn`, `topic/[id]`, `practice/[topicId]` | `13` | Approved. Live evidence store. **`lowConfidence` threshold 12 is a demo deviation — the spec value is 5.** |
| 4b | Practice at 360 px, largest Dynamic Type step, four options | EN | `practice/[topicId]` | `08`, `13` | Approved. Option D falls below the fold; accepted, rationale recorded in `08`. |
| 4c | Blocked list at turn 4 | — | — | `BLOCKED_CAPABILITIES` | Superseded — read `BLOCKED_CAPABILITIES.md`. |

### Turn 5 — the rest of the product

| ID | Screens drawn | Lang | Route(s) | Spec | Notes |
| --- | --- | --- | --- | --- | --- |
| 5a | Classroom — member and non-member | EN | `classrooms/[id]` | `14` | Approved. The non-member view is the payload the server actually sends. |
| 5b | Messages list + conversation | EN | `(tabs)/chat`, `chat/[id]` | `15` | Approved shape. **Six send states are required; three are unrepresented in the UI.** Own messages are ink, not teal. |
| 5c | Search — four result types | EN | `search` | `16` | Approved. Topic and classroom search are blocked — `16` §deferred. |
| 5d | Profile + Compose, default and validation error | EN | `profile/[handle]`, `compose` (modal) | `17`, `18` | Approved. Follow must use `social.*` keys, never `groups.*`. |
| 5e | Notifications — 4 groups, collapsed rows | EN | *route absent* | `19` | **Design only — capability blocked.** No producer, drain, route or client. Do not schedule as buildable. |
| 5f | Sign in + onboarding step 5, error and valid | EN | `(auth)/sign-in`, `(onboarding)` | `20` | Approved. |
| 5g | State family — loading, empty, error, offline, restricted | EN | applies to every route | `21` | Approved. Simpler than the screen, never a different product. |
| 5h | Classroom, conversation, Search, Compose, Sign in in RTL | AR | `classrooms/[id]`, `chat/[id]`, `search`, `compose`, `(auth)/sign-in` | `22` | Approved. Composed for Arabic, not mirrored. |
| 5j | Semantic colour inventory | — | — | `07`, `09` | One meaning per colour. If a screen needs a colour for a meaning not on the list, the answer is ink. |
| 5k | Blocked list + cross-screen audit | — | — | `BLOCKED_CAPABILITIES` | Approved. |

### Turns 1–2 — history

Do not build from these. They are kept as audit evidence of what was rejected and why.

| ID | What it draws | Route(s) | Status |
| --- | --- | --- | --- |
| 1a | Home, as it was before the redesign | `(tabs)/index` | HISTORICAL — baseline evidence only |
| 1b | Learn, baseline | `(tabs)/learn` | HISTORICAL |
| 1c | Topic, baseline | `topic/[id]` | HISTORICAL |
| 1d | Practice, baseline | `practice/[topicId]` | HISTORICAL |
| 2a | Direction A — Academic Editorial | Home, Learn, Topic, Practice | SUPERSEDED by 3a — this direction was chosen and then resolved further |
| 2b | Direction B — Calm Operating System | ″ | REJECTED |
| 2c | Direction C — Knowledge Network | ″ | REJECTED |

---

## Specified in writing, never drawn

No frame exists for these. **Absence of a frame is not a licence to improvise** — the written spec is the contract.

Multi-select and true/false practice · practice submit-failure · practice resume · sign-up · forgot password · reset password · onboarding steps 1–4 · session restoration · lecture + materials · group detail · post detail with its correction thread · privacy settings · block dialog · report flow · account deletion (7 states) · support and legal · Arabic Practice completion · queued, delivered and read message states.

## If implementation disagrees with a frame

1. Check the numbered spec file first. The spec wins.
2. Check whether the frame is listed above as historical, superseded, exploration, or carrying a known deviation.
3. If the spec and the shipped screen genuinely contradict each other, that is the documented reopening condition — raise it with the evidence, the affected rule and the minimum correction, per `FINAL-FREEZE.md` §Stop condition. Do not resolve it by redrawing.
