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
export default ({ config }: ConfigContext): ExpoConfig => {
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL;
  return {
    ...config,
    name: config.name ?? 'Student OS',
    slug: config.slug ?? 'student-os',
    extra: { ...config.extra, ...(apiBaseUrl ? { apiBaseUrl } : {}) },
  };
};
