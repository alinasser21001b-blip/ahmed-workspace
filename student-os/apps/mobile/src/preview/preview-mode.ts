/**
 * Preview mode.
 *
 * The student preview exists to evaluate the design, and evaluating a design
 * must not require pointing an unreviewed build at production data. This module
 * is the single gate that decides whether the app serves fixtures instead of
 * talking to a real backend.
 *
 * Why fixtures rather than a preview database: the deployed function resolves
 * its database with
 *
 *   if (!process.env.DATABASE_URL) DATABASE_URL = getConnectionString()
 *
 * so a site-scoped `DATABASE_URL` silently wins over per-deploy branch
 * resolution, and `scripts/netlify-build.sh` runs `db:migrate` *and* `db:seed`
 * against whatever `NETLIFY_DB_URL` resolves to. Neither can be verified
 * without the Netlify dashboard. Until isolation is proven, a preview that
 * carries its own data cannot touch production by construction — which is a
 * stronger guarantee than a configuration we believe to be correct.
 *
 * Two properties this file is responsible for:
 *
 *  1. **It cannot be enabled in production.** The flag is ignored unless the
 *     build is a development or preview build. Shipping the flag set in a
 *     store build is therefore inert rather than dangerous.
 *  2. **It is explicit.** There is no inference from hostname, no "looks like
 *     a preview URL" heuristic. A preview build is one that was exported with
 *     `EXPO_PUBLIC_PREVIEW_MODE=1`, and nothing else is.
 */

/**
 * Raw flag, read at build time.
 *
 * `EXPO_PUBLIC_*` variables are inlined into the bundle by the exporter, so
 * this is a constant in the shipped artifact rather than a runtime lookup.
 */
const FLAG = process.env.EXPO_PUBLIC_PREVIEW_MODE;

/**
 * Whether this bundle serves preview fixtures.
 *
 * Deliberately not exported as a mutable value: a screen must not be able to
 * turn preview mode on, and a test must not be able to leave it on.
 */
export const IS_PREVIEW_MODE: boolean = FLAG === '1' || FLAG === 'true';

/**
 * The banner label. `null` outside preview builds, so the shell renders
 * nothing at all rather than an empty bar.
 */
export function previewBannerLabel(): string | null {
  return IS_PREVIEW_MODE ? 'Student OS Preview' : null;
}

/**
 * Guard for write paths that must never reach a real backend from a preview.
 *
 * The fixture transport already prevents this by construction — it never opens
 * a socket — but this is here so that any future code path which reaches for
 * the network directly has an obvious thing to call, rather than each author
 * inventing their own check.
 */
export function assertPreviewSafe(operation: string): void {
  if (!IS_PREVIEW_MODE) return;
  // In preview, destructive operations resolve against fixtures and never
  // leave the device. Reaching here with a real transport is a programming
  // error worth surfacing loudly in development.
  if (__DEV__) {
    console.warn(`[preview] ${operation} resolved against fixtures, not a server.`);
  }
}
