# API Contract

> Constitution §89.D. The **schemas in `packages/contracts` are the contract**;
> this document is the map. Every request and response below is a Zod schema
> that validates on the server and types the client — they cannot drift.

## 1. Conventions

- Base path `/v1`. Platform endpoints (`/health`) are unversioned.
- Auth: `Authorization: Bearer <accessToken>`.
- Every route declares its auth posture explicitly. **There is no
  implicit-public default** — a new endpoint cannot become public by omission.
- Unknown request fields are rejected, never silently ignored.
- Client-supplied `userId`, `role`, `status`, or membership is **never**
  trusted. Identity comes from the token.
- Errors always use the envelope below.
- Lists use cursor pagination; offsets are not offered (they duplicate and skip
  rows on a feed that receives writes mid-scroll).

### Error envelope

```jsonc
{ "error": { "code": "FORBIDDEN", "message": "…", "details": [], "requestId": "…" } }
```

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Schema failure; `details[]` carries field paths |
| `UNAUTHENTICATED` | 401 | Missing, invalid, expired, or revoked token |
| `FORBIDDEN` | 403 | Authenticated but not permitted |
| `ACCOUNT_SUSPENDED` | 403 | Account state blocks the action |
| `NOT_FOUND` | 404 | Absent — **or present but invisible to this actor** |
| `CONFLICT` | 409 | Uniqueness violation (email, handle) |
| `PRECONDITION_FAILED` | 412 | Semantically invalid input (e.g. impossible academic placement) |
| `PAYLOAD_TOO_LARGE` | 413 | Upload over limit |
| `RATE_LIMITED` | 429 | Budget exceeded |
| `INTERNAL` | 500 | Bug. Logged with stack; nothing leaked to the client |

**404-over-403 rule.** When a resource exists but the actor may not see it, the
API returns 404. A 403 confirms existence, which defeats the point of a private
profile or a private group.

## 2. Shipped in Phase 0

### Platform

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness. Does not touch the database. |
| GET | `/health/ready` | none | Readiness: DB reachable + migrations current. 503 otherwise. |

### Auth — `/v1/auth`

| Method | Path | Auth | Rate limit | Notes |
| --- | --- | --- | --- | --- |
| POST | `/signup` | none | 10/min | → 201 `AuthSession`. 409 on duplicate email. |
| POST | `/login` | none | 10/min | → 200 `AuthSession`. Constant-time against unknown accounts. |
| POST | `/refresh` | none | 60/min | Rotates. Replaying a rotated token revokes the whole chain. |
| POST | `/logout` | required | default | 204. `allDevices` revokes every session. |
| GET | `/me` | required | default | → `AuthUser`, including `onboardingCompleted`. |

Token model: 15-minute JWT access token + 30-day opaque rotating refresh token
(SHA-256 at rest). The session row is checked on every authenticated request,
so **logout takes effect immediately** rather than after the access token
expires.

### Academic hierarchy — `/v1/academic`

All reads, any caller. Reference data describing institutions, not people —
onboarding must read it before the user has any placement.

| Method | Path | Query |
| --- | --- | --- |
| GET | `/universities` | — |
| GET | `/colleges` | `universityId` |
| GET | `/programs` | `collegeId` |
| GET | `/stages` | `programId` |
| GET | `/academic-years` | `universityId` |
| GET | `/courses` | `stageId?`, `programId?` |
| GET | `/courses/:courseId/subjects` | — |
| GET | `/topics` | `subjectId?`, `courseId?` |

Every node returns both `nameAr` and `nameEn`.

### Identity — `/v1`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/me/profile` | required | Own profile, localised by `Accept-Language`. |
| POST | `/me/onboarding` | required | Completes the profile. Validates the placement against the hierarchy → 412. Idempotent. |
| PATCH | `/me/profile` | required | Display name, bio, avatar, interests. |
| GET | `/me/privacy` | required | Creates defaults on first read. |
| PATCH | `/me/privacy` | required | Partial update. |
| GET | `/handles/available` | none | 60/min. Live availability during onboarding. |
| GET | `/profiles/:handle` | required | Enforces profile visibility. 404 when not visible. |

`Profile.viewer` carries the relationship (`isSelf`, `isFollowing`,
`isBlocked`, `canMessage`) so the client never has to infer permissions.

**Viewer state is a projection, never a hint.** Container responses carry every
gate the policy computed — `canJoin`, `canRead`, `canWrite`, `canPost`,
`canComment`, `canLeave`, `canInvite`, `canModerate`, `canManage` — each a
separate boolean, because "may see it exists", "may read inside it", "may write
in it" and "may administer it" are four different questions. The client renders
these and does not re-derive them; a control whose gate is false is not
rendered, rather than rendered and inert.

