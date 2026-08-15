/**
 * Preview journey — drives the real Expo web build, in preview fixture mode,
 * through the core student loop at a 360 px viewport, in both locales.
 *
 * This is the acceptance evidence for the preview: it is the actual exported
 * bundle in a real browser, not a unit test of the transport. Screenshots land
 * in E2E_SHOT_DIR for visual review.
 *
 * Usage:
 *   E2E_WEB_URL=http://localhost:8081 node apps/mobile/e2e/preview-journey.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/preview-shots';
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
let checks = 0;
function check(condition, label) {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}`);
  }
}

/**
 * Counts only VISIBLE matches.
 *
 * expo-router keeps a covered screen mounted in the DOM on web, so a plain
 * `count()` sees text from screens the user cannot see. Every assertion here
 * is about what is on screen, so visibility is the right test.
 */
async function visibleCount(page, text) {
  const locator = page.getByText(text, { exact: true });
  const total = await locator.count();
  let seen = 0;
  for (let i = 0; i < total; i += 1) {
    if (await locator.nth(i).isVisible()) seen += 1;
  }
  return seen;
}

async function waitVisible(page, text, timeout = 20_000) {
  await page
    .getByText(text, { exact: true })
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout });
}

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

/** 360 px is the narrow-phone target the handoff requires verifying. */
async function run(locale, width) {
  const context = await browser.newContext({
    viewport: { width, height: 780 },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  const label = `${locale} @ ${width}px`;
  console.log(`\n${label}`);

  const shot = async (name) =>
    page.screenshot({ path: join(SHOTS, `${locale}-${width}-${name}.png`), fullPage: false });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // The preview banner must be present — this build is fixture-backed.
  await page.waitForSelector('text=Student OS Preview', { timeout: 20_000 });
  check(true, 'preview banner is visible');

  // --- sign in ------------------------------------------------------------
  const signInWord = locale === 'ar' ? 'تسجيل الدخول' : 'Sign in';
  await page.waitForSelector(`text=${signInWord}`, { timeout: 20_000 });
  await shot('01-signin');

  const inputs = page.locator('input');
  await inputs.nth(0).fill('preview@student-os.example');
  await inputs.nth(1).fill('preview-password');
  await page.getByText(signInWord, { exact: true }).last().click();

  // --- home ---------------------------------------------------------------
  await page.waitForSelector('text=Student OS', { timeout: 20_000 });
  const classified = locale === 'ar' ? 'مصنَّف ضمن مواضيعك' : 'Classified to your topics';
  await waitVisible(page, classified);
  check(true, 'home renders the classification section');
  // The fixture feed carries a disputed item, so the challenged group shows.
  const challengedHeading = locale === 'ar' ? 'قيد الاعتراض' : 'Under challenge';
  check(
    (await visibleCount(page, challengedHeading)) > 0,
    'home renders the "under challenge" group',
  );
  await shot('02-home');

  // --- learn --------------------------------------------------------------
  const learnTab = locale === 'ar' ? 'التعلّم' : 'Learn';
  await page.getByText(learnTab, { exact: true }).last().click();
  const builtFrom = locale === 'ar'
    ? 'مبني فقط على الأسئلة التي أجبت عنها.'
    : 'Built only from questions you have answered.';
  await waitVisible(page, builtFrom);
  check(true, 'learn renders its evidence subtitle');
  const readyToPractise = locale === 'ar' ? 'جاهز للتدريب' : 'Ready to practise';
  check(
    (await visibleCount(page, readyToPractise)) > 0,
    'learn shows the ink band (the one dominant action)',
  );
  await shot('03-learn');

  // --- topic --------------------------------------------------------------
  await page.getByText('Acid–base balance', { exact: true }).last().click();
  const howItConnects = locale === 'ar' ? 'كيف يرتبط' : 'How it connects';
  await waitVisible(page, howItConnects);
  check(true, 'topic renders "how it connects"');

  // The evidence fraction before practising: 4 of 6 (Arabic uses the word form).
  const beforeFraction = locale === 'ar' ? '٤ من ٦' : '4 of 6';
  check(
    (await visibleCount(page, beforeFraction)) > 0,
    `topic shows the accuracy fraction before practising (${beforeFraction})`,
  );
  await shot('04-topic-before');

  // --- practice -----------------------------------------------------------
  const practise = locale === 'ar' ? 'تدرّب' : 'Practise';
  await page.getByText(practise, { exact: true }).last().click();

  // The stem is the largest text; wait for the first question.
  await page.waitForSelector('text=pH 7.1', { timeout: 20_000 });
  check(true, 'practice opens on the first question');
  // Focus mode: the tab bar must not be VISIBLE. On web the covered tab
  // screen stays mounted, so presence in the DOM is expected and only
  // visibility is meaningful.
  check(
    (await visibleCount(page, learnTab)) === 0,
    'practice hides the tab bar (focus mode)',
  );
  await shot('05-practice-question');

  // Select the correct option, then check.
  await page.getByText('Metabolic acidosis with respiratory compensation', { exact: true }).last().click();
  await shot('06-practice-selected');
  const checkAnswer = locale === 'ar' ? 'تحقّق من الإجابة' : 'Check answer';
  await page.getByText(checkAnswer, { exact: true }).last().click();

  // --- feedback + the evidence delta --------------------------------------
  const correctWord = locale === 'ar' ? 'إجابة صحيحة' : 'Correct';
  await waitVisible(page, correctWord);
  check(true, 'feedback shows the verdict as a word, not colour alone');

  const whatChanged = locale === 'ar' ? 'ما الذي تغيّر' : 'What this changed';
  check(
    (await visibleCount(page, whatChanged)) > 0,
    'feedback shows the "what this changed" delta block',
  );
  const afterFraction = locale === 'ar' ? '٥ من ٧' : '5 of 7';
  check(
    (await visibleCount(page, afterFraction)) > 0,
    `feedback shows the after side of the delta (${afterFraction})`,
  );
  await shot('07-practice-feedback');

  // --- return to topic, refetched -----------------------------------------
  const openTopic = locale === 'ar' ? 'افتح الموضوع' : 'Open topic';
  await page.getByText(openTopic, { exact: true }).last().click();
  await waitVisible(page, howItConnects);
  check(
    (await visibleCount(page, afterFraction)) > 0,
    'topic refetches and shows the updated evidence after practice',
  );
  check(
    (await visibleCount(page, beforeFraction)) === 0,
    'the pre-practice fraction is gone — the refetch really happened',
  );
  await shot('08-topic-after');

  // --- no horizontal overflow at this width -------------------------------
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 1, `no horizontal overflow (${overflow}px)`);

  // --- document direction --------------------------------------------------
  const dir = await page.evaluate(() => document.documentElement.dir);
  check(dir === (locale === 'ar' ? 'rtl' : 'ltr'), `document direction is ${dir}`);

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors[0]}` : ''}`);

  await context.close();
}

await run('ar', 360);
await run('en', 360);
await run('ar', 390);

await browser.close();

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('preview journey FAILED');
  process.exit(1);
}
console.log('preview journey passed');
