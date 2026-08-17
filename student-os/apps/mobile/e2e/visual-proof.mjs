/**
 * Visual proof — the approved frame beside the running screen, at 390 px.
 *
 * Captures both halves of every comparison from real renders: the frozen
 * reference (`docs/design-handoff/reference/Student OS V2.dc.html`, served
 * locally with its pinned dependencies) and the preview fixture build. No
 * screenshot here is a crop of a design tool export — there are none; the
 * reference page is the only visual artefact that exists, as FRAME-MAP.md
 * records.
 *
 * Frame identity comes from FRAME-MAP.md: turns 3–5 only. Turn 6 (faculty
 * console) and turns 1–2 (history) are never consulted.
 *
 * Prerequisites, both local and both fixture-only:
 *   - the reference directory served at http://127.0.0.1:8099
 *   - the preview build served at http://localhost:8081
 *
 * Usage:
 *   node apps/mobile/e2e/visual-proof.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REFERENCE_URL =
  process.env.REFERENCE_URL ?? 'http://127.0.0.1:8099/Student%20OS%20V2.dc.html';
const APP_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const OUT = process.env.PROOF_DIR ?? '/tmp/visual-proof';
const DEPS = process.env.REF_DEPS ?? '/tmp/refdeps';

/** The reference draws its phones at 390×844 inside a 1 px border. */
const VIEWPORT = { width: 390, height: 844 };

mkdirSync(OUT, { recursive: true });

/**
 * Every screen in the proof set, and the frame it must be judged against.
 *
 * `shell` is the index of the phone within the frame, left to right as drawn.
 * `reference: null` means no frame exists — FRAME-MAP.md §"Specified in
 * writing, never drawn" — and the absence is reported rather than papered
 * over with a lookalike from another turn.
 */
const SCREENS = [
  { key: 'home', label: 'Home', frame: '3a', shell: 0, path: '/', locale: 'en' },
  { key: 'learn', label: 'Learn', frame: '3a', shell: 1, path: '/learn', locale: 'en' },
  { key: 'topic', label: 'Topic', frame: '3a', shell: 2, path: '/topic/t-acid-base', locale: 'en' },
  { key: 'practice', label: 'Practice', frame: '3a', shell: 3, path: '/practice/t-acid-base', locale: 'en' },
  { key: 'classroom', label: 'Classroom', frame: '5a', shell: 0, path: '/classrooms/classroom-1', locale: 'en' },
  { key: 'messages', label: 'Messages', frame: '5b', shell: 0, path: '/chat', locale: 'en' },
  // The reference frame draws three populated result sections. `le` is the
  // query that produces the same shape from this fixture world — people,
  // knowledge and a study group — so the two are compared with results on
  // screen rather than one of them showing an empty state.
  { key: 'search', label: 'Search', frame: '5c', shell: 0, path: '/search', locale: 'en', query: 'le' },
  { key: 'profile', label: 'Profile', frame: '5d', shell: 0, path: '/profile/layla.hassan', locale: 'en' },
  { key: 'compose', label: 'Compose', frame: '5d', shell: 1, path: '/compose', locale: 'en' },
  { key: 'settings', label: 'Settings', frame: null, shell: null, path: '/settings', locale: 'en' },

  { key: 'home-ar', label: 'Home — Arabic', frame: '3b', shell: 0, path: '/', locale: 'ar' },
  { key: 'learn-ar', label: 'Learn — Arabic', frame: '3b', shell: 1, path: '/learn', locale: 'ar' },
  { key: 'topic-ar', label: 'Topic — Arabic', frame: '3b', shell: 2, path: '/topic/t-acid-base', locale: 'ar' },
  { key: 'practice-ar', label: 'Practice — Arabic', frame: '3b', shell: 3, path: '/practice/t-acid-base', locale: 'ar' },
];

/**
 * The reference's pinned CDN dependencies, answered from disk.
 *
 * jsDelivr and unpkg are unreachable from this sandbox, and Chromium's request
 * for the Google Fonts stylesheet fails even though the host answers curl — so
 * all of them are intercepted and served locally at the exact pinned versions,
 * including the real woff2 files. Without this the reference renders in system
 * fonts with no icons, and typographic fidelity could not be judged at all.
 */
