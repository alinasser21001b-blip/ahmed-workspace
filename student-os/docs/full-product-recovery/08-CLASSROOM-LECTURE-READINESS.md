# 08 — Classroom and Lecture Readiness: classrooms, lectures, files

**Source of truth.** Every status claim below is taken from the Phase A forensic evidence file
(area `classroom`, with supporting entries from area `authugc` for instructor eligibility). Where
this document departs from that evidence, it says so explicitly and cites the repository line that
disproves the audit note. Where the audit is silent, this document says "not established by the
audit" rather than filling the gap.

**Path convention.** File paths are given as the evidence gives them, relative to the `student-os`
repository root (e.g. `apps/api/src/...` means
`/home/user/ahmed-workspace/student-os/apps/api/src/...`).

**Status vocabulary.** `CONNECTED_AND_WORKING`, `BACKEND_ONLY`, `FRONTEND_ONLY`, `PARTIAL`,
`BLOCKED_BY_EXTERNAL_SERVICE`, `BLOCKED_BY_DEPLOYMENT`, `BLOCKED_BY_PRODUCT_DECISION`, `MISSING`,
`DEAD_CODE`, `PREVIEW_ONLY`.

---

## 1. Summary of findings

| Capability | Status | Anchor citation |
| --- | --- | --- |
| Classroom creation (instructor-gated, join code minted server-side) | CONNECTED_AND_WORKING | `apps/api/src/modules/classrooms/classrooms.routes.ts:60-83`; `apps/mobile/app/classrooms/new.tsx:62-67` |
| Join by enrolment or by join code (including code lookup) | CONNECTED_AND_WORKING | `apps/api/src/modules/classrooms/classrooms.routes.ts:85-102,123-150`; `apps/mobile/app/classrooms/index.tsx:66-85` |
| Membership roster and roles | PARTIAL (roster reads; `admin`/`moderator`/`banned` unreachable) | `apps/api/src/modules/classrooms/classrooms.routes.ts:169-186`; `apps/api/src/modules/classrooms/classrooms.service.ts:261-264,306` |
| Lecture creation / publishing | BACKEND_ONLY (endpoint + tests, no UI anywhere) | `apps/api/src/modules/classrooms/classrooms.routes.ts:210-238`; `apps/mobile/e2e/classroom-journey.mjs:213-224` |
| Lecture reading, per-lecture discussion, reading progress | CONNECTED_AND_WORKING | `apps/api/src/modules/classrooms/classrooms.routes.ts:190-208,240-257,293-352,354-377`; `apps/mobile/app/lecture/[id].tsx:58-65,77-110` |
| Material attach to a lecture | PARTIAL (images only; `externalUrl` has no UI field) | `apps/api/src/modules/classrooms/classrooms.routes.ts:259-289`; `apps/mobile/app/lecture/[id].tsx:118-164` |
| File upload (`POST /v1/files`) | CONNECTED_AND_WORKING | `apps/api/src/modules/files/files.routes.ts:12-52`; `apps/mobile/src/api/client.ts:203-238` |
| File download via signed URLs | CONNECTED_AND_WORKING | `apps/api/src/modules/files/signed-url.ts:37-46`; `apps/api/src/modules/files/files.routes.ts:62-91` |
| Storage backend for file bytes (Netlify Blobs) | **Correction (round-2 review): downgraded from CONNECTED_AND_WORKING to PARTIAL (code correct, integration unverified).** The driver is registered unconditionally at boot — the citation below is accurate code — but no test file in the repository references it or `@netlify/blobs`, `/health/ready` never probes storage, and it has never been invoked by a deployed function. The original CONNECTED_AND_WORKING label was applied with the same vocabulary this document uses elsewhere for capabilities that actually have integration coverage, which this one does not: only the local-disk driver has ever been exercised (see `01-CAPABILITY-MATRIX.md`'s File upload row) | `netlify/api/handler.mts:87-115,136-137`; `apps/api/src/platform/config.ts:51,115-117`; no test anywhere references `netlifyBlobsDriver` or `@netlify/blobs` |
| S3 storage driver | DEAD_CODE (constructor throws) | `apps/api/src/platform/storage.ts:67-86` |
| Instructor-facing screens as a set | PARTIAL (create/publish, drafts, roster and room management all absent) | `apps/mobile/app/lecture/[id].tsx:300-333`; `apps/mobile/app/classrooms/index.tsx:183-190` |
| Classroom management (archive, rename, rotate code, transfer, promote, remove/ban) | MISSING (policy and schema exist; no routes) | `apps/api/src/modules/classrooms/classrooms.service.ts:529-534`; `apps/api/migrations/0005_learning.sql:37-44` |
| Leave classroom | BACKEND_ONLY (route exists; no screen calls it) | `apps/api/src/modules/classrooms/classrooms.routes.ts:152-167`; `packages/core/src/policy/classroom.policy.ts:147-153` |
| Classroom flows in deploy previews | PREVIEW_ONLY | `netlify.toml` `[context.deploy-preview]`; `apps/mobile/src/preview/fixture-transport.ts:235-268` |

The one-line reading: **the student side of a classroom is complete and the teaching side is not.**
The audit describes this vertical as the most complete feature in the repository — creation, both
join paths, roster reads, lecture reading, discussion, reading progress, material attach, upload,
download and durable storage are all wired from screen to database and covered by integration
tests. What is missing sits entirely on the authoring and administration side: an instructor who
installs the shipped app can open a classroom and attach an image to a lecture that already exists,
but cannot create that lecture, cannot manage the room, and cannot manage its members.

---

## 2. Classroom creation — CONNECTED_AND_WORKING

`POST /v1/classrooms` is defined at `apps/api/src/modules/classrooms/classrooms.routes.ts:60-83`
and served by `classrooms.service.ts:228-271`. The service applies the eligibility gate at
`classrooms.service.ts:244-245` and writes the creator's owner membership inside the same
transaction at `classrooms.service.ts:247-266`, so a room cannot exist without somebody who can
publish into it. The join code is minted server-side at `classrooms.service.ts:222-226` from
`randomBytes(8)` over a Crockford-ish alphabet.

The gate itself is `canCreateClassroom` at `packages/core/src/policy/classroom.policy.ts:172-177`,
which requires two independent things: global teaching eligibility, and enrolment in the course the
room is being opened against. Teaching eligibility is `verification_level in ('instructor',
'official')` and is a separate axis from `users.role`; it is settable only through
`PUT /v1/admin/users/:userId/verification` behind `canSetVerificationLevel`
(`apps/api/src/modules/admin/admin.service.ts:27-30` with `admin.routes.ts:29-120`). The audit
records that no registration payload, role-update endpoint or classroom-ownership path lets a
student acquire teaching capability, and that `canTeachAcademically` explicitly refuses to treat
`role='admin'` as a teaching credential (`packages/core/src/policy/academic.policy.ts:66-78`).

On the client, `apps/mobile/app/classrooms/new.tsx:62-67` posts the request, and the entry button is
shown only when the server has projected `user.teachingEligible`
(`apps/mobile/app/classrooms/index.tsx:183-190`, projected at
`apps/api/src/modules/auth/auth.service.ts:54`). The button is a hint, not the control: the server
returns 403 regardless of what the client renders. Integration coverage is at
`apps/api/test/classrooms.integration.test.ts:290-321,434`.

The join code is treated as a bearer credential and is returned only to staff:
`classrooms.service.ts:186` gates it on `canManageClassroomMembership`, and the contract states that
students receive `null` (`packages/contracts/src/learning/classroom.contract.ts:88-95`).

---

## 3. Joining a classroom — CONNECTED_AND_WORKING

Two paths exist and both work from the shipped UI.

**By join code.** `GET /v1/classrooms/lookup` (`classrooms.routes.ts:85-102`, rate-limited to 30 per
minute) resolves a code to a room. The comparison is case-insensitive via uppercasing at
`classrooms.service.ts:290-291`, and a wrong code produces a 404 at `classrooms.service.ts:298-303`
that is indistinguishable from the 404 for a room that does not exist. The repository lookup
excludes archived rooms (`classrooms.repository.ts:114-125`).

**By enrolment.** `PUT /v1/classrooms/:id/membership` (`classrooms.routes.ts:123-150`) admits an
actor enrolled in the room's course when the room's visibility is `course`. The decision is
`canJoinClassroom` at `packages/core/src/policy/classroom.policy.ts:123-137`: a valid code, or
course enrolment; an archived room is refused; and a `banned` membership is never reinstated. The
membership write is an idempotent upsert guarded by `WHERE status <> 'banned'`
(`classrooms.repository.ts:156-170`).

Client wiring is `apps/mobile/app/classrooms/index.tsx:66-85` (lookup then `PUT` membership) and
`apps/mobile/app/classrooms/[id].tsx:77-92` for the join-by-enrolment button, which is gated on the
server-projected `viewer.canJoin` at `apps/mobile/app/classrooms/[id].tsx:188`. Tests:
`apps/api/test/classrooms.integration.test.ts:236-289,447-500`.

Rooms whose visibility is `classroom` are invisible to discovery by construction
(`classrooms.repository.ts:94-112`) and are reachable only by code.

---

## 4. Roster and roles — PARTIAL, with dead policy paths

Reading the roster works end to end. `GET /v1/classrooms/:id/members`
(`classrooms.routes.ts:169-186`) is members-only through `loadReadable`
(`classrooms.service.ts:190-212`), and the roster renders at
`apps/mobile/app/classrooms/[id].tsx:55-58,168-177`.

The role model on paper is wider than the role model in reality. The contract declares
`owner | admin | moderator | member` (`packages/contracts/src/learning/classroom.contract.ts:31-32`),
the schema carries the same roles plus a `banned` status
(`apps/api/migrations/0005_learning.sql:37-44`), and the policy layer distinguishes `STAFF_ROLES`
from `MANAGE_ROLES` at `packages/core/src/policy/classroom.policy.ts:64-65`. But the only role
assignments anywhere in the codebase are `owner`, written for the creator at
`classrooms.service.ts:261-264`, and `member`, written for a joiner at `classrooms.service.ts:306`.

Consequently:

- **`admin` and `moderator` are dead policy paths.** No endpoint promotes anyone into either role,
  so `canManageClassroom` and `canManageClassroomMembership` can only ever be satisfied by the
  original creator. `assertCanManage` is exported at `classrooms.service.ts:529-534` — its comment
  describes it as being "for the routes' archive/manage surface" — and the audit found zero route
  callers.
- **`banned` is a dead status for classrooms.** Nothing ever sets `classroom_members.status =
  'banned'`; the audit's grep found the ban path only in groups
  (`apps/api/src/modules/groups/groups.service.ts:393-439`). The ban check in `canJoinClassroom`
  therefore guards a state that cannot currently be produced.
- **Leaving is BACKEND_ONLY.** `DELETE /v1/classrooms/:classroomId/membership` exists at
  `classrooms.routes.ts:152-167`, and the owner-cannot-leave rule is enforced at
  `packages/core/src/policy/classroom.policy.ts:147-153`, but the audit's grep of `apps/mobile/app`
  found only `PUT` membership calls — no screen invokes the leave route, so it is reachable only by
  raw API call.

Every other management operation — archive, rename, rotate join code, transfer ownership, promote a
member, remove or ban a member — is **MISSING**: policy gates and schema columns exist, and no HTTP
route exists to drive them. The audit is explicit that this is a product gap rather than a
UI-only gap.

---

## 5. Lecture creation — BACKEND_ONLY

`POST /v1/classrooms/:classroomId/lectures` is fully implemented at
`classrooms.routes.ts:210-238`, served by `classrooms.service.ts:444-475` with the
`canTeachInClassroom` gate at `classrooms.service.ts:450-451`. That gate
(`packages/core/src/policy/classroom.policy.ts:192-203`) requires both a staff role in the room and
the global academic credential, so a de-verified owner is refused. Drafts are supported: the publish
flag is in the contract at `packages/contracts/src/learning/classroom.contract.ts:169-180`, and
drafts are filtered to staff in SQL at `classrooms.repository.ts:269-284`. Integration coverage is
at `apps/api/test/classrooms.integration.test.ts:290-366`.

**No user interface calls it.** The audit's grep of `apps/mobile/app` found no `POST` to
`/lectures`; the only caller is the end-to-end script, which creates lectures by raw API call at
`apps/mobile/e2e/classroom-journey.mjs:213-224`. The practical consequence is that an instructor
using the shipped app can attach materials to a lecture that already exists but cannot create one,
and cannot create a draft either — even though the lecture screen already renders a "draft" badge at
`apps/mobile/app/lecture/[id].tsx:213`.

This is the single largest gap in the vertical: the endpoint is complete and tested, and the
authoring surface in front of it does not exist.

---

## 6. Lecture reading, discussion and reading progress — CONNECTED_AND_WORKING

The reading loop is complete for members from the UI.

- **Listing** — `classrooms.routes.ts:190-208`, members-only, with drafts filtered in SQL.
- **Detail** — `classrooms.routes.ts:240-257`, returning material URLs already signed
  (`classrooms.service.ts:414-436`).
- **Discussion** — `classrooms.routes.ts:293-352`. Posts are ordinary `content_items` pointed at a
  lecture (`apps/api/migrations/0012_classrooms.sql:28-33`, where `lecture_id` narrows visibility
  and never grants it), and visibility is forced to `classroom` at
  `classrooms.service.ts:599-621`, so a discussion post inherits the feed permission predicate.
- **Reading progress** — `classrooms.routes.ts:354-377`, made monotonic with `GREATEST` at
  `classrooms.repository.ts:366-381`.

Membership is resolved through the lecture's own classroom
(`classrooms.service.ts:365-387,546-558`), so possessing a lecture id is not a way around the
classroom gate; non-members and outsiders receive 404s, and this is tested at
`apps/api/test/classrooms.integration.test.ts:96-158,322-366,527-670`.

Client wiring: `apps/mobile/app/classrooms/[id].tsx:56` for the lecture list, and
`apps/mobile/app/lecture/[id].tsx:58-65` (detail and discussion), `:92-110` (post a question),
`:77-90` (mark read).

---

## 7. Material attach — PARTIAL

`POST /v1/classrooms/lectures/:id/materials` is at `classrooms.routes.ts:259-289` behind
`canTeachInClassroom` (`classrooms.service.ts:485-487`). The attach claims the file into the
classroom atomically at `classrooms.repository.ts:460-480`
(`UPDATE files SET visibility='classroom', classroom_id=$2 WHERE attached_at IS NULL`), after which
`canAccessFile` (`packages/core/src/policy/interaction.policy.ts:178-181`) refuses non-members.

The client flow — pick an image with `expo-image-picker`, upload to `/v1/files`, then post the
material with the returned `fileId` — is at `apps/mobile/app/lecture/[id].tsx:118-164`, and the form
is drawn only when the server projected `viewer.canTeach`
(`apps/mobile/app/lecture/[id].tsx:300-333`).

Two gaps keep this at PARTIAL:

1. **Images only — no PDFs.** `POST /v1/files` sniffs the format from the bytes and refuses anything
   that is not PNG, JPEG, GIF or WebP (`apps/api/src/platform/storage.ts:136-141`, sniffing at
   `apps/api/src/modules/files/files.service.ts:53-59`). A lecture "material" can therefore only be
   an image. The audit notes plainly that PDFs and slide decks — the usual form of lecture material —
   cannot be uploaded at all, regardless of file extension or declared MIME type.
2. **`externalUrl` materials are backend-only.** The contract accepts a link material at
   `packages/contracts/src/learning/classroom.contract.ts:182-196`, and the UI offers no field for
   it.

---

## 8. File upload — CONNECTED_AND_WORKING, with two caveats

`POST /v1/files` is at `apps/api/src/modules/files/files.routes.ts:12-52` (multipart, 30 per minute)
and served by `files.service.ts:42-110`. The declared MIME type is ignored and the format is sniffed
from the bytes (`files.service.ts:53-59`); EXIF and GPS data are stripped by `sanitizeImage`
(`files.service.ts:76-81`); the row is written before the bytes (`files.service.ts:91-108`); and the
upload lands private and unattached (`files.service.ts:99`). The size cap is
`MAX_IMAGE_BYTES = 8 * 1024 * 1024` (`packages/contracts/src/social/files.contract.ts:18`). The
mobile client uploads with a 401-refresh-and-replay wrapper at
`apps/mobile/src/api/client.ts:203-238`, used by both the post composer
(`apps/mobile/app/compose.tsx:95`) and lecture materials (`apps/mobile/app/lecture/[id].tsx:140`).

**Caveat 1 — the 8 MB cap versus the Netlify request body limit.** The audit records that the app's
8 MB cap exceeds the roughly 6 MB request body limit of Netlify's synchronous functions, so the
largest uploads the application permits may be rejected by the platform before the API ever sees
them. The audit labels this as inference rather than an in-repo finding: the ~6 MB figure is a
platform limit and is not asserted by any file in the repository. The mismatch between the two
numbers, however, is a repository fact.

**Caveat 2 — no orphan cleanup.** `listOrphanedFiles`
(`apps/api/src/modules/files/files.repository.ts:229-247`) has zero callers, so uploads that are
never attached to anything accumulate in storage indefinitely.

---

## 9. File download and the signed-URL model — CONNECTED_AND_WORKING

Signatures are minted at `apps/api/src/modules/files/signed-url.ts:37-46` as an HMAC-SHA256 over
`fileId:expiry`, with a default time-to-live of 900 seconds (`apps/api/src/platform/config.ts:59`).

The serving route `GET /v1/files/:fileId/raw` (`files.routes.ts:62-91`) is deliberately
unauthenticated: the signature is verified in constant time
(`apps/api/src/modules/files/signed-url.ts:54-73`) and a bad signature returns 404. Authorisation
therefore happens at mint time against the real actor — `files.routes.ts:93-105` re-mints a URL only
after `canAccessFile` passes (`files.service.ts:136-144`; policy at
`packages/core/src/policy/interaction.policy.ts:161-201`, with the classroom case at `:178-181`) —
and the resulting URL is a short-lived bearer capability, the same model as an S3 presigned URL.
Lecture materials arrive already signed for a caller who has passed the classroom gate
(`classrooms.service.ts:414-436`), and the UI simply opens
`${API_BASE_URL}${material.file.url}` (`apps/mobile/app/lecture/[id].tsx:272-291`).

Deleted files stop serving part-way through an unexpired window
(`files.service.ts:120-128`). The integration suite includes a case that "refuses a non-member every
route to a signed material URL" (`apps/api/test/classrooms.integration.test.ts:96-203`).

---

## 10. Storage path on Netlify — CONNECTED_AND_WORKING

File bytes go through a pluggable driver interface declared at
`apps/api/src/platform/storage.ts:16-21`. Three drivers exist:

- **Local disk** (`storage.ts:30-57`), path-traversal guarded, for development and test only.
  Production refuses `STORAGE_DRIVER=local` outright (`apps/api/src/platform/config.ts:51,115-117`).
- **S3** (`storage.ts:67-86`) — **DEAD_CODE**: the constructor throws "not implemented".
- **Netlify Blobs**, defined in `netlify/api/handler.mts:5,87-115`
  (`getStore({ name: 'sos-uploads', consistency: 'strong' })` with `put`/`get`/`delete`) and
  registered through `setStorage()` during boot at `netlify/api/handler.mts:136-137`. The packaging
  test asserts `STORAGE_DRIVER=external` for the deployed function
  (`scripts/verify-function-package.mjs:239,334`).

The database stores only a `storage_key` and never the bytes
(`apps/api/migrations/0003_social_and_content.sql:23-29`).

The audit's conclusion is direct: on the deployed host the bytes live in Netlify Blobs — not S3, not
the database, and not disk — and this **does** work on Netlify Functions, because every upload and
download is a single request/response cycle through the function with the blob store providing
durable storage. Two consequences follow. First, the only production storage path that exists is
Netlify-specific, so moving off Netlify requires writing a driver, since the S3 driver is a stub
that throws at construction. Second, blobs are not covered by the `ops/` backup scripts: rows
restore, objects do not.

---

## 11. Instructor-facing versus student-facing screens — PARTIAL

There is one set of screens, with capabilities projected by the server and rendered by the client;
the client never re-derives a permission. Capabilities are computed by `classroomCapabilities`
(`packages/core/src/policy/classroom.policy.ts:268-286`). The create-classroom button appears only
for `teachingEligible` users (`apps/mobile/app/classrooms/index.tsx:183-190`); the join-code block
renders only when the server sent a code, i.e. for staff
(`apps/mobile/app/classrooms/[id].tsx:154-164`); the add-material form renders only when
`viewer.canTeach` (`apps/mobile/app/lecture/[id].tsx:300-333`). Student affordances — join
(`apps/mobile/app/classrooms/[id].tsx:188-194`), discussion post
(`apps/mobile/app/lecture/[id].tsx:342-373`), mark-read (`:392-402`) — are all present.

The audit's assessment is that the pattern is sound and the student journey is complete, while the
instructor journey is not: there is no create-or-publish-lecture screen, no draft management, no
roster management (remove, ban, promote), and no archive/rename/rotate-code/transfer screen. For
most of those the API route is missing as well, so closing the gap is a product decision and not
only a front-end task.

Instructor verification itself has no in-app surface either: it is driven through the admin API
(`apps/api/src/modules/admin/admin.service.ts:42`), and the end-to-end script grants it by raw API
call at `apps/mobile/e2e/classroom-journey.mjs:192`. The audit records the moderation queue as
BACKEND_ONLY for the same reason — endpoints exist, no client screen does.

---

## 12. Deploy previews — PREVIEW_ONLY

`netlify.toml` sets `EXPO_PUBLIC_PREVIEW_MODE=1` for `[context.deploy-preview]` and ships an empty
functions directory (`netlify/no-functions`), so `/v1/*` returns 404 in that context. The client
instead serves canned fixtures through an injected transport seam
(`apps/mobile/src/api/client.ts:58-70`), with the classroom fixtures at
`apps/mobile/src/preview/fixture-transport.ts:235-268`: classroom, lecture and member reads are
stubbed; `POST /v1/classrooms` always returns 403 ("Only verified instructors..."); code lookup
always returns 404; the materials POST is stubbed.

Nothing about a deploy preview therefore demonstrates that the classroom surface works. This is
scoped to deploy-preview and branch-deploy contexts only; production builds use the real transport
and the real function.

---

## 13. What must exist for the instructor journey in Section 27 to pass

The exact wording of Section 27 is not established by the audit; the evidence file contains no
reference to it. The list below is derived from what the evidence shows to be absent on the
teaching side, in the order an instructor would hit it.

1. **A lecture authoring screen.** `POST /v1/classrooms/:classroomId/lectures`
   (`classrooms.routes.ts:210-238`) is complete, gated and tested; nothing in `apps/mobile/app`
   calls it. Until a screen exists, the instructor journey stops at the point of publishing content.
   This is the only item on the list where the backend is already finished — it is a pure UI build.
2. **Draft handling in that screen.** The publish flag exists in the contract
   (`packages/contracts/src/learning/classroom.contract.ts:169-180`) and drafts are staff-filtered in
   SQL (`classrooms.repository.ts:269-284`), and the lecture screen already renders a draft badge
   (`apps/mobile/app/lecture/[id].tsx:213`); with no creation UI, a draft can never come into
   existence from the app.
3. **A non-image material path, or an explicit product decision to remain image-only.** Uploads are
   refused by byte-sniffing for anything that is not PNG, JPEG, GIF or WebP
   (`apps/api/src/platform/storage.ts:136-141`), so a PDF or slide deck cannot be attached to a
   lecture at all. If lecture materials are meant to include documents, this requires contract,
   sniffing, sanitisation and storage work, not only a UI field.
4. **An `externalUrl` material field in the UI.** The API already accepts link materials
   (`packages/contracts/src/learning/classroom.contract.ts:182-196`); the client offers no input, so
   the cheapest route to non-image materials is currently unreachable.
5. **Classroom management routes, then screens.** Archive, rename, rotate join code and transfer
   ownership all have policy gates — `assertCanManage` at `classrooms.service.ts:529-534` — and no
   HTTP routes. Both halves have to be built.
6. **Member management routes, then screens.** Promotion to `admin` or `moderator`, and removal or
   banning of a member, have contract values (`packages/contracts/src/learning/classroom.contract.ts:31-32`)
   and schema columns (`apps/api/migrations/0005_learning.sql:37-44`) but no endpoint that can
   produce those states. Until then the only reachable roles are `owner` and `member`, and the ban
   branch of `canJoinClassroom` guards an unreachable state.
7. **A leave-classroom control.** The route exists at `classrooms.routes.ts:152-167` with the
   owner-must-transfer-or-archive rule enforced at
   `packages/core/src/policy/classroom.policy.ts:147-153`; no screen calls it. Note that the
   owner's exit depends on item 5, since transfer and archive do not exist as routes.
8. **An in-app route to instructor verification, or a documented out-of-app process.**
   Teaching eligibility is set only through `PUT /v1/admin/users/:userId/verification`
   (`apps/api/src/modules/admin/admin.service.ts:27-30`), which has no client surface; today an
   instructor becomes an instructor only because an operator calls the admin API.
9. **A decision on the upload size mismatch.** The application permits 8 MB
   (`packages/contracts/src/social/files.contract.ts:18`) while the deployed function's platform
   limit is lower (the ~6 MB figure is the audit's inference, not a repository fact). Either lower
   the cap, or move large uploads off the synchronous function path, or accept that the top of the
   permitted range fails at the edge.
10. **Orphan file cleanup.** `listOrphanedFiles`
    (`apps/api/src/modules/files/files.repository.ts:229-247`) has no callers, so every abandoned
    upload during authoring is retained forever. This does not block the journey, but it scales with
    it.
11. **A backup story for Netlify Blobs.** The audit records that blobs are outside the `ops/` backup
    scripts, so a restore returns lecture rows whose material bytes are gone
    (`netlify/api/handler.mts:87-115`).

Items 1 and 4 are UI-only. Items 3, 5, 6 and 8 need API work before any screen can be built. Item 9
is a configuration or architecture decision. Nothing on this list is blocked by an external service:
the audit records no `BLOCKED_BY_EXTERNAL_SERVICE` finding anywhere in the classroom area, and the
storage path it depends on is working on the deployed host.
