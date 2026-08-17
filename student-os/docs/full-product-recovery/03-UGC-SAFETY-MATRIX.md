# 03 — UGC SAFETY MATRIX

Scope: the user-generated-content safety surface of Student OS, as established by the Phase A
forensic sweep. The sole source of truth for this document is the Phase A evidence file; the
three areas drawn on here are `authugc`, `api` and `social`. Where the audit did not examine a
question, this document says "not established by the audit" rather than inferring an answer.

Two vocabularies are in play and they are deliberately kept apart:

- **CLASS** is the classification this matrix is asked for: `IMPLEMENTED`, `PARTIAL`, `MISSING`,
  `NOT_APPLICABLE`.
- **AUDIT STATUS** is the Phase A status verbatim, from the task's fixed vocabulary:
  `CONNECTED_AND_WORKING`, `BACKEND_ONLY`, `FRONTEND_ONLY`, `PARTIAL`,
  `BLOCKED_BY_EXTERNAL_SERVICE`, `BLOCKED_BY_DEPLOYMENT`, `BLOCKED_BY_PRODUCT_DECISION`,
  `MISSING`, `DEAD_CODE`, `PREVIEW_ONLY`.

`IMPLEMENTED` in the CLASS column means the capability exists in code with a working path from a
student's screen to the database. It does not mean the capability has been exercised against a
deployed environment; no runtime verification was part of the Phase A sweep, so nothing below
should be read as a claim about production behaviour.

One vocabulary note. Two Phase A findings — password-reset email delivery and the support/privacy/terms
destinations — were recorded by the auditors as `BLOCKED_BY_OWNER_SERVICE`, a term outside this task's
fixed list. Both describe a capability that is complete in code and cannot complete because a
third-party service has not been provisioned, so they are reported here as
`BLOCKED_BY_EXTERNAL_SERVICE`. This is a mapping of labels, not a change of finding.

All file paths are relative to `student-os/`. Line numbers are copied from the Phase A evidence.

---

## 1. The matrix

### 1.1 Reporting

| CAPABILITY | CLASS | AUDIT STATUS | CODE EVIDENCE | WHAT THE CODE ACTUALLY DOES |
|---|---|---|---|---|
| REPORT CONTENT (a post) | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/social/social.routes.ts:183-202`; `apps/api/src/modules/social/social.service.ts:202-244`; `apps/mobile/src/components/ReportSheet.tsx:83-98`; `apps/mobile/app/post/[id].tsx:191-196` | `POST /v1/reports` behind `requireAuth`, rate-limited to 20/min, nine reason codes, `details` capped at 2000 characters, duplicate open reports rejected with 409 and surfaced in the UI as "already filed", non-existent targets mapped to 404 from the FK violation. The post-detail overflow menu opens `ReportSheet` with `targetType: 'content'`. |
| REPORT USER (a profile) | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/mobile/app/profile/[handle].tsx:284-311`; `apps/mobile/src/components/ReportSheet.tsx:89`; `packages/contracts/src/social/interactions.contract.ts:76-101` | The profile menu opens the same sheet with `targetType: 'profile'`, and on confirmation additionally offers to block the reported person (`profile/[handle].tsx:303-311`). |
| REPORT COMMENT | PARTIAL | BACKEND_ONLY | `packages/contracts/src/social/interactions.contract.ts:97-101`; `apps/api/src/modules/social/social.routes.ts:183-202`; absence: `ReportSheet` is imported only by `apps/mobile/app/post/[id].tsx` and `apps/mobile/app/profile/[handle].tsx` | The `comment` target type is accepted by the contract and by the endpoint, and reaches the moderator queue. No comment row in the client renders a report affordance, so a student cannot reach it. The server capability exists; the client entry point does not. |
| REPORT MESSAGE (a DM) | PARTIAL | BACKEND_ONLY | `packages/contracts/src/social/interactions.contract.ts:92-101`; `apps/api/src/modules/social/social.routes.ts:183-202`; absence: no `ReportSheet` import and no `/v1/reports` call in `apps/mobile/app/chat/[id].tsx` | Same shape as comment reporting. The contract comment at `interactions.contract.ts:92-95` records that the `message` target was added for App Review Guideline 1.2, but the audit found no chat-screen call site, so a direct message cannot be reported from the shipped UI. |
| REPORT GROUP / COMMUNITY | PARTIAL | BACKEND_ONLY | `packages/contracts/src/social/interactions.contract.ts:97-101` | The `group` and `community` target types are accepted server-side. The audit records no client entry point for either. |

