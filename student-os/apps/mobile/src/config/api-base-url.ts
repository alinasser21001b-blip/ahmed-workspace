/**
 * Where the client sends its requests.
 *
 * A web bundle has no environment. Whatever this resolves to is frozen into the
 * JavaScript at export time and cannot be corrected afterwards without building
 * again — which is precisely why getting it wrong used to be so quiet.
 *
 * The defect this file exists to close had two halves, and the second was worse
 * than the first:
 *
 *   1. the resolution chain ended in an unconditional `?? 'http://localhost:4000'`,
 *      so a production export that forgot its configuration shipped an app that
 *      loaded normally and then failed every request — indistinguishable, from
 *      the outside, from the backend being down;
 *   2. `app.json` hardcoded `extra.apiBaseUrl` to localhost, and `extra` was read
 *      FIRST, so `EXPO_PUBLIC_API_URL` was never consulted at all. Exporting with
 *      `EXPO_PUBLIC_API_URL=https://api.example` produced a bundle containing
 *      zero occurrences of that host and two of `localhost:4000`. The documented
 *      way to configure the client did nothing.
 *
 * So there is now exactly one source — `EXPO_PUBLIC_API_URL`, read at build time
 * — and no silent default outside development. A build that does not say where
 * its API lives does not become a build.
 *
 * Kept dependency-free on purpose: `app.config.ts` imports it in Node while the
 * client imports it inside the bundle, and the rule has to be the same one in
 * both places rather than two copies that drift.
 */

/** The development default. Only ever applied to a development build. */
export const DEV_API_BASE_URL = 'http://localhost:4000';

/**
 * Hosts that only mean anything on the machine that built the bundle.
 *
 * `0.0.0.0` is included because it is a bind address rather than a destination:
 * a client that requests it is asking its own machine, which is the same defect
 * wearing a different number.
 */
const LOOPBACK_HOST = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:$|\/)/i;

export function isLoopbackApiUrl(url: string): boolean {
  return LOOPBACK_HOST.test(url.trim());
}

export class ApiBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiBaseUrlError';
  }
}

export interface ResolveApiBaseUrlInput {
  /**
   * `EXPO_PUBLIC_API_URL`, or the value baked into `extra.apiBaseUrl` from it.
   *
   * Typed loosely, and checked at runtime, because it arrives through Expo's
   * config serialisation rather than from TypeScript's world: a `null` written
   * into `extra` comes back out as `{}`. The type says what should arrive; the
   * check below survives what actually does.
   */
  configured: unknown;
  /**
   * Whether this is a development build.
   *
   * At runtime this is Metro's `__DEV__`, which is compiled to a literal and is
   * `false` in anything `expo export` produces — so it cannot be spoofed by an
   * environment variable at deploy time, which is what makes it trustworthy
   * here. At build time it is whether the command is a dev server rather than
   * an export.
   */
  isDevelopmentBuild: boolean;
  /** Named in error messages so the reader is told which knob to turn. */
  variableName?: string;
}

/**
 * The one rule, applied identically at build time and at runtime.
 *
 * Throws rather than falling back, because the whole point is that there is no
 * fallback to fall back to. A misconfigured production build should be a loud
 * failure at the earliest possible moment — ideally during `expo export`, where
 * nobody is affected — and never a quiet one in a user's browser.
 */
export function resolveApiBaseUrl(input: ResolveApiBaseUrlInput): string {
  const variable = input.variableName ?? 'EXPO_PUBLIC_API_URL';
  // Anything that is not a non-empty string counts as "nobody configured this",
  // including the `{}` Expo produces from a null in `extra`.
  const configured = typeof input.configured === 'string' ? input.configured.trim() : '';

  if (!configured) {
    if (input.isDevelopmentBuild) return DEV_API_BASE_URL;
    throw new ApiBaseUrlError(
      `${variable} was not set when this bundle was built. A production build has ` +
        'no environment to read at runtime, so the API address has to be baked in ' +
        `at build time. Set ${variable} and build again.`,
    );
  }

  if (!/^https?:\/\//i.test(configured)) {
    throw new ApiBaseUrlError(
      `${variable} must be an absolute http(s) URL — received ${JSON.stringify(configured)}.`,
    );
  }

  // Trailing slashes produce `//v1/...` once a path is appended.
  return configured.replace(/\/+$/, '');
}

/**
 * Whether a resolved URL deserves a warning rather than a refusal.
 *
 * Loopback in a non-development build is *usually* a mistake, but not always: the
 * end-to-end journeys export a production-mode bundle deliberately pointed at a
 * local API, and failing that would mean the browser tests could never run
 * against a real bundle. Since it can only happen when somebody typed the
 * address themselves, it is a warning — the accidental case, an address nobody
 * chose, is already impossible above.
 */
export function shouldWarnAboutLoopback(url: string, isDevelopmentBuild: boolean): boolean {
  return !isDevelopmentBuild && isLoopbackApiUrl(url);
}
