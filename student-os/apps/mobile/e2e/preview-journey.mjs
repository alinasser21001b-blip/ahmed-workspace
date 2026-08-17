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
/**
 * Exact text matching, tolerant of the bidi isolates the text primitive adds.
 *
 * Single-line text that can be clipped is wrapped in U+2068…U+2069 so its
 * ellipsis lands at the reading end (see `src/components/Text.tsx`). Those are
 * invisible formatting characters — a screen reader ignores them — but they sit
 * in the DOM, so an `exact: true` match on the human-readable string no longer
 * matches. Matching on the string with optional isolates keeps these
 * assertions exact about what a person sees.
 */
function exactly(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^\u2068?${escaped}\u2069?$`, 'u');
}

async function visibleCount(page, text) {
  const locator = page.getByText(exactly(text));
  const total = await locator.count();
  let seen = 0;
  for (let i = 0; i < total; i += 1) {
    if (await locator.nth(i).isVisible()) seen += 1;
  }
  return seen;
}

async function waitVisible(page, text, timeout = 20_000) {
  await page
    .getByText(exactly(text))
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

  /*
   * The remaining surfaces are reached by direct URL rather than by tapping
   * the tab bar. Two reasons: a pushed route covers the tab bar on web while
   * leaving it in the DOM, which makes a tab click flaky rather than
   * meaningful; and reaching each screen cold is itself the route-reload
   * requirement, so this exercises both at once.
   */

  // --- classroom ----------------------------------------------------------
  await page.goto(`${BASE}/classrooms/classroom-1`, { waitUntil: 'networkidle' });
  const lecturesHeading = locale === 'ar' ? 'المحاضرات' : 'Lectures';
  await waitVisible(page, lecturesHeading);
  check(true, 'classroom renders its lecture sequence');
  const roleLabel = locale === 'ar' ? 'أنت طالب هنا' : 'You are a student here';
  check(await visibleCount(page, roleLabel) > 0, 'classroom states the viewer role');
  const mostRecent = locale === 'ar' ? 'أحدث محاضرة' : 'Most recent lecture';
  check(await visibleCount(page, mostRecent) > 0, 'classroom offers the most recent lecture');
  await shot('09-classroom');

  // --- messages -----------------------------------------------------------
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await waitVisible(page, 'Layla Hassan');
  check(true, 'messages list renders conversations');
  // The production host cannot hold a socket open, so this line is permanent
  // and must be visible rather than implied.
  const connectionLine = locale === 'ar'
    ? 'التسليم الفوري غير متاح — الرسائل تُرسل وتُقرأ بشكل طبيعي.'
    : 'Live delivery is unavailable — messages send and load normally.';
  check(
    await visibleCount(page, connectionLine) > 0,
    'messages states the realtime limitation honestly',
  );
  await shot('10-messages');

  // --- conversation -------------------------------------------------------
  await page.goto(`${BASE}/chat/conv-1`, { waitUntil: 'networkidle' });
  await waitVisible(page, 'اقرأي الفصل السابع من Guyton and Hall، صفحة 214.');
  check(true, 'conversation renders its messages');
  await shot('11-conversation');

  // --- search -------------------------------------------------------------
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
  await page.locator('input:visible').first().fill('Layla');
  await waitVisible(page, locale === 'ar' ? 'أشخاص' : 'People');
  check(true, 'search returns people results');
  const deferred = locale === 'ar'
    ? 'المواضيع والقاعات غير قابلة للبحث بعد.'
    : 'Topics and classrooms are not searchable yet.';
  check(
    await visibleCount(page, deferred) > 0,
    'search states the blocked result types rather than faking them',
  );
  await shot('12-search');

  // --- profile ------------------------------------------------------------
  await page.goto(`${BASE}/profile/layla.hassan`, { waitUntil: 'networkidle' });
  /*
   * The contribution score is gone, and its absence is now the assertion.
   *
   * It read `profiles.contribution_score`, a column with `DEFAULT 0` that no
   * code in the repository ever writes — so every real student saw a permanent
   * zero, while these preview fixtures showed a lively 12 and made the number
   * look earned. This test used to certify that illusion.
   */
  const contribution = locale === 'ar' ? 'نقاط المساهمة' : 'Contribution score';
  await waitVisible(page, locale === 'ar' ? 'المنشورات' : 'Posts');
  check(
    (await visibleCount(page, contribution)) === 0,
    'profile shows no unearned contribution score',
  );
  const followWord = locale === 'ar' ? 'تتابعه' : 'Following';
  check(
    await visibleCount(page, followWord) > 0,
    'profile uses follow terminology, not group join/leave',
  );
  await shot('13-profile');

  // --- compose ------------------------------------------------------------
  await page.goto(`${BASE}/compose`, { waitUntil: 'networkidle' });
  const whoCanSee = locale === 'ar' ? 'من يمكنه رؤية هذا' : 'Who can see this';
  await waitVisible(page, whoCanSee);
  check(true, 'compose leads with the audience decision');
  const optional = locale === 'ar' ? 'اختياري' : 'optional';
  check(await visibleCount(page, optional) > 0, 'compose marks classification optional');
  await shot('14-compose');

  // --- settings -----------------------------------------------------------
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  const notificationsBlocked = locale === 'ar'
    ? 'الإشعارات غير متاحة بعد'
    : 'Notifications are not available yet';
  await waitVisible(page, notificationsBlocked);
  check(true, 'settings states that notifications are blocked');
  await shot('15-settings');

  // --- account deletion ---------------------------------------------------
  await page.goto(`${BASE}/settings/delete-account`, { waitUntil: 'networkidle' });
  // Substring, not an exact node match: these are sentences, and the
  // assertion is about the copy being present and readable.
  const deletionText = await page.locator('body').innerText();
  const survives = locale === 'ar'
    ? 'المجموعات والقاعات التي تملكها'
    : 'Groups and classrooms you own';
  check(deletionText.includes(survives), 'deletion warning states what survives, above the fields');
  const tombstone = locale === 'ar' ? 'حُذفت هذه الرسالة' : 'This message was deleted';
  check(
    deletionText.includes(tombstone),
    'deletion copy states messages are tombstoned, not erased',
  );
  await shot('16-delete-account');

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
