import {
  ApiBaseUrlError,
  isLoopbackApiUrl,
  resolveApiBaseUrl,
} from '../src/config/api-base-url.js';

/**
 * Refuses to start a web build that has not been told where its API lives.
 *
 * Run by `pnpm --filter @sos/mobile build:web` immediately before
 * `expo export`, so the failure happens in a terminal belonging to whoever is
 * building rather than in a browser belonging to a student.
 *
 * This is the *early* gate, not the only one. `expo export` invoked directly
 * skips it — and the bundle it produces still refuses to run, because the same
 * rule is applied inside the client at startup. Two gates, one rule: this file
 * and the client import the identical module, which is why the check can be
 * moved earlier without becoming a second opinion.
 *
 * Run with tsx, because it imports TypeScript that the Expo config loader
 * cannot (`require` does not resolve `.ts`).
 */

const url = process.env.EXPO_PUBLIC_API_URL;

try {
  const resolved = resolveApiBaseUrl({ configured: url, isDevelopmentBuild: false });

  if (isLoopbackApiUrl(resolved)) {
    /*
     * Deliberate for the end-to-end journeys, which bundle in production mode
     * against a local API on purpose. Said out loud so it cannot become a habit
     * — the accidental version of this is already impossible, since an unset
     * variable throws above.
     */
    process.stderr.write(
      `\n  ⚠  Bundling for production against a loopback API address (${resolved}).\n` +
        '     This bundle will only work on the machine that built it.\n\n',
    );
  } else {
    process.stdout.write(`  API address for this build: ${resolved}\n`);
  }
} catch (error) {
  if (error instanceof ApiBaseUrlError) {
    process.stderr.write(`\n  ✗ Refusing to build the web bundle.\n\n    ${error.message}\n\n`);
    process.exit(1);
  }
  throw error;
}
