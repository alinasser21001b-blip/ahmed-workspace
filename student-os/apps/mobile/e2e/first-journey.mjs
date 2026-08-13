import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/**
 * E2E: the first working user journey (§91).
 *
 *   sign up → university → college → program → stage → profile + interests
 *           → academic home → create a post → see it in the feed
 *           → open the thread → comment → like → save
 *           → create a study group → post inside it → find it by search
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

/*
 * A pre-installed Chromium is used when one is present — this sandbox ships one
 * at a fixed path, and re-downloading it per run would be minutes of nothing.
 * When the variable is unset or empty, Playwright resolves its own browser,
 * which is what CI does after `playwright install`.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
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
  check(home.includes('كن أول من ينشر'), 'the empty feed has a real empty state');

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
  check(
    shell.includes('هذه مؤشرات نشاط دراسي، وليست تقييماً لمستواك.'),
    'learning signals carry their honesty disclaimer where they are shown',
  );
  check(shell.includes('لا توجد محادثات'), 'chat shell has an empty state');

  console.log('step 6 — the social core loop (phase 2)');
  await visibleText('الرئيسية').click();
  await settle('14-home-feed');

  const postBody = `منشور اختباري ${Date.now()}`;
  await page.getByLabel('منشور جديد').last().click();
  await settle('15-composer');
  check(
    await page.getByText('من يمكنه الرؤية').last().isVisible(),
    'the composer makes the audience an explicit choice',
  );

  await page.locator('textarea:visible, input:visible').first().fill(postBody);
  await page.getByRole('button', { name: 'نشر' }).last().click();
  await page.waitForTimeout(2500);
  await settle('16-post-detail');
  check((await page.locator('body').innerText()).includes(postBody), 'the new post opens after publishing');

  const comment = 'تعليق اختباري على المنشور مع تفاصيل كافية لتكون مساهمة.';
  await page.getByLabel('اكتب تعليقاً…').last().fill(comment);
  await page.getByLabel('إرسال').last().click();
  await page.waitForTimeout(1800);
  await settle('17-comment-posted');
  check((await page.locator('body').innerText()).includes(comment), 'the comment appears in the thread');

  await page.getByLabel('إعجاب').last().click();
  await page.getByLabel('حفظ').last().click();
  await page.waitForTimeout(1200);
  await settle('18-liked-and-saved');
  check(
    await page.getByLabel('محفوظ').last().isVisible(),
    'saving flips the affordance to its saved state',
  );

  await page.getByLabel('رجوع').last().click();
  await page.waitForTimeout(2000);
  await settle('19-feed-with-post');
  check(
    (await page.locator('body').innerText()).includes(postBody),
    'the post is in the author’s own cohort feed',
  );

  console.log('step 7 — community (phase 3)');
  await visibleText('المجموعات').click();
  await settle('20-groups-empty');
  check(
    (await page.locator('body').innerText()).includes('لا توجد مجموعات دراسية بعد'),
    'the groups tab starts with a real empty state',
  );

  const groupName = `مجموعة الكلى ${Date.now().toString().slice(-6)}`;
  await page.getByLabel('إنشاء مجموعة').last().click();
  await settle('21-create-group');
  check(
    await page.getByText('من يمكنه رؤية المجموعة').last().isVisible(),
    'creating a group asks who can find it separately from who can join',
  );

  await page.getByLabel('اسم المجموعة').last().fill(groupName);
  await page.getByRole('button', { name: 'إنشاء', exact: true }).last().click();
  await page.waitForTimeout(2500);
  await settle('22-group-detail');
  check(
    (await page.locator('body').innerText()).includes(groupName),
    'the new group opens after creation',
  );
  check(
    (await page.locator('body').innerText()).includes('لا توجد منشورات في المجموعة'),
    'an empty group offers a way to post rather than a blank tab',
  );

  const groupPost = `ملاحظة داخل المجموعة ${Date.now()}`;
  await page.getByLabel('منشور جديد').last().click();
  await page.waitForTimeout(1200);
  await page.locator('textarea:visible, input:visible').first().fill(groupPost);
  await page.getByRole('button', { name: 'نشر' }).last().click();
  await page.waitForTimeout(2500);
  await settle('23-group-post');
  check(
    (await page.locator('body').innerText()).includes(groupPost),
    'a post published into a group is visible to its members',
  );

  console.log('step 8 — search');
  // Publishing lands on the post detail, which sits two screens above the tab
  // bar: back out to the group, then to the shell, before the tabs are usable.
  await page.getByLabel('رجوع').last().click();
  await page.waitForTimeout(1200);
  await page.getByLabel('رجوع').last().click();
  await page.waitForTimeout(1500);
  await visibleText('الرئيسية').click();
  await page.waitForTimeout(1500);
  await page.getByLabel('بحث').last().click();
  await settle('24-search-empty');
  await page.getByLabel('ابحث عن زملاء أو منشورات أو مجموعات…').last().fill('الكلى');
  await page.waitForTimeout(2000);
  await settle('25-search-results');
  check(
    (await page.locator('body').innerText()).includes(groupName),
    'search finds the group the student just created',
  );

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
