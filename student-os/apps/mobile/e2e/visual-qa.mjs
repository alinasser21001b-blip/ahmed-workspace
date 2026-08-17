import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Visual QA capture, against the real build and a real account.
 *
 * The existing gates (visual-gate, rtl-audit, motion-regression) assert
 * properties; this one produces pictures for a person to look at, which the
 * recovery brief requires and no assertion replaces. It runs six
 * configurations — 360, 390 and desktop, each in English and Arabic — across
 * the principal screens, signing in as a real seeded student so what appears
 * is real content rather than fixtures.
 *
 *   E2E_WEB_URL=http://localhost:8085 \
 *   E2E_EMAIL=amjad@uob.edu.iq E2E_PASSWORD=correct-horse-battery \
 *   E2E_SHOT_DIR=/tmp/visual-qa node apps/mobile/e2e/visual-qa.mjs
 *
 * It also reports two facts per screen that a screenshot cannot show on its
 * own: whether the page scrolled sideways, and whether anything errored.
 */

const BASE = (process.env.E2E_WEB_URL ?? 'http://localhost:8085').replace(/\/$/u, '');
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/visual-qa';
const EMAIL = process.env.E2E_EMAIL ?? 'amjad@uob.edu.iq';
const PASSWORD = process.env.E2E_PASSWORD ?? 'correct-horse-battery';
mkdirSync(SHOTS, { recursive: true });

const problems = [];

/** The screens the brief names, in the order a student meets them. */
const SCREENS = [
  ['/', 'today'],
  ['/topics', 'topics'],
  ['/learn', 'learn'],
  ['/saved', 'saved'],
  ['/rooms', 'rooms'],
  ['/chat', 'chat'],
  ['/search', 'search'],
  ['/compose', 'compose'],
  ['/classrooms', 'classrooms'],
];

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function capture({ locale, width, height, tag }) {
  console.log(`\n${tag}`);
  const context = await browser.newContext({
    viewport: { width, height },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: width > 900 ? 1 : 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input:visible');
  await inputs.nth(0).fill(EMAIL);
  await inputs.nth(1).fill(PASSWORD);
  await page
    .getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' })
    .first()
    .click();
  await page.waitForTimeout(3500);

  for (const [route, name] of SCREENS) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);

    const facts = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dir: document.documentElement.dir,
      // Anything that renders as a literal empty string in a heading slot is a
      // missing translation showing through.
      emptyHeadings: Array.from(document.querySelectorAll('[role="heading"]')).filter(
        (node) => (node.textContent ?? '').trim() === '',
      ).length,
    }));

    if (facts.overflow > 0) problems.push(`${tag}/${name}: ${facts.overflow}px horizontal overflow`);
    if (facts.emptyHeadings > 0) problems.push(`${tag}/${name}: ${facts.emptyHeadings} empty heading(s)`);
    const expectedDir = locale === 'ar' ? 'rtl' : 'ltr';
    if (facts.dir !== expectedDir) problems.push(`${tag}/${name}: dir=${facts.dir}, expected ${expectedDir}`);

    await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`), fullPage: false });
    console.log(`  · ${name} (dir=${facts.dir}, overflow=${facts.overflow})`);
  }

  if (errors.length > 0) problems.push(`${tag}: ${errors.length} console/page error(s) — ${errors[0]}`);
  await context.close();
}

for (const spec of [
  { locale: 'en', width: 360, height: 800, tag: 'en-360' },
  { locale: 'ar', width: 360, height: 800, tag: 'ar-360' },
  { locale: 'en', width: 390, height: 844, tag: 'en-390' },
  { locale: 'ar', width: 390, height: 844, tag: 'ar-390' },
  { locale: 'en', width: 1440, height: 900, tag: 'en-desktop' },
  { locale: 'ar', width: 1440, height: 900, tag: 'ar-desktop' },
]) {
  await capture(spec);
}

await browser.close();

console.log(`\nscreenshots in ${SHOTS}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} machine-detectable problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('no machine-detectable problems — the screenshots still need a human');
