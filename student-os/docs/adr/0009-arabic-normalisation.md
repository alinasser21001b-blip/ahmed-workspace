# ADR-0009 — Normalise Arabic for search, in the column and in the query

**Status:** accepted (Phase 3 closure)
**Supersedes nothing. Refines [ADR-0008](0008-trigram-search.md).**

## Context

ADR-0008 chose trigram search over `tsvector` because the corpus is bilingual.
It did not ask what trigrams actually do to Arabic. The Phase 3 closure audit
measured it, against PostgreSQL 16 with `pg_trgm`, at the 0.15 similarity floor
the search module uses:

| Case | Similarity | Outcome |
| --- | --- | --- |
| exact phrase | 1.00 | found |
| word inside a phrase | 0.50 | found |
| five-character prefix | 0.29 | found |
| mixed Arabic + English | 0.37 | found |
| `أمراض` vs `امراض` (hamza) | 0.64 | found, narrowly |
| `الكلوية` vs `الكلويه` (ta marbuta) | 0.60 | found, narrowly |
| `مستشفى` vs `مستشفي` (alef maqsura) | 0.56 | found, narrowly |
| `القـــلب` vs `القلب` (tatweel) | 0.36 | degraded |
| **`آفة` vs `افة` (alef madda)** | **0.14** | **not found** |
| **`اَلْقَلْب` vs `القلب` (tashkeel)** | **0.07** | **not found** |
| `القلب` vs `قلب` (definite article) | 0.25 | weak |

Two of these are not ranking imperfections. They are missing results: a student
who types a word without diacritics could not find a post written with them, and
the four alef forms did not reliably match each other.

Two further facts, worth recording because neither is obvious:

- **`show_trgm` on Arabic returns hashed trigrams**, not readable ones
  (`{0xafa81e,…}`). `pg_trgm` CRC-hashes any trigram containing a multibyte
  character. Matching works; the index behaves as a hash index, and collisions
  are possible at scale.
- **There is no Arabic stemming or root analysis, and trigrams cannot provide
  one.** كتاب, كتب and مكتبة share a root and not a trigram profile.

## Decision

Fold away the orthographic differences that carry **no meaning** in ordinary
Arabic writing, and nothing else:

- combining marks (harakat, tanween, shadda, sukun, superscript alef, the
  Quranic range)
- tatweel — a justification glyph with no phonetic value
- the four alef forms → bare alef
- ta marbuta → heh; alef maqsura → yeh
- Farsi yeh and keheh, which arrive from mixed keyboards
- Arabic-Indic and extended Arabic-Indic digits → ASCII

This is the set Lucene's `ArabicNormalizationFilter` applies. It was chosen
because it is a published, tested standard rather than something we invented.

**Explicitly not applied**: stripping the definite article `ال`, or folding
`و`/`ؤ` or `ا`/`ع`. Those merge words students distinguish — `القلب` is not
`قلب`, and `سؤال` is not `سوال` — and a search that cannot tell them apart is
worse than one that occasionally asks for a better query.

The fold applies to **both sides** of the comparison:

- the stored side is a generated column (`body_norm`, `display_name_norm`,
  `name_norm`, `name_ar_norm`, `name_en_norm`) with its own trigram index
- the query side is `normalizeArabic()` in `@sos/core`, applied once in the
  search service

Normalising only the query would match nothing. Normalising the column inline in
the `WHERE` would discard the index. Handles keep their raw index: they are
ASCII by constraint, so normalising them is a cost with no reader.

## Consequences

- Diacritised and undiacritised text now match. So do all four alef forms,
  ta marbuta against heh, alef maqsura against yeh, and tatweel against its
  absence — each covered by a test.
- **Two implementations of one rule now exist**, in TypeScript and in SQL. That
  is a drift risk, and it is handled the same way the feed's ranking is: a test
  runs a table of cases through both and asserts they agree. Without it, a
  divergence would not raise an error — Arabic search would simply return
  nothing, which is the least visible failure this product could have.
- Search remains **lexical**. Root-aware matching, query expansion and semantic
  retrieval over embeddings are deferred to a dedicated Search phase and will be
  a different endpoint, not a silent change to this one. This is a deferral with
  a reason, not an oversight.
- The generated columns roughly double the stored size of the searchable text.
  At cohort scale that is nothing; at institution scale it is still cheaper than
  the alternative, which is a second search service.
