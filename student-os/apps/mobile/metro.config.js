// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/**
 * Metro configuration.
 *
 * Its one job here is keeping the preview world out of real student builds.
 *
 * `EXPO_PUBLIC_PREVIEW_MODE` already decides at runtime whether the app serves
 * fixtures, and it fails closed. What it could not do is keep the fixtures out
 * of the *bundle*: Metro walks `import` statements before any constant folding,
 * so an unconditional import of the fixture transport pulled in the whole
 * invented dataset — demo students, their posts, their conversations — and
 * shipped it as unreachable but readable code on every student's device.
 *
 * So the exclusion happens where module resolution happens. In a build that was
 * not exported with the preview flag, the fixture transport resolves to a stub
 * that throws if anything ever calls it, and the fixture data module is never
 * reached at all. In a preview export the resolver stands aside and the real
 * modules load exactly as before.
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
  const path = require('path');
  const stub = path.resolve(__dirname, 'src/preview/fixture-transport.stub.ts');

  const previewOnly = new Set(['./fixture-transport', './fixtures', '../preview/fixture-transport']);

  const defaultResolveRequest = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (previewOnly.has(moduleName)) {
      return { type: 'sourceFile', filePath: stub };
    }
    return defaultResolveRequest
      ? defaultResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
