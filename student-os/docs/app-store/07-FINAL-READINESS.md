# Final Readiness Report

```
APP_STORE_CODE_READY       = NO   (app icon/splash missing — see CODE/DESIGN blockers)
IOS_PRODUCTION_BUILD_PROVEN = NO  (no Apple/EAS credentials in this environment)
TESTFLIGHT_READY            = NO  (blocked by both of the above)
APP_REVIEW_READY            = NO  (blocked by all of the above, plus support URLs)
```

Everything that could be implemented inside the repository was implemented and proven with real tests against a real database and a real deployment-package bundler. What remains is genuinely outside the repository's reach: Apple account credentials, real branded artwork, and operator-provided URLs.

## Branch / commit

- Branch: `claude/app-store-readiness`
- Starting commit: `8d7541ddd7e405982fc1901f8d4318b8aa7d03d4` (`origin/main`)
- HEAD at this report: see `git log -1` — two commits on this branch (P0 capabilities, then this documentation/config pass)

## Files changed (by area)

- **Account deletion**: `apps/api/src/modules/account/*`, `apps/api/migrations/0015_moderation_and_deletion.sql`, `apps/mobile/app/settings/*`
- **Moderation gate**: `packages/core/src/moderation/moderation.ts`, wired into `content.service.ts`, `comments.service.ts`, `conversations.service.ts`
- **Report/block UI**: `apps/mobile/src/components/{ActionSheet,ReportSheet}.tsx`, `apps/mobile/app/profile/[handle].tsx`, `apps/mobile/app/post/[id].tsx`
- **Support links**: `apps/api/src/modules/account/support.service.ts`, `apps/mobile/src/state/support-links.ts`
- **iOS config**: `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `apps/mobile/EAS_SETUP.md`
- **Release gate**: `scripts/appstore-check.mjs`, wired as `pnpm appstore:check`
- **Docs**: `docs/app-store/*` (this directory)

## Migrations added

- `0015_moderation_and_deletion.sql` — `moderation_terms` (lexicon, seeded with 13 slur-only rows), `moderation_decisions` (gate audit trail), `account_deletions` (one-way deletion receipt), plus two indexes on `reports` for queue performance.

## New endpoints

- `DELETE /v1/me/account`
- `GET /v1/me/blocks`
- `GET /v1/support/links`
- `GET /v1/moderation/reports`
- `POST /v1/moderation/reports/:reportId/resolve`
- (existing `POST /v1/reports` extended to accept `targetType: 'message'`)

## New tests

- 33 unit tests — `packages/core/src/moderation/__tests__/moderation.test.ts` (the gate: slurs, threats, self-harm, sexual harassment, spam, and — critically — every rule proven NOT to fire on real medical-curriculum vocabulary)
- 25 integration tests — `apps/api/test/app-store-readiness.integration.test.ts` (deletion, reporting, blocking, and the gate, all adversarial: wrong password, retry-after-success, duplicate reports, reporter-identity spoofing attempts, block-bypass attempts, moderation-bypass attempts)
- 12 unit tests carried over from the prior phase (`grading.test.ts`, unrelated to this pass but part of the green baseline)

## Full test results

| Suite | Result |
|---|---|
| `packages/core` unit | 270 / 270 passed (13 files) |
| `apps/api` unit | 26 / 26 passed |
| `apps/mobile` unit | 20 / 20 passed |
| `apps/api` integration (full suite, incl. migration path) | **280 / 280 passed** (14 files) |
| `pnpm typecheck` (all packages + `typecheck:deploy`) | passed |
| `pnpm lint` | passed, 0 problems |
| Deployment package gate (`verify-function-package.mjs`) | 15/15 migrations packaged, 18/18 live-request checks passed |

## Native verification

| Check | Result |
|---|---|
| `pnpm typecheck` (apps/mobile) | ✓ |
| `pnpm lint` | ✓ |
| `npx expo-doctor` | 19/21 checks pass. 2 fail, both from this sandbox's network egress policy blocking calls to Expo's remote schema-validation and React Native Directory services — not project defects. Re-run in an environment with normal internet access before relying on it as a final gate. |
| `pnpm appstore:check` | Fails as designed — 4 required env vars unset (support/privacy URLs, production API address) and no app icon. Passes every other check (bundle identifier, build number, encryption declaration, privacy manifest presence, EAS profiles, no leaked credentials, typecheck). See the live run below. |
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

With real (non-placeholder) values for the four support/API variables, **the only remaining code-level blocker is the app icon** — everything else the gate checks passes.

## Blockers

### CODE BLOCKERS

1. **App icon / splash screen.** No branded artwork exists in the repository. `pnpm appstore:check` hard-fails on this by design.
   - Evidence: `app.json` has no `icon` or `splash` field; `find apps/mobile -iname 'icon*.png'` returns nothing.
   - Next action: obtain final artwork from the concurrent Claude Design visual pass, add `icon.png` (1024×1024) and splash assets, reference them in `app.json`.

2. **Password reset flow does not exist.** Not an Apple guideline requirement directly, but a real product gap: a user who forgets their password cannot re-authenticate to delete their own account either.
   - Evidence: no `/v1/auth/forgot-password` or equivalent route in `apps/api/src/modules/auth/`.
   - Next action: implement email-based password reset (out of this pass's P0 scope; recommend as the next engineering priority after this branch merges).

3. **Privacy manifest not verified against a real prebuild.** The declared `NSPrivacyAccessedAPITypes` are reasoned from known Expo/React Native behaviour, not confirmed against an actual `expo prebuild` + Xcode archive (no macOS toolchain in this environment). See `03-PRIVACY-MANIFEST-AUDIT.md`.

### DESIGN BLOCKERS

1. **App icon and splash screen** — see CODE BLOCKERS #1; listed here too because the actual creation of the artwork is a design task, not an engineering one. This branch's engineering work (config wiring, the release-gate check) is complete; only the asset itself is missing.
2. **Screenshots** — explicitly not generated in this pass (`WAITING_FOR_DESIGN_FINAL`), to avoid producing App Store assets against a pre-redesign UI that would misrepresent the shipped app once Claude Design's work lands.

### EXTERNAL OWNER BLOCKERS

1. **Apple Developer Program membership + App Store Connect app record.** Required for `eas submit`, TestFlight, and App Review itself. Nothing in the repository can substitute for this.
2. **EAS/Apple credentials** (`appleId`, `ascAppId`, `appleTeamId`, and iOS signing certificates) — referenced by name in `eas.json`, not present. See `apps/mobile/EAS_SETUP.md` for the exact commands to provide them.
3. **Support URL, Privacy Policy URL, Terms URL, support email** — code-complete plumbing exists (`GET /v1/support/links`, the Settings screen, `pnpm appstore:check`'s enforcement); the actual values must be provided and the pages must exist. See `SUPPORT_REQUIREMENTS.md`.
4. **Xcode 26 / iOS 26 SDK compliance** for uploads from April 28, 2026 (confirmed live from Apple Developer News this session) — depends on the EAS build image at build time, not something this repository pins.
5. **Age-rating questionnaire submission** in App Store Connect, using the evidence prepared in `04-AGE-RATING.md` — Apple requires developer responses to the new questionnaire by January 31, 2026.

### LEGAL / POLICY REVIEW

1. **Privacy policy** — `PRIVACY_POLICY_DRAFT.md` is an engineering data-accuracy draft, explicitly not legal advice. Needs counsel review, a real legal entity name/address, and a decision on session-security data (IP/User-Agent) retention before publication.
2. **Terms of use / no-tolerance content policy text** — a link surface exists in the client; the actual policy document and an explicit "I agree" gesture at signup do not. Recommend addressing alongside the privacy policy review.
3. **EXIF/GPS metadata in uploaded photos** — not stripped server-side (`docs/app-store/01-PRIVACY-DATA-MAP.md`). Either fix server-side or disclose explicitly in the privacy policy; currently neither is done. This is a genuine user-privacy gap, not just a metadata-accuracy one, and should be prioritized before the app ships broadly.

## What is genuinely done

Every P0 acceptance gate named in the brief that could be verified in-repository is green: account deletion works end-to-end and is proven adversarially; report works and reaches a real moderator queue; block works server-side across messaging and is proven to resist bypass; UGC filtering is real, server-side, and proven to distinguish abuse from medical curriculum content rather than block by keyword; the privacy data inventory is a truthful accounting of what actually moves through the code, including the gaps (EXIF, IP retention) rather than a sanitized summary; privacy/support access exists in-app; the iOS release configuration refuses to ship with a localhost or cleartext API address; no secret or demo credential reaches the mobile bundle; the privacy manifest is evidence-based where it can be, and honestly flagged where it cannot yet be confirmed; and every existing test — 316 unit, 280 integration — remains green.
