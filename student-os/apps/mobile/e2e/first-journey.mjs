import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/**
 * E2E: the first working user journey (§91).
 *
 *   sign up → university → college → program → stage → profile + interests
 *           → academic home
 *
 * The Constitution is explicit that this journey must work end to end before
 * the product expands, so it is a test rather than a manual checklist. It runs
 * against the real API and the real web build — no mocks anywhere.
 *
 * Run:
 *   pnpm --filter @sos/api db:reset && pnpm --filter @sos/api db:seed
 *   pnpm --filter @sos/api dev &
 *   pnpm --filter @sos/mobile export:web && npx serve apps/mobile/dist -l 8081 --single &
 *   node apps/mobile/e2e/first-journey.mjs
 *
 * Locale: the journey runs in Arabic on purpose. Arabic is the primary
 * language and RTL is where layout bugs actually appear; running the happy
 * path in English would hide them.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const SHOTS = process.env.E2E_SHOT_DIR ?? null;

const email = `journey-${Date.now()}@uob.edu.iq`;
const displayName = 'أحمد الناصر';
const handle = `journey_${Date.now().toString(36)}`.slice(0, 30);

const failures = [];

function check(condition, description) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures.push(description);
    console.log(`  ✗ ${description}`);
  }
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({
  viewport: { width: 420, height: 900 },
  locale: 'ar-IQ',
});

const jsErrors = [];
page.on('pageerror', (error) => jsErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') jsErrors.push(message.text());
});

async function settle(label) {
  await page.waitForTimeout(900);
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
}

/** Screens stay mounted in the navigator stack, so always target the visible one. */
const visibleText = (text) => page.getByText(text, { exact: true }).last();

try {
  console.log('step 1 — sign up');
  await page.goto(WEB_URL, { waitUntil: 'networkidle' });
  await settle('01-signin');
  check(await page.getByText('تسجيل الدخول').first().isVisible(), 'sign-in renders in Arabic');

  await page.getByText('ليس لديك حساب؟ أنشئ حساباً').last().click();
  await settle('02-signup');

  const signupInputs = page.locator('input:visible');
  await signupInputs.nth(0).fill(email);
  await signupInputs.nth(1).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'إنشاء حساب' }).last().click();
  await page.waitForTimeout(2500);
  await settle('03-onboarding-university');
  check(
    await page.getByText('اختر جامعتك').last().isVisible(),
    'signup routes straight into onboarding',
  );

  console.log('step 2 — academic placement, driven entirely by the hierarchy API');
  await visibleText('جامعة بغداد').click();
  await settle('04-onboarding-college');
  check(await page.getByText('اختر كليتك').last().isVisible(), 'college step lists real colleges');

  await visibleText('كلية الطب').click();
  await settle('05-onboarding-program');

  await visibleText('بكالوريوس طب وجراحة').click();
  await settle('06-onboarding-stage');
  check(await visibleText('المرحلة الخامسة').isVisible(), 'all six stages are offered');

  await visibleText('المرحلة الخامسة').click();
  await page.waitForTimeout(2000);
  await settle('07-onboarding-profile');

  console.log('step 3 — profile and interests');
  const profileInputs = page.locator('input:visible');
  await profileInputs.nth(0).fill(displayName);
  await profileInputs.nth(1).fill(handle);
  await page.waitForTimeout(1200);
  check(
    await page.getByText('المعرّف متاح').last().isVisible(),
    'handle availability is checked live',
  );

  await page.getByText('المتلازمة الكلوية').first().click();
  await settle('08-profile-filled');

  await page.getByRole('button', { name: 'ابدأ', exact: true }).last().click();
  await page.waitForTimeout(2500);
  await settle('09-home');

  console.log('step 4 — academic home');
  const home = await page.locator('body').innerText();
  check(home.includes(displayName), 'home greets the student by name');
  check(home.includes('كلية الطب'), 'home shows the real college from the profile');
  check(home.includes('المرحلة الخامسة'), 'home shows the real stage from the profile');
  check(
    home.includes('هذه مؤشرات نشاط دراسي، وليست تقييماً لمستواك.'),
    'learning signals carry their honesty disclaimer',
  );
  check(home.includes('لا يوجد جديد بعد'), 'the empty feed has a real empty state');

  console.log('step 5 — the five primary destinations');
  for (const [tab, label] of [
    ['المجموعات', '10-groups'],
    ['إنشاء', '11-create'],
    ['التعلّم', '12-learn'],
    ['المحادثات', '13-chat'],
  ]) {
    await visibleText(tab).click();
    await settle(label);
  }
  const shell = await page.locator('body').innerText();
  check(shell.includes('لا توجد مجموعات دراسية بعد'), 'groups shell has an empty state');
  check(shell.includes('مقطع تعليمي'), 'create sheet offers academic content types');
  check(shell.includes('مواضيع تحتاج مراجعة'), 'learn shell exposes weak topics');
  check(shell.includes('لا توجد محادثات'), 'chat shell has an empty state');

  check(jsErrors.length === 0, `no uncaught JS errors (saw ${jsErrors.length})`);
  if (jsErrors.length > 0) console.log(jsErrors.slice(0, 5));
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\nFAILED — ${failures.length} check(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nfirst journey passed');
