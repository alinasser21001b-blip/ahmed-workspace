/**
 * Bundle cleanliness gate.
 *
 * Everything this checks is about the artifact a student actually downloads,
 * not about what the source intends. Three things were true of the previous
 * export and are not allowed to be true again:
 *
 *   1. The invented preview world — demo students, their posts, their
 *      conversations — shipped inside the real bundle as unreachable code,
 *      because Metro bundles statically-imported modules whether or not the
 *      branch using them can run. Unreachable is not absent: the strings were
 *      readable in the artifact.
 *   2. `/motion-samples` existed as a route in a real build and rendered
 *      hardcoded English developer copy, bypassing the translation catalogue
 *      entirely, to an app whose default language is Arabic.
 *   3. The web shell claimed `lang="en"` and carried no icon at all.
 *
 * Run against an export directory:
 *
 *   node e2e/bundle-cleanliness.mjs dist
 *
 * In a PREVIEW export the first two rules are inverted on purpose — the
 * fixtures are supposed to be there — so pass `--preview` and the gate checks
 * that instead. One script, one truth, whichever build is in front of it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const expectPreview = process.argv.includes('--preview');

let checks = 0;
let failures = 0;
function check(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Every JS file in the export, concatenated once. */
function readBundle(root) {
  const parts = [];
  const walk = (path) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) parts.push(readFileSync(full, 'utf8'));
    }
  };
  walk(root);
  return parts.join('\n');
}

const js = readBundle(dir);
const html = readFileSync(join(dir, 'index.html'), 'utf8');

console.log(`\n${expectPreview ? 'PREVIEW' : 'REAL'} export at ${dir} (${(js.length / 1e6).toFixed(1)} MB of JS)\n`);

/**
 * People and places that exist only in the fixture world. Each one is a name a
 * student could read out of the artifact.
 */
const FIXTURE_MARKERS = [
  'Preview Student',
  'preview.student',
  'Layla Hassan',
  'Omar Al-Khafaji',
  'Student OS Preview',
  'preview dataset',
];

/**
 * Developer/preview copy that never went through the translation catalogue,
 * plus the working feedback form itself.
 *
 * `recordFeedback` is `src/preview/feedback-store.ts`'s only exported write
 * function and appears nowhere else in the app — its presence means the real
 * feedback form shipped, not the route stub. The banner's own marketing line
 * is checked directly rather than by a substring of the deleted
 * motion-samples screen: an adversarial pass found the previous list's third
 * entry could never match anything (it was that screen's exact wording, gone
 * along with the file, so the check passed vacuously while leaving the
 * feedback-form leak — a materially identical bug — undetected).
 */
const DEVELOPER_MARKERS = [
  'Motion samples',
  'motion prototypes',
  'sample data · بيانات تجريبية',
  'recordFeedback',
];

/**
 * NOT checked, deliberately: individual `preview.feedback.*` catalogue
 * strings (e.g. "Tell us how this felt"). The translation catalogue is one
 * object shared by every build, and it ships in full regardless of which
 * routes are reachable — that is true of any i18n system and is not evidence
 * a screen shipped. What matters is whether the FORM ships (checked via
 * `recordFeedback`, its only call site) and whether the BANNER's own copy
 * ships (checked directly above) — both do not, and are what the metro
 * resolver in `metro.config.js` exists to guarantee.
 */

if (expectPreview) {
  check(
    FIXTURE_MARKERS.some((marker) => js.includes(marker)),
    'preview export carries its fixture world (it is the point of this build)',
  );
} else {
  for (const marker of FIXTURE_MARKERS) {
    check(!js.includes(marker), `no fixture identity in the bundle: "${marker}"`);
  }
  for (const marker of DEVELOPER_MARKERS) {
    check(!js.includes(marker), `no developer copy in the bundle: "${marker}"`);
  }
  check(!js.includes('/motion-samples'), 'no motion-samples route in the bundle');
}

// The web shell, in both kinds of build.
check(html.includes('lang="ar"'), 'shell declares the product language (lang="ar")');
check(html.includes('dir="rtl"'), 'shell declares the product direction (dir="rtl")');
check(html.includes('rel="icon"'), 'shell carries an icon');
check(html.includes('name="description"'), 'shell carries a description');
check(!/lang="en"/u.test(html), 'shell does not declare English');

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('bundle cleanliness FAILED');
  process.exit(1);
}
console.log('bundle is clean');