The endpoint is one endpoint with a target-type discriminator, so "partial" here is entirely a
client-surface statement: the API half of comment, message, group and community reporting is the
same code path that the working post and profile reports already exercise.

### 1.2 Blocking

| CAPABILITY | CLASS | AUDIT STATUS | CODE EVIDENCE | WHAT THE CODE ACTUALLY DOES |
|---|---|---|---|---|
| BLOCK | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/social/social.routes.ts:75-103`; `apps/api/src/modules/social/social.service.ts:95-118`; `apps/mobile/app/profile/[handle].tsx:85-96,229-285` | `PUT /v1/profiles/:handle/block` with an optional reason of ≤500 characters. Self-block is rejected. The block succeeds even when the target is already invisible to the caller. The client shows a confirmation dialogue before applying. |
| UNBLOCK | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/social/social.routes.ts:75-103`; `apps/mobile/app/settings/blocked.tsx:29-45`; `apps/mobile/app/profile/[handle].tsx:92-105` | `DELETE /v1/profiles/:handle/block`, reachable both from the profile screen and from the blocked-accounts screen. |
| BLOCKED LIST | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/account/account.routes.ts:59-73`; `apps/mobile/app/settings/blocked.tsx:29-45` | `GET /v1/me/blocks` backs a Settings → Blocked accounts screen that lists and unblocks. |
| BLOCK ENFORCEMENT | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/auth/auth.repository.ts:271-274,313-314`; `apps/mobile/app/profile/[handle].tsx:313` | Enforcement is structural rather than per-endpoint: `loadActor` hydrates `blockedUserIds` and `blockedByUserIds` into the Actor on every request, and `visibilityScopesFor` / `isBlockedEitherWay` in the policy layer consult them, so blocked users drop out of feeds, follow lists and visibility checks. The blocked person is not notified. The profile screen also renders an empty post list for a blocked account. |
| MUTE (adjacent, not blocking) | PARTIAL | BACKEND_ONLY | `apps/api/src/modules/social/social.routes.ts:149-181`; `apps/api/src/modules/content/content.service.ts:488-492` | `PUT`/`DELETE /v1/mutes` exist and mutes are honoured in the feed query, but the audit found no client call site anywhere in `apps/mobile`, so a student cannot create or remove a mute. Listed here because it is the softer safety control a reviewer will ask about alongside blocking. |

### 1.3 Moderation

