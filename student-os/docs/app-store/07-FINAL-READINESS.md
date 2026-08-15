# Final Readiness Report

```
APP_STORE_CODE_READY       = NO   (app icon/splash missing — see DESIGN blockers; nothing else code-level remains)
IOS_PRODUCTION_BUILD_PROVEN = NO  (no Apple/EAS credentials in this environment)
TESTFLIGHT_READY            = NO  (blocked by both of the above)
APP_REVIEW_READY            = NO  (blocked by all of the above, plus support URLs)
```

Everything that could be implemented inside the repository was implemented and proven with real tests against a real database and a real deployment-package bundler. A pre-merge hardening pass (see `08-HARDENING-PASS.md`) closed the two remaining code gaps this report used to list — uploaded-photo EXIF/GPS metadata and password reset — and advanced (though did not complete) native privacy manifest verification by actually running `expo prebuild`, which also caught and fixed two unused permission declarations. What remains after all of that is genuinely outside the repository's reach: Apple account credentials, real branded artwork, operator-provided URLs, and an email provider for password-reset delivery.

## Branch / commit

- Branch: `claude/app-store-readiness`
- Starting commit: `8d7541ddd7e405982fc1901f8d4318b8aa7d03d4` (`origin/main`)
- Three commits on this branch: P0 capabilities (account deletion, moderation gate, report/block) → iOS release config, EAS profiles, release gate, first readiness report → this pre-merge hardening pass (EXIF/GPS stripping, password reset, native privacy manifest verification). See `git log --oneline` for exact SHAs.

## Files changed (by area)

