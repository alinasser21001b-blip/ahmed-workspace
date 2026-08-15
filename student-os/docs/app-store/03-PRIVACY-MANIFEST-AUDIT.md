# Privacy Manifest Audit

## Status: `NATIVE_PRIVACY_MANIFEST_NOT_YET_PROVEN`

Upgraded from "could not be checked at all" (original pass) to "verified as far as this environment allows, gap precisely bounded" (pre-merge hardening pass — see `08-HARDENING-PASS.md`). This environment has no macOS toolchain, no Xcode, and no CocoaPods binary — the one thing a real `expo prebuild` cannot do here is `pod install`, and everything below is organised around exactly that line.

## What was actually run, this pass

```
$ npx expo prebuild --platform ios --no-install
✔ Created native directory (./ios)
✔ Finished prebuild

$ npx expo prebuild --platform android --no-install
✔ Finished prebuild
```

This genuinely produces a real native project — `ios/StudentOS/Info.plist`, `ios/StudentOS/PrivacyInfo.xcprivacy`, `ios/Podfile`, `ios/Podfile.properties.json`, and the equivalent `android/app/src/main/AndroidManifest.xml` — by running every Expo config plugin this project declares against the real `app.json`. `--no-install` is the only concession to this environment: it skips `pod install`, which needs CocoaPods and, in practice, macOS. Nothing else about this step is a simulation. (The generated `ios/` and `android/` directories are build output, not committed — see `.gitignore`; reproduce with the commands above.)

## What this proved

**The app-level `PrivacyInfo.xcprivacy` is correct.** The generated file matches `app.json`'s `ios.privacyManifests` declaration exactly:

```xml
<key>NSPrivacyAccessedAPITypes</key>
<array>
  <dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryUserDefaults</string>
        <key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array></dict>
  <dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
        <key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array></dict>
  <dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryDiskSpace</string>
        <key>NSPrivacyAccessedAPITypeReasons</key><array><string>E174.1</string></array></dict>
</array>
<key>NSPrivacyCollectedDataTypes</key><array/>
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyTrackingDomains</key><array/>
```

This confirms the JSON-to-plist projection Expo's config plugin performs is exactly what was intended — a mechanical step that had never actually been run before this pass, only reasoned about.

**A real permission audit found and fixed two unused entitlements.** Reading the generated `Info.plist` (not the source config — the actual output) surfaced two usage-description strings that had no business being there:

| Key | Source | Why it was wrong | Fix |
|---|---|---|---|
| `NSFaceIDUsageDescription` | `expo-secure-store`'s config plugin adds this by default whenever the plugin runs — it does not require the app to actually request biometric-gated Keychain access | `apps/mobile/src/state/session.tsx`'s `SecureStore.getItemAsync/setItemAsync/deleteItemAsync` calls take no options and never request `requireAuthentication` | `app.json`: `["expo-secure-store", { "faceIDPermission": false }]` |
| `NSMicrophoneUsageDescription` | `expo-image-picker`'s config plugin defaults `microphonePermission` to a generic string; the existing config only disabled `cameraPermission`, not this | The product has no audio-recording feature — `cameraPermission` was already `false`, but the equivalent microphone flag had never been set | `app.json`: added `"microphonePermission": false` next to the existing `"cameraPermission": false` |

Re-ran `expo prebuild` after the fix and confirmed by reading the regenerated `Info.plist` directly: neither key is present; only `NSPhotoLibraryUsageDescription` remains, which is the one permission this app genuinely uses. The Android manifest was checked the same way — `RECORD_AUDIO` and `CAMERA` both appear with `tools:node="remove"`, confirming the same fix blocks both platforms via the shared plugin mechanism (`applyPermissions()` in `@expo/config-plugins`: setting a permission key to `false` deletes it from the manifest rather than filling in a description).

This is exactly the class of finding Guideline 5.1.1 exists to catch — "don't request access to data not used by the app" — caught here by actually generating the artifact Apple reviews, not by reasoning about what the config *should* produce.

**Privacy manifest aggregation is enabled by default, for whatever ships from CocoaPods.** `ios/Podfile`'s `use_react_native!` call includes `:privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false'` — and `Podfile.properties.json` does not set that key, so it defaults to **enabled**. This is React Native's own (Meta-maintained) mechanism for collecting `PrivacyInfo.xcprivacy` files out of every linked CocoaPod at build time. It does not remove the need to verify the result, but it means the *aggregation step itself* does not need to be built or configured by this project — it is already on.

## What remains genuinely unverified, and exactly why

`ios/Podfile` resolves its pod list **programmatically**, at `pod install` time, via `use_expo_modules!` and `use_native_modules!` — both shell out to `expo-modules-autolinking` to compute the dependency graph. There is no static list of pods to read out of the Podfile; the actual set of linked native dependencies, and therefore the actual set of `Pods/**/PrivacyInfo.xcprivacy` files aggregation would collect, **only exists after `pod install` runs**, which needs CocoaPods and, for a project this size with native modules, realistically needs macOS. This is the one link in the chain this environment cannot forge, and it is a different, narrower gap than the original pass's "nothing has been verified" — the app-level manifest is proven correct; only the *third-party aggregate* is unconfirmed.

**`NATIVE_PRIVACY_MANIFEST_NOT_YET_PROVEN`** stands until someone runs, on a machine with Xcode and CocoaPods (this is also the very first EAS/macOS native build, so folding this into that step costs nothing extra):

```sh
cd apps/mobile
npx expo prebuild --platform ios --clean   # full run this time, no --no-install
find ios/Pods -name 'PrivacyInfo.xcprivacy' -exec echo {} \; -exec cat {} \;
```

Then, for each Required-Reason API category that shows up in a pod's manifest but is not already declared in `app.json`'s `ios.privacyManifests`, either add it (with the correct approved reason code for the actual use) or investigate why that pod is touching it. And the reverse check matters too: if a category this project currently declares (UserDefaults / FileTimestamp / DiskSpace) turns out not to be touched by anything in the real `Pods/` tree, remove it — an over-broad declaration is not conservative, it is inaccurate.

## Third-party SDK privacy manifests / signatures

Apple maintains a list of SDKs (`developer.apple.com/support/third-party-SDK-requirements/`) that must ship their own signed privacy manifest. **React Native/Hermes** is explicitly named on that list. Expo's build pipeline (EAS Build) is responsible for including Hermes's manifest when it links the engine; this repository does not vendor Hermes directly and has no action to take beyond keeping the Expo SDK current.

None of the other ~80 SDKs on Apple's list (Firebase, Facebook SDKs, Google Sign-In, Alamofire, Realm, etc.) are dependencies of this project — confirmed by the full `apps/mobile/package.json` read in `01-PRIVACY-DATA-MAP.md`, and unchanged by this pass.

## Required follow-up before submission

**EXTERNAL_OWNER_ACTION_REQUIRED:** the `pod install`-dependent verification above. Everything else in this document that could be produced without Xcode has been.