| CAPABILITY | CLASS | AUDIT STATUS | CODE EVIDENCE | WHAT THE CODE ACTUALLY DOES |
|---|---|---|---|---|
| MODERATION QUEUE | PARTIAL | BACKEND_ONLY | `apps/api/src/modules/account/account.routes.ts:98-146`; `apps/api/src/modules/moderation/moderation.admin.service.ts:21-94`; `apps/api/src/modules/moderation/moderation.repository.ts:111-174`; absence: no screen, route or fetch touching `/v1/moderation/reports` anywhere under `apps/mobile` (only i18n strings at `en.ts:406-410`) | `GET /v1/moderation/reports` filters by `open` / `reviewing` / `all` and is gated by `isPlatformAdmin`; it returns 404 rather than 403 to non-admins so the surface is not discoverable. The endpoint is complete. There is no client surface of any kind, so the queue can only be worked with `curl` or `psql`. |
| MODERATOR ACTIONS | PARTIAL | BACKEND_ONLY | `apps/api/src/modules/account/account.routes.ts:122`; `apps/api/src/modules/moderation/moderation.repository.ts:166-173`; `apps/api/src/modules/moderation/moderation.admin.service.ts:21-25` | `POST /v1/moderation/reports/:reportId/resolve` supports `dismiss`, `warn`, `remove_content`, `restrict`, `suspend` and `ban`. It writes the `reports` row update and the `moderation_actions` row in one transaction; `suspend` and `ban` additionally set `users.status` and revoke every live session in the same transaction. Same gate, same 404-not-403 posture. Same absence of any UI. |
| AUTOMATED CONTENT GATE | PARTIAL | PARTIAL | `apps/api/src/modules/moderation/moderation.service.ts:33,91-131`; call sites `apps/api/src/modules/content/content.service.ts:286`, `apps/api/src/modules/content/comments.service.ts:94`, `apps/api/src/modules/messaging/conversations.service.ts:361`; absence: no `gate(` call in `apps/api/src/modules/users/users.service.ts`, and no `surface: 'profile'` anywhere in `apps/api/src` | A deterministic term-list gate (terms in `moderation_terms`, 60-second cache, matching rules in `@sos/core moderateText`) runs before every post, comment and direct-message write. A `block` verdict returns 422 `CONTENT_REFUSED`; a `review` verdict writes the row and links it into the moderation queue via `linkFlaggedTarget`. `ModerationSurfaceKind` declares a fourth surface, `'profile'` (`moderation.service.ts:33`), and nothing ever calls `gate()` with it: profile bio (≤500 characters) and display-name updates bypass the gate entirely. Text that is refused in a post can be published verbatim in a bio. |
| COMMENT MODERATION | PARTIAL | PARTIAL | gate at `apps/api/src/modules/content/comments.service.ts:94`; moderator removal at `apps/api/src/modules/account/account.routes.ts:122`; author-side edit/delete at `apps/api/src/modules/content/content.routes.ts:273-310` (no client call sites); reporting see §1.1 | Comments are covered by the automated gate on write, and a moderator can act on them through the resolve endpoint. What is missing is every human-facing lever: no report affordance on a comment row, and no client call to comment edit (`PATCH /v1/comments/:commentId`) or delete (`DELETE /v1/comments/:commentId`) — `CommentRow` (`apps/mobile/app/post/[id].tsx:311-333`) renders name, time and body with no actions at all. |
| ABUSE HANDLING (end-to-end) | PARTIAL | PARTIAL | composed of the rows above: `apps/api/src/modules/social/social.routes.ts:183-202` (intake), `apps/api/src/modules/account/account.routes.ts:98-146` (queue and resolution), `apps/api/src/modules/social/social.routes.ts:75-103` (self-service block), `apps/api/src/modules/moderation/moderation.repository.ts:166-173` (session revocation on suspend/ban) | Every link in the chain exists in code, and the enforcement end is unusually strong — a ban lands atomically with the revocation of every session the banned account holds. The chain is broken in exactly one place: between a filed report and a moderator, there is no in-app queue, so the audit records that "timely responses to concerns" currently depends on an out-of-app workflow. |
| SPAM PROTECTION | PARTIAL | PARTIAL | `spam` reason code at `packages/contracts/src/social/interactions.contract.ts:76-85`; duplicate-report 409 at `apps/api/src/modules/social/social.service.ts:202-244`; term-list gate at `apps/api/src/modules/moderation/moderation.service.ts:91-131`; rate limits per §1.4 | What exists: `spam` is one of the nine report reasons; duplicate open reports against the same target are rejected; the deterministic term list can refuse or flag text on write; and every write path is rate-limited. What the audit did not find, and this document does not claim: any behavioural or reputational anti-spam heuristic, new-account posting restriction, or link/domain filter. Whether any such mechanism exists outside the audited files is not established by the audit. |
| RATE LIMIT | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/http/app.ts:55,109-110`; `apps/api/src/platform/config.ts:12-85` (`RATE_LIMIT_MAX` default 300, `RATE_LIMIT_WINDOW` default `1 minute`, `AUTH_RATE_LIMIT_MAX` default 10); per-route budgets: `apps/api/src/modules/auth/auth.routes.ts:38-41,52,86`; `apps/api/src/modules/social/social.routes.ts:183-202` (reports 20/min); `apps/api/src/modules/groups/groups.routes.ts:311-324` (search 120/min); `apps/api/src/modules/content/content.routes.ts:197-220` (views 600/min); `apps/api/src/modules/account/account.routes.ts:27-55` (account deletion 5 per 15 min); `apps/api/src/modules/auth/auth.routes.ts:86` (forgot-password 5 per 15 min) | A global Fastify rate limiter is registered with a per-authenticated-user key where one is available and the client IP otherwise, explicitly so that a shared campus NAT does not throttle a whole cohort as one client. Sensitive routes carry their own tighter budgets on top. Transport caps sit alongside: JSON body limit 1 MiB, multipart 8 MiB for a single file, WebSocket `maxPayload` 16 KiB (`apps/api/src/http/app.ts:55,109-110`). |

### 1.4 Visibility, privacy and account control

| CAPABILITY | CLASS | AUDIT STATUS | CODE EVIDENCE | WHAT THE CODE ACTUALLY DOES |
|---|---|---|---|---|
| CONTENT VISIBILITY / PRIVACY | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/mobile/app/compose.tsx:108-118` (visibility picker: stage / college / university / private); `packages/contracts/src/social/content.contract.ts:126-146`; `apps/api/src/modules/content/content.service.ts:207-364`; feed predicate at `apps/api/src/modules/content/feed.sql.ts:91` (`followers` visibility); block hydration at `apps/api/src/modules/auth/auth.repository.ts:271-274` | The composer offers a visibility choice per post and the server enforces it in the feed query rather than in the client. Visibility, blocks and mutes are all resolved in the same policy/SQL layer, which is why block enforcement is uniform across feeds, follow lists and visibility checks. |
| USER PRIVACY SETTINGS | PARTIAL | BACKEND_ONLY | `apps/api/src/modules/users/users.routes.ts:80,93`; `apps/api/migrations/0002_academic_hierarchy.sql:215` (`privacy_settings` table); absence: no client call site for `/v1/me/privacy` anywhere in `apps/mobile` | `GET /v1/me/privacy` and `PATCH /v1/me/privacy` exist behind `requireAuth` and are backed by a `privacy_settings` table, but the audit found zero client call sites. A student cannot see or change their privacy settings from the app. What those settings control is not established by the audit. |
| ACCOUNT DELETION | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/account/account.routes.ts:27-55`; `apps/mobile/app/settings/delete-account.tsx:52`; `apps/api/migrations/0015_moderation_and_deletion.sql:142` | `DELETE /v1/me/account` requires re-entry of the password in the body, is rate-limited to 5 per 15 minutes, and performs a full cascade: content, memberships, sessions, storage objects, message tombstoning, and ownership transfer or archival of solely-owned groups, communities and classrooms. Counts and completion are recorded in `account_deletions`. The Settings screen issues the call with the password. |
| CONTENT DELETION (by author) | PARTIAL | BACKEND_ONLY | `apps/api/src/modules/content/content.routes.ts:114-129`; `apps/api/src/modules/content/content.service.ts:419-431`; absence: no delete affordance on `apps/mobile/app/post/[id].tsx` or any feed row; the only caller is `apps/mobile/e2e/smoke.mjs:203` | `DELETE /v1/content/:contentId` performs a soft delete under a `canDeleteContent` policy that also admits platform admins. No screen renders a delete button, so an author cannot remove their own post from within the app. Account deletion (above) remains the only in-app route to removing one's content, and it removes everything. |
| AUTHORSHIP | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/users/users.routes.ts:124-136`; `apps/mobile/app/(tabs)/index.tsx:189`; `apps/mobile/src/components/knowledge/ContentGrammar.tsx:90-198`; `apps/mobile/app/profile/[handle].tsx:52-54`; authorship checks at `apps/api/src/modules/content/content.service.ts:383-417` | Every feed row carries an author line that navigates to `/profile/[handle]`, and the profile screen loads an author-scoped feed (`scope=author`). Authorship is also load-bearing server-side: edit and delete are author-gated by policy, and the post-detail overflow menu offers Report only to non-authors (`apps/mobile/app/post/[id].tsx:173-196`). One navigational gap the audit records: post detail passes no `onAuthorPress` to `PostCard` (`apps/mobile/app/post/[id].tsx:208-212`), so tapping the author on a post's own page does nothing. |