### Files — `/v1`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/files` | required | 30/min. Multipart. Format read from magic bytes; the declared type is ignored. Max 8 MiB. Lands unattached and owner-only. |
| GET | `/files/:id/raw` | **signature** | Serves bytes. Unauthenticated by necessity — an `<img>` cannot send a header — so the signature is the credential. |
| GET | `/files/:id` | required | Mints a fresh signed URL after a policy check. |
| DELETE | `/files/:id` | required | Owner only. |

### Content and the feed — `/v1`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/feed` | required | Scopes: `home` (ranked), `recent`, `author`, `saved`. Cursor-paginated. |
| POST | `/content` | required | 60/min. Author and academic context come from the token and profile, never the body. |
| GET | `/content/:id` | required | Honours the admin bypass for moderation; 404 when not visible. |
| PATCH | `/content/:id` | required | Author only. |
| DELETE | `/content/:id` | required | Author, platform admin, or container moderator. |
| PUT/DELETE | `/content/:id/reaction` | required | Returns the reconciled like count. |
| PUT/DELETE | `/content/:id/bookmark` | required | |
| POST | `/content/:id/view` | required | 600/min. Counts a distinct viewer once. |
| GET/POST | `/content/:id/comments` | required | Threads are one level deep. |
| PATCH/DELETE | `/comments/:id` | required | Author, post author, or platform admin may delete. |
| PUT/DELETE | `/comments/:id/reaction` | required | |

### Social graph and reporting — `/v1`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/profiles/:handle/relationship` | required | |
| PUT/DELETE | `/profiles/:handle/follow` | required | Unfollow does not require visibility. |
| PUT/DELETE | `/profiles/:handle/block` | required | Blocking severs follows in both directions. |
| GET | `/profiles/:handle/followers` / `/following` | required | Cursor-paginated, block-filtered. |
| PUT/DELETE | `/mutes` | required | user / conversation / group / community / topic. |
| POST | `/reports` | required | 20/min. One open report per reporter per target. |

### Communities, groups and search — `/v1`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/communities` | required | `scope=mine\|discover`. Cursor-paginated. |
| GET | `/communities/:id` | required | 404 when out of scope. |
| PUT/DELETE | `/communities/:id/membership` | required | Join / leave. |
| GET | `/groups` | required | `scope=mine\|discover`. Unlisted groups never appear in discover. |
| POST | `/groups` | required | 20/min. Placement copied from the founder's profile. |
| GET | `/groups/:id` | required | 404 for an unlisted group the caller is not in. |
| PATCH/DELETE | `/groups/:id` | required | Owner/admin. DELETE archives. |
| PUT | `/groups/:id/membership` | required | Returns `active` or `pending` — the server decides which. |
| DELETE | `/groups/:id/membership` | required | 412 if an owner would strand the group. |
| GET | `/groups/:id/members` | required | `status=active` for members, `pending` for moderators only. |
| POST | `/groups/:id/invites` | required | Owner/admin. |
| PATCH | `/groups/:id/members/:handle` | required | Approve, promote, demote, ban, transfer ownership. |
| DELETE | `/groups/:id/members/:handle` | required | Rank-checked: cannot remove an equal or superior. Removing **yourself** is leaving, and is held to the same 412 as the endpoint above — the two routes out of a group share one rule. Also the moderator's *reject* on a pending request. |
| GET | `/search` | required | 120/min. People, content, groups, communities — all permission-filtered. |

**Search and permissions.** `/search` runs the same visibility predicate as the
feed, including the hard container boundary. That is the phase's central claim,
and it is covered by a test that walks one permission matrix — owner, member,
outsider, removed member, banned member — across the direct read, the feed,
search, the container itself and its roster, asserting all five agree.

**Search and Arabic.** The query and the indexed text are both normalised, by
rules that fold only meaning-preserving orthographic variation: diacritics,
tatweel, alef and yeh variants, ta marbuta, Arabic-Indic digits. The definite
article is *not* stripped. See [ADR-0009](adr/0009-arabic-normalisation.md) for
the measurements behind that boundary. Search remains lexical; root-aware and
semantic retrieval are a later Search phase and a different endpoint.

**Search and mutes.** Mutes are deliberately not applied. A mute silences an
ambient surface; a search is an explicit request, and hiding a muted person from
a query for their own name is a behaviour no UI could explain. Blocking is the
tool that makes someone unfindable, and it applies everywhere.

