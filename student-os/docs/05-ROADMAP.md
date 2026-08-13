# Implementation Roadmap

> Constitution §89.F. Small, independently testable milestones. Each phase
> lists its exit criterion — the thing that must be demonstrably true before
> the next phase starts.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| **0 — Foundation** | repo, architecture, database, auth, config, design system, navigation, error handling, logging, tests, CI | ✅ **Done** |
| **1 — Identity** | signup/login, profile, academic placement, interests, privacy | ✅ **Done** |
| **2 — Social core** | feed, posts, image upload, comments, reactions, bookmarks, reports, follow/block/mute | ✅ **Done** |
| **3 — Community** | communities, groups, membership, join requests, group posts, search | ✅ **Done and closed** |
| **4 — Messaging** | 1:1 + group chat, realtime, presence, typing, receipts, attachments | ✅ **Done** |
| 5 — Learning | courses, classrooms, lectures, resources, PDF viewing, discussion | Next |
| 6 — AI v1 | lecture summary, ask-AI, MCQ generation — all source-grounded | |
| 7 — Quizzes | authoring, taking, attempts, scoring, explanations, topic performance | |
| 8 — Reels | upload, transcoding pipeline, playback, academic metadata | |
| 9 — Study system | study groups, sessions, shared resources, timers, goals | |
| 10 — Live | external video provider, join, chat, participants, recording reference | |
| 11 — AI intelligence | tutor modes, group summary, academic search, weak topics, recommendations | |
| 12 — Admin | user management, moderation, reports, hierarchy, analytics | |

## Exit criteria

**Phase 0 — met.**
- 77-table schema applies from empty on every test run
- signup → login → refresh → logout works, with immediate revocation
- 114 tests pass (72 unit in `@sos/core`, 42 integration against real Postgres)
- design system, five-tab navigation, four shells render
- typecheck clean across all four packages; CI runs the whole thing

**Phase 1 — met.**
- academic hierarchy is fully data-driven; no institution is hardcoded
- onboarding validates placement server-side and is idempotent
- privacy settings default to cohort scope
- **the first journey (§91, first half) passes end-to-end in a browser, in Arabic**

**Phase 2 — met.**
- a post with an image reaches cohort-mates' feeds and nowhere else, proven by
  test at both the feed and single-item level
- private, followers-scoped, blocked, deleted and suspended-author content are
  each excluded from the feed by test
- the feed pages without duplicating or dropping rows, on a ranked ordering
- uploads are validated by magic bytes, not by the client's claim; media cannot
  be attached by a non-owner or reused across posts
- SQL and TypeScript ranking agree to six decimal places (parity test)
- the browser journey now runs through publish → comment → like → save

**Phase 3 — met, then closed.**

The exit criteria below were met at the end of implementation. They were not
sufficient: a closure audit ([06-PHASE-3-AUDIT.md](06-PHASE-3-AUDIT.md)) found
twelve issues that a green test run did not, including an unrecoverable
ownerless-group state, mutes that affected no read surface, a CI step red since
Phase 0, and Arabic search that returned nothing for diacritised text. All
twelve are closed or deferred in writing. The additional criteria are listed
after the original ones.

- an unlisted group's posts are invisible to non-members through the feed, the
  single-item read, and search — proven by one test across all three surfaces
- the group itself is unfindable: neither browsable nor searchable by name
- join policy is honoured: open joins, request queues for approval, invite-only
  refuses without an invitation and accepts with one
- role rank is enforced — a moderator cannot remove an admin or mint more
  moderators; an owner cannot strand a group by leaving it
- `member_count` stays accurate across join, leave and rejoin
- search honours the searchable opt-out and both block directions

**Phase 3 closure — met.**
- the API, the feed and search agree on one permission matrix, asserted as a
  single table over owner / member / outsider / removed / banned
- no group can be left without an owner, through either exit
- a mute changes the feed, and stops at surfaces the reader asked for
- every container gate is named and separate: `canView`, `canRead`, `canWrite`,
  `canPost`, `canComment`, `canJoin`, `canLeave`, `canInvite`, `canModerate`,
  `canManage`
- a suspended author's content is withheld by the policy and by the SQL, and a
  restricted author's is not — each with a test that asserts what its name says
- Arabic search finds diacritised, tatweel'd and alef-variant text, with the
  TypeScript and SQL normalisation proven identical
- Arabic counts use CLDR's six plural categories
- every Phase 3 screen passes a layout audit in Arabic and English, on phone and
  desktop: 192 checks, clean console, no failed requests