- **Account deletion**: `apps/api/src/modules/account/*`, `apps/api/migrations/0015_moderation_and_deletion.sql`, `apps/mobile/app/settings/*`
- **Moderation gate**: `packages/core/src/moderation/moderation.ts`, wired into `content.service.ts`, `comments.service.ts`, `conversations.service.ts`
- **Report/block UI**: `apps/mobile/src/components/{ActionSheet,ReportSheet}.tsx`, `apps/mobile/app/profile/[handle].tsx`, `apps/mobile/app/post/[id].tsx`
- **Support links**: `apps/api/src/modules/account/support.service.ts`, `apps/mobile/src/state/support-links.ts`
- **iOS config**: `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `apps/mobile/EAS_SETUP.md`
- **Release gate**: `scripts/appstore-check.mjs`, wired as `pnpm appstore:check`
- **Uploaded-image metadata privacy** *(hardening pass)*: `apps/api/src/platform/image-sanitize.ts`, wired into `apps/api/src/modules/files/files.service.ts`
- **Password reset** *(hardening pass)*: `apps/api/src/modules/auth/{auth.service,auth.repository,auth.routes,tokens}.ts`, `apps/api/src/platform/mailer.ts`, `apps/api/migrations/0016_password_reset.sql`, `apps/mobile/app/(auth)/{forgot-password,reset-password}.tsx`, `apps/mobile/src/state/session.tsx`
- **Native privacy manifest verification** *(hardening pass)*: `apps/mobile/app.json` (two permission fixes), `docs/app-store/03-PRIVACY-MANIFEST-AUDIT.md`
- **Docs**: `docs/app-store/*` (this directory)

## Migrations added

- `0015_moderation_and_deletion.sql` — `moderation_terms` (lexicon, seeded with 13 slur-only rows), `moderation_decisions` (gate audit trail), `account_deletions` (one-way deletion receipt), plus two indexes on `reports` for queue performance.
- `0016_password_reset.sql` *(hardening pass)* — `password_resets` (opaque single-use token, SHA-256 hash at rest, expiry, per-user supersede), plus two partial indexes.

## New endpoints

- `DELETE /v1/me/account`
- `GET /v1/me/blocks`
- `GET /v1/support/links`
- `GET /v1/moderation/reports`
- `POST /v1/moderation/reports/:reportId/resolve`
- (existing `POST /v1/reports` extended to accept `targetType: 'message'`)
- `POST /v1/auth/forgot-password` *(hardening pass)*
- `POST /v1/auth/reset-password` *(hardening pass)*

## New tests

- 33 unit tests — `packages/core/src/moderation/__tests__/moderation.test.ts` (the gate: slurs, threats, self-harm, sexual harassment, spam, and — critically — every rule proven NOT to fire on real medical-curriculum vocabulary)
- 25 integration tests — `apps/api/test/app-store-readiness.integration.test.ts` (deletion, reporting, blocking, and the gate, all adversarial: wrong password, retry-after-success, duplicate reports, reporter-identity spoofing attempts, block-bypass attempts, moderation-bypass attempts)
- 12 unit tests carried over from the prior phase (`grading.test.ts`, unrelated to this pass but part of the green baseline)
- **13 unit + 3 integration tests** *(hardening pass)* — `apps/api/src/platform/__tests__/image-sanitize.test.ts`, `apps/api/test/upload-sanitization.integration.test.ts` (real GPS-bearing fixtures per format, orientation preservation, essential-metadata-kept positive controls, malformed-input robustness, end-to-end through the live HTTP upload and signed-URL-serving routes)
- **10 integration tests** *(hardening pass)* — `apps/api/test/password-reset.integration.test.ts` (non-enumeration, full lifecycle, single-use, supersede, expiry, session revocation, rate limiting)

## Full test results

| Suite | Result |
|---|---|
| `packages/core` unit | 270 / 270 passed (13 files) |
| `apps/api` unit | **39 / 39 passed** (3 files — was 26/2; +13 `image-sanitize` tests) |
| `apps/mobile` unit | 20 / 20 passed |
| `apps/api` integration (full suite, incl. migration path) | **293 / 293 passed** (16 files — was 280/14; +10 password-reset, +3 upload-sanitization) |
| `pnpm typecheck` (all packages + `typecheck:deploy`) | passed |
| `pnpm lint` | passed, 0 problems |
| Deployment package gate (`verify-function-package.mjs`) | **16/16** migrations packaged, 18/18 live-request checks passed |

No test written in an earlier commit on this branch was weakened or deleted to make a later one pass — verified by diff before this report was finalized.

## Native verification

| Check | Result |
|---|---|
| `pnpm typecheck` (apps/mobile) | ✓ |
| `pnpm lint` | ✓ |
| `npx expo-doctor` | 19/21 checks pass. 2 fail, both from this sandbox's network egress policy blocking calls to Expo's remote schema-validation and React Native Directory services — not project defects. Re-run in an environment with normal internet access before relying on it as a final gate. |
| `pnpm appstore:check` | Fails as designed — 4 required env vars unset (support/privacy URLs, production API address) and no app icon. Passes every other check (bundle identifier, build number, encryption declaration, privacy manifest presence, EAS profiles, no leaked credentials, typecheck). Re-verified after the hardening pass: same 5 failures, unaffected by it — confirmed by diff. See the live run below. |
| `expo prebuild --platform ios/android --no-install` *(hardening pass)* | **Actually run**, not reasoned about — see `08-HARDENING-PASS.md`. Produced a real `Info.plist`/`PrivacyInfo.xcprivacy`/`AndroidManifest.xml`, confirmed the app-level manifest projects correctly, and caught two unused permission declarations (fixed). `pod install` still cannot run here (needs CocoaPods/macOS) — see `NATIVE_PRIVACY_MANIFEST_NOT_YET_PROVEN` below. |
| `eas build --platform ios` | **IOS_BUILD_NOT_EXECUTED_EXTERNAL_CREDENTIAL_BLOCKER** — no Apple Developer account or EAS credentials available in this environment. Not attempted; not claimed. |

```
$ EXPO_PUBLIC_API_URL_PRODUCTION=https://api.studentos.example \
  SUPPORT_URL=https://studentos.example/support \
  PRIVACY_POLICY_URL=https://studentos.example/privacy \
  SUPPORT_EMAIL=support@studentos.example \
  pnpm appstore:check

  18 passed, 1 failed
  ✗ a real app icon is configured — no icon field — Apple rejects Expo's placeholder icon; WAITING_FOR_DESIGN_FINAL
```

With real (non-placeholder) values for the four support/API variables, **the only remaining code-level blocker is the app icon** — everything else the gate checks passes. This was true before the hardening pass and remains true after it: the pass closed code gaps that sat *beside* the gate's checks (EXIF stripping, password reset), not gaps the gate itself was reporting.

## Blockers

### CODE BLOCKERS

1. **App icon / splash screen.** No branded artwork exists in the repository. `pnpm appstore:check` hard-fails on this by design.
   - Evidence: `app.json` has no `icon` or `splash` field; `find apps/mobile -iname 'icon*.png'` returns nothing.
   - Next action: obtain final artwork from the concurrent Claude Design visual pass, add `icon.png` (1024×1024) and splash assets, reference them in `app.json`.

That is the only remaining code blocker. The two that were here before — password reset not existing, and the privacy manifest being reasoned-about rather than verified — were closed and advanced respectively in the pre-merge hardening pass; see `08-HARDENING-PASS.md` for exactly what changed and `03-PRIVACY-MANIFEST-AUDIT.md` for the privacy-manifest item's precise remaining scope (below, under EXTERNAL OWNER BLOCKERS).

### DESIGN BLOCKERS

1. **App icon and splash screen** — see CODE BLOCKERS #1; listed here too because the actual creation of the artwork is a design task, not an engineering one. This branch's engineering work (config wiring, the release-gate check) is complete; only the asset itself is missing.
2. **Screenshots** — explicitly not generated in this pass (`WAITING_FOR_DESIGN_FINAL`), to avoid producing App Store assets against a pre-redesign UI that would misrepresent the shipped app once Claude Design's work lands.

### EXTERNAL OWNER BLOCKERS

1. **Apple Developer Program membership + App Store Connect app record.** Required for `eas submit`, TestFlight, and App Review itself. Nothing in the repository can substitute for this.
2. **EAS/Apple credentials** (`appleId`, `ascAppId`, `appleTeamId`, and iOS signing certificates) — referenced by name in `eas.json`, not present. See `apps/mobile/EAS_SETUP.md` for the exact commands to provide them.
3. **Support URL, Privacy Policy URL, Terms URL, support email** — code-complete plumbing exists (`GET /v1/support/links`, the Settings screen, `pnpm appstore:check`'s enforcement); the actual values must be provided and the pages must exist. See `SUPPORT_REQUIREMENTS.md`.
4. **Xcode 26 / iOS 26 SDK compliance** for uploads from April 28, 2026 (confirmed live from Apple Developer News this session) — depends on the EAS build image at build time, not something this repository pins.
5. **Age-rating questionnaire submission** in App Store Connect, using the evidence prepared in `04-AGE-RATING.md` — Apple requires developer responses to the new questionnaire by January 31, 2026.
6. **`pod install` on a machine with Xcode and CocoaPods** *(hardening pass, narrowed from "no macOS toolchain at all")* — to confirm the real, aggregated `Pods/**/PrivacyInfo.xcprivacy` set matches `app.json`'s declaration. The app-level manifest is now verified correct (`08-HARDENING-PASS.md`); only the third-party aggregate remains unconfirmed, and only because it cannot exist before this step runs. Fold into the first real EAS/macOS build — see `03-PRIVACY-MANIFEST-AUDIT.md` for the exact commands.
7. **An email provider** *(hardening pass, new)* — password reset is code-complete and tested end-to-end, but no account currently exists with any provider (Resend, SES, SendGrid, or similar), so `apps/api/src/platform/mailer.ts`'s one integration point has nothing to call. Choosing a provider, provisioning an API key, and wiring it into `mailer.ts` (and the corresponding `platform/config.ts` env vars) is the only remaining step — everything upstream of delivery (token lifecycle, hashing, expiry, single-use enforcement, session revocation) does not need to change when this is wired in.

### LEGAL / POLICY REVIEW

1. **Privacy policy** — `PRIVACY_POLICY_DRAFT.md` is an engineering data-accuracy draft, explicitly not legal advice. Needs counsel review, a real legal entity name/address, and a decision on session-security data (IP/User-Agent) retention before publication.
2. **Terms of use / no-tolerance content policy text** — a link surface exists in the client; the actual policy document and an explicit "I agree" gesture at signup do not. Recommend addressing alongside the privacy policy review.

~~3. EXIF/GPS metadata in uploaded photos~~ — **closed in the pre-merge hardening pass.** Stripped server-side, unconditionally, for every upload. See `01-PRIVACY-DATA-MAP.md` and `08-HARDENING-PASS.md` §1. `PRIVACY_POLICY_DRAFT.md`'s photo-upload paragraph now states the true, current behaviour.

## What is genuinely done

Every P0 acceptance gate named in the original brief that could be verified in-repository is green: account deletion works end-to-end and is proven adversarially; report works and reaches a real moderator queue; block works server-side across messaging and is proven to resist bypass; UGC filtering is real, server-side, and proven to distinguish abuse from medical curriculum content rather than block by keyword; the privacy data inventory is a truthful accounting of what actually moves through the code, including remaining gaps (IP retention, third-party pod manifest aggregation) rather than a sanitized summary; privacy/support access exists in-app; the iOS release configuration refuses to ship with a localhost or cleartext API address; no secret or demo credential reaches the mobile bundle.

The pre-merge hardening pass added two more genuinely-closed gaps to that list — uploaded photos no longer carry GPS metadata into storage, and a user who forgets their password can recover their account through a real, tested, server-verified flow — and turned "the privacy manifest cannot be checked at all" into "the app-level manifest is verified correct; only the third-party pod aggregate awaits a machine with Xcode," which is a materially smaller, precisely-bounded remaining gap. Every test that existed before this pass remains green, and 26 more now exist and pass alongside them: **329 unit, 293 integration.**
