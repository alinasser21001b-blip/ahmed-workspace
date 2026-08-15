# App Store Readiness Audit

Starting commit: `8d7541ddd7e405982fc1901f8d4318b8aa7d03d4` (`origin/main`, after PR #12 merged)
Branch: `claude/app-store-readiness`
Audit method: 8 parallel read-only agents over the real repository, followed by adversarial re-verification of 24 risky claims (19 corrected). Apple documentation fetched live from `developer.apple.com` — sources and access date below.

Classification: `PASS` / `PARTIAL` / `FAIL` / `NOT_APPLICABLE` / `EXTERNAL_OWNER_ACTION_REQUIRED`.

This document reflects the repository **after** the implementation work in this branch (commits `44eb5f0` and later). Where the initial audit found a `FAIL`, the fix and its evidence are recorded alongside it — the audit is not rewritten to hide what it found, because the record of what was missing is part of the readiness case.

## Apple documentation consulted (live fetch, this session)

- App Review Guidelines — `developer.apple.com/app-store/review/guidelines/` (full text of 1.2, 1.5, 1.6, 2.1, 2.3, 2.4, 2.5, 4.8, 5.1.1, 5.1.2)
- Required Reason API — `developer.apple.com/documentation/BundleResources/describing-use-of-required-reason-api` (categories and reason codes)
- Third-party SDK requirements — `developer.apple.com/support/third-party-SDK-requirements/`
- App Tracking Transparency / tracking definition — `developer.apple.com/app-store/user-privacy-and-data-use/`
- Upcoming SDK/Xcode requirements — Apple Developer News, via search (Xcode 26 / iOS 26 SDK required for App Store Connect uploads from **April 28, 2026**)
- Updated age-rating system — Apple Developer News (13+/16+/18+ tiers added; new questionnaire; developer response deadline **January 31, 2026**)
- `ITSAppUsesNonExemptEncryption` — fetch of the canonical documentation page returned only a title (proxy/network limitation in this environment); the export-compliance conclusion below is therefore based on the well-established exemption criteria (HTTPS/TLS, OS-provided or authentication-only encryption) cross-checked against this repository's actual dependency graph, not a fresh read of Apple's page text. **This one sub-finding should be re-verified against the live page before submission** — flagged explicitly rather than asserted with false confidence.

---

## 1. Account deletion — Guideline 5.1.1(v)

| Requirement | Status | Evidence |
|---|---|---|
| Real deletion, in-app | **PASS** | `apps/api/src/modules/account/{account.service,account.repository,account.routes}.ts`; `DELETE /v1/me/account`, registered in `apps/api/src/http/app.ts`. Client: `apps/mobile/app/settings/delete-account.tsx`, reachable from `apps/mobile/app/settings/index.tsx`. |
| Not a soft-disable | **PASS** | `account.repository.ts:deleteUserRow` — `DELETE FROM users WHERE id = $1`. No `status='deleted'` path exists or is used. |
| UGC handled | **PASS** | Posts/comments/reactions cascade (schema); messages become tombstones (`tombstoneMessages` — body/metadata cleared, row survives so the other party's thread is not renumbered). |
| Files removed from storage | **PASS** | `account.service.ts` reads `files.storage_key` inside the deletion transaction (before the CASCADE removes the pointer), then calls `storage.delete(key)` per file after commit; failures recorded in `account_deletions.orphaned_object_keys` for a sweep. |
| Sessions/credentials revoked | **PASS** | `revokeAllSessions` inside the transaction; integration test proves the access token used to request deletion is dead immediately after. |
| Ownership invariants preserved | **PASS** | `resolveGroupOwnership` / `resolveCommunityOwnership` / `resolveClassroomOwnership` — transfer to the most senior remaining member (classroom successors additionally checked for instructor verification) or archive with none. |
| Safe against retries | **PARTIAL** | The whole operation is one transaction; a retry after success correctly 401s (session is gone). A retry that races the ORIGINAL request (two concurrent deletion calls) is not separately tested — the second would find no user row and 404, which is safe, but this exact interleaving has no dedicated test. |

**Original audit finding (pre-implementation), for the record:** the audit run before this branch's account module existed found **zero** account-deletion capability anywhere in the repository — no route, no service, no mobile screen — and `0001_foundation.sql:9-11`'s own comment proposed a soft-disable design that would itself have failed 5.1.1(v). The full FK map that audit produced (64 foreign keys to `users(id)`, 39 `CASCADE` / 25 `SET NULL`, zero `RESTRICT`) is accurate and is what `account.repository.ts` was built against.

## 2. User Generated Content — Guideline 1.2

| Capability | Status | Evidence |
|---|---|---|
| **FILTER** | **PASS** | `packages/core/src/moderation/moderation.ts`, wired into `content.service.ts:createPost`, `comments.service.ts:createComment`, `conversations.service.ts:sendMessage`. Server-side, before every write, on all three UGC surfaces. Not AI — a deterministic rule engine, documented as such. |
| **REPORT** | **PASS** | Request contract and `reports` table existed since Phase 3/6; this branch added the reader (`GET/POST /v1/moderation/reports`), made messages reportable, and built `ReportSheet.tsx` wired into the post and profile screens. |
| **BLOCK** | **PASS** | Block/unblock API existed; this branch added the visible list (`GET /v1/me/blocks`, `apps/mobile/app/settings/blocked.tsx`) and the profile-screen entry point with a confirm dialog. |
| **CONTACT** | **PARTIAL** | `GET /v1/support/links` and a Settings screen exist and render real config when set. The values are environment-driven and **unset in every environment right now** — `pnpm appstore:check` fails on exactly this, which is the intended behaviour: the capability is code-complete, the values are `EXTERNAL_OWNER_ACTION_REQUIRED`. |

Terms of use exists as a string reference (`apps/mobile/src/i18n/en.ts` — `settings.support.terms`) pointing at `TERMS_URL`, but there is no explicit "I agree" gesture at signup and no "no-tolerance for objectionable content" policy text anywhere. **PARTIAL** — the surface exists, the substance does not yet.

## 3. Privacy — Guideline 5.1 / App Privacy labels

See `01-PRIVACY-DATA-MAP.md` and `02-APP-PRIVACY-ANSWERS.md`.

Headline finding, PASS with evidence: no third-party SDK in `apps/mobile/package.json` collects or transmits data off-device (11 dependencies audited: `@expo/vector-icons`, `expo`, `expo-constants`, `expo-image-picker`, `expo-linking`, `expo-localization`, `expo-router`, `expo-secure-store`, `expo-status-bar`, `react`/`react-dom`, `react-native`, `react-native-safe-area-context`, `react-native-screens`, `react-native-web` — none are analytics, crash-reporting, or advertising SDKs). One client, one server origin, no third party. This is the basis for the "no tracking" conclusion in `02-APP-PRIVACY-ANSWERS.md`.

**Updated in the hardening pass (see `08-HARDENING-PASS.md`):** uploaded-photo EXIF/GPS metadata — flagged as an open gap in the original pass — is now stripped server-side, unconditionally, before bytes reach storage. `apps/api/src/platform/image-sanitize.ts` parses each container format (JPEG/PNG/WebP/GIF) at the metadata level only — never decoding pixels — and removes GPS-capable metadata while preserving JPEG orientation and required color-management data. Proven with 13 unit tests against hand-built fixtures and 3 integration tests that upload a real GPS-bearing JPEG through the live HTTP route and confirm the coordinates are absent from what the signed-URL route serves back.

## 4. Login services — Guideline 4.8

**NOT_APPLICABLE.** The app uses exclusively its own email/password account system (`apps/api/src/modules/auth/`). No third-party or social login (Google, Facebook, Apple, etc.) exists anywhere in the codebase. Guideline 4.8's "equivalent option" requirement is triggered only by the presence of a third-party login; since there is none, **Sign in with Apple is correctly NOT added** — the brief's own instruction not to add it for decoration is followed.

## 5. iOS / Expo release configuration

| Item | Status | Evidence |
|---|---|---|
| Bundle identifier / name / slug / scheme | **PASS** | `app.json` — `app.studentos.client`, stable, unchanged in this branch |
| `ios.buildNumber` | **FIXED → PASS** | Added: `"buildNumber": "1"` |
| `ios.config.usesNonExemptEncryption` | **FIXED → PASS** | Added: `false`. See §14 (export compliance) for the reasoning. |
| `NSPhotoLibraryUsageDescription` | **FIXED → PASS** | Added, matched to the actual feature (`compose.tsx:pickImage` → `ImagePicker.launchImageLibraryAsync`). No camera permission requested — `launchCameraAsync` is not called anywhere, so `cameraPermission: false` is set on the plugin rather than requesting a permission the app does not use. |
| `ios.privacyManifests` | **FIXED → PARTIAL** | A manifest declaring `UserDefaults`, `FileTimestamp` and `DiskSpace` categories (the ones Expo/React Native's own core is documented to use) was added to `app.json`. **Not verified against an actual `expo prebuild` output** — no Xcode/macOS toolchain available in this environment to generate and inspect the native project. See `03-PRIVACY-MANIFEST-AUDIT.md`. |
| `supportsTablet` | **FIXED → PASS** | Was `true` with zero supporting evidence (no responsive layout, no `useWindowDimensions`, no breakpoint handling anywhere in `apps/mobile`). Changed to `false` — an honest v1 scope reduction rather than an unproven claim. |
| Production API address in a shipped binary | **FIXED → PASS** | `app.config.ts:assertNativeProductionApiUrl` refuses an EAS `production` build with no `EXPO_PUBLIC_API_URL`, a loopback address, `same-origin` (native has no page to inherit from), or a non-HTTPS URL. `pnpm appstore:check` re-asserts the same rule at the release-gate level. |
| `eas.json` | **FIXED → PARTIAL** | Created with `development`/`preview`/`production` build profiles and an iOS submit profile. The production/preview API URLs and Apple submission credentials are referenced by name and must be set via `eas env:create` — `EXTERNAL_OWNER_ACTION_REQUIRED`, documented in `apps/mobile/EAS_SETUP.md`. |
| App icon (1024×1024) / splash screen | **FAIL** | No `icon` or `splash` asset exists in the repository. Cannot be fabricated here without the visual design system Claude Design is concurrently producing — deliberately not competed with. `WAITING_FOR_DESIGN_FINAL`. `pnpm appstore:check` hard-fails on this. |
| Xcode/SDK version for submission | **EXTERNAL_OWNER_ACTION_REQUIRED** | Apple requires iOS 26 SDK / Xcode 26 for App Store Connect uploads from April 28, 2026 (fetched live, see sources above). EAS build images are updated by Expo on their own schedule; confirm the `production` profile's build image supports this SDK at build time — not something the repository can pin with certainty months in advance. |

## 6. Authentication & session security

| Item | Status |
|---|---|
| Login methods (email/password only) | **PASS** |
| Token storage on device | **PARTIAL** — `expo-secure-store` (iOS Keychain) is used; not independently re-verified in this pass beyond the earlier audit's read of `apps/mobile/src/state/session.tsx`. |
| Logout revokes server-side | **PASS** |
| Refresh token rotation | **PASS** |
| Sign-out reachable in the shipped app | **FIXED → PASS** | Previously `signOut()` existed but no screen called it. `apps/mobile/app/settings/index.tsx` now does. |
| Password reset / forgotten password | **FIXED → PASS (code), delivery EXTERNAL_INFRASTRUCTURE_REQUIRED** | `POST /v1/auth/forgot-password` + `POST /v1/auth/reset-password` (`auth.service.ts`), backed by `password_resets` (`0016_password_reset.sql`): opaque single-use token, SHA-256 hash at rest, 30-minute expiry, superseded on a fresh request, redemption revokes every existing session and issues one fresh one. Mobile screens at `app/(auth)/{forgot-password,reset-password}.tsx`. No email provider is configured anywhere in this repository (`platform/config.ts` has no SMTP/provider vars) — `platform/mailer.ts` is the one integration point, currently a no-op that logs `EXTERNAL_INFRASTRUCTURE_REQUIRED` rather than pretending to send. 10 adversarial integration tests. |
| Hardcoded credentials reaching the iOS bundle | **PASS** | `pnpm appstore:check` greps `apps/mobile/app` and `apps/mobile/src` for demo passwords / JWT-secret patterns — clean. Demo credentials (`correct-horse-battery`) exist only in `apps/api/scripts/seed-demo.ts` and test helpers, neither of which is part of the mobile bundle. |
| Debug panels in production | **PASS** | No `__DEV__`-gated debug UI found. |

## 7. Backend release readiness

Covered structurally by the existing deployment-contract gate (`scripts/verify-function-package.mjs`), re-run in this pass: 15/15 migrations packaged, 18/18 live-request checks pass (health/ready 200, rejected login 401 JSON, unknown route 404 JSON, no leaked stack/path/secret on a boot failure). Realtime/WebSocket limitation on the deployed Netlify host is pre-existing and documented in `netlify/api/handler.mts` — unchanged by this pass, out of scope for an App Store gate (it affects messaging liveness, not review-blocking behaviour).

## 8. Product positioning / medical claims / age rating

No diagnostic, prescriptive, or "replaces clinical judgment" language found in either i18n catalogue (`apps/mobile/src/i18n/ar.ts`, `en.ts`, read in full for this audit). The product markets itself as student learning content, consistently. No dormant AI/LLM feature is user-visible or referenced in-app; `AI_PROVIDER` defaults to `'none'` in `apps/api/src/platform/config.ts`. See `04-AGE-RATING.md` for the prepared questionnaire answers.

---

## Summary counts

- **PASS:** 25
- **PARTIAL:** 8
- **FAIL:** 1 (app icon/splash — a DESIGN blocker, not this pass's to fix)
- **NOT_APPLICABLE:** 1 (Guideline 4.8)
- **EXTERNAL_OWNER_ACTION_REQUIRED:** 4 (EAS/Apple credentials, support URL values, Xcode/SDK version confirmation, password reset email delivery — see `08-HARDENING-PASS.md`)

Updated in the pre-merge hardening pass (see `08-HARDENING-PASS.md`): password reset moved from FAIL to PASS (§6 above); uploaded-photo EXIF/GPS metadata (§3 above, and `01-PRIVACY-DATA-MAP.md`) is now stripped server-side rather than an open gap; the privacy manifest audit (`03-PRIVACY-MANIFEST-AUDIT.md`) gained real evidence from an actual `expo prebuild` run, which also surfaced and fixed two unused permission declarations (`NSFaceIDUsageDescription`, `NSMicrophoneUsageDescription`).
