import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/**
 * E2E: the social loop, on Today.
 *
 *   sign up → Today → create post → see it in the feed → like → unlike
 *           → comment → save → read it back on Saved → unsave
 *           → open a topic from a post → open an author's profile
 *           → report a post → block its author → confirm the block took
 *
 * This is the journey the owner's recovery brief specifies, and it exists
 * because the previous version of Today could not perform most of it: the feed
 * read posts and every act happened one screen deeper, saved posts had no
 * screen at all, and nothing in the app could start a conversation. A test
 * that only proved the detail screen worked would have kept saying "pass"
 * while the product's primary surface stayed read-only.
 *
 * Every assertion below is against the real API and a real (non-preview) web
 * build. Counts are read back from the interface after the server answers, so
 * an optimistic update that never reconciled would fail here.
 *
 * Run:
 *   E2E_WEB_URL=http://localhost:8085 node apps/mobile/e2e/social-journey.mjs
 *
 * Locale: Arabic, like the first journey — Arabic is the primary language, and
 * running the loop in English would hide exactly the bugs worth catching.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8085';
const SHOTS = process.env.E2E_SHOT_DIR ?? null;

const stamp = Date.now();
const email = `social-${stamp}@uob.edu.iq`;
const displayName = 'سارة الجبوري';
const handle = `social_${stamp.toString(36)}`.slice(0, 30);

const failures = [];
function check(condition, description) {
  if (condition) console.log(`  ✓ ${description}`);
  else {
    failures.push(description);
    console.log(`  ✗ ${description}`);
  }
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: 'ar-IQ' });

const jsErrors = [];
page.on('pageerror', (error) => jsErrors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') jsErrors.push(message.text());
});

async function settle(label, ms = 900) {
  await page.waitForTimeout(ms);
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${label}.png` });
  }
}

const visibleText = (text) => page.getByText(text, { exact: true }).last();
const body = () => page.locator('body').innerText();

/**
 * The controls belonging to ONE post.
 *
 * A feed is a list of other people's posts with the reader's own somewhere
 * inside it, so `getByLabel('save').first()` acts on whichever row happens to
 * sit at the top — which is how the first run of this test cheerfully saved a
 * stranger's post and then failed to find its own. Scope every interaction to
 * the innermost element that contains both the post's text and its actions,
 * and the assertions mean what they say.
 */
/**
 * Brings the post under test into the list's rendered window.
 *
 * The feed is virtualised and grows every time this journey runs, so a row can
 * legitimately not be in the DOM yet. Scrolling until it is keeps the test
 * honest about the feature (the row IS reachable) rather than depending on the
 * post happening to land in the first window.
 */
async function scrollTo(postText) {
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if ((await page.getByText(postText, { exact: false }).count()) > 0) {
      await page.getByText(postText, { exact: false }).last().scrollIntoViewIfNeeded();
      return true;
    }
    /*
     * The list scrolls its own container, not the window — a wheel event aimed
     * at the page does nothing, which is why an earlier version of this helper
     * scrolled fourteen times and found nothing. Drive whichever element is
     * actually scrollable, and walk it back to the top first: the row we want
     * is the newest post, so it is above wherever the list was left.
     */
    await page.evaluate((step) => {
      const scrollers = Array.from(document.querySelectorAll('div')).filter(
        (node) => node.scrollHeight > node.clientHeight + 20,
      );
      for (const scroller of scrollers) scroller.scrollTop += step;
      window.scrollBy(0, step);
    }, attempt === 0 ? -100_000 : 700);
    await page.waitForTimeout(450);
  }
  return false;
}

function actionIn(postText, label) {
  return page
    .locator('div')
    .filter({ has: page.getByLabel(label, { exact: true }) })
    .filter({ hasText: postText })
    .last()
    .getByLabel(label, { exact: true })
    .last();
}

