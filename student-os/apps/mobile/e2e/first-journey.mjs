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
  /*
   * The frozen design replaced the "Hi {name}" greeting with the product
   * masthead plus the cohort line: Home states where you are, not who you
   * are, because the identity is already the account you signed into. The
   * profile-derived facts below are the part that still has to be real.
   */
  check(home.includes('Student OS'), 'home shows the product masthead');
  check(home.includes('كلية الطب'), 'home shows the real college from the profile');
  check(home.includes('المرحلة الخامسة'), 'home shows the real stage from the profile');
  /*
   * The feed either offers the empty state or shows real cohort content — what
   * it must never do is render a blank area. Asserting the empty state alone
   * only held while the database happened to be empty; once a cohort has posts
   * a new student correctly lands in a populated feed, and a test that failed
   * on that would be testing the fixture rather than the product.
   */
  check(
    home.includes('كن أول من ينشر') || home.includes('مصنَّف ضمن مواضيعك'),
    'the home feed shows either a real empty state or the classification section',
  );

  console.log('step 5 — the five primary destinations');
  // The frozen five: Today · Topics · Learn · Rooms · Chat (04-NAVIGATION.md).
  for (const [tab, label] of [
    ['المواضيع', '10-topics'],
    ['التعلّم', '12-learn'],
    ['القاعات', '11-rooms'],
    ['المحادثات', '13-chat'],
  ]) {
    await visibleText(tab).click();
    await settle(label);
  }
  const shell = await page.locator('body').innerText();
  // Rooms replaces the old Groups tab; a new student has no rooms at all.
  check(shell.includes('لا قاعات بعد'), 'rooms shell has a real empty state');
  // Topics is the curriculum browser the frozen five added to the bar.
  check(shell.includes('كل ما يُدرَّس لمرحلتك'), 'topics tab states what it lists');
  /*
   * Phase 5 replaced the Learn shell. It used to list "topics to review" as a
   * coming-soon card whether or not any existed; it now shows sections only
   * where the student has signals. This student has exactly one signal — the
   * interest they declared two steps ago — so Learn shows the interests
   * section and nothing else. That is the cold-start path working: the
   * screen is built from a real row, not from a placeholder.
   */
  /*
   * The frozen Learn groups topics by evidence rather than by section label:
   * a student with one declared interest and no answers has nothing in the
   * difficulty group and their interest in the "not enough evidence" group.
   * The topic name and the evidence framing are what must be real.
   */
  check(
    shell.includes('لا توجد أدلة كافية للحكم'),
    'learn shows the low-evidence group for a student with no answers',
  );
  check(shell.includes('المتلازمة الكلوية'), 'learn names the declared interest topic');
  check(
    shell.includes('مبني فقط على الأسئلة التي أجبت عنها.'),
    'learn states that it is built only from answered questions',
  );
  check(
    shell.includes('إشارات نشاط دراسي، وليست تقييماً. تظهر لك وحدك.'),
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
    await page.getByText('من يمكنه رؤية هذا').last().isVisible(),
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
  // Study groups live in the Rooms tab now, alongside classrooms under their
  // distinct nouns; creation is the section's trailing link.
  await visibleText('القاعات').click();
  await settle('20-rooms-empty');
  check(
    (await page.locator('body').innerText()).includes('لا قاعات بعد') ||
      (await page.locator('body').innerText()).includes('لا مجموعات دراسة بعد'),
    'the rooms tab starts with a real empty state',
  );

  const groupName = `مجموعة الكلى ${Date.now().toString().slice(-6)}`;
  await page.getByLabel('مجموعة جديدة').last().click().catch(async () => {
    await page.getByText('مجموعة جديدة', { exact: true }).last().click();
  });
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
  // Exact label, not a substring. `بحث` is a substring of the Messages
  // screen's own people-search control, and that screen is mounted in the tab
  // navigator while Home covers it — so a loose match resolved to a control
  // that could never be clicked.
  await page
    .getByLabel('ابحث عن زملاء أو منشورات أو مجموعات…', { exact: true })
    .first()
    .click();
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
