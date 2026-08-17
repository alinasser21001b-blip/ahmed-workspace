import { chromium } from 'playwright';

/**
 * The ellipsis must fall at the end of the line a reader is reading towards.
 *
 * RC-03 in the product critique: a study group called
 * «مجموعة مراجعة الفسلجة — Physiology revision circle» rendered in the English
 * interface as «…n circle — مجموعة مراجعة الفسلجة» — the ellipsis on the
 * visual LEFT, clipping the Latin half mid-word. Nothing was slicing strings:
 * `numberOfLines` becomes `text-overflow: ellipsis`, and the ellipsis follows
 * the *element's* resolved direction. A name whose first strong character is
 * Arabic made `dir="auto"` resolve the row RTL inside an LTR page, so the
 * clipped end was the left one. The Arabic interface suffered the mirror image
 * with Latin-first names and cited source URLs.
 *
 * The existing RTL audit could not catch this: it exempts ellipsized elements
 * from inspection and measures direction only at the document level.
 *
 * This gate asserts the property directly, on whatever build it is pointed at:
 * every single-line clipped element must resolve to the interface's own
 * direction, so its ellipsis lands at the reading end. It also checks the
 * mechanism that makes that safe — the isolate around the value, without which
 * forcing the direction would reorder mixed text instead of just clipping it.
 *
 *   E2E_WEB_URL=http://localhost:8081 node apps/mobile/e2e/bidi-truncation.mjs
 */

const BASE = (process.env.E2E_WEB_URL ?? 'http://localhost:8081').replace(/\/$/u, '');
const EMAIL = process.env.E2E_EMAIL ?? 'preview@student-os.example';
const PASSWORD = process.env.E2E_PASSWORD ?? 'preview-password';

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

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

/** Every element the browser is actually clipping with an ellipsis. */
const COLLECT = () => {
  const pageDirection = document.documentElement.dir || 'ltr';
  const clipped = [];
  for (const node of document.querySelectorAll('div, span, p')) {
    const style = getComputedStyle(node);
    if (style.textOverflow !== 'ellipsis' || style.whiteSpace !== 'nowrap') continue;
    // Only leaves: a wrapper inherits the property and would double-count.
    if (node.querySelector('div, span, p')) continue;
    const text = (node.textContent ?? '').trim();
    if (text.length === 0) continue;
    clipped.push({
      text: text.slice(0, 60),
      direction: style.direction,
      // U+2068 FSI … U+2069 PDI: the isolate that keeps mixed content ordered
      // correctly while the element itself carries the interface direction.
      isolated: text.charCodeAt(0) === 0x2068,
      overflowing: node.scrollWidth > node.clientWidth + 1,
    });
  }
  return { pageDirection, clipped };
};

async function run(locale) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input:visible');
  await inputs.nth(0).fill(EMAIL);
  await inputs.nth(1).fill(PASSWORD);
  await page
    .getByRole('button', { name: locale === 'ar' ? 'تسجيل الدخول' : 'Sign in' })
    .first()
    .click();
  await page.waitForTimeout(3000);

  console.log(`\n${locale} — screens where mixed-script names get clipped`);
  let inspected = 0;
  for (const route of ['/rooms', '/search', '/chat', '/']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const { pageDirection, clipped } = await page.evaluate(COLLECT);

    for (const element of clipped) {
      inspected += 1;
      check(
        element.direction === pageDirection,
        `${route} "${element.text}" clips towards the reading end`,
        `element direction ${element.direction}, page ${pageDirection}`,
      );
      /*
       * Isolation is asserted where it changes the outcome: text mixing both
       * scripts. Single-script text in its own interface needs no isolate, and
       * demanding one everywhere would fail on navigation labels this app does
       * not render through its own text primitive.
       */
      const mixed = /[؀-ۿ]/u.test(element.text) && /[A-Za-z]/u.test(element.text);
      if (mixed) {
        check(
          element.isolated,
          `${route} "${element.text}" is bidi-isolated`,
          'no U+2068 isolate — mixed text may reorder',
        );
      }
      // Whatever happens, the ellipsis is never the first thing read.
      check(!element.text.startsWith('…'), `${route} "${element.text}" has no leading ellipsis`);
    }
  }
  check(inspected > 0, `${locale}: found clipped text to inspect`, `${inspected} elements`);
  await context.close();
}

await run('en');
await run('ar');
await browser.close();

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('bidi truncation FAILED');
  process.exit(1);
}
console.log('bidi truncation passed');