### 1.5 Platform hardening around UGC

| CAPABILITY | CLASS | AUDIT STATUS | CODE EVIDENCE | WHAT THE CODE ACTUALLY DOES |
|---|---|---|---|---|
| SESSION SECURITY | IMPLEMENTED | CONNECTED_AND_WORKING | `apps/api/src/modules/auth/tokens.ts:35-83`; `apps/api/src/modules/auth/auth.service.ts:114-137,226-281`; `apps/api/src/http/plugins/authenticate.ts:32-52`; `apps/api/src/modules/auth/password.ts:27-45`; `apps/mobile/src/state/session.tsx:20-46` | Access tokens are HS256 JWTs with a 900-second default TTL and a `JWT_SECRET` minimum of 32 characters. Refresh tokens are 256-bit opaque values stored only as SHA-256 hashes, rotated on every use, with reuse detection that revokes every session for the user. The `authenticate` plugin re-checks the session row on every request, so logout, suspension and ban take effect immediately. Login equalises timing with a dummy hash; passwords use scrypt at N=2^16 with a versioned hash format and rehash-on-login. One recorded soft spot: on web the client stores tokens in `localStorage` rather than secure storage (`session.tsx:23-46`) — a deliberate, commented choice, but it leaves the 30-day refresh token readable to any successful XSS. |
| INPUT VALIDATION LIMITS | IMPLEMENTED | CONNECTED_AND_WORKING | `packages/contracts/src/social/content.contract.ts:128-134,165`; `packages/contracts/src/social/interactions.contract.ts:49,60,111`; `packages/contracts/src/social/messaging.contract.ts:171,218`; `packages/contracts/src/users/users.contract.ts:79-93`; `packages/contracts/src/users/account.contract.ts:96-101`; `apps/api/src/http/app.ts:55,59-61,109-110` | Every UGC field carries a Zod cap enforced at the route, with `fastify-type-provider-zod` acting as both validator and serialiser. Recorded caps: post body ≤10,000 characters with ≤10 topics, comments ≤5,000, DM body ≤8,000 with ≤10 attachments, bio ≤500, report details ≤2,000, block reason ≤500, moderator resolve reason ≤500 and notes ≤2,000, cursors ≤500, password 10–200, email ≤254. Transport caps as listed under RATE LIMIT. |
| XSS HANDLING | PARTIAL | PARTIAL | absence established by grep: no `dangerouslySetInnerHTML`, `innerHTML`, `document.write` or `WebView` anywhere under `apps/mobile/src` or `apps/mobile/app`; `apps/mobile/src/components/Text.tsx:1-16`; gap: `packages/contracts/src/knowledge/knowledge.contract.ts:51` (`url: z.string().url().max(2000)`) and `apps/mobile/src/components/KnowledgePanel.tsx:221-228` (`Linking.openURL(source.url!)`) | The web build is react-native-web and all user text — posts, comments, messages, bios, report details — renders through one `Text` primitive that becomes an auto-escaped DOM text node. The audit found no HTML or Markdown renderer anywhere in the client. The single gap is not text but URLs: a user-attached knowledge-source URL is validated only for URL *shape*, with no scheme allowlist, so `javascript:` and `data:` pass; it is stored, echoed to every viewer, and opened on tap via `Linking.openURL`, which on web is `window.open`. That is a click-activated script-execution vector against other students. |
| SUPPORT CONTACT | PARTIAL | BLOCKED_BY_EXTERNAL_SERVICE | `apps/api/src/modules/account/account.routes.ts:77`; `apps/mobile/src/state/support-links.ts:22-43`; Settings entry at `apps/mobile/app/settings/index.tsx:53-59`; `apps/api/src/platform/config.ts:81-84` (`SUPPORT_URL`, `PRIVACY_POLICY_URL`, `TERMS_URL`, `SUPPORT_EMAIL`, all optional) | `GET /v1/support/links` is deliberately unauthenticated — the audit records the in-code reasoning that someone who cannot sign in is the person who most needs the support address — and the Settings screen renders support, privacy and terms rows from it, hiding any row whose value is unset. The mechanism is complete and connected. What is missing is the destination: the four environment variables are optional, the repository's documented examples are `studentos.example` placeholders, and the audit records that no such pages exist in or out of the repository. Until an owner publishes them and sets the variables, the client renders nothing and there is no reachable support contact. |
| REPORT-TO-MODERATOR NOTIFICATION | MISSING | DEAD_CODE (schema only) | `apps/api/migrations/0006_ai_moderation_platform.sql:100,119,128` (`notifications`, `notification_preferences`, `push_tokens` — no route anywhere in `apps/api/src`); `apps/mobile/app/settings/index.tsx:63-78` (in-UI statement that notifications are blocked by product capability) | Tables exist for notifications and push tokens; no endpoint reads or writes them, and the Settings screen states plainly in the UI that notifications are unavailable. Nothing tells a moderator that a report has arrived, which is why the moderation chain depends on someone choosing to poll the queue. |
| ENCRYPTION OF UGC AT REST | NOT_APPLICABLE | not established by the audit | — | Phase A audited application code, contracts, migrations and client screens. It did not examine storage-layer or database-level encryption, and no finding addresses it. Any claim here would be invention. |
| AGE ASSURANCE / MINOR PROTECTION | NOT_APPLICABLE | not established by the audit | `apps/api/src/modules/auth/auth.service.ts:88-112`; `packages/contracts/src/auth/auth.contract.ts:20-24` | The signup contract is `{email, password, locale}` only, with no domain allowlist and no email-verification step, and the DB assigns `role` by `DEFAULT 'student'`. The audit records no age field, date of birth, or minor-specific handling anywhere; whether the product intends any is not established by the audit. |

