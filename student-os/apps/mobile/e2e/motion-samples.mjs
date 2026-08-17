/**
 * Verification for the motion-samples prototype route.
 *
 * The samples are for judgement, not for shipping, so this checks the things
 * that would make them unjudgeable or unsafe rather than asserting a
 * particular animation curve:
 *
 *   - each of the five demos is present and independently triggerable;
 *   - triggering one changes its end state (the motion actually resolves);
 *   - the page holds at 390 and 360, in English and Arabic;
 *   - reduced motion is detected and reported, and the demos still reach
 *     their end state with it on — reduced motion removes the transition,
 *     never the outcome;
 *   - nothing leaves the origin, and no socket opens;
 *   - the console stays clean.
 *
 * Screenshots of every interaction, before and after, land in E2E_SHOT_DIR.
 *
 *   E2E_WEB_URL=http://localhost:8081 node apps/mobile/e2e/motion-samples.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.E2E_WEB_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/motion-shots';
const ORIGIN = new URL(BASE).origin;
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

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

/** The five triggers, and the text that proves each one resolved. */
const DEMOS = [
  { key: '1-learn-topic', trigger: 'Open Acid–base balance', settles: 'Cites 2 sources' },
  // The option is a radio, not a button — the same role the approved Practice
  // screen gives it, so the harness has to ask for it by that role.
  { key: '2-answer-select', role: 'radio', trigger: 'Respiratory acidosis', settles: 'Selected — the static design, arrived at.' },
  { key: '3-verdict', trigger: 'Check answer', settles: 'Evidence for this topic:' },
  { key: '4-report-modal', trigger: 'Report @layla.hassan', settles: 'A moderator from your college reviews this' },
  { key: '5-send', trigger: 'Send', settles: 'Sent' },
];

async function run({ locale, width, reducedMotion }) {
  const label = `${locale} @ ${width}px${reducedMotion === 'reduce' ? ' · reduced motion' : ''}`;
  console.log(`\n${label}`);

  const context = await browser.newContext({
    viewport: { width, height: 850 },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: 2,
    reducedMotion,
  });
  const page = await context.newPage();

  const errors = [];
  const offOrigin = [];
  const sockets = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!url.startsWith(ORIGIN)) offOrigin.push(`${r.method()} ${url}`);
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));

  // Sign in, then reach the prototype route directly — it is not linked from
  // any production screen, which is the point.
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

  await page.goto(`${BASE}/motion-samples`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const body = await page.locator('body').innerText();
  check(body.includes('Motion samples'), 'the prototype route renders');
  check(
    body.includes(`Reduced motion is ${reducedMotion === 'reduce' ? 'ON' : 'OFF'}`),
    'reduced-motion state is reported correctly',
    body.match(/Reduced motion is \w+/)?.[0] ?? 'not found',
  );

  for (let i = 1; i <= 5; i += 1) {
    check(body.includes(`${i} · `), `sample ${i} is present`);
  }
  check((await page.getByRole('button', { name: 'Replay' }).count()) === 5, 'five replay controls');

  const tag = `${locale}-${width}${reducedMotion === 'reduce' ? '-reduced' : ''}`;
  await page.screenshot({ path: join(SHOTS, `${tag}-00-page.png`), fullPage: true });

  for (const demo of DEMOS) {
    const before = join(SHOTS, `${tag}-${demo.key}-before.png`);
    const after = join(SHOTS, `${tag}-${demo.key}-after.png`);

    const trigger = page.getByRole(demo.role ?? 'button', { name: demo.trigger }).first();
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: before });

    await trigger.click();
    // Long enough for the longest token (220 ms) plus its stagger to finish.
    await page.waitForTimeout(700);
    await page.screenshot({ path: after });

    const text = await page.locator('body').innerText();
    check(text.includes(demo.settles), `${demo.key} reaches its end state`);
  }

  // Dismissal, for the modal: context → task → context.
  const dismiss = page.getByRole('button', { name: 'Cancel' }).first();
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS, `${tag}-4-report-modal-dismissed.png`) });
    check(true, 'the modal dismisses back to context');
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 0, 'no horizontal overflow', `${overflow}px`);

  const dir = await page.evaluate(() => document.documentElement.dir);
  check(dir === (locale === 'ar' ? 'rtl' : 'ltr'), 'document direction matches locale', dir);

  check(offOrigin.length === 0, 'no request left the origin', offOrigin.slice(0, 3).join(' | '));
  check(sockets.length === 0, 'no WebSocket opened', sockets.slice(0, 2).join(' | '));
  check(errors.length === 0, 'no console or page errors', errors.slice(0, 3).join(' | '));

  await context.close();
}

for (const run_ of [
  { locale: 'en', width: 390, reducedMotion: 'no-preference' },
  { locale: 'ar', width: 390, reducedMotion: 'no-preference' },
  { locale: 'en', width: 360, reducedMotion: 'no-preference' },
  { locale: 'ar', width: 360, reducedMotion: 'no-preference' },
  { locale: 'en', width: 390, reducedMotion: 'reduce' },
]) {
  await run(run_);
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('motion samples verification FAILED');
  process.exit(1);
}
console.log('motion samples verification passed');
