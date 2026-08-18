// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro configuration.
 *
 * Its one job here is keeping the preview world out of real student builds.
 *
 * `EXPO_PUBLIC_PREVIEW_MODE` already decides at runtime whether the app serves
 * fixtures, and it fails closed. What it could not do on its own is keep the
 * preview material out of the *bundle*: Metro walks the whole module graph
 * before any constant folding, so an unconditional import of the fixture
 * transport, the always-mounted preview banner, or the feedback route all
 * shipped their full source — invented students, marketing copy, a working
 * form — as unreachable but readable code on every student's device, even
 * though the runtime flag correctly kept every one of them inert.
 *
 * So the exclusion happens where module resolution happens, for every file in
 * this list. In a build that was not exported with the preview flag, each one
 * resolves to a minimal stub instead of its real implementation; in a preview
 * export the resolver stands aside and the real modules load exactly as
 * before.
 *
 * Matching is done on the RESOLVED ABSOLUTE FILE PATH, not on the literal
 * import specifier. An earlier version of this file matched specifier
 * strings directly (`'./fixture-transport'`, `'../preview/fixture-transport'`,
 * …), which meant a harmless-looking change to an import path — an added
 * `../`, a different relative depth, a barrel re-export — could silently fall
 * outside the allowlist and ship the real module again with nothing to notice.
 * Resolving first and then checking the real file that resolution landed on
 * closes that hole: however a module is reached, if it IS one of the files
 * below, it is swapped.
 *
 * This is deliberately a *build-time* decision keyed to the same flag as
 * everything else, so there is one answer to "is this a preview?" rather than
 * two that can disagree. `e2e/bundle-cleanliness.mjs` asserts the outcome
 * against the exported artifact, because a resolver rule nobody checks is a
 * comment.
 */
const flag = process.env.EXPO_PUBLIC_PREVIEW_MODE;
const isPreviewBuild = flag === '1' || flag === 'true';

const config = getDefaultConfig(__dirname);

if (!isPreviewBuild) {
  // real absolute path -> stub absolute path
  const SWAPS = new Map([
    [
      path.resolve(__dirname, 'src/preview/fixture-transport.ts'),
      path.resolve(__dirname, 'src/preview/fixture-transport.stub.ts'),
    ],
    [
      path.resolve(__dirname, 'src/preview/PreviewBanner.tsx'),
      path.resolve(__dirname, 'src/preview/PreviewBanner.stub.tsx'),
    ],
    [
      path.resolve(__dirname, 'app/preview-feedback.tsx'),
      path.resolve(__dirname, 'src/preview/preview-feedback-route.stub.tsx'),
    ],
  ]);
  // `fixtures.ts` has no direct importer outside `fixture-transport.ts`
  // itself, so swapping that one entry point is enough to drop it from the
  // graph — but it is matched too, in case that ever stops being true.
  SWAPS.set(
    path.resolve(__dirname, 'src/preview/fixtures.ts'),
    path.resolve(__dirname, 'src/preview/fixture-transport.stub.ts'),
  );

  const defaultResolveRequest =
    config.resolver.resolveRequest || ((context, moduleName, platform) => context.resolveRequest(context, moduleName, platform));

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = defaultResolveRequest(context, moduleName, platform);
    if (resolved && resolved.type === 'sourceFile' && SWAPS.has(resolved.filePath)) {
      return { type: 'sourceFile', filePath: SWAPS.get(resolved.filePath) };
    }
    return resolved;
  };
}

module.exports = config;
