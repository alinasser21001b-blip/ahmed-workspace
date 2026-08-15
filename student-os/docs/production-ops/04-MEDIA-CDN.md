# 04 — Media / Object Storage / CDN

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§3 Media / Object Storage**: images, video, PDFs, PowerPoint, message attachments, direct upload vs API proxy, signed URLs, CDN, quotas, retention/lifecycle, orphan cleanup. Constraint from the brief: **PostgreSQL = structured truth, Object Storage = heavy binary content, Device = cache/offline; do not propose storing large media blobs in PostgreSQL.** No recommendation here violates that.

## 1. Driver (`PARTIALLY_EXISTS`)

`apps/api/src/platform/storage.ts` defines a `StorageDriver` interface (`put`/`get`/`delete`) with two built-in implementations:

- `LocalStorageDriver` — disk, dev/test only, path-traversal-guarded.
- **`S3StorageDriver` — unimplemented. Its constructor throws unconditionally** (`storage.ts:73-77`). The `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` env vars exist in the config schema and are unused.

Production runs `STORAGE_DRIVER=external`, registered at boot by the Netlify adapter (`handler.mts:87-115`) to a **Netlify Blobs** store (`getStore({name:'sos-uploads', consistency:'strong'})`). Selecting `external` with nothing registered throws rather than silently falling back to disk (`storage.ts:98-101`) — a good failure mode.

**Netlify Blobs is therefore the only working production storage driver.** There is no second implementation to fall back to, and no migration path to another object store without implementing one.

## 2. The boundary is already correctly drawn

- **PostgreSQL = structured truth** — `files` rows hold metadata and the storage key. No binary content is stored as column data anywhere. Verified.
- **Object Storage = heavy binary content** — image bytes live in Netlify Blobs, referenced by UUID key (not sequential), sharded by owner and date.
- **Device = cache/offline** — nothing in the backend treats device state as authoritative.

**No recommendation below changes where content lives.** Every gap here is about how efficiently and completely the object-storage side is *operated*.

## 3. Upload path: images only, API-proxied (`EXISTS_NOW`)

`sniffImage` (`image-meta.ts`) accepts exactly **four formats by magic bytes** — PNG, JPEG, GIF, WebP — ignoring the client's declared `Content-Type` entirely. Every accepted image is sanitized (`image-sanitize.ts`: strips EXIF/GPS/XMP, preserves JPEG orientation) before storage. Cap: 8 MiB (`MAX_IMAGE_BYTES`, `packages/contracts/src/social/files.contract.ts:18`), enforced both at the multipart plugin and re-checked in the service.

Upload is **proxied through the Fastify function** via `@fastify/multipart` — every byte passes through function memory before reaching Blobs. **There is no presigned-PUT or direct-to-bucket path.** At the 8 MiB image cap this is acceptable; it becomes a hard functional ceiling for any larger content type (§6).

**No other file type has a byte-upload path anywhere in this API.** Specifically:

- `reel_details` (video) is **schema-only** — its `processing_status` state machine exists in migration `0003`, but there is no reels module, service, or route under `apps/api/src/modules`. `DOCUMENTED_ONLY`.
- Classroom `materials` accept either `fileId` — which can only reference an already-uploaded *image*, per the four-format sniff — or `externalUrl`. **A PDF or PowerPoint lecture material can therefore only be attached as an off-platform link, never as uploaded bytes.** The demo seed demonstrates exactly this, attaching a PDF via `externalUrl` with a comment noting materials "take different paths" (`seed-demo.ts:742-747`).

This means large binaries stay out of PostgreSQL today by construction, not by policy — there is simply no path to upload them at all.

## 4. Reads: signed, same-origin, and explicitly uncacheable

`apps/api/src/modules/files/signed-url.ts` — HMAC-SHA256 over `fileId:expiresAtSeconds`, keyed by `mediaUrlSecret`, 900s default TTL, `timingSafeEqual` comparison, boolean-only verification (no oracle distinguishing "expired" from "bad signature"). Cryptographically sound; see `08-SECURITY.md`.

**But the signed URL is relative and same-origin** — `/v1/files/:fileId/raw?exp=...&sig=...` — not a direct blob or CDN URL. `GET /files/:fileId/raw` **reads the bytes through the function and re-streams them** (`files.service.ts:118-127`: `getStorage().get(...)` then `reply.send(file.body)`). No redirect to a blob URL exists anywhere in that route.

**The blocker is explicit, not incidental**: the response sets `cache-control: private, max-age=300` (`files.routes.ts:87`). `private` forbids *any* shared cache — CDN, edge, or proxy — from storing the object. Only the requesting browser may cache it, for five minutes. `netlify.toml` has no `[[headers]]` block and no CDN configuration for the API path; only the static SPA shell is served from Netlify's platform CDN.

**Consequence, stated plainly: every media view costs one function invocation plus one Netlify Blobs round trip. Nothing bypasses the function for a repeat view of the same image.** This scales with *view* volume, not with unique-content volume — the cost curve nobody notices until it is steep.

