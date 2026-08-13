# ADR-0008 — Trigram search, not `tsvector`

**Status:** Accepted · Phase 3

## Context

Phase 3's exit criterion requires that a private group's content be invisible
through search as well as through the API. That means search has to exist, and
it has to run the same permission predicate as the feed.

The corpus is the hard part: content is Arabic and English, frequently mixed
inside a single post, and student writing is full of half-remembered spellings
and transliterations.

## Decision

Postgres `pg_trgm` with GIN indexes and `similarity()` ranking, over
`content_items.body`, `profiles.display_name`, `profiles.handle`, group names
and community names.

## Why not `tsvector`

Postgres has no Arabic text-search configuration. `to_tsvector('simple', …)`
would tokenise Arabic without stemming — no better than trigrams — while
forcing a dictionary choice that is wrong for whichever half of the corpus it
is not configured for. Full-text search would buy stemming for the English
half and nothing for the Arabic half.

Trigrams also give prefix and typo tolerance for free, which matters more here
than stemming: students search for a handle they half remember, or a topic
whose transliteration they are guessing at.

## Consequences

**Good.** One index type for both languages. Typo tolerance. Ranking that can
be explained in a sentence. No dictionary configuration to get wrong.

**Bad.** GIN trigram indexes are larger than `tsvector` ones and degrade on
very large corpora. Similarity ranking is lexical, so it finds the words typed
and nothing conceptually adjacent — searching "kidney" does not find "الكلى".

**Accepted** because the second limitation is what Phase 11's semantic search
is for, and that will be a *different endpoint* over embeddings rather than a
silent change to this one. Students should be able to tell which kind of search
they are using.

**Watch for.** A similarity floor makes results fuzzy by design: a query can
return a post that merely resembles it. Tests must assert that a specific item
is absent rather than that the result set is empty — the first is a permission
property, the second is an accident of the ranking function.

## The part that matters

`searchContent` repeats the feed's visibility predicate rather than sharing a
SQL string, because the two queries select different shapes. That duplication
is the risk this ADR exists to name: an integration test asserts a private
group's post is absent from an outsider's search results, so the two predicates
cannot drift apart unnoticed.
