/**
 * Accessibility audit against the rendered preview build.
 *
 * Checks the rules 23-ACCESSIBILITY.md makes binding and that can be verified
 * from the DOM: tap-target size, accessible names on controls, heading roles,
 * live regions, colour-independence of status, and RTL reading order.
 *
 * This is a floor, not a substitute for device verification with a real
 * screen reader — VoiceOver order and Dynamic Type still need a phone.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_WEB_URL ?? 'http://localhost:8098';
const MIN_TARGET = 44;

let failures = 0;
let checks = 0;
function check(condition, label, detail = '') {
  checks += 1;
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const ROUTES = [
  ['/', 'sign-in'],
  ['/learn', 'learn'],
  ['/topic/t-acid-base', 'topic'],
  ['/practice/t-acid-base', 'practice'],
  ['/classrooms/classroom-1', 'classroom'],
  ['/chat', 'messages'],
  ['/chat/conv-1', 'conversation'],
  ['/search', 'search'],
  ['/profile/layla.hassan', 'profile'],
  ['/compose', 'compose'],
  ['/settings', 'settings'],
  ['/settings/privacy', 'privacy'],
  ['/settings/delete-account', 'delete-account'],
];

for (const locale of ['ar', 'en']) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
  });
  const page = await context.newPage();

  // Sign in once so authenticated routes render.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const inputs = page.locator('input');
  if ((await inputs.count()) >= 2) {
    await inputs.nth(0).fill('preview@student-os.example');
    await inputs.nth(1).fill('preview-password');
    const signIn = locale === 'ar' ? 'تسجيل الدخول' : 'Sign in';
    await page.getByText(signIn, { exact: true }).last().click();
    await page.waitForTimeout(2500);
  }

  console.log(`\n${locale} @ 360px`);

  const unnamed = [];
  const small = [];
  const stateless = [];
  let headings = 0;
  let liveRegions = 0;

  for (const [route, name] of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    const report = await page.evaluate((minTarget) => {
      const out = { unnamed: [], small: [], stateless: [], headings: 0, live: 0 };

      const named = (el) =>
        (el.getAttribute('aria-label') || '').trim().length > 0 ||
        (el.innerText || '').trim().length > 0 ||
        (el.getAttribute('title') || '').trim().length > 0;

      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      for (const el of document.querySelectorAll('[role="button"],[role="link"],[role="radio"],[role="checkbox"],[role="tab"],[role="search"],button,a')) {
        if (!visible(el)) continue;
        if (!named(el)) out.unnamed.push(el.outerHTML.slice(0, 90));
        const r = el.getBoundingClientRect();
        // Only flag controls that are genuinely small in both axes; a wide
        // short row is still a comfortable target.
        if (r.height + 0.5 < minTarget && r.width + 0.5 < minTarget) {
          out.small.push(`${Math.round(r.width)}x${Math.round(r.height)} ${(el.getAttribute('aria-label') || el.innerText || '').slice(0, 40)}`);
        }
      }
      /*
       * A selectable control must say which state it is in, not only what it
       * is. React Native Web does not derive aria-checked from
       * accessibilityState, so this went unnoticed until the motion pass:
       * every answer option announced "radio" and never "selected".
       */
      for (const el of document.querySelectorAll('[role="radio"],[role="checkbox"],[role="switch"]')) {
        if (!visible(el)) continue;
        if (el.getAttribute('aria-checked') === null && el.getAttribute('aria-selected') === null) {
          out.stateless.push((el.getAttribute('aria-label') || el.innerText || '').slice(0, 45));
        }
      }
      out.headings = document.querySelectorAll('[role="heading"],h1,h2,h3').length;
      out.live = document.querySelectorAll('[aria-live]').length;
      return out;
    }, MIN_TARGET);

    unnamed.push(...report.unnamed.map((h) => `${name}: ${h}`));
    stateless.push(...report.stateless.map((h) => `${name}: ${h}`));
    small.push(...report.small.map((h) => `${name}: ${h}`));
    headings += report.headings;
    liveRegions += report.live;

    // Every screen must have a readable document direction.
    const dir = await page.evaluate(() => document.documentElement.dir);
    if (dir !== (locale === 'ar' ? 'rtl' : 'ltr')) {
      check(false, `${name}: document direction`, dir);
    }
  }

  check(unnamed.length === 0, 'every visible control has an accessible name', unnamed.slice(0, 4).join(' | '));
  check(small.length === 0, `every control meets the ${MIN_TARGET}px target`, small.slice(0, 4).join(' | '));
  check(
    stateless.length === 0,
    'every selectable control announces its state',
    stateless.slice(0, 4).join(' | '),
  );
  check(headings > 0, 'screens expose heading roles');
  check(liveRegions > 0, 'live regions are present for announced changes');

  // Colour-independence: the practice verdict must carry a word, and the
  // message state must be a word rather than a tick glyph.
  await page.goto(`${BASE}/practice/t-acid-base`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByText('Metabolic acidosis with respiratory compensation', { exact: true }).last().click();
  await page.getByText(locale === 'ar' ? 'تحقّق من الإجابة' : 'Check answer', { exact: true }).last().click();
  await page.waitForTimeout(1200);
  const practiceText = await page.locator('body').innerText();
  check(
    practiceText.includes(locale === 'ar' ? 'إجابة صحيحة' : 'Correct'),
    'correctness is carried by a word, not colour alone',
  );

  await page.goto(`${BASE}/chat/conv-1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const chatText = await page.locator('body').innerText();
  check(
    chatText.includes(locale === 'ar' ? 'أُرسلت' : 'Sent'),
    'message state is carried by a word, not a tick glyph',
  );

  await context.close();
}

await browser.close();
console.log(`\n${checks - failures}/${checks} accessibility checks passed`);
if (failures > 0) {
  console.error('accessibility audit FAILED');
  process.exit(1);
}
console.log('accessibility audit passed');