**CORS.** The allowed-methods list is set explicitly. The library default omits
`PUT`, `PATCH` and `DELETE`, which leaves reads working and every mutation from
a browser failing at preflight — a failure that looks like a client bug.

### Messaging — `/v1`

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/conversations` | required | The chat list, by recent activity. Membership is an inner join, so a conversation you are not in cannot appear. Carries `totalUnread`. |
| POST | `/conversations` | required | 60/min. Opens a direct conversation or a group's. **Idempotent** — per unordered pair, and per group. |
| GET | `/conversations/:id` | required | 404 when not a member. |
| GET | `/conversations/:id/messages` | required | Paginated by `seq`. `beforeSeq` scrolls back, `afterSeq` replays a reconnect gap oldest-first. |
| POST | `/conversations/:id/messages` | required | 300/min. **Idempotent on `clientMessageId`**; a retry returns the stored message with `deduplicated: true`, same id and seq. |
| PUT | `/conversations/:id/read` | required | 300/min. Advances **your own** position. Monotonic, clamped to the head. |
| PATCH | `/messages/:id` | required | Sender only. |
| DELETE | `/messages/:id` | required | Sender, or a conversation moderator. Soft — the row keeps its `seq`. |
| WS | `/realtime?token=…` | handshake | Notifications only. No frame writes to the database. |

**Ordering is `seq`, never a timestamp.** Two messages can share a millisecond;
none can share a sequence number. A page boundary on a non-total ordering drops
or repeats rows, and on a chat that is a lost message.

**Idempotency is required, not optional.** `clientMessageId` is a required
field. Making it optional would give callers who forgot it at-least-once
delivery with duplicates and callers who remembered exactly-once — a difference
no test catches until a user sees the same message twice.

**Read state is one integer per member.** `last_read_seq` serves receipts *and*
unread counts, so the two cannot disagree, and neither costs a row per message
per user.

**There is no admin bypass.** A platform admin can open a reported *post*,
because a post was published to an audience. A private conversation was not.
Reported messages reach moderation through the report, which carries the copy.

**Attachments** are uploaded first and referenced by id; bytes never travel
through this API. Their URLs are signed at message-read time for a caller who
has already passed the conversation gate.

## 3. Contracted for later phases

Shapes are settled; implementation follows the roadmap.

| Phase | Surface |
| --- | --- |
| 5 — Learning | `/v1/classrooms`, `/lectures`, `/materials`, `/v1/files` (signed URLs) |
| 6 — AI | `POST /v1/ai/sessions`, `/messages`, `/lectures/:id/summary`, `/lectures/:id/generate-quiz` |
| 7 — Quizzes | `/v1/quizzes`, `/attempts`, `/answers` |
| 11 — Intelligence | `/v1/learning/progress`, `/weak-topics`, `/recommendations`, `/v1/search` |
| 12 — Admin | `/v1/admin/*`, `/v1/reports`, `/v1/moderation/*` |

## 4. Realtime

WebSocket at `/v1/realtime?token=<accessToken>`. The token is in the query
string because a browser's `WebSocket` constructor cannot set headers; the
handshake re-checks the session against the database exactly as REST does.

**The socket notifies; it never commands.** There is deliberately no
`message.send` frame — sending is `POST /messages`, which is what makes retries
idempotent, offline queues ordinary, and a message impossible to lose between
an ack and a write ([ADR-0011](adr/0011-realtime-notifies-database-decides.md)).

| Direction | Frame | Payload |
| --- | --- | --- |
| → | `subscribe` / `unsubscribe` | `{ conversationId }`. Gated by the same policy as the REST read |
| → | `resync` | `{ conversationId, lastSeq }` → the server replays the gap, oldest-first |
| → | `typing` | `{ conversationId, typing }`. Ephemeral, expires server-side, never persisted |
| → | `ping` | → `pong` |
| ← | `ready`, `subscribed` | connection and subscription acknowledgement |
| ← | `message.new` / `message.updated` | the full message, including its server `seq` |
| ← | `message.read` | `{ conversationId, userId, seq }` |
| ← | `typing`, `presence` | ephemeral |
| ← | `resync` | the gap, in one frame, ordered by `seq` |

## 5. Rate limits

| Surface | Budget | Reason |
| --- | --- | --- |
| Default | 300/min | Normal browsing |
| Auth (`signup`, `login`) | 10/min | Credential attempts |
| `refresh` | 60/min | Legitimate on many concurrent requests |
| Handle availability | 60/min | Typed-ahead lookups |
| AI (planned) | per-user daily budget via `ai_usage_daily` | Cost control, not just abuse control |

Keyed by authenticated user where available, falling back to IP — so a shared
campus NAT does not throttle a whole cohort as one client.
