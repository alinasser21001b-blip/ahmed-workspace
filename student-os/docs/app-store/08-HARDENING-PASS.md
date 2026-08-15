# Pre-Merge Hardening Pass

Three scoped items, closed before `claude/app-store-readiness` opens as a PR against `main`. Nothing outside these three (plus one directly-discovered permission fix — see below) was touched: no design work, no new capability, no refactor of the prior pass's account-deletion/moderation/report/block work.

## 1. Uploaded image metadata privacy — CLOSED

**Before:** uploaded images were stored exactly as received. `01-PRIVACY-DATA-MAP.md` and `PRIVACY_POLICY_DRAFT.md` both carried an open, honestly-disclosed gap: a phone photo's GPS coordinates went straight into object storage and out through every signed URL.

**After:** `apps/api/src/platform/image-sanitize.ts` — a new, dependency-free module that strips metadata at the **container level only**, never by decoding pixels (the same risk posture `image-meta.ts` already documented for format sniffing: a decoder that turns untrusted bytes into pixels is a much larger attack surface than a parser that reads length-prefixed segments and copies or drops them whole).

| Format | What's removed | What's kept, and why |
|---|---|---|
| JPEG | Every APP1 (EXIF *and* XMP) and APP13 (Photoshop/IPTC) segment, plus COM comments | APP0/JFIF, APP2/ICC colour profile, SOF/DQT/DHT/scan data — required to decode and render. If the original EXIF carried an Orientation tag, a fresh 26-byte, orientation-only TIFF block is rebuilt so the photo still displays right-side up with no GPS, camera model, or timestamp attached. |
| PNG | Everything **not** on an explicit allow-list: `eXIf` (PNG's own EXIF/GPS chunk), `tEXt`/`zTXt`/`iTXt`, `tIME` | `IHDR`, `PLTE`, `tRNS`, `IDAT`, `IEND`, `gAMA`, `cHRM`, `sRGB`, `iCCP`, `bKGD` |
| WebP | The RIFF `EXIF` and `XMP ` subchunks; the `VP8X` capability bits for both are cleared to match | `VP8X`/`VP8`/`VP8L`/`ANIM`/`ANMF`/`ICCP` and everything else |
| GIF | Comment Extension blocks only | Graphic Control, Plain Text and Application extensions — GIF has no standard EXIF/GPS carrier at all, so there is nothing else to strip; this is stated, not assumed |

Wired into `files.service.ts`'s `uploadImage` — every upload is sanitised unconditionally before the bytes reach the storage driver; there is no client-supplied flag to skip it, because the route only accepts bytes and a declared MIME type.

**A real bug the tests caught before this shipped:** the first implementation only rebuilt the orientation-preserving EXIF block *after* its marker-walking loop exited normally — but every real JPEG terminates that loop early, at the mandatory Start-of-Scan marker. The rebuild code was structurally unreachable for any actual photograph. `image-sanitize.test.ts`'s first JPEG test (hand-built fixture with a real Orientation tag, independently re-parsed rather than trusting the implementation's own logic) failed immediately and pointed straight at the bug. Fixed by routing every exit from the marker walk through one `finish()` closure.

**Tests:** 13 unit (`apps/api/src/platform/__tests__/image-sanitize.test.ts`) — one per format's removal behaviour, plus positive controls proving essential metadata (ICC profile, animation loop) survives, plus malformed-input robustness. 3 integration (`apps/api/test/upload-sanitization.integration.test.ts`) — a real GPS-bearing JPEG through the live `POST /v1/files` route, confirmed absent from what `GET /files/:id/raw` serves back; a "no opt-out exists" regression guard; a malformed-bytes rejection check.

**Documentation updated:** `01-PRIVACY-DATA-MAP.md` (gap → closed), `PRIVACY_POLICY_DRAFT.md` (the EXIF paragraph rewritten to state the true, current behaviour instead of carrying an `EXTERNAL_OWNER_ACTION_REQUIRED` placeholder), `00-READINESS-AUDIT.md` §3.

## 2. Password reset — CODE READY, delivery `EXTERNAL_INFRASTRUCTURE_REQUIRED`

**Before:** no route, no screen. Flagged as a non-Apple-guideline CODE BLOCKER in the prior pass's final report, because a user who forgets their password cannot re-authenticate to delete their own account either (`DELETE /v1/me/account` requires the current password).

**After:** the full lifecycle, in the same shape this codebase already uses for refresh tokens (`auth/tokens.ts`) — opaque 256-bit random value, hashed with SHA-256 at rest, never the plaintext in a database row.