try {
  console.log('step 1 — a real account');
  await page.goto(WEB_URL, { waitUntil: 'networkidle' });
  await settle('01-signin');
  await page.getByText('ليس لديك حساب؟ أنشئ حساباً').last().click();
  await settle('02-signup');
  const signupInputs = page.locator('input:visible');
  await signupInputs.nth(0).fill(email);
  await signupInputs.nth(1).fill('correct-horse-battery');
  await page.getByRole('button', { name: 'إنشاء حساب' }).last().click();
  await settle('03-onboarding', 2500);

  await visibleText('جامعة بغداد').click();
  await settle('04-college');
  await visibleText('كلية الطب').click();
  await settle('05-program');
  await visibleText('بكالوريوس طب وجراحة').click();
  await settle('06-stage');
  await visibleText('المرحلة الخامسة').click();
  await settle('07-profile', 2000);

  const profileInputs = page.locator('input:visible');
  await profileInputs.nth(0).fill(displayName);
  await profileInputs.nth(1).fill(handle);
  await page.waitForTimeout(1200);
  await page.getByText('المتلازمة الكلوية').first().click();
  await page.getByRole('button', { name: 'ابدأ', exact: true }).last().click();
  await settle('08-today', 2500);
  check((await body()).includes('Student OS'), 'Today opens on the masthead');

  console.log('step 2 — publish, then find it in the feed');
  const postBody = `الاعتلال الكلوي السكري — ملخص ${stamp}`;
  await page.getByLabel('منشور جديد').last().click();
  await settle('09-composer', 1200);
  await page.locator('textarea:visible, input:visible').first().fill(postBody);
  await page.getByRole('button', { name: 'نشر' }).last().click();
  await settle('10-published', 2500);

  // Back to Today: the loop's requirement is that the post is actionable on
  // the feed, not only on the screen publishing happened to land on.
  await page.getByLabel('رجوع').last().click();
  await settle('11-feed', 2000);
  check((await body()).includes(postBody), 'the new post is in the Today feed');

  console.log('step 3 — like and unlike, on the feed itself');
  check(await scrollTo(postBody), 'the post is reachable in the feed list');
  const like = actionIn(postBody, 'إعجاب');
  check(await like.isVisible(), 'the feed row carries a like control');
  await like.click();
  await settle('12-liked', 1800);
  // The count comes back from the server; a like that only ever existed in
  // local state would leave the label without its number.
  const likedRow = page
    .locator('div')
    .filter({ has: page.getByLabel(/^إعجاب/u) })
    .filter({ hasText: postBody })
    .last();
  check(
    (await likedRow.getByLabel(/إعجاب, ?[١1]/u).count()) > 0,
    'liking shows the server’s count beside the control',
  );

  await likedRow.getByLabel(/^إعجاب/u).last().click();
  await settle('13-unliked', 1800);
  check(
    (await actionIn(postBody, 'إعجاب').count()) > 0,
    'unliking returns the control to its unliked state',
  );

  console.log('step 4 — save, read back on Saved, unsave');
  await scrollTo(postBody);
  await actionIn(postBody, 'حفظ').click();
  await settle('14-saved', 1800);
  check(
    (await actionIn(postBody, 'محفوظ').count()) > 0,
    'saving flips the control to its saved state on the feed',
  );

  await visibleText('التعلّم').click();
  await settle('15-learn', 2000);
  check((await body()).includes('المنشورات المحفوظة'), 'Learn offers the saved posts destination');
  await visibleText('المنشورات المحفوظة').click();
  await settle('16-saved-screen', 2000);
  check((await body()).includes(postBody), 'the saved post is readable on the Saved screen');

  await actionIn(postBody, 'محفوظ').click();
  await settle('17-unsaved', 2000);
  check(
    !(await body()).includes(postBody),
    'unsaving removes the row from Saved rather than leaving a ghost',
  );

  console.log('step 5 — comment');
  await page.getByLabel('رجوع').last().click();
  await settle('18-back-to-learn', 1500);
  await visibleText('اليوم').click();
  await settle('19-today', 1800);
  check(await scrollTo(postBody), 'the post is still reachable after returning to Today');
  await actionIn(postBody, 'تعليق').click();
  await settle('20-post-detail', 2000);
  const comment = `التصنيف حسب مرحلة الاعتلال مفيد هنا — ${stamp}`;
  await page.getByLabel('اكتب تعليقاً…').last().fill(comment);
  await page.getByLabel('إرسال').last().click();
  await settle('21-commented', 2000);
  check((await body()).includes(comment), 'the comment appears in the thread');

  await page.getByLabel('رجوع').last().click();
  await settle('22-feed-after-comment', 2000);
  await scrollTo(postBody);
  check(
    (await page
      .locator('div')
      .filter({ has: page.getByLabel(/^تعليق/u) })
      .filter({ hasText: postBody })
      .last()
      .getByLabel(/تعليق, ?[١1]/u)
      .count()) > 0,
    'the feed shows the comment count the server returned',
  );

  console.log('step 6 — classification and identity are reachable from a post');
  await page.getByLabel(/المتلازمة الكلوية|شرح|ملخّص/u).first().click();
  await settle('23-topic', 2200);
  const topicScreen = await body();
  check(
    topicScreen.includes('المتلازمة الكلوية') || topicScreen.includes('الموضوع'),
    'the classification line opens the topic',
  );

  await page.goto(`${WEB_URL}/profile/${handle}`, { waitUntil: 'networkidle' });
  await settle('24-own-profile', 2200);
  const ownProfile = await body();
  check(ownProfile.includes(displayName), 'a profile shows the person’s academic identity');
  check(
    !/\b0\b/u.test(ownProfile.split('المتلازمة')[0] ?? ''),
    'no unexplained zero stands at the top of a profile',
  );

  console.log('step 7 — report and block, against a real second person');
  // @amjad is seeded by demo:seed. Reporting and blocking must work against
  // somebody who is not the author — the paths a student actually needs.
  await page.goto(`${WEB_URL}/profile/amjad`, { waitUntil: 'networkidle' });
  await settle('25-other-profile', 2500);
  const other = await body();
  check(other.includes('أمجد') || other.includes('amjad'), 'another student’s profile loads');
  check(
    (await page.getByLabel('مراسلة').count()) > 0 ||
      (await page.getByText('مراسلة').count()) > 0,
    'a profile offers a way to start a conversation',
  );

  await page.getByLabel('إجراءات أخرى').last().click();
  await settle('26-profile-menu', 1400);
  const menu = await body();
  check(menu.includes('الإبلاغ عن'), 'the profile menu offers reporting');
  check(menu.includes('حظر'), 'the profile menu offers blocking');

  await page.getByText('الإبلاغ عن', { exact: false }).last().click();
  await settle('27-report-sheet', 1600);
  const reportSheet = await body();
  check(
    reportSheet.includes('سبب') || reportSheet.includes('مضايقة') || reportSheet.includes('إبلاغ'),
    'the report sheet asks for a reason rather than filing silently',
  );

  // Out of the report sheet, then block — the act a student reaches for when
  // reporting is not enough. It is confirmed rather than instant, because it
  // cuts off messaging and visibility in one step.
  //
  // An earlier version of this test stopped here, asserting only that the
  // confirmation dialog's own title text was on screen — which is true the
  // instant the dialog opens, before anything has actually happened. That
  // let a real P0 ship silently: the client sent the block request with no
  // body at all, the server correctly rejected it with 400, and the
  // catch block swallowed the failure — so confirming looked identical to
  // this test whether the block worked or not. The dialog closing is not
  // evidence; the relationship actually changing is.
  await page.keyboard.press('Escape');
  await settle('28-after-report', 1200);
  await page.getByLabel('إجراءات أخرى').last().click();
  await settle('29-menu-again', 1400);
  await page.getByText('حظر', { exact: false }).last().click();
  await settle('30-block-confirm', 1400);
  check(
    (await body()).includes('حظر'),
    'blocking asks for confirmation before it applies',
  );

  await page.getByRole('button', { name: 'حظر @amjad', exact: true }).last().click();
  await settle('31-blocked', 2000);
  // This text renders only from `relationship.isBlocked`, freshly reloaded
  // from `GET /v1/profiles/:handle/relationship` after the mutation — it is
  // not a local/optimistic flag, so seeing it is proof the server accepted
  // the write, not just that the client believes it did.
  check(
    (await body()).includes('لقد حظرت هذا الشخص'),
    'the profile reflects the block actually taking effect, not just the dialog closing',
  );
  const unblockButton = page.getByLabel('إلغاء حظر @amjad', { exact: true }).last();
  check(await unblockButton.isVisible(), 'an unblock control appears once the block has taken');

  // Restore state: unblocking @amjad, a shared demo account other suites and
  // manual QA runs also rely on being reachable.
  await unblockButton.click();
  await settle('32-unblocked', 1800);
  check(
    !(await body()).includes('لقد حظرت هذا الشخص'),
    'unblocking restores the normal profile view',
  );

  console.log(`\n${jsErrors.length} console/page errors`);
  if (jsErrors.length > 0) console.log(jsErrors.slice(0, 5).join('\n'));
  check(jsErrors.length === 0, 'no console or page errors during the journey');
} catch (error) {
  failures.push(`journey threw: ${String(error).slice(0, 300)}`);
  console.error(error);
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/99-failure.png` });
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\nSOCIAL JOURNEY FAILED — ${failures.length} check(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nSOCIAL JOURNEY PASSED');
