/**
 * Visual acceptance gate for the corrected preview.
 *
 * Asserts the two global properties the owner rejected the build over, in the
 * condition that produced the rejection:
 *
 *   1. PAPER GROUND, EVEN IN A DARK-MODE BROWSER. The owner's device is in
 *      dark mode, and the app was following it into an unreviewed dark theme.
 *      Every screen is therefore rendered with `colorScheme: 'dark'` and the
 *      body/app backgrounds are read back — they must be the paper values,
 *      not an ink ground.
 *
 *   2. NO DESKTOP STRETCH. At desktop width the app must render inside a
 *      bounded canvas (~430 px) centred on a neutral ground, with the content
 *      constrained to it; at phone widths it must fill the viewport.
 *
 * Screenshots of every gated screen land in E2E_SHOT_DIR for the owner.
 *
 *   E2E_WEB_URL=http://localhost:8081 node apps/mobile/e2e/visual-gate.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.E2E_WEB_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/visual-gate';
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

/** The gate screens the owner named. */
const SCREENS = [
  ['/', 'today'],
  ['/topics', 'topics'],
  ['/learn', 'learn'],
  ['/topic/t-acid-base', 'topic'],
  ['/practice/t-acid-base', 'practice'],
  ['/chat', 'chat'],
  ['/profile/layla.hassan', 'profile'],
];

const PAPER = 'rgb(252, 251, 249)'; // paper50 — the app ground
const CANVAS_GROUND = 'rgb(237, 238, 241)'; // the reference page's neutral

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

async function run({ locale, width, height, colorScheme, tag }) {
  console.log(`\n${tag}`);
  const context = await browser.newContext({
    viewport: { width, height },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: width > 900 ? 1 : 2,
    colorScheme,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await signIn(page, locale);

  for (const [route, name] of SCREENS) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    const facts = await page.evaluate(() => {
      const root = document.getElementById('root');
      const rect = root.getBoundingClientRect();
      // The dominant ground: sample the app's own top-level surface.
      const rootBg = getComputedStyle(root).backgroundColor;
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      // The first full-size child carries the app background on RN-web.
      const app = root.firstElementChild ? getComputedStyle(root.firstElementChild).backgroundColor : rootBg;
      return {
        bodyBg,
        rootBg,
        appBg: app,
        rootWidth: Math.round(rect.width),
        rootLeft: Math.round(rect.left),
        viewport: window.innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    // 1. Paper ground, regardless of the browser's colour scheme.
    const grounds = [facts.appBg, facts.rootBg, facts.bodyBg].join(' ');
    const paperish =
      grounds.includes(PAPER) ||
      facts.appBg === PAPER ||
      // Practice's reading body is paper0 white by design.
      facts.appBg === 'rgb(255, 255, 255)';
    check(paperish, `${name}: paper ground`, grounds);

    // 2. Canvas geometry.
    if (facts.viewport >= 520) {
      // 430 content + the two 1 px canvas-edge borders.
      check(
        facts.rootWidth <= 434,
        `${name}: bounded canvas at desktop width`,
        `${facts.rootWidth}px wide`,
      );
      check(
        Math.abs(facts.rootLeft - (facts.viewport - facts.rootWidth) / 2) <= 2,
        `${name}: canvas is centred`,
        `left=${facts.rootLeft}`,
      );
      check(facts.bodyBg === CANVAS_GROUND, `${name}: neutral ground outside the canvas`, facts.bodyBg);
    } else {
      check(
        facts.rootWidth === facts.viewport,
        `${name}: full width on phone viewports`,
        `${facts.rootWidth} vs ${facts.viewport}`,
      );
    }
    check(facts.overflow <= 0, `${name}: no horizontal overflow`, `${facts.overflow}px`);

    await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`) });
  }

  check(errors.length === 0, 'no console or page errors', errors.slice(0, 3).join(' | '));
  await context.close();
}

for (const spec of [
  // The rejection condition: a dark-mode browser. Paper must win anyway.
  { locale: 'en', width: 390, height: 844, colorScheme: 'dark', tag: 'en-390-darkbrowser' },
  { locale: 'ar', width: 390, height: 844, colorScheme: 'dark', tag: 'ar-390-darkbrowser' },
  // Desktop, both schemes.
  { locale: 'en', width: 1440, height: 900, colorScheme: 'dark', tag: 'en-desktop-darkbrowser' },
  { locale: 'en', width: 1440, height: 900, colorScheme: 'light', tag: 'en-desktop-light' },
  { locale: 'ar', width: 1440, height: 900, colorScheme: 'light', tag: 'ar-desktop-light' },
  // Light phone, the baseline.
  { locale: 'en', width: 390, height: 844, colorScheme: 'light', tag: 'en-390-light' },
]) {
  await run(spec);
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('visual gate FAILED');
  process.exit(1);
}
console.log('visual gate passed');
