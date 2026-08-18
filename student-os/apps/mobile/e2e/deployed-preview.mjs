/**
 * Deployed-preview acceptance test.
 *
 * Runs against whatever URL it is given — the local artifact before a deploy,
 * and the real deployed site after one — so "it worked locally" and "it works
 * for a student" are the same test rather than two different ones.
 *
 * It asks two questions the journey suite does not:
 *
 *   1. Does the whole ordered journey work, including the surfaces a student
 *      only reaches deliberately — report, block, password reset, and the
 *      preview's own feedback form?
 *
 *   2. Does anything leave the origin? Every request, WebSocket and
 *      notification permission call is recorded, and a request to any host but
 *      the preview's own is a failure. This is the evidence behind
 *      PRODUCTION_DATA_ISOLATED: not "we believe the transport is fixtures"
 *      but "the browser was watched and it never called anyone."
 *
 * Usage:
 *   E2E_WEB_URL=https://… node apps/mobile/e2e/deployed-preview.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.E2E_WEB_URL ?? 'http://localhost:8098').replace(/\/$/, '');
const SHOTS = process.env.E2E_SHOT_DIR ?? '/tmp/deployed-preview-shots';
mkdirSync(SHOTS, { recursive: true });

const ORIGIN = new URL(BASE).origin;

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

/**
 * Exact text matching, tolerant of the bidi isolates the text primitive adds.
 *
 * Single-line text that can be clipped is wrapped in U+2068…U+2069 so its
 * ellipsis lands at the reading end (see `src/components/Text.tsx`). Those are
 * invisible formatting characters — a screen reader ignores them — but they
 * sit in the DOM, so an `exact: true` match on the human-readable string no
 * longer matches. Matching on the string with optional isolates keeps these
 * assertions exact about what a person sees.
 */
