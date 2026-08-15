# EAS build & submit setup

`eas.json` in this directory defines three build profiles. This file states
what is configured, what is a placeholder, and exactly what the account owner
must do before a real build can run.

## What's configured

| Profile | Purpose | Distribution |
| --- | --- | --- |
| `development` | A dev client for local testing against `localhost:4000` | internal |
| `preview` | An internal TestFlight-style build against a staging API | internal |
| `production` | The App Store submission build | store |

`production` sets `"autoIncrement": "buildNumber"` so every build gets a
fresh `CFBundleVersion` without a manual edit to `app.json` — App Store
Connect rejects a re-upload at the same build number.

## EXTERNAL_OWNER_ACTION_REQUIRED

1. **`EXPO_PUBLIC_API_URL_PREVIEW` / `EXPO_PUBLIC_API_URL_PRODUCTION`.**
   `eas.json` references these by name in each profile's `env` block. They
   are not committed — the app's own build-time gate
   (`app.config.ts:assertNativeProductionApiUrl`) refuses a `production`
   build with no value, a loopback address, or a non-HTTPS URL, so a missing
   or wrong value fails the build loudly rather than shipping a broken
   binary. Set the real values with:

   ```sh
   eas env:create --scope project --name EXPO_PUBLIC_API_URL_PRODUCTION \
     --value https://<the real production API host> --environment production --visibility plaintext
   eas env:create --scope project --name EXPO_PUBLIC_API_URL_PREVIEW \
     --value https://<a staging or deploy-preview API host> --environment preview --visibility plaintext
   ```

   Confirm the exact `eas env:create` flags against the CLI installed
   (`eas env:create --help`) — EAS's environment-variable surface has
   changed across CLI versions and this was not runnable in this sandbox
   (no network egress to the EAS API, no Apple/Expo account).

2. **Apple Developer Program membership and App Store Connect record.**
   `eas.json`'s `submit.production.ios` needs `appleId`, `ascAppId` and
   `appleTeamId`. None of these can be produced from the repository — they
   come from an active paid Apple Developer account and an app record
   created in App Store Connect. Set them with `eas env:create` the same way,
   or run `eas submit` interactively the first time and let it store them.

3. **Signing.** `eas build` can generate and manage iOS signing credentials
   automatically (`eas credentials`) the first time it runs against a real
   Apple Developer account. Nothing in the repository holds a certificate or
   provisioning profile, and nothing should.

4. **App icon and splash screen.** `app.json` does not reference an `icon` or
   `splash` field — there is no branded artwork in the repository yet.
   Apple rejects a submission using Expo's placeholder icon. This is marked
   `WAITING_FOR_DESIGN_FINAL` — see `docs/app-store/07-FINAL-READINESS.md`.

## Running a build once the above is done

```sh
cd apps/mobile
eas build --platform ios --profile production
```

## Submitting (do not run until the account owner has reviewed App Store Connect metadata)

```sh
eas submit --platform ios --profile production
```

Never run `eas submit` as part of an automated pipeline without a human
confirming the App Store Connect listing (screenshots, description, age
rating, pricing) is what is meant to ship — `eas submit` uploads a binary for
review, it does not itself publish the app.
