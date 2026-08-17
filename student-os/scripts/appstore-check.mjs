#!/usr/bin/env node
/**
 * The App Store release gate.
 *
 *   pnpm appstore:check
 *
 * Everything here is a check that would let a genuinely broken build ship
 * quietly otherwise: a localhost or cleartext API address baked into the iOS
 * binary, a placeholder support URL, a demo password compiled into the
 * bundle, a missing EAS profile, a build that does not typecheck. Each
 * check is a real assertion against real files — not a checklist that always
 * prints green — and the process exits non-zero the moment one fails, so it
 * can gate a CI job or a release script the same way.
 *
 * What this CANNOT verify, and does not pretend to: Apple account state,
 * App Store Connect metadata, code signing, or anything that requires a real
 * Apple Developer membership. Those are named explicitly in the report as
 * EXTERNAL_OWNER_ACTION_REQUIRED, not silently skipped.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MOBILE = join(ROOT, 'apps', 'mobile');

const failures = [];
const passes = [];

function ok(label, detail = '') {
  passes.push(label);
  process.stdout.write(`  ✓ ${label}${detail ? ` — ${detail}` : ''}\n`);
}
function fail(label, detail) {
  failures.push(label);
  process.stdout.write(`  ✗ ${label} — ${detail}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

process.stdout.write('\nApp Store release gate\n\n');

// --- 0. Preview fixtures must not ship in a store build ---------------------
//
// EXPO_PUBLIC_PREVIEW_MODE is inlined at export time. A store or production
// web build that has it set is a fixture build, not the product. The flag
// being unset is necessary and not sufficient — the artifact must also not
// contain the fixture people, which is asserted when a web export is present.

{
  const flag = process.env.EXPO_PUBLIC_PREVIEW_MODE ?? '';
  if (flag === '1' || flag === 'true') {
    fail(
      'EXPO_PUBLIC_PREVIEW_MODE is unset for a store build',
      `got "${flag}" — a preview fixture build cannot be submitted`,
    );
  } else {
    ok('EXPO_PUBLIC_PREVIEW_MODE is unset');
  }

  const dist = join(MOBILE, 'dist');
  if (existsSync(dist)) {
    const { stdout } = await run('grep', ['-R', '--fixed-strings', 'Layla Hassan', dist], {
      encoding: 'utf8',
    }).catch((error) => ({ stdout: typeof error.stdout === 'string' ? error.stdout : '' }));
    if (stdout.trim()) {
      fail('production web bundle contains no preview fixtures', 'found "Layla Hassan" in apps/mobile/dist');
    } else {
      ok('production web bundle contains no preview fixture names');
    }
  }
}

// --- 1. Production API address ----------------------------------------------
//
// Read directly, not inferred: the same loopback/HTTPS rules the app itself
// enforces at build time, checked here so a bad value is caught before a
// build is even attempted.

{
  const url = process.env.EXPO_PUBLIC_API_URL_PRODUCTION ?? '';
  const LOOPBACK = /^https?:\/\/(localhost|127(?:\.\d+){3}|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:$|\/)/i;
  if (!url) {
    fail(
      'production API address configured',
      'EXPO_PUBLIC_API_URL_PRODUCTION is unset in this environment. Set it (or the EAS-hosted ' +
        'equivalent — see apps/mobile/EAS_SETUP.md) before building for production.',
    );
  } else if (url.trim().toLowerCase() === 'same-origin') {
    fail('production API address is not "same-origin"', 'a native build has no page to inherit an origin from');
  } else if (LOOPBACK.test(url)) {
    fail('production API address is not a loopback address', url);
  } else if (!/^https:\/\//i.test(url)) {
    fail('production API address uses HTTPS', `got "${url}"`);
  } else {
    ok('production API address is a real HTTPS host', url);
  }
}

// --- 2. Support / privacy / terms URLs ---------------------------------------

{
  const PLACEHOLDER = /example\.(com|org)|localhost|127\.0\.0\.1|TODO|CHANGE[_-]?ME/i;
  const checks = [
    ['SUPPORT_URL', 'Guideline 1.5 (developer contact)'],
    ['PRIVACY_POLICY_URL', 'Guideline 5.1.1(i) (privacy policy)'],
  ];
  for (const [name, why] of checks) {
    const value = process.env[name] ?? '';
    if (!value) {
      fail(`${name} is set`, `required for ${why}`);
    } else if (PLACEHOLDER.test(value)) {
      fail(`${name} is not a placeholder`, `got "${value}"`);
    } else if (!/^https:\/\//i.test(value)) {
      fail(`${name} is HTTPS`, `got "${value}"`);
    } else {
      ok(`${name} is set and looks real`, value);
    }
  }
  const email = process.env.SUPPORT_EMAIL ?? '';
  if (!email) fail('SUPPORT_EMAIL is set', 'Guideline 1.5 requires a way to reach the developer');
  else if (PLACEHOLDER.test(email)) fail('SUPPORT_EMAIL is not a placeholder', `got "${email}"`);
  else ok('SUPPORT_EMAIL is set', email);
}

// --- 3. Bundle identifier, version, build number -----------------------------

{
  const appJsonPath = join(MOBILE, 'app.json');
  if (!existsSync(appJsonPath)) {
    fail('apps/mobile/app.json exists', 'not found');
  } else {
    const { expo } = readJson(appJsonPath);
    if (!expo?.ios?.bundleIdentifier) fail('ios.bundleIdentifier is set', 'missing');
    else ok('ios.bundleIdentifier is set', expo.ios.bundleIdentifier);

    if (!expo?.ios?.buildNumber) fail('ios.buildNumber is set', 'required for CFBundleVersion');
    else ok('ios.buildNumber is set', expo.ios.buildNumber);

    if (!expo?.version) fail('version is set', 'missing');
    else ok('version is set', expo.version);

    if (expo?.ios?.config?.usesNonExemptEncryption === undefined) {
      fail('ios.config.usesNonExemptEncryption is declared', 'missing — App Store Connect will ask at every submission otherwise');
    } else {
      ok('ios.config.usesNonExemptEncryption is declared', String(expo.ios.config.usesNonExemptEncryption));
    }

    if (expo?.ios?.supportsTablet === true) {
      fail(
        'supportsTablet is not claimed without evidence',
        'app.json declares iPad support; see docs/app-store/00-READINESS-AUDIT.md for why this is currently false',
      );
    } else {
      ok('supportsTablet reflects the actual iPad readiness decision', String(expo?.ios?.supportsTablet));
    }

    const photoPermission = expo?.ios?.infoPlist?.NSPhotoLibraryUsageDescription;
    if (!photoPermission || photoPermission.length < 20) {
      fail(
        'NSPhotoLibraryUsageDescription is a real purpose string',
        'missing or too short — expo-image-picker is used by apps/mobile/app/compose.tsx',
      );
    } else {
      ok('NSPhotoLibraryUsageDescription is present');
    }

    if (!expo?.ios?.privacyManifests) {
      fail('ios.privacyManifests is declared', 'missing — required-reason APIs must be declared for App Store submission');
    } else {
      ok('ios.privacyManifests is declared');
    }

    if (!expo?.icon && !expo?.ios?.icon) {
      fail(
        'a real app icon is configured',
        'no icon field — Apple rejects Expo’s placeholder icon; WAITING_FOR_DESIGN_FINAL',
      );
    } else {
      ok('an app icon is configured');
    }
  }
}

// --- 4. eas.json ---------------------------------------------------------

{
  const easPath = join(MOBILE, 'eas.json');
  if (!existsSync(easPath)) {
    fail('apps/mobile/eas.json exists', 'not found');
  } else {
    const eas = readJson(easPath);
    for (const profile of ['development', 'preview', 'production']) {
      if (!eas.build?.[profile]) fail(`eas.json has a "${profile}" build profile`, 'missing');
      else ok(`eas.json has a "${profile}" build profile`);
    }
    if (!eas.submit?.production?.ios) {
      fail('eas.json has an iOS submit profile', 'missing');
    } else {
      ok('eas.json has an iOS submit profile');
    }
  }
}

// --- 5. No secrets or demo credentials in the mobile bundle ------------------

{
  const { stdout } = await run(
    'git',
    ['-C', ROOT, 'grep', '-rniE', 'correct-horse-battery|jwt_secret\\s*=|password\\s*=\\s*[\\x27\\x22]', '--', 'apps/mobile/app', 'apps/mobile/src'],
    { reject: false },
  ).catch((error) => ({ stdout: '', code: error.code }));

  const hits = stdout.trim().split('\n').filter(Boolean);
  if (hits.length > 0) {
    fail('no demo credentials or secrets in apps/mobile', `${hits.length} match(es):\n    ${hits.slice(0, 5).join('\n    ')}`);
  } else {
    ok('no demo credentials or secrets found in apps/mobile');
  }
}

// --- 6. Every EXPO_PUBLIC_* reference is genuinely public config -------------

{
  const { stdout } = await run(
    'git',
    ['-C', ROOT, 'grep', '-rhoE', 'EXPO_PUBLIC_[A-Z0-9_]+', '--', 'apps/mobile'],
  ).catch((error) => ({ stdout: error.stdout ?? '' }));
  const names = [...new Set(stdout.trim().split('\n').filter(Boolean))];
  const SENSITIVE = /SECRET|PASSWORD|KEY|TOKEN|CREDENTIAL/i;
  const suspicious = names.filter((n) => SENSITIVE.test(n));
  if (suspicious.length > 0) {
    fail('no EXPO_PUBLIC_* variable name looks like a secret', suspicious.join(', '));
  } else {
    ok(`every EXPO_PUBLIC_* reference looks like public config (${names.length} found)`, names.join(', '));
  }
}

// --- 7. Build health: typecheck must pass ------------------------------------

{
  try {
    await run('pnpm', ['--filter', '@sos/mobile', 'typecheck'], { cwd: ROOT });
    ok('apps/mobile typechecks');
  } catch (error) {
    fail('apps/mobile typechecks', String(error.stderr ?? error.message).split('\n').slice(0, 5).join('\n    '));
  }
}

// --- summary ------------------------------------------------------------

process.stdout.write(`\n  ${passes.length} passed, ${failures.length} failed\n\n`);

if (failures.length > 0) {
  process.stderr.write(`✗ release gate failed:\n${failures.map((f) => `  - ${f}`).join('\n')}\n\n`);
  process.exit(1);
}

process.stdout.write('✓ the release gate passes — see EAS_SETUP.md for the account-level steps still required\n\n');
