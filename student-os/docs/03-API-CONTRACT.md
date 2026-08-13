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

## 3. Contracted for later phases

Shapes are settled; implementation follows the roadmap.

| Phase | Surface |
| --- | --- |
| 2 — Social | `POST/GET/PATCH/DELETE /v1/content`, `/v1/content/:id/comments`, `/reactions`, `/bookmarks`, `GET /v1/feed` |
| 3 — Community | `/v1/communities`, `/v1/groups`, `/members`, join/leave |
| 4 — Messaging | `/v1/conversations`, `/messages` (cursor by `seq`), `WS /v1/realtime` |
| 5 — Learning | `/v1/classrooms`, `/lectures`, `/materials`, `/v1/files` (signed URLs) |
| 6 — AI | `POST /v1/ai/sessions`, `/messages`, `/lectures/:id/summary`, `/lectures/:id/generate-quiz` |
| 7 — Quizzes | `/v1/quizzes`, `/attempts`, `/answers` |
| 11 — Intelligence | `/v1/learning/progress`, `/weak-topics`, `/recommendations`, `/v1/search` |
| 12 — Admin | `/v1/admin/*`, `/v1/reports`, `/v1/moderation/*` |

## 4. Realtime (Phase 4)

WebSocket at `/v1/realtime`, authenticated with the access token at handshake.
Subscriptions are authorised through the same policy layer as REST.

| Direction | Event | Payload |
| --- | --- | --- |
| → | `subscribe` | `{ topic: "conversation:<id>" }` |
| → | `message.send` | `{ conversationId, clientMessageId, kind, body }` |
| ← | `message.new` | full message including server `seq` |
| ← | `message.ack` | `{ clientMessageId, id, seq }` |
| → | `read` | `{ conversationId, seq }` |
| ↔ | `typing`, `presence` | ephemeral, never persisted |
| → | `resync` | `{ conversationId, lastSeq }` → server replays the gap |

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