---

## 2. What a platform-safety reviewer would still ask for

These are the real gaps, stated as a reviewer would encounter them. Each is a documented Phase A
finding, not an inference.

### 2.1 There is no admin UI for the moderation queue

`GET /v1/moderation/reports` and `POST /v1/moderation/reports/:reportId/resolve` are complete,
transactional and correctly gated (`apps/api/src/modules/account/account.routes.ts:98-146`;
`apps/api/src/modules/moderation/moderation.admin.service.ts:21-94`), and the enforcement side is
strong — a suspend or ban sets `users.status` and revokes every live session in the same
transaction (`apps/api/src/modules/moderation/moderation.repository.ts:166-173`). But the audit
searched `apps/mobile` and found no screen, no route and no fetch touching
`/v1/moderation/reports`; the only trace of the queue in the client is a set of unused i18n
strings (`en.ts:406-410`). A moderator can only work the queue with `curl` or `psql`.

The consequence a reviewer will state back: a student can file a report and the system will store
it correctly, but nothing in the product brings that report in front of a human, and nothing
notifies anyone that it arrived (see the notification row in §1.5). The response-time property
that reporting is supposed to deliver is not a property of this codebase; it is a property of
whatever manual workflow an operator maintains outside it.

### 2.2 Profile-surface text is not gated by the term list

