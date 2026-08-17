/**
 * Patches the exported web shell.
 *
 * `expo export` writes `dist/index.html` from its own template, and that
 * template knows nothing about this product: it declares `lang="en"` on an
 * Arabic-first app, carries no icon, and offers no description or theme
 * colour. The result is a browser tab with a blank page-shaped placeholder
 * beside the title, and a document that tells a screen reader — and every
 * translation tool — that this page is in English before a single Arabic word
 * renders. The app corrects the direction itself once React mounts, but the
 * shell is what the browser reads first.
 *
 * The template is not a file this project owns, so the correction happens here,
 * right after the export, where it can be read and reviewed. Everything below
 * is inlined: no request leaves the page for an icon.
 *
 *   node scripts/patch-web-shell.mjs [dist-dir]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const file = join(dist, 'index.html');

/**
 * The favicon: paper ground, ink letter, and the 2 px rule that opens every
 * screen in this product. Drawn rather than fetched — an SVG data URI is part
 * of the document, so it survives an offline load and adds no request.
 *
 * The mark is Latin because the product name is (design constitution rule 10:
 * "Student OS" stays Latin in both languages), and a serif because the display
 * voice of the interface is a serif.
 */
const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="10" fill="#FCFBF9"/>' +
      '<rect x="12" y="12" width="40" height="3" fill="#14181F"/>' +
      '<text x="32" y="48" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-size="34" fill="#14181F">S</text>' +
      '</svg>',
  );

const DESCRIPTION =
  'منصة الطالب — مجتمعك الأكاديمي ودراستك في مكان واحد. Student OS: your academic community and your studying, in one place.';

let html = readFileSync(file, 'utf8');

// Arabic is the product's default language, and the shell should say so before
// React has a chance to. `ThemeProvider` still updates both attributes when a
// student chooses English, so this is the starting state, not a lock.
html = html.replace('<html lang="en">', '<html lang="ar" dir="rtl">');

const head = [
  `<link rel="icon" href="${FAVICON}" />`,
  `<link rel="apple-touch-icon" href="${FAVICON}" />`,
  `<meta name="theme-color" content="#FCFBF9" />`,
  `<meta name="description" content="${DESCRIPTION}" />`,
].join('\n    ');

if (!html.includes('rel="icon"')) {
  html = html.replace('<title>', `${head}\n    <title>`);
}

writeFileSync(file, html);

const langOk = html.includes('<html lang="ar" dir="rtl">');
const iconOk = html.includes('rel="icon"');
console.log(`web shell patched — lang/dir: ${langOk ? 'ok' : 'FAILED'}, icon: ${iconOk ? 'ok' : 'FAILED'}`);
if (!langOk || !iconOk) process.exit(1);