async function wireReferenceDeps(page) {
  await page.route('**://unpkg.com/**', (route) => {
    const url = route.request().url();
    const file = url.includes('react-dom')
      ? 'react-dom.js'
      : url.includes('babel')
        ? 'babel.js'
        : 'react.js';
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: readFileSync(`${DEPS}/${file}`),
    });
  });

  await page.route('**://cdn.jsdelivr.net/npm/ionicons@7.4.0/dist/ionicons/**', (route) => {
    const name = route.request().url().split('/ionicons/')[1].split('?')[0];
    try {
      route.fulfill({
        status: 200,
        contentType: name.endsWith('.svg') ? 'image/svg+xml' : 'application/javascript',
        body: readFileSync(`${DEPS}/ionicons-dist/ionicons/${name}`),
      });
    } catch {
      route.fulfill({ status: 404, body: '' });
    }
  });

  await page.route('**://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: readFileSync(`${DEPS}/fonts.css`) }),
  );

  await page.route('**/__fonts/*', (route) => {
    const name = route.request().url().split('/__fonts/')[1];
    try {
      route.fulfill({
        status: 200,
        contentType: 'font/woff2',
        body: readFileSync(`${DEPS}/fonts/${name}`),
      });
    } catch {
      route.fulfill({ status: 404, body: '' });
    }
  });
}

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

// --- reference ------------------------------------------------------------

console.log('reference frames');
{
  const context = await browser.newContext({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await wireReferenceDeps(page);
  await page.goto(REFERENCE_URL, { waitUntil: 'networkidle', timeout: 180_000 });
  // The page compiles itself with Babel in the browser; give it room to settle
  // and the webfonts room to land before anything is measured.
  await page.waitForTimeout(9000);
  await page.evaluate(() => document.fonts.ready);

  for (const screen of SCREENS) {
    if (!screen.frame) {
      console.log(`  ${screen.key}: no approved frame — skipped (never drawn)`);
      continue;
    }
    const handle = await page.evaluateHandle(
      ({ frame, shell }) => {
        const root = document.getElementById(frame);
        if (!root) return null;
        let boxes = [...root.querySelectorAll('div')].filter((d) => {
          const r = d.getBoundingClientRect();
          return r.width >= 370 && r.width <= 410 && r.height >= 500;
        });
        // Outermost only: the shells nest, and the inner scroller is not the phone.
        boxes = boxes.filter((d) => !boxes.some((o) => o !== d && o.contains(d)));
        return boxes[shell] ?? null;
      },
      { frame: screen.frame, shell: screen.shell },
    );
    const element = handle.asElement();
    if (!element) {
      console.log(`  ${screen.key}: shell ${screen.frame}[${screen.shell}] NOT FOUND`);
      continue;
    }
    await element.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await element.screenshot({ path: join(OUT, `${screen.key}-reference.png`) });
    console.log(`  ${screen.key}  ← ${screen.frame}[${screen.shell}]`);
  }
  await context.close();
}

// --- implementation -------------------------------------------------------

console.log('\nimplementation');
for (const locale of ['en', 'ar']) {
  const wanted = SCREENS.filter((s) => s.locale === locale);
  if (wanted.length === 0) continue;

  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Sign in once per locale; the fixture world keeps the session for the context.
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('preview@student-os.example');
  await inputs.nth(1).fill('preview-password');
  await page
    .getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' })
    .first()
    .click();
  await page.waitForTimeout(3500);

  for (const screen of wanted) {
    await page.goto(`${APP_URL}${screen.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);

    // Search is a blank field until something is typed; the reference frame
    // draws results, so the implementation must be shown with results too.
    if (screen.query) {
      await page.locator('input').first().fill(screen.query);
      await page.waitForTimeout(2200);
    }

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, `${screen.key}-implemented.png`) });
    console.log(`  ${screen.key}  ← ${screen.path}`);
  }
  await context.close();
}

await browser.close();
console.log(`\nwritten to ${OUT}`);