`ModerationSurfaceKind` declares four surfaces — `post`, `comment`, `message`, `profile`
(`apps/api/src/modules/moderation/moderation.service.ts:33`) — and the gate is called for the
first three (`apps/api/src/modules/content/content.service.ts:286`,
`apps/api/src/modules/content/comments.service.ts:94`,
`apps/api/src/modules/messaging/conversations.service.ts:361`). It is never called with
`'profile'`: the audit found no `gate(` call in `apps/api/src/modules/users/users.service.ts` and
no `surface: 'profile'` anywhere in the API source.

The consequence: a slur or threat that returns 422 `CONTENT_REFUSED` from the post composer can be
saved verbatim into a bio of up to 500 characters or into a display name, where every viewer of
that profile sees it, and — because profile text is not gated — no `review` verdict is written and
nothing is linked into the moderation queue. The declared surface exists in the type; the call
does not exist in the code.

### 2.3 The `comment` and `message` report targets have no client entry point

The report endpoint accepts six target types (`packages/contracts/src/social/interactions.contract.ts:97-101`)
but `ReportSheet` is imported by exactly two screens, post detail and profile. The audit found no
report affordance on any comment row and no `/v1/reports` call in `apps/mobile/app/chat/[id].tsx`.

The consequence is worth stating precisely because the repository itself states the intent: the
contract comment at `interactions.contract.ts:92-95` records that the `message` target was added
because a direct message is where harassment is most private and least visible to anyone else. The
capability was built for that reason and then left unreachable. A student being harassed in a DM
has, from the shipped UI, only blocking — which works (§1.2) — and no way to tell anyone why.
Comments are in the same position, and comment moderation is further thinned by the absence of any
author-side edit or delete affordance (§1.3).

