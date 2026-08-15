# Privacy Manifest Audit

## What was checked

`apps/mobile/app.json`'s `expo.ios.privacyManifests` field, and the Required Reason API categories Expo/React Native's own runtime is documented to touch, per Apple's `NSPrivacyAccessedAPIType` taxonomy fetched live from `developer.apple.com` this session.

## What could not be checked, and why

This environment has no macOS toolchain and no Xcode — `expo prebuild --platform ios` cannot produce a real native project here, and without one there is no `ios/` directory, no `Pods/` tree, and no way to run `find . -name '*.xcprivacy'` against actual compiled dependencies to confirm which Required Reason APIs are genuinely present in the linked binary. This is stated plainly rather than worked around with an unverifiable guess.

## What was declared, and the reasoning

```json
"privacyManifests": {
  "NSPrivacyAccessedAPITypes": [
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp", "NSPrivacyAccessedAPITypeReasons": ["C617.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace", "NSPrivacyAccessedAPITypeReasons": ["E174.1"] }
  ]
}
```

- **UserDefaults (`CA92.1`)** — React Native core and several Expo modules (notably `expo-constants`, `AsyncStorage`-adjacent code paths inside Expo's own runtime) read `NSUserDefaults` for internal bookkeeping (app version checks, module registration state). Reason `CA92.1` ("access user defaults to read/write information that is only accessible to the app itself") matches this use — the app does not read another app's or the system's UserDefaults for cross-app data.
- **File timestamp (`C617.1`)** — Metro's bundled JS runtime and Expo's asset-resolution code check file modification times during app startup for cache validation. Reason `C617.1` covers this ("access timestamps of files inside the app container, bundle, or app group").
- **Disk space (`E174.1`)** — `expo-file-system` (a transitive dependency of several Expo modules used here, including `expo-image-picker`'s temp-file handling) checks available disk space before writing. Reason `E174.1` covers checking space to confirm there's enough before performing an operation.

None of these are declared speculatively from an example — each is tied to a specific, real code path this product's dependency tree exercises (React Native core, Expo's constants/asset system, `expo-image-picker`'s temp file handling). But **the exact set present in the final linked binary depends on the specific transitive dependency versions resolved at build time**, which is exactly what only a real `expo prebuild` + Xcode archive can confirm.

## Third-party SDK privacy manifests / signatures

Apple maintains a list of SDKs (`developer.apple.com/support/third-party-SDK-requirements/`) that must ship their own signed privacy manifest. This list includes entries relevant to a React Native app in general — **React Native/Hermes** is explicitly named on Apple's list. Expo's own build pipeline (EAS Build) is responsible for including Hermes's manifest when it links the engine; this repository does not vendor Hermes directly and has no action to take beyond keeping the Expo SDK current.

None of the other ~80 SDKs on Apple's list (Firebase, Facebook SDKs, Google Sign-In, Alamofire, Realm, etc.) are dependencies of this project — confirmed by the full `apps/mobile/package.json` read in `01-PRIVACY-DATA-MAP.md`.

## Required follow-up before submission

**EXTERNAL_OWNER_ACTION_REQUIRED:** run `npx expo prebuild --platform ios --clean` on a machine with Xcode, then `find ios -name '*.xcprivacy'` and diff the actual declared reasons against every Required Reason API call site the resulting `Pods/` tree exercises (searchable via `grep -r` for the relevant Foundation APIs — `NSUserDefaults`, `NSFileManager` timestamp/size accessors, `NSProcessInfo.systemUptime` for boot time). Correct `app.json`'s `privacyManifests` block to match exactly what the real build uses — remove any category not actually touched, add any that is.