**`RECOMMENDED`**: serve media through a CDN-fronted signed URL rather than an API proxy. The existing HMAC mechanism is the right foundation — what changes is the URL's *destination* and the cache header. Two constraints on doing it:

- **Do not weaken access control to gain caching.** The signed-URL check must still gate the object at the edge. Relaxing `private` without moving the authorization check to the edge would make every media object publicly cacheable — a straight downgrade. `08-SECURITY.md` §3 records this explicitly.
- Whether Netlify's CDN can front a private Blobs store with signature verification at the edge is `NEEDS LIVE VERIFICATION` — if it cannot, this becomes `BLOCKED_BY_EXTERNAL_DEPENDENCY` and the alternative is a storage backend that supports presigned reads natively, which would first require implementing `S3StorageDriver` (§1).

## 5. Quotas, retention, orphan cleanup

**Quotas — none.** No per-user or per-classroom storage quota exists anywhere; the only limit is the global 8 MiB per-file cap. `RECOMMENDED`: track cumulative uploaded bytes per user as a derived value in PostgreSQL — the *count* in structured truth, the *content* in object storage, consistent with the required boundary — and enforce a soft cap at upload time. Application-layer, no new infrastructure.

**Account deletion — better than an earlier draft of this document claimed.** Account deletion **does** delete storage objects, and in the correct order: keys are captured *before* the cascading `DELETE FROM users` removes the `files` rows that reference them. Failures are recorded into `account_deletions.orphaned_object_keys` (`0015_moderation_and_deletion.sql`).

**But nothing ever reads that column back.** A repository-wide grep finds only the write path. Recorded failures accumulate unread — the cleanup is *attempted and audited*, never *reconciled*.

**Orphaned uploads — a query with zero callers.** `listOrphanedFiles` (`files.repository.ts:227-245`, "uploaded but never attached to a post") exists and is correct. Verified repository-wide: **no route, no script, no scheduled job calls it.** The only other occurrence is its own compiled type declaration.

So the orphan situation has two distinct leaks, both `PARTIALLY_EXISTS`:

| Leak | What exists | What is missing |
|---|---|---|
| Unattached uploads | The query that finds them | Anything that runs it |
| Failed deletes during account deletion | Capture into `orphaned_object_keys` | Anything that reads it back and retries |

**`RECOMMENDED`**: one sweep job on the queue from `01-TARGET-ARCHITECTURE.md` §5 that drains both — runs `listOrphanedFiles` past an age threshold, and retries keys recorded in `orphaned_object_keys`. This is one job type on infrastructure already being introduced for account deletion, not a new system.

**Retention / lifecycle — no policy exists.** Nothing defines what happens to media over time (content of a deleted account, archived classroom, long-unviewed media). This is a **product and legal decision this audit does not make**; the enforcement mechanism, once a policy exists, is the same job queue.

**Backups do not cover object storage.** `ops/README.md` states it directly: *"A restore brings back the rows that point at objects; it does not bring back the objects."* Netlify Blobs' own durability is what stands behind uploaded media today. Carried into `06-BACKUP-RESTORE.md`.

## 6. If video / PDF / PowerPoint upload is ever built

Not recommended now — no evidence in this audit establishes it as a near-term need. The pattern is recorded so it is not retrofitted later:

- **Direct-to-storage upload, not API-proxied.** Routing multi-hundred-megabyte video through a serverless function's request body and execution-time limits is a hard functional ceiling, not merely an inefficiency. The client should request a signed upload URL, upload directly to the storage backend, then register the object with the API.
- **CDN-fronted reads from day one**, per §4 — do not repeat the API-proxy pattern for new content types.
- **The boundary holds regardless**: large binaries go to object storage, never to PostgreSQL. Metadata and processing state stay in PostgreSQL.
- Note that direct-to-storage presigned uploads likely require implementing `S3StorageDriver` or an equivalent — Netlify Blobs' suitability for large multipart uploads is `NEEDS LIVE VERIFICATION`.

## 7. Summary

| Finding | Status | Boundary violated? | Priority |
|---|---|---|---|
| API-proxied reads; `cache-control: private` forbids CDN caching | `EXISTS_NOW` (as a cost/latency gap) | No | **P0** |
| No per-user storage quota | gap | No | P1 |
| `listOrphanedFiles` has zero callers | `PARTIALLY_EXISTS` | No | P1 |
| `orphaned_object_keys` written, never read back | `PARTIALLY_EXISTS` | No | P1 |
| No retention/lifecycle policy | gap — product decision | No | P1/P2 |
| Backups exclude blob bytes | `EXISTS_NOW` (stated gap in `ops/README.md`) | No | `06-BACKUP-RESTORE.md` |
| `S3StorageDriver` unimplemented — Blobs is the only working driver | `PARTIALLY_EXISTS` | No | P2 |
| No video/PDF/PPTX upload path; `reel_details` schema-only | `DOCUMENTED_ONLY` | No — large binaries cannot reach PostgreSQL by construction | Not scheduled |

No recommendation proposes storing media blobs in PostgreSQL, and none proposes device-primary storage.
