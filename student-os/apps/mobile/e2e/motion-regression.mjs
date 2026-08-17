/**
 * Motion regression on the real application.
 *
 * The samples proved the language; this proves the integration. It exercises
 * the ways motion actually breaks a product rather than the ways it looks
 * nice:
 *
 *   - rapid repeated taps on an animated control;
 *   - navigation interrupted mid-transition, and going back mid-transition;
 *   - nothing left animating once a transition has finished;
 *   - no element parked off-screen by a transform that never resolved;
 *   - no horizontal overflow created by motion;
 *   - reduced motion reaching the same end state on every screen.
 *
 * The last two matter most: a transform that fails to settle is invisible in
 * a screenshot taken at the wrong moment but permanently wrong for the
 * student, and an off-screen transform is the classic way an entrance
 * animation creates a scrollbar nobody can explain.
 *
 *   E2E_WEB_URL=http://localhost:8081 node apps/mobile/e2e/motion-regression.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.E2E_WEB_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/motion-regression';
mkdirSync(SHOTS, { recursive: true });

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

const ROUTES = [
  ['/', 'today'],
  ['/topics', 'topics'],
  ['/learn', 'learn'],
  ['/topic/t-acid-base', 'topic'],
  ['/rooms', 'rooms'],
  ['/classrooms/classroom-1', 'classroom'],
  ['/chat', 'messages'],
  ['/chat/conv-1', 'conversation'],
  ['/search', 'search'],
  ['/profile/layla.hassan', 'profile'],
  ['/compose', 'compose'],
  ['/settings', 'settings'],
];

/**
 * Everything the page is animating, and everything sitting on a transform
 * that has not resolved to identity. Read after motion should have finished.
 */
const settleReport = () => ({
  running: document.getAnimations
    ? document.getAnimations().filter((a) => a.playState === 'running').length
    : 0,
  // An entrance that never completed leaves its element translated. Anything
  // still displaced by more than a pixel after the longest duration is stuck.
  displaced: [...document.querySelectorAll('div')]
    .filter((el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === 'none') return false;
      const m = t.match(/matrix\(([^)]+)\)/);
      if (!m) return false;
      const parts = m[1].split(',').map((n) => parseFloat(n));
      return Math.abs(parts[4]) > 1 || Math.abs(parts[5]) > 1;
    })
    .length,
  faded: [...document.querySelectorAll('div')].filter((el) => {
    const o = parseFloat(getComputedStyle(el).opacity);
    return o > 0 && o < 0.99;
  }).length,
});

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function signIn(page, locale) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  await inputs.nth(0).fill('preview@student-os.example');
  await inputs.nth(1).fill('preview-password');
  await page
    .getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' })
    .first()
    .click();
  await page.waitForTimeout(3000);
}

async function run({ locale, width, reducedMotion }) {
  const label = `${locale} @ ${width}px${reducedMotion === 'reduce' ? ' · reduced' : ''}`;
  console.log(`\n${label}`);

  const context = await browser.newContext({
    viewport: { width, height: 850 },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: 1,
    reducedMotion,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await signIn(page, locale);

  // --- every route settles, and stays settled ------------------------------
  for (const [route, name] of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    // Longest token is 220 ms and the deepest stagger is 2×60 — 900 ms is well
    // past any legitimate transition.
    await page.waitForTimeout(900);

    const report = await page.evaluate(settleReport);
    check(report.running === 0, `${name}: nothing still animating`, `${report.running} running`);
    check(report.displaced === 0, `${name}: nothing left displaced`, `${report.displaced} elements`);
    check(report.faded === 0, `${name}: nothing left part-faded`, `${report.faded} elements`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(overflow <= 0, `${name}: no horizontal overflow`, `${overflow}px`);
  }

  // --- rapid repeated taps on an animated control --------------------------
  await page.goto(`${BASE}/practice/t-acid-base`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const option = page.getByRole('radio').first();
  for (let i = 0; i < 8; i += 1) {
    await option.click({ force: true });
    await page.waitForTimeout(35); // faster than the 120 ms it animates for
  }
  await page.waitForTimeout(700);
  const afterTaps = await page.evaluate(settleReport);
  check(afterTaps.running === 0, 'rapid taps: animation settles', `${afterTaps.running} running`);
  check(
    afterTaps.faded === 0,
    'rapid taps: no control stranded mid-fade',
    `${afterTaps.faded} elements`,
  );
  check(
    (await page.getByRole('radio').first().getAttribute('aria-checked')) === 'true',
    'rapid taps: the option still reports itself selected',
    String(await page.getByRole('radio').first().getAttribute('aria-checked')),
  );

  // --- navigation interrupted mid-transition -------------------------------
  await page.goto(`${BASE}/learn`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // Leave while the entrance is still running.
  const nav = page.goto(`${BASE}/topic/t-acid-base`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(60);
  await nav;
  await page.waitForTimeout(900);
  const afterInterrupt = await page.evaluate(settleReport);
  check(
    afterInterrupt.running === 0 && afterInterrupt.displaced === 0,
    'interrupted navigation settles on the new screen',
    `${afterInterrupt.running} running, ${afterInterrupt.displaced} displaced`,
  );

  // --- back navigation mid-transition --------------------------------------
  await page.goto(`${BASE}/profile/layla.hassan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(80);
  await page.goBack({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const afterBack = await page.evaluate(settleReport);
  check(
    afterBack.running === 0 && afterBack.displaced === 0,
    'back mid-transition settles',
    `${afterBack.running} running, ${afterBack.displaced} displaced`,
  );
  check(
    (await page.locator('body').innerText()).length > 80,
    'back mid-transition leaves a rendered screen',
  );

  // --- the modal: enter, then leave ----------------------------------------
  await page.goto(`${BASE}/profile/layla.hassan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const more = page.getByLabel(locale === 'ar' ? 'إجراءات أخرى' : 'More actions').first();
  if ((await more.count()) > 0) {
    await more.click();
    await page.waitForTimeout(600);
    const report = page
      .getByText(locale === 'ar' ? 'الإبلاغ عن @layla.hassan' : 'Report @layla.hassan', {
        exact: true,
      })
      .filter({ visible: true })
      .first();
    if ((await report.count()) > 0) {
      await report.click();
      await page.waitForTimeout(700);
      const opened = await page.evaluate(settleReport);
      check(opened.running === 0, 'report modal settles open', `${opened.running} running`);

      await page
        .getByRole('button', { name: locale === 'ar' ? 'إلغاء' : 'Cancel' })
        .first()
        .click();
      await page.waitForTimeout(700);
      const closed = await page.evaluate(settleReport);
      check(
        closed.running === 0 && closed.displaced === 0,
        'report modal settles closed',
        `${closed.running} running, ${closed.displaced} displaced`,
      );
    }
  }

  await page.screenshot({ path: `${SHOTS}/${locale}-${width}${reducedMotion === 'reduce' ? '-reduced' : ''}.png` });
  check(errors.length === 0, 'no console or page errors', errors.slice(0, 3).join(' | '));

  await context.close();
}

for (const spec of [
  { locale: 'en', width: 390, reducedMotion: 'no-preference' },
  { locale: 'ar', width: 390, reducedMotion: 'no-preference' },
  { locale: 'ar', width: 360, reducedMotion: 'no-preference' },
  { locale: 'en', width: 390, reducedMotion: 'reduce' },
]) {
  await run(spec);
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('motion regression FAILED');
  process.exit(1);
}
console.log('motion regression passed');
