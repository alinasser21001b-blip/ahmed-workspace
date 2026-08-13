# ADR-0002 — One `content_items` spine instead of six content tables

**Status:** Accepted · Phase 0

## Context

The feed carries post, reel, question, poll, resource, announcement and live
(§9). They share author, academic context, container, visibility, counters and
timestamps; they differ only in payload.

## Decision

A single `content_items` table carries everything shared. Per-kind payload
lives in `reel_details`, `question_details`, `poll_details`,
`resource_details`, `announcement_details`.

## Consequences

**Good.**
- The feed is one indexed query, not a `UNION ALL` of six differently-shaped
  selects re-sorted in memory and paginated approximately.
- `reactions`, `comments`, `bookmarks`, `reports`, `content_topics` and
  `content_links` reference one table with **real foreign keys**. The
  alternative — a `(target_type, target_id)` pair — cannot have a foreign key,
  so orphaned rows become inevitable.
- Visibility and academic context are defined once, so the permission filter
  cannot drift between post and reel. Six copies of a permission filter means
  the fifth copy is where the leak is.

**Bad.** Reading one kind needs a `kind = ?` predicate and a join. Adding a
kind means a new details table.

**Rejected alternative.** Separate tables per kind. Cleaner in isolation, worse
at every join, and structurally prone to permission drift.
