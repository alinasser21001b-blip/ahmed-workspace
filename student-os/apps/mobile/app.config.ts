import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo config, computed rather than static.
 *
 * `app.json` remains the home of everything fixed about the app — name, slug,
 * plugins, bundle identifiers. This file exists for the one field that is not
 * fixed: where the client sends its requests.
 *
 * That field used to be a literal in `app.json`:
 *
 *     "extra": { "apiBaseUrl": "http://localhost:4000" }
 *
 * and the client read `extra` *before* `EXPO_PUBLIC_API_URL`, so the environment
 * variable was inert. Exporting with `EXPO_PUBLIC_API_URL=https://api.example`
 * produced a bundle containing zero occurrences of that host and two of
 * `localhost:4000` — the documented way to configure the client did nothing, and
 * every build of every kind shipped addressed to the machine that made it.
 *
 * A static file cannot hold a value that differs per environment, so the field
 * moved to where the environment can be read.
 *
 * Deliberately no validation here, and no default. This file is transpiled and
 * evaluated by `require`, which cannot resolve a relative `.ts` import, so it
 * cannot share the rule in `src/config/api-base-url.ts` — and a second copy of
 * a security rule is worse than none, because the copies drift. Enforcement
 * therefore lives in the two places that can hold the real one:
 *
 *   * `scripts/check-api-url.ts`, run before `expo export` by the `build:web`
 *     script, so a misconfigured build fails before it produces an artifact;
 *   * `src/state/session.tsx`, inside the bundle, where `__DEV__` is a compile
 *     -time literal and a production build with no address throws instead of
 *     quietly addressing localhost. That one cannot be bypassed by invoking the
 *     Expo CLI directly, which is what makes it the guarantee rather than the
 *     convenience.
 *
 * No fallback is the whole point: an unset variable must stay visibly unset all
 * the way to the check that refuses it.
 *
 * The key is OMITTED when unset rather than set to `null`, because Expo
 * serialises `null` in `extra` as `{}` — an empty object, which is truthy, and
 * which then reaches the client looking like a configured value. That produced
 * a `TypeError` deep in the resolver instead of the sentence explaining which
 * variable to set. An absent key survives the round trip as `undefined`, which
 * is what "nobody configured this" is supposed to look like.
 */
/*
 * The native half of the same guarantee `check-api-url.ts` gives the web
 * build (App Store readiness — no localhost or cleartext HTTP in a shipped
 * binary).
 *
 * `same-origin` — the web build's whole answer — cannot apply here: a native
 * app has no page and therefore no origin to inherit, which
 * `resolveApiBaseUrl` already refuses at runtime. What was missing is a gate
 * BEFORE the binary is produced, so a misconfigured `eas build` fails in a
 * terminal rather than shipping a build that fails every request on a
 * reviewer's device.
 *
 * Scoped to `EAS_BUILD_PROFILE`, which EAS sets only while it is actually
 * building — never during `expo start` or a local `expo prebuild` a developer
 * runs to inspect the native project. Those must keep working without a
 * production API address configured.
 */
const LOOPBACK_HOST = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:$|\/)/i;

function assertNativeProductionApiUrl(profile: string | undefined, apiBaseUrl: string | undefined): void {
  if (!profile) return; // Not an EAS build — a local prebuild/dev inspection.
  if (profile !== 'production') return; // Preview/dev EAS profiles may point at a staging host.

  if (!apiBaseUrl) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set for an EAS production build. A native build has no page ' +
        'to infer an origin from — set it explicitly to the production API’s HTTPS URL in ' +
        'eas.json (build.production.env.EXPO_PUBLIC_API_URL) or the EAS project’s environment ' +
        'variables before building.',
    );
  }
  if (apiBaseUrl.trim().toLowerCase() === 'same-origin') {
    throw new Error(
      'EXPO_PUBLIC_API_URL is "same-origin" for a native production build. That setting only ' +
        'means anything in a browser; a native build must be given the API’s actual HTTPS URL.',
    );
  }
  if (LOOPBACK_HOST.test(apiBaseUrl.trim())) {
    throw new Error(
      `EXPO_PUBLIC_API_URL is "${apiBaseUrl}" for a native production build — a loopback ` +
        'address that only means anything on the machine that built it. Refusing to produce ' +
        'a binary that would only work on this machine.',
    );
  }
  if (!/^https:\/\//i.test(apiBaseUrl.trim())) {
    throw new Error(
      `EXPO_PUBLIC_API_URL is "${apiBaseUrl}" for a native production build — not HTTPS. iOS ` +
        'App Transport Security refuses cleartext HTTP by default, so this build would fail ' +
        'every request on-device.',
    );
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;
  assertNativeProductionApiUrl(process.env.EAS_BUILD_PROFILE, apiBaseUrl);
  return {
    ...config,
    name: config.name ?? 'Student OS',
    slug: config.slug ?? 'student-os',
    extra: { ...config.extra, ...(apiBaseUrl ? { apiBaseUrl } : {}) },
  };
};
