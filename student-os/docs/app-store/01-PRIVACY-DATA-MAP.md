# Privacy Data Map

What Student OS's mobile client sends to the server, and what the server stores about a user. Compiled from a full read of `apps/mobile/src/api/client.ts`, every screen that writes, and the migrations that define the tables. Evidence, not inference — every row below is traceable to a specific endpoint and table.

## The transport fact this whole document rests on

**One client, one server origin, zero third parties.** `apps/mobile/package.json`'s 14 dependencies were read individually: `@expo/vector-icons`, `expo`, `expo-constants`, `expo-image-picker`, `expo-linking`, `expo-localization`, `expo-router`, `expo-secure-store`, `expo-status-bar`, `react`, `react-dom`, `react-native`, `react-native-safe-area-context`, `react-native-screens`, `react-native-web`. None is an analytics, crash-reporting, attribution, or advertising SDK. There is no IDFA reference, no App Tracking Transparency framework import, no third-party network call anywhere in `apps/mobile/src`. Everything the app sends goes to its own API, over HTTPS, and nowhere else.

## Data types

| Data | Origin (client) | Endpoint | Table | Linked to identity? | Third party? | Deletion |
|---|---|---|---|---|---|---|
| Email | `(auth)/sign-up.tsx` | `POST /v1/auth/signup` | `users.email` | Yes (primary identifier) | No | Row deleted on account deletion |
| Password | sign-up/sign-in | `/v1/auth/{signup,login}` | `users.password_hash` (scrypt, never the plaintext — corrected in this pass; the doc previously said bcrypt, see `auth/password.ts`) | Yes | No | Deleted with the row |
| Display name, handle, bio | onboarding | `POST /v1/me/onboarding`, `PATCH /v1/me/profile` | `profiles` | Yes | No | Deleted (cascade) |
| University/college/program/stage | onboarding | `POST /v1/me/onboarding` | `profiles.*_id` | Yes | No | Deleted (cascade) |
| Declared interests (topics) | onboarding | `POST /v1/me/onboarding` | `profile_interests` | Yes | No | Deleted (cascade) |
| Posts, comments, questions | compose/post screens | `POST /v1/content`, `POST /v1/content/:id/comments` | `content_items`, `comments` | Yes | No | Deleted (cascade) |
| Direct/group messages | chat | `POST /v1/conversations/:id/messages` | `messages` | Yes (until deletion) | No | **Tombstoned**, not deleted — see below |
| Uploaded photos | compose, materials | `POST /v1/files` (multipart) | `files` (bytes in the storage driver) | Yes | No (own storage; Netlify Blobs in the deployed config) | Object deleted + row deleted on account deletion |
| Reactions, bookmarks, follows | various | `PUT/DELETE /v1/content/:id/reaction`, etc. | `reactions`, `bookmarks`, `follows` | Yes | No | Deleted (cascade) |
| Blocks, mutes | profile screen | `PUT/DELETE /v1/profiles/:handle/block` | `blocks`, `mutes` | Yes | No | Deleted (cascade) |
| **Reports filed** (reason, free-text details) | `ReportSheet` | `POST /v1/reports` | `reports` | Yes (reporter) | No | Reporter's identity anonymised (`SET NULL`); the report row itself survives for moderation history |
| Group/classroom/community membership | join flows | `PUT /v1/groups/:id/membership`, etc. | `*_members` | Yes | No | Deleted (cascade); ownership transferred first (§ deletion doc) |
| Practice answers, learning signal | `/practice/*` screens | `POST /v1/practice/attempts/:id/answers` | `quiz_answers`, `learning_progress`, `learning_events` | Yes | No | Deleted (cascade) |
| Session / refresh token | login | `POST /v1/auth/login` | `sessions.token_hash` (hashed, not the raw token) | Yes | No | Revoked on logout/deletion, expires otherwise |
| Password reset token *(new — this pass)* | `(auth)/forgot-password.tsx` | `POST /v1/auth/forgot-password` | `password_resets.token_hash` (SHA-256, not the raw token — the raw token exists only in memory for one function call and is never logged; see `platform/mailer.ts`) | Yes | No | Single-use (consumed on redemption), superseded by any later request, 30-minute expiry, cascades on account deletion |
| **IP address and User-Agent** | every session | `sessions.ip`, `sessions.user_agent` (written at login) | `sessions` | Yes | No | **No explicit retention bound found** — persists until the session row is pruned or the account is deleted. Not currently disclosed anywhere in-app. |
| Product analytics events | various actions | server-side `recordAnalytics()` calls | `analytics_events` | Yes (nullable `user_id`, `ON DELETE SET NULL`) | No | Row survives deletion with `user_id` nulled — anonymised, not deleted |
| Push notification token | *(not yet wired to a client screen; table exists — `push_tokens`)* | — | `push_tokens` | Yes | No (APNs/FCM are the delivery channel, not a data recipient of this app's data beyond the token itself) | Explicitly removed on account deletion (`account.repository.ts:removePushTokens`) |

## Closed gap: EXIF/GPS in uploaded photos

**Fixed in the pre-merge hardening pass — see `08-HARDENING-PASS.md`.** Uploaded images were previously stored exactly as received; `apps/api/src/modules/files/files.service.ts` now runs every upload through `apps/api/src/platform/image-sanitize.ts` before a single byte reaches storage. GPS-capable metadata (JPEG EXIF/XMP APP1, PNG `eXIf`, WebP `EXIF`/`XMP` RIFF chunks) is removed unconditionally — the route takes only bytes and a declared MIME type, so there is no client-side opt-out to trust. JPEG orientation is preserved (a fresh, minimal, orientation-only EXIF block is rebuilt) so a phone photo still displays right-side up; PNG's colour-management chunks (`iCCP`/`gAMA`/`sRGB`) and JPEG's ICC profile (APP2) are kept for correct rendering. GIF is documented as never having carried GPS in the first place — there is no standard EXIF/GPS mechanism in the format — so nothing needed stripping beyond its own Comment Extension blocks.

Proven two ways: 13 unit tests in `apps/api/src/platform/__tests__/image-sanitize.test.ts` against hand-built fixtures per format, and 3 integration tests in `apps/api/test/upload-sanitization.integration.test.ts` that upload a real GPS-bearing JPEG through the live `POST /v1/files` route and confirm the coordinates are absent from what `GET /files/:id/raw` serves back.

## Messages: the tombstone, explained once

A deleted user's message rows are **not** removed — `messages.sender_id` is `ON DELETE SET NULL` by design, because the row is shared state with the other party in the conversation and deleting it would silently renumber their thread (`seq` is a gapless per-conversation counter). Account deletion instead clears `body`, `metadata` and sets `deleted_at`, so the row becomes exactly the same "message deleted" placeholder the UI already renders for any deleted message. The recipient's copy of the conversation is preserved structurally; nothing personal about the deleted sender survives in it.

## What is genuinely absent (good news, stated as evidence not assumption)

- No location data collection (no `expo-location` dependency, no GPS API call in `apps/mobile/src`)
- No contacts access (no `expo-contacts` dependency)
- No advertising identifier, no ATT prompt (nothing to track)
- No data sold or shared with a data broker, an ad network, or any third party for any purpose

## What this document is not

This is an engineering data-accuracy map, not a legal privacy policy and not a substitute for one. See `PRIVACY_POLICY_DRAFT.md` for the drafted policy text and `02-APP-PRIVACY-ANSWERS.md` for the App Store Connect questionnaire preparation.