- **Migration** `0016_password_reset.sql` — `password_resets(id, user_id, token_hash UNIQUE, expires_at, used_at, created_at)`, two partial indexes (active-token lookup, per-user supersede).
- **Service** (`auth.service.ts`) — `requestPasswordReset(email, deliver)` takes delivery as an injected callback rather than a return value, specifically so no future route change can accidentally serialise a plaintext token into an HTTP response; `resetPassword(token, newPassword, meta)` verifies (`FOR UPDATE`, single-use, expiring), sets the new password, revokes **every** existing session, and issues one fresh one for the device that completed the reset — a reset is frequently a recovery from credential theft, and a session opened before it must not outlive it.
- **Routes** — `POST /v1/auth/forgot-password` (rate-limited 5/15min, responds with one constant message regardless of whether the email exists), `POST /v1/auth/reset-password` (rate-limited 10/15min).
- **Mobile** — `app/(auth)/forgot-password.tsx`, `app/(auth)/reset-password.tsx`, a link from the sign-in screen, and `useSession()` gained `requestPasswordReset`/`resetPassword` alongside the existing `signIn`/`signUp`.
- **Delivery** — `apps/api/src/platform/mailer.ts` is the one integration point a real email provider gets wired into. It does not exist yet: `platform/config.ts`'s environment schema has no SMTP host, no provider API key, nothing. The current implementation logs `EXTERNAL_INFRASTRUCTURE_REQUIRED` and returns — it does **not** write the reset link to the server log as a stand-in for email, which would be a credential leaked into every log aggregator rather than a smaller version of sending one.

**How the flow is tested without a mail provider:** the same way `platform/mailer.ts`'s `deliver` callback works in production — `auth.service.requestPasswordReset` is called directly with a callback that captures the plaintext token into a local variable, then that token is redeemed through the real HTTP route. This is not a workaround; it is the function's designed shape, exercised the way its one real caller exercises it, minus the unconfigured mailer.

**Tests:** 10 integration (`apps/api/test/password-reset.integration.test.ts`) — byte-identical non-enumerating response for a real vs. nonexistent email; full lifecycle (reset → login with new password → old password rejected); single-use enforcement; a later request superseding an earlier one; expiry; no token minted for a nonexistent account; every existing session revoked on redemption (proven by a stale refresh token failing afterwards); the redeeming device gets a working session; rate-limit burst refusal.

**Documentation updated:** `00-READINESS-AUDIT.md` §6 (FAIL → PASS), `01-PRIVACY-DATA-MAP.md` (new row for `password_resets`, plus an incidental correction: the password-hash row said bcrypt, the code has always used scrypt — `auth/password.ts`), `06-APP-REVIEW-NOTES.md` (reviewer note: the flow works, delivery does not, so a reviewer who taps it should not expect an email).

## 3. Native privacy manifest verification — advanced, not completed

**Before:** "this environment has no macOS toolchain, nothing can be verified" — true, but stated at a coarser grain than necessary.

**After:** `expo prebuild --platform ios --no-install` and `--platform android --no-install` were actually run. `--no-install` is the only concession to this environment — it skips `pod install`, which needs CocoaPods and realistically macOS; every other step, including every Expo config plugin this project declares, ran for real and produced a real `ios/StudentOS/Info.plist`, a real `ios/StudentOS/PrivacyInfo.xcprivacy`, and a real `android/app/src/main/AndroidManifest.xml`. (Not committed — build output, now gitignored: see `.gitignore`.)

This proved the app-level `PrivacyInfo.xcprivacy` projects exactly what `app.json` declares — a mechanical claim that had only been reasoned about before, never run. It also caught something the reasoning-only pass could not have: two usage-description strings in the generated `Info.plist` that had no business being there.

### A concrete finding, fixed

| Key | Injected by | Why it was wrong |
|---|---|---|
| `NSFaceIDUsageDescription` | `expo-secure-store`'s config plugin, unconditionally by default | Session token storage (`state/session.tsx`) never requests biometric-gated Keychain access |
| `NSMicrophoneUsageDescription` | `expo-image-picker`'s config plugin, unconditionally by default (the existing config disabled `cameraPermission` but never set the equivalent microphone flag) | No audio-recording feature exists anywhere in the product |

Fixed in `app.json`: `["expo-secure-store", { "faceIDPermission": false }]`, and `"microphonePermission": false` alongside the existing `"cameraPermission": false` in the `expo-image-picker` plugin config. Re-ran prebuild and confirmed by reading the regenerated `Info.plist` directly: only `NSPhotoLibraryUsageDescription` remains. The Android manifest shows the identical fix blocking `RECORD_AUDIO` and `CAMERA` via `tools:node="remove"` — one config change, both platforms, because both plugins share Expo's `createPermissionsPlugin` helper (`permission === false` deletes the manifest key rather than filling in a description, the exact mechanism the pre-existing `cameraPermission: false` already relied on).

