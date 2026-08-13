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
| 3 — Community | communities, groups, membership, group posts | Next |
| 4 — Messaging | 1:1 + group chat, realtime, presence, typing, receipts, attachments | |
| 5 — Learning | courses, classrooms, lectures, resources, PDF viewing, discussion | |
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

**Phase 3.** A private group's posts are invisible to non-members through the
API, search, and (later) AI retrieval — one policy, three surfaces, one test
suite.

**Phase 4.** A message survives: app backgrounded mid-send, connection dropped,
duplicate retry, out-of-order receipt, reconnect with a gap. No duplicates, no
losses, correct ordering.

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