- CI runs install → migrate → deterministic seed → build → serve → journey →
  layout audit, and `pnpm test:unit` is green for the first time since Phase 0
- domain events exist with one vocabulary and a transactional outbox, so
  Phase 4's message events extend it rather than introducing a second one

**Phase 4 — met.**
- `seq` is dense and gapless under concurrent senders, and a retry does not burn
  one — proven by test, because a gap makes a reconnecting client wait forever
- a retry with the same `clientMessageId` returns the stored message, same id
  and same seq, and emits no second event: exactly-once, observable
- ordering is the server's `seq`; dragging a message's wall-clock ten days
  backwards does not move it
- a read position is one integer per member, monotonic, clamped to the head:
  a late receipt cannot rewind it and a client cannot silence what it has not
  seen. Zero rows in `message_receipts`
- a non-participant is refused every operation by direct API manipulation —
  read, list, send, mark read, edit, delete — with 404, never 403
- a platform admin has no way into a private conversation, by design
- the realtime layer only ever announces committed state ([ADR-0011](adr/0011-realtime-notifies-database-decides.md))
- **two browsers, one conversation, a real dropped connection**: messages sent
  during the outage arrive on reconnect, in order, exactly once; a double-tap on
  Send produces one message ([`e2e/messaging.mjs`](../apps/mobile/e2e/messaging.mjs))

**Phase 5.** A student opens a classroom, reads a lecture, and downloads a
resource through a signed URL that a non-member cannot use.

**Phase 6.** Every AI answer about course material cites a source that resolves
to a real retrieved chunk. A fabricated citation is rejected by the validator,
not merely discouraged. A student cannot obtain content they lack permission to
read by asking the AI for it — proven by test.

**Phase 7.** A quiz attempt writes question-level rows that roll up into topic
performance.

**Phases 8–12.** Defined at entry; the exit criterion for each is written
before implementation starts.

## What the next phases must not build

Added after §1.1 of the product architecture was written down, because the
cheapest time to refuse a feature is before it has a schema.

| Phase | Build | Do **not** build |
| --- | --- | --- |
| 5 — Learning | Classrooms, lectures, materials, discussion attached to a topic | A file locker. A resource with no academic placement is not discoverable, and undiscoverable knowledge is the problem this product exists to solve |
| 6 — AI v1 | Tutor and summariser reading the platform's own structured knowledge, source-grounded, behind the same authorization layer as a human | A chatbot beside the product. An AI with its own retrieval path is an AI with its own permission model |
| 7 — Quizzes | Question-level results rolling up into topic performance | Scores as a leaderboard. Comparing students is a popularity mechanic wearing an academic hat |
| 8 — Reels | **Reconsider entirely.** If it ships, micro-learning bound to a topic, a course and a lecture | A scrolling feed of clips. This is the single feature most able to turn the product into the thing it is defined against |
| 9 — Study system | Groups growing discussions, resources, questions and sessions — the learning space §1.1 describes | Chat with more tabs |
| 11 — Intelligence | Ranking on academic relevance, personal context, usefulness and quality | Ranking on likes and views. Popularity is an input, never the objective |

The Knowledge Feed — "what is academically useful to me right now?" — is the
Phase 11 target, and the reason `learning_events` and `content_links` have been
in the schema since Phase 0.

## Sequencing rationale

Messaging (4) precedes learning (5) because retention in a cohort product comes
from people, not from documents; a classroom with no conversation in it is
Google Classroom.

AI v1 (6) precedes quizzes (7) because MCQ generation gives quizzes their
initial content — a quiz system with no quizzes in it does not get used.

Reels (8) waits until after AI and quizzes because a reel is only worth more
than a TikTok clip once it can link to a lecture, a quiz and a discussion (§12).
Shipping reels early would produce exactly the disconnected feature the
Constitution warns against.

## Per-phase checklist (§87)

Every feature, without exception:

1. Inspect existing architecture
2. Identify affected domains
3. Update the data model if needed
4. Define the API contract in `packages/contracts`
5. Define permissions in `packages/core/policy` **with unit tests first**
6. Define UX states (loading / empty / error / success)
7. Implement backend
8. Implement frontend
9. Add tests — unit, integration, and E2E for critical flows
10. Verify edge cases, especially cross-user and cross-container access
11. Update documentation

## Reporting

Each phase closes with the report format the Constitution requires:
Implemented · Changed · Database Changes · API Changes · Frontend Changes ·
AI Changes · Security Changes · Tests · Known Issues · Next Milestone.