This was in scope: it is a permission-and-privacy-manifest compliance finding, surfaced directly by doing the verification item 3 asked for, not an unrelated addition.

### What is still not provable here

`ios/Podfile` resolves its pod list **programmatically** (`use_expo_modules!`/`use_native_modules!` shell out to `expo-modules-autolinking` at `pod install` time) — there is no static list to read. The actual set of linked third-party dependencies, and therefore the actual set of `Pods/**/PrivacyInfo.xcprivacy` files React Native's built-in aggregation (`privacy_file_aggregation_enabled`, confirmed **on** by default in this project's `Podfile.properties.json`) would collect, only exists after `pod install` runs. That one step needs CocoaPods and, for a project with native modules, realistically macOS — the one link this environment cannot forge.

**Status: `NATIVE_PRIVACY_MANIFEST_NOT_YET_PROVEN`.** The exact commands to close it, to be run on the first real EAS/macOS build:

```sh
cd apps/mobile
npx expo prebuild --platform ios --clean   # full run, no --no-install
find ios/Pods -name 'PrivacyInfo.xcprivacy' -exec echo {} \; -exec cat {} \;
```

Then reconcile: add any Required-Reason category a real pod's manifest declares that `app.json` does not yet have (with the correct reason code for the actual use); remove any category `app.json` currently declares that nothing in the real `Pods/` tree turns out to touch. Full detail and reasoning in `03-PRIVACY-MANIFEST-AUDIT.md`, which this pass rewrote to carry the real evidence above rather than "could not check."

## Re-verification after all three items

| Check | Result |
|---|---|
| `pnpm typecheck` (all packages + `typecheck:deploy`) | ✓ |
| `pnpm lint` | ✓ 0 problems |
| `packages/core` unit | ✓ 270 / 270 (13 files) |
| `apps/api` unit | ✓ 39 / 39 (3 files — includes the 13 new `image-sanitize` tests) |
| `apps/mobile` unit | ✓ 20 / 20 |
| `apps/api` integration, full suite incl. migration path | ✓ **293 / 293** (16 files, up from 280 — 13 new: 10 password-reset + 3 upload-sanitization) |
| Deployment package gate (`verify-function-package.mjs`, live requests) | ✓ 16/16 migrations packaged, 18/18 live-request checks |
| `pnpm appstore:check` | Same 5 pre-existing owner-config failures as before this pass (production API URL, 3 support/privacy URLs, app icon) — unaffected by these changes, confirmed by diff; 14 checks pass |

No test written before this pass was weakened or deleted to make it pass.

## Files changed, this pass only

**New:** `apps/api/src/platform/image-sanitize.ts`, `apps/api/src/platform/__tests__/image-sanitize.test.ts`, `apps/api/src/platform/mailer.ts`, `apps/api/migrations/0016_password_reset.sql`, `apps/api/test/password-reset.integration.test.ts`, `apps/api/test/upload-sanitization.integration.test.ts`, `apps/mobile/app/(auth)/forgot-password.tsx`, `apps/mobile/app/(auth)/reset-password.tsx`, this file.

**Modified:** `apps/api/src/modules/files/files.service.ts` (sanitize on upload), `apps/api/src/modules/auth/{auth.service,auth.repository,auth.routes,tokens}.ts`, `packages/contracts/src/auth/auth.contract.ts`, `apps/mobile/src/state/session.tsx`, `apps/mobile/app/(auth)/sign-in.tsx`, `apps/mobile/src/i18n/{ar,en}.ts`, `apps/mobile/app.json` (two permission fixes), `.gitignore` (prebuild output), `docs/app-store/{00-READINESS-AUDIT,01-PRIVACY-DATA-MAP,03-PRIVACY-MANIFEST-AUDIT,06-APP-REVIEW-NOTES,07-FINAL-READINESS,PRIVACY_POLICY_DRAFT}.md`.

## What this pass does NOT claim

Does not change any of the four top-line readiness flags to fully green — the app icon (a DESIGN blocker, explicitly out of this pass's scope and untouched) and the Apple/EAS credentials (an EXTERNAL OWNER blocker, unchanged) still gate `APP_STORE_CODE_READY`, `IOS_PRODUCTION_BUILD_PROVEN`, `TESTFLIGHT_READY`, and `APP_REVIEW_READY`. See `07-FINAL-READINESS.md` for the current, precise state of all four.
