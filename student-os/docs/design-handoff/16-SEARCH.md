# Search

Search is where the product's architecture is either visible or absent. Today it is partly absent, and that is the single largest gap in the handoff.

**Route** `app/search.tsx`
**Purpose** Reach any object in Student OS by name.
**Primary user question** "Where is the thing I am thinking of?"
**Dominant action** none — the field is the screen.
**Secondary actions** clear, cancel, open a result.

**Source repo files** `app/search.tsx`, `packages/core/src/text/arabic.ts` (`normalizeArabic`), SQL mirror `sos_normalize_arabic` (migration 0009).
**Required data** query, per-type result arrays.
**Optional data** result counts per section.
**Unsupported data** topics, classrooms, semantic/AI search, root-aware Arabic matching, filters, sort, search history persistence, "did you mean".

## Currently supported result types — exactly four

| Section heading | Row | Destination |
| --- | --- | --- |
| **People** | avatar 36 · display name · `@handle · Stage` (isolated LTR) | `profile/[handle]` |
| **Study groups** | title · member count · chevron | `group/[id]` |
| **Knowledge** | ContentGrammar at `search` density — knowledge body in the display voice, inline ProvenanceLine, type + author metadata | `post/[id]` |
| **Communities** | title · "Official" label (structure) | community route |

## One language, four objects

Every result is the same shape: **a section heading naming the type, then rows of title plus one metadata line.** The heading carries the type, so the row never repeats it. No cards, and no five miniature card systems.

Knowledge results are the only ones in the editorial voice, because they are the only ones whose content *is* what you are reading. A ProvenanceLine rides along where sources exist — which is what lets a student judge a result before opening it.

## Search mechanics — real, measured, and design-relevant

From `arabic.ts`, measured against PostgreSQL 16 with a `pg_trgm` similarity floor of 0.15:

- **Folded away** (so they match): hamza forms → bare alef, ta marbuta → heh, alef maqsura and Farsi yeh → yeh, Farsi keheh → kaf, tashkeel and tatweel stripped, Arabic-Indic digits → Latin, case folded.
- **Degraded:** tatweel-heavy text (0.36).
- **Fails below the floor:** alef madda vs bare alef (0.14), fully vocalised text (0.07).
- **Not normalised:** the definite article ال — `القلب` and `قلب` score 0.25, which is weak.
- **No stemming, tokenisation or root analysis.** `كتاب` / `كتب` / `مكتبة` share a root and not a trigram profile. They will not match each other.

**Design consequences.** Minimum query 2 characters, 300 ms debounce. The empty-result copy must **not** promise intelligence the index does not have: "No results for «{query}»" plus "Try a shorter word, or the term as it appears in your course material." Do not write "Try different keywords" — the actionable advice here is *shorter*, because prefix matching works (0.29 at five characters) and root matching does not.

## Deferred contract — do not render before capability exists

### Topics — **BLOCKED_BY_PRODUCT_CAPABILITY, P0**

Heading "Topics". Row: topic name (display voice) · course path metadata · EvidenceFraction where the viewer has answered anything · chevron → `topic/[id]`. Placed **first** when the query matches a topic, because a topic is the most navigable object in the product.

The topic graph is what Learn, Topic and Practice are built on, and it is unreachable from the screen whose only job is navigation. Requires: a search endpoint branch, an index over topic names in both languages through `sos_normalize_arabic`, a result-union member, and the client section.

### Classrooms — **BLOCKED_BY_PRODUCT_CAPABILITY, P1**

Heading "Classrooms". Row: classroom title · course code + member count · chevron. Destination depends on `viewer.canRead`: member → the room; non-member → the same route, which resolves to the join view. **Never leak lecture counts into a search row for a non-member.**

## Group vs Classroom vs Community — resolved

Three distinct nouns, three headings, three metadata shapes:

- **Study groups** — student-formed, "N members".
- **Classrooms** — staff-formed, course code first (blocked).
- **Communities** — official and topic-scoped, "Official" label.

## Behaviour

· one scroll container under a pinned field · **keyboard: opens with the screen and stays; results scroll under it; the field never scrolls away** · loading: the previous results stay with the attention rule, never a spinner over them; first query shows skeleton rows · initial state: recent queries in-memory only (no persistence exists) or nothing · empty: as above, plus the honest advice line · error + retry · offline: "Search needs a connection" with the field disabled — there is no local index · RTL: field is RTL for Arabic queries but `@handles` and Latin runs stay isolated; the clear glyph sits at the trailing edge · mixed script: an Arabic query returning Latin knowledge titles is normal and must not reorder sections · Dynamic Type: rows grow, headings stay 13 px · 360 px: handle truncates before display name · accessibility: section headings are headers; the result count per section is announced with the heading; the field has `accessibilityRole="searchbox"`; results update through a polite live region, never assertive.

**Status** SUPPORTED_NOW for four types. Topics and Classrooms BLOCKED.