### 2.4 Knowledge-source URLs are stored and opened with no scheme validation

`addSourceRequestSchema.url` is `z.string().url().max(2000)`
(`packages/contracts/src/knowledge/knowledge.contract.ts:51`), which validates URL *shape* and
accepts `javascript:` and `data:` schemes. The value is stored, echoed back to all viewers as a
plain string on `contentSourceSchema.url`, and opened on tap via `Linking.openURL(source.url!)`
(`apps/mobile/src/components/KnowledgePanel.tsx:221-228`). On the web build `Linking.openURL`
resolves to `window.open`.

This is the one XSS-shaped hole in an otherwise clean client: the audit confirmed by grep that
there is no `dangerouslySetInnerHTML`, raw `innerHTML`, `document.write` or `WebView` anywhere in
`apps/mobile`, and that all user text passes through a single auto-escaping `Text` primitive
(`apps/mobile/src/components/Text.tsx:1-16`). The vector is not text rendering; it is a
user-supplied URL attached to an academic source, presented to other students as a citation, and
executed on click. The audit's own recommendation is recorded as two changes: an `http(s)`-only
refinement on `addSourceRequestSchema.url`, and a scheme check before `openURL`.

### 2.5 Secondary items a reviewer will also raise

- **Privacy settings are unreachable.** `GET`/`PATCH /v1/me/privacy` exist
  (`apps/api/src/modules/users/users.routes.ts:80,93`) with a backing `privacy_settings` table
  (`apps/api/migrations/0002_academic_hierarchy.sql:215`), and no client call site. A student
  cannot inspect or change their own privacy posture from the app.
- **No in-app content deletion for an author.** `DELETE /v1/content/:contentId` soft-deletes
  (`apps/api/src/modules/content/content.routes.ts:114-129`) but no screen calls it, so the only
  in-app removal path is full account deletion.
- **Support, privacy-policy and terms destinations do not exist.** The serving mechanism is
  complete (`apps/api/src/modules/account/account.routes.ts:77`;
  `apps/mobile/src/state/support-links.ts:22-43`) and the client hides unset rows, but the URLs
  are optional configuration (`apps/api/src/platform/config.ts:81-84`) pointing at placeholder
  examples, so today there is no contact route for a user with a safety concern.
- **Password reset cannot complete.** The token lifecycle is fully implemented — minted, hashed,
  30-minute TTL, single-use under a row lock, revoking all sessions on redemption
  (`apps/api/src/modules/auth/auth.service.ts:162-217`) — but `deliverPasswordResetEmail` only
  logs `EXTERNAL_INFRASTRUCTURE_REQUIRED` and sends nothing (`apps/api/src/platform/mailer.ts:33-39`),
  and no email provider or configuration key exists. A user locked out of an account they need in
  order to block, report or delete cannot recover it. Audit status: `BLOCKED_BY_EXTERNAL_SERVICE`.
- **Web token storage.** The 30-day refresh token sits in `localStorage` on web
  (`apps/mobile/src/state/session.tsx:23-46`). Given §2.4, the two findings compound: a
  click-activated script on the same origin would have read access to it.

---

## 3. What this document does not claim

The audit examined repository contents only. Accordingly:

- No statement here should be read as saying a capability has been observed working in a deployed
  environment. `IMPLEMENTED` means the code path is complete and connected in the repository.
- Nothing here asserts compliance with any external platform's review policy. Where the repository
  cites a guideline in its own comments — for instance the `message` report target at
  `packages/contracts/src/social/interactions.contract.ts:92-95`, or the unauthenticated support
  endpoint at `apps/api/src/modules/account/account.routes.ts:77` — this document reports that the
  comment exists and what the surrounding code does, and stops there.
- Storage-level encryption, data-retention behaviour beyond the deletion cascade recorded at
  `apps/api/src/modules/account/account.routes.ts:27-55`, age assurance, and any human moderation
  process operating outside the repository are not established by the audit.