function exactly(text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^⁨?${escaped}⁩?$`, 'u');
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

async function waitVisible(page, text, timeout = 25_000) {
  await page
    .getByText(exactly(text))
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout });
}

const clickVisible = async (page, text) =>
  page.getByText(exactly(text)).filter({ visible: true }).first().click();

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const COPY = {
  ar: {
    signIn: 'تسجيل الدخول',
    learn: 'التعلّم',
    check: 'تحقّق من الإجابة',
    lectures: 'المحاضرات',
    unavailable: 'التسليم الفوري غير متاح — الرسائل تُرسل وتُقرأ بشكل طبيعي.',
    more: 'إجراءات أخرى',
    report: 'الإبلاغ عن @layla.hassan',
    reportReason: 'مضايقة',
    submitReport: 'إرسال البلاغ',
    reportThanks: 'تم استلام بلاغك',
    forgot: 'نسيت كلمة المرور؟',
    forgotTitle: 'إعادة تعيين كلمة المرور',
    feedback: 'أرسل ملاحظاتك',
    feedbackTitle: 'كيف كان استخدامك للتطبيق؟',
    feedbackSend: 'إرسال الملاحظات',
    feedbackThanks: 'شكراً لك',
    notifBlocked: 'الإشعارات',
    deleteTitle: 'حذف الحساب',
  },
  en: {
    signIn: 'Sign in',
    learn: 'Learn',
    check: 'Check answer',
    lectures: 'Lectures',
    unavailable: 'Live delivery is unavailable — messages send and load normally.',
    more: 'More actions',
    report: 'Report @layla.hassan',
    reportReason: 'Harassment',
    submitReport: 'Submit report',
    reportThanks: 'Report received',
    forgot: 'Forgot password?',
    forgotTitle: 'Reset your password',
    feedback: 'Give feedback',
    feedbackTitle: 'Tell us how this felt',
    feedbackSend: 'Send feedback',
    feedbackThanks: 'Thank you',
    notifBlocked: 'Notifications',
    deleteTitle: 'Delete account',
  },
};

async function run(locale, width) {
  const c = COPY[locale];
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    locale: locale === 'ar' ? 'ar-IQ' : 'en-GB',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const errors = [];
  const offOrigin = [];
  const sockets = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Every request the page makes, judged against the origin it was served
  // from. A fixture build should never produce one that is not a static asset
  // of this very site.
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (!url.startsWith(ORIGIN)) offOrigin.push(`${request.method()} ${url}`);
  });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  /*
   * Playwright's websocket event reports sockets that connect. A socket that
   * is attempted and refused never fires it — which is precisely the case a
   * fixture preview produces, and precisely the one that must fail this test.
   * So the constructor itself is wrapped before any app code runs.
   */
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__socketAttempts = [];
    const Real = w.WebSocket;
    w.WebSocket = function (url, protocols) {
      w.__socketAttempts.push(String(url));
      return new Real(url, protocols);
    };
    w.WebSocket.prototype = Real.prototype;
    // Same for push: record a permission request rather than trusting that
    // nothing asked.
    w.__notificationPermissionRequested = false;
    if (w.Notification && w.Notification.requestPermission) {
      const realRequest = w.Notification.requestPermission.bind(w.Notification);
      w.Notification.requestPermission = (...args) => {
        w.__notificationPermissionRequested = true;
        return realRequest(...args);
      };
    }
  });

  const label = `${locale} @ ${width}px`;
  console.log(`\n${label}`);
  const shot = async (name) =>
    page.screenshot({ path: join(SHOTS, `${locale}-${width}-${name}.png`) });

  const noOverflow = async (where) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(overflow <= 0, `${where}: no horizontal overflow`, `${overflow}px`);
  };

  // --- 1. the app loads, and says what it is -------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Student OS Preview', { timeout: 25_000 });
  check(true, 'preview banner is present');

  // --- 2. password reset, reached before signing in ------------------------
  await clickVisible(page, c.forgot);
  await page.waitForTimeout(1200);
  check((await visibleCount(page, c.forgotTitle)) > 0, 'forgot password is reachable from sign-in');
  await shot('01-forgot-password');
  await page.goBack();
  await page.waitForTimeout(1200);

  // --- 3. sign in ----------------------------------------------------------
  const inputs = page.locator('input');
  await inputs.nth(0).fill('preview@student-os.example');
  await inputs.nth(1).fill('preview-password');
  /*
   * By role, not by text. The screen's heading and its submit control carry
   * the same words, and a text match resolved to the heading — which is not
   * clickable, so the journey silently continued as a signed-out visitor
   * while every later assertion still passed against fixture data that does
   * not require a session.
   */
  await page.getByRole('button', { name: c.signIn }).first().click();
  await page.waitForTimeout(3500);
  await shot('02-home');
  // Proof of arrival, not absence of a URL: the masthead only exists inside
  // the app, and the sign-in submit only exists outside it.
  check(
    (await visibleCount(page, 'Student OS')) > 0 &&
      (await page.getByRole('button', { name: c.signIn }).count()) === 0,
    'sign-in authenticates and lands on Home',
  );
  await noOverflow('home');

  // --- 4. learn → topic → practice → answer → feedback ---------------------
  await page.goto(`${BASE}/learn`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await noOverflow('learn');
  await shot('03-learn');

  await page.goto(`${BASE}/topic/t-acid-base`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await noOverflow('topic');
  await shot('04-topic');

  await page.goto(`${BASE}/practice/t-acid-base`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await clickVisible(page, 'Metabolic acidosis with respiratory compensation');
  await clickVisible(page, c.check);
  await page.waitForTimeout(1500);
  const verdict = locale === 'ar' ? 'إجابة صحيحة' : 'Correct';
  check((await visibleCount(page, verdict)) > 0, 'practice returns a worded verdict');
  await noOverflow('practice');
  await shot('05-practice-feedback');

  // --- 5. classroom --------------------------------------------------------
  await page.goto(`${BASE}/classrooms/classroom-1`, { waitUntil: 'networkidle' });
  await waitVisible(page, c.lectures);
  check(true, 'classroom renders its lectures');
  await noOverflow('classroom');
  await shot('06-classroom');

  // --- 6. messages and the conversation ------------------------------------
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
  await waitVisible(page, 'Layla Hassan');
  check(
    (await visibleCount(page, c.unavailable)) > 0,
    'messages states the realtime limitation instead of faking it',
  );
  await noOverflow('messages');
  await shot('07-messages');

  await page.goto(`${BASE}/chat/conv-1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await noOverflow('conversation');
  await shot('08-conversation');

  // --- 7. search -----------------------------------------------------------
  await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.locator('input').first().fill('lay');
  await page.waitForTimeout(2000);
  check((await visibleCount(page, 'Layla Hassan')) > 0, 'search returns fixture people');
  await noOverflow('search');
  await shot('09-search');

  // --- 8. profile, then report, then block ---------------------------------
  await page.goto(`${BASE}/profile/layla.hassan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await noOverflow('profile');
  await shot('10-profile');

  // Report lives in the profile's overflow menu, not on the surface — a
  // report is a deliberate act, not a control you can brush past.
  await page.getByLabel(c.more).first().click();
  await page.waitForTimeout(1000);
  await clickVisible(page, c.report);
  await page.waitForTimeout(1400);
  await clickVisible(page, c.reportReason);
  await clickVisible(page, c.submitReport);
  await page.waitForTimeout(1800);
  check(
    (await page.locator('body').innerText()).includes(c.reportThanks),
    'a report is filed against fixture state and confirmed',
  );
  await shot('11-report-filed');

  // Blocking is offered on the report confirmation, which is the whole point
  // of putting it there — reporting does not hide the content, blocking does.
  const blockWord = locale === 'ar' ? 'حظر هذا الشخص' : 'Block this person';
  const blockOffered = (await visibleCount(page, blockWord)) > 0;
  check(blockOffered, 'blocking is offered on the report confirmation');
  if (blockOffered) {
    await clickVisible(page, blockWord);
    await page.waitForTimeout(2000);
    await shot('12-blocked');
  }

  // --- 9. compose ----------------------------------------------------------
  await page.goto(`${BASE}/compose`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await noOverflow('compose');
  await shot('13-compose');

  // --- 10. settings, and the inert notifications state ---------------------
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(
    (await page.locator('body').innerText()).includes(c.notifBlocked),
    'settings names the notifications state',
  );
  await noOverflow('settings');
  await shot('14-settings');

  // --- 11. account deletion ------------------------------------------------
  await page.goto(`${BASE}/settings/delete-account`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check(
    (await page.locator('body').innerText()).includes(c.deleteTitle),
    'the deletion lifecycle screen renders',
  );
  await noOverflow('delete-account');
  await shot('15-delete-account');

  // --- 12. the preview feedback form ---------------------------------------
  await page.goto(`${BASE}/preview-feedback`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  check((await visibleCount(page, c.feedbackTitle)) > 0, 'the feedback form is reachable');
  // One answer in each of the collected shapes: a context, a rating, and free
  // text. Submitting proves the whole form resolves without a backend.
  const scaleWord = locale === 'ar' ? 'نعم، بسهولة' : 'Yes, easily';
  await clickVisible(page, locale === 'ar' ? 'التطبيق كله' : 'The whole app');
  await clickVisible(page, scaleWord);
  const areas = page.locator('textarea');
  if ((await areas.count()) >= 2) {
    await areas.nth(0).fill('nothing yet');
    await areas.nth(1).fill('more spacing');
  }
  await noOverflow('feedback');
  await shot('16-feedback');
  await clickVisible(page, c.feedbackSend);
  await page.waitForTimeout(1500);
  check(
    (await page.locator('body').innerText()).includes(c.feedbackThanks),
    'feedback submits and is confirmed',
  );
  await shot('17-feedback-sent');

  // --- 13. a direct reload is not a 404 ------------------------------------
  const reload = await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  check(reload?.status() === 200, 'a direct reload of a deep route is served', String(reload?.status()));
  await page.waitForTimeout(1500);
  check((await page.locator('body').innerText()).length > 100, 'the reloaded route renders content');

  // --- 14. nothing left the origin -----------------------------------------
  check(offOrigin.length === 0, 'no request left the preview origin', offOrigin.slice(0, 5).join(' | '));
  const attempted = await page.evaluate(() => window.__socketAttempts ?? []);
  check(
    sockets.length === 0 && attempted.length === 0,
    'no WebSocket was opened or even attempted',
    [...sockets, ...attempted].slice(0, 3).join(' | '),
  );

  const pushUsed = await page.evaluate(() => {
    // The app must never have asked for notification permission: push is inert
    // on this platform, and a prompt would be a promise it cannot keep.
    const w = /** @type {any} */ (window);
    return Boolean(w.__notificationPermissionRequested);
  });
  check(pushUsed === false, 'no push permission was requested');

  const dir = await page.evaluate(() => document.documentElement.dir);
  check(dir === (locale === 'ar' ? 'rtl' : 'ltr'), 'document direction matches the locale', dir);
  check(errors.length === 0, 'no uncaught browser errors', errors.slice(0, 3).join(' | '));

  await context.close();
}

for (const [locale, width] of [
  ['ar', 360],
  ['en', 360],
  ['ar', 390],
  ['en', 390],
]) {
  await run(locale, width);
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error('deployed preview acceptance FAILED');
  process.exit(1);
}
console.log('deployed preview acceptance passed');
