# Architecture Decision Records

One short record per significant decision, so that in twelve months anyone — including a
developer who has never met us — can find out *why* something is the way it is, not just
*what* it is (§64).

## Status values

| Status | Meaning |
| --- | --- |
| **Proposed** | Written, argued, **not approved.** Everything here is Proposed until the Product Owner approves the architecture |
| **Accepted** | Approved and in force |
| **Superseded by NNNN** | Replaced. The record stays — the history is the point |
| **Rejected** | Considered and declined. Kept, so it is not re-proposed from scratch |

## When to write one

Write an ADR when a decision is **expensive to reverse** or when someone will later ask
"why on earth is it done this way?":

- Choosing a language, framework, database, or hosting model
- Where a cross-cutting concern lives (authorization, errors, i18n, events)
- A data-model decision with migration cost
- Anything clinical-safety-related in the system's design
- Deliberately *not* doing something obvious

Do **not** write one for ordinary implementation choices. An ADR every week is a healthy
project; an ADR every day means the format is being misused.

## Rules

- Numbered sequentially, never renumbered.
- **Never edited after acceptance** except to change status. A decision that changes gets
  a new ADR that supersedes the old one.
- Short. One page. If it needs five pages, it is a design document with an ADR pointing
  at it.
- Records the **context and the consequences**, including the bad ones. An ADR listing
  only advantages is marketing, not a record.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](./0001-modular-monolith-typescript.md) | Modular monolith in TypeScript | Proposed |
| [0002](./0002-long-lived-container.md) | The API runs as a long-lived container | Proposed |
| [0003](./0003-single-authorization-layer.md) | Exactly one authorization implementation | Proposed |
