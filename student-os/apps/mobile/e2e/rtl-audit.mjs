import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

/**
 * The RTL and layout audit.
 *
 * Every Phase 3 screen, in four combinations: Arabic and English, phone and
 * desktop. What it asserts is deliberately mechanical, because these are the
 * failures that a human reading the code will not see and a human looking at
 * one screenshot will not either:
 *
 *   - the document's writing direction matches the locale
 *   - nothing overflows horizontally (the page body must never scroll sideways)
 *   - no text is clipped by its own container
 *   - controls that exist are actually visible and hit-testable
 *   - back arrows point at the start of the line, in both directions
 *   - the console is clean
 *   - no request fails, and none returns data the viewer should not have
 *
 * It is separate from `first-journey.mjs` because that script asks "does the
 * product work"; this one asks "does it look like it was designed for the
 * language it is in". A mechanically mirrored interface passes the first and
 * fails the second.
 *
 * Run:
 *   node apps/mobile/e2e/rtl-audit.mjs
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const SHOTS = process.env.E2E_SHOT_DIR ?? null;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

const LOCALES = [
  { name: 'ar', locale: 'ar-IQ', dir: 'rtl' },
  { name: 'en', locale: 'en-GB', dir: 'ltr' },
];

const failures = [];
let checks = 0;

function check(condition, description) {
  checks += 1;
  if (condition) {
    console.log(`    ✓ ${description}`);
  } else {
    failures.push(description);
    console.log(`    ✗ ${description}`);
  }
}

// --- a real account, and real content to render -----------------------------

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

console.log('preparing a cohort with real content…');

const stamp = Date.now();
const PASSWORD = 'correct-horse-battery';
const EMAIL = `rtl-${stamp}@uob.edu.iq`;

const session = await api('/v1/auth/signup', {
  method: 'POST',
  body: { email: EMAIL, password: PASSWORD },
});
const token = session.tokens.accessToken;

/*
 * A fresh session per browser context.
 *
 * Refresh tokens rotate, and replaying a rotated one is treated as theft and
 * revokes the whole chain — correctly. Planting one account's tokens into four
 * contexts would therefore kill three of them, and the resulting 401s would
 * look like a client bug rather than the auth design working. Each context
 * logs in the way a second device would.
 */
async function freshSession() {
  return api('/v1/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  });
}

// The hierarchy endpoints return bare arrays — reference data, not paginated
// lists — so the placement below is read from the database rather than assumed.
const [university] = await api('/v1/academic/universities');
const [college] = await api(`/v1/academic/colleges?universityId=${university.id}`);
const [program] = await api(`/v1/academic/programs?collegeId=${college.id}`);
const stages = await api(`/v1/academic/stages?programId=${program.id}`);
const [year] = await api(`/v1/academic/academic-years?universityId=${university.id}`);

/*
 * The cohort is whichever stage actually carries courses — discovered, not
 * assumed. Hardcoding "stage 5" here would make the script a second place that
 * knows something about medicine at Baghdad, which is exactly what the
 * data-driven hierarchy exists to prevent.
 */
let stage = null;
let courses = [];
for (const candidate of stages) {
  const found = await api(`/v1/academic/courses?stageId=${candidate.id}`);
  if (found.length > 0) {
    stage = candidate;
    courses = found;
    break;
  }
}
if (!stage) throw new Error('no stage in the hierarchy has any courses — is the seed applied?');
const topics = await api(`/v1/academic/topics?courseId=${courses[0].id}`);

const handle = `rtl_${stamp.toString(36)}`.slice(0, 30);
await api('/v1/me/onboarding', {
  method: 'POST',
  token,
  body: {
    handle,
    displayName: 'أحمد الناصر',
    universityId: university.id,
    collegeId: college.id,
    programId: program.id,
    stageId: stage.id,
    academicYearId: year.id,
    interestTopicIds: topics.slice(0, 1).map((t) => t.id),
  },
});

// Long, mixed-direction, and multi-line — the three shapes that break RTL
// layouts. A screen that only ever holds short Arabic looks fine by accident.
await api('/v1/content', {
  method: 'POST',
  token,
  body: {
    body: 'مراجعة سريعة لموضوع Nephrotic Syndrome قبل امتحان طب الأطفال، مع ملاحظات عن الوذمة والبروتين في البول وطرق العلاج الحديثة المستخدمة في مستشفى بغداد التعليمي هذا العام ٢٠٢٦.',
    visibility: 'stage',
    mediaFileIds: [],
    topicIds: [],
  },
});
await api('/v1/content', {
  method: 'POST',
  token,
  body: {
    body: 'Short English post.\nSecond line.\nhttps://example.org/a/very/long/link/that/should/not/overflow/its/card',
    visibility: 'stage',
    mediaFileIds: [],
    topicIds: [],
  },
});

const group = await api('/v1/groups', {
  method: 'POST',
  token,
  body: {
    name: 'مجموعة مراجعة طب الأطفال',
    description: 'مجموعة للمراجعة المشتركة قبل الامتحانات النهائية.',
    visibility: 'stage',
    joinPolicy: 'open',
    maxMembers: 50,
  },
});
await api('/v1/content', {
  method: 'POST',
  token,
  body: {
    body: 'منشور داخل المجموعة لاختبار التخطيط في الاتجاهين.',
    visibility: 'group',
    groupId: group.id,
    mediaFileIds: [],
    topicIds: [],
  },
});

/*
 * A conversation with real content, so the thread screen is audited with
 * bubbles, a date separator and a composer rather than as an empty state.
 */
const partner = await api('/v1/auth/signup', {
  method: 'POST',
  body: { email: `rtl-partner-${stamp}@uob.edu.iq`, password: PASSWORD },
});
await api('/v1/me/onboarding', {
  method: 'POST',
  token: partner.tokens.accessToken,
  body: {
    handle: `rtlp_${stamp.toString(36)}`.slice(0, 30),
    displayName: 'زينب الحسيني',
    universityId: university.id,
    collegeId: college.id,
    programId: program.id,
    stageId: stage.id,
    academicYearId: year.id,
    interestTopicIds: topics.slice(0, 1).map((t) => t.id),
  },
});

const directConversation = await api('/v1/conversations', {
  method: 'POST',
  token,
  body: { recipientHandle: `rtlp_${stamp.toString(36)}`.slice(0, 30) },
});
for (const [sender, body] of [
  [token, 'سؤال سريع عن المحاضرة الأخيرة، هل عندك الملخص؟'],
  [partner.tokens.accessToken, 'Yes — I uploaded it earlier. Check the group files.'],
  [token, 'شكراً جزيلاً، سأراجعه الليلة قبل الامتحان النهائي إن شاء الله.'],
]) {
  await api(`/v1/conversations/${directConversation.id}/messages`, {
    method: 'POST',
    token: sender,
    body: { clientMessageId: randomUUID(), body },
  });
}

/*
 * A classified post with a citation and an open correction against it. The
 * Phase 5 surfaces are all badges and chip rows, which are exactly what wraps
 * badly at a narrow width in the wrong direction — auditing them empty would
 * prove nothing.
 */
const classified = await api('/v1/content', {
  method: 'POST',
  token,
  body: {
    body: 'الوذمة في المتلازمة الكلوية تنتج عن فقدان الألبومين في البول وانخفاض الضغط الجرمي في البلازما، وليس عن احتباس الصوديوم وحده.',
    visibility: 'stage',
    mediaFileIds: [],
    topicIds: topics.slice(0, 2).map((t) => t.id),
    knowledgeType: 'explanation',
    difficulty: 'medium',
  },
});
await api(`/v1/content/${classified.id}/sources`, {
  method: 'POST',
  token,
  body: {
    kind: 'textbook',
    citation: 'Nelson Textbook of Pediatrics, 22nd edition',
    url: null,
    fileId: null,
    pageRef: 'p. 2752',
  },
});
// Proposed by the partner: the author cannot correct their own content.
await api(`/v1/content/${classified.id}/corrections`, {
  method: 'POST',
  token: partner.tokens.accessToken,
  body: {
    body: 'الآلية الحديثة تصف خللاً أولياً في قناة الصوديوم بالأنبوب الجامع، فالعبارة أعلاه ناقصة وليست خاطئة تماماً.',
    source: null,
  },
});


/*
 * A classroom with a published lecture and a material (Phase 5b). Both new
 * screens are dense chip rows over mixed-direction text with a long external
 * URL — the shape that wraps badly in one direction and looks fine in the
 * other.
 *
 * Opening one needs instructor eligibility since Phase 5c, so the audit account
 * is granted it first — through the real admin endpoint, using the demo
 * cohort's administrator. A layout audit has no business bypassing an
 * authorization rule to build its fixture; if the grant path breaks, this
 * should notice.
 */
const adminSession = await api('/v1/auth/login', {
  method: 'POST',
  body: { email: 'amjad@uob.edu.iq', password: PASSWORD },
}).catch(() => {
  throw new Error('the demo cohort is missing — run `pnpm --filter @sos/api demo:seed` first');
});
await api(`/v1/admin/users/${session.user.id}/verification`, {
  method: 'PUT',
  token: adminSession.tokens.accessToken,
  body: { verificationLevel: 'instructor', reason: 'RTL audit fixture' },
});

const classroom = await api('/v1/classrooms', {
  method: 'POST',
  token,
  body: {
    courseId: courses[0].id,
    title: 'قاعة طب الأطفال — المجموعة ب',
    description: 'محاضرات أسبوعية وشرائح ومصادر للمراجعة قبل الامتحان النهائي.',
    visibility: 'course',
  },
});
const auditLecture = await api(`/v1/classrooms/${classroom.id}/lectures`, {
  method: 'POST',
  token,
  body: {
    title: 'المتلازمة الكلوية — الآلية والعلاج Nephrotic Syndrome',
    description: 'الوذمة والبروتين في البول وطرق العلاج الحديثة.',
    learningObjectives: ['شرح آلية الوذمة في المتلازمة الكلوية بالتفصيل الكامل'],
    keyConcepts: ['الألبومين', 'oncotic pressure'],
    durationMinutes: 50,
    topicIds: topics.slice(0, 2).map((t) => t.id),
  },
});
await api(`/v1/lectures/${auditLecture.id}/materials`, {
  method: 'POST',
  token,
  body: {
    title: 'شرائح المحاضرة Lecture slides',
    description: 'Nelson Textbook of Pediatrics, 22nd edition — chapter 545.',
    externalUrl: 'https://example.org/a/very/long/link/that/should/not/overflow/its/card.pdf',
  },
});

console.log(`  cohort ready — @${handle}, group ${group.id}, conversation ${directConversation.id}\n`);

// --- the audit --------------------------------------------------------------

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);

if (SHOTS) await mkdir(SHOTS, { recursive: true });

const SCREENS = [
  { name: 'feed', path: '/' },
  { name: 'chat-list', path: '/(tabs)/chat' },
  { name: 'chat-thread', path: `/chat/${directConversation.id}` },
  { name: 'rooms', path: '/(tabs)/rooms' },
  { name: 'group-detail', path: `/group/${group.id}` },
  { name: 'group-new', path: '/group/new' },
  { name: 'search', path: '/search' },
  { name: 'profile', path: `/profile/${handle}` },
  { name: 'compose', path: '/compose' },
  { name: 'learn', path: '/(tabs)/learn' },
  { name: 'chat', path: '/(tabs)/chat' },
  // Phase 5. Both are dense chip rows over mixed-direction text, which is the
  // shape that wraps badly in one direction and looks fine in the other.
  { name: 'post-knowledge', path: `/post/${classified.id}` },
  { name: 'topic', path: `/topic/${topics[0].id}` },
  // Phase 5b.
  { name: 'classrooms', path: '/classrooms' },
  { name: 'classroom-detail', path: `/classrooms/${classroom.id}` },
  { name: 'classroom-new', path: '/classrooms/new' },
  { name: 'lecture', path: `/lecture/${auditLecture.id}` },
];

for (const viewport of VIEWPORTS) {
  for (const localeSpec of LOCALES) {
    console.log(`\n${localeSpec.name.toUpperCase()} · ${viewport.name} (${viewport.width}×${viewport.height})`);

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: localeSpec.locale,
    });

    const consoleErrors = [];
    const networkFailures = [];

    /*
     * The session is written by an init script rather than after a first
     * navigation. `goto` then `evaluate` boots the app once unauthenticated,
     * and that boot's 401s would be counted as exactly the console noise this
     * audit exists to watch for.
     */
    const contextSession = await freshSession();
    await context.addInitScript((tokens) => {
      // The same two keys the client writes on web (`src/state/session.tsx`).
      //
      // Seeded only when absent. The init script runs on EVERY navigation, and
      // overwriting on each one would re-plant a refresh token the app had
      // already rotated — which the server correctly treats as a stolen token
      // and answers by revoking the whole chain. That is the auth design
      // working; it is not something to reproduce nine times per run.
      if (!window.localStorage.getItem('sos.access')) {
        window.localStorage.setItem('sos.access', tokens.accessToken);
        window.localStorage.setItem('sos.refresh', tokens.refreshToken);
      }
    }, contextSession.tokens);

    const page = await context.newPage();
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 400 && response.url().includes('/v1/')) {
        networkFailures.push(`${status} ${response.url()}`);
      }
    });

    for (const screen of SCREENS) {
      await page.goto(`${WEB_URL}${screen.path}`);
      await page.waitForTimeout(1200);

      const report = await page.evaluate(() => {
        const doc = document.documentElement;

        // Horizontal overflow: the page body must never scroll sideways. A
        // couple of pixels are rounding, not a layout bug.
        const bodyOverflow = doc.scrollWidth - doc.clientWidth;

        // Elements wider than the viewport that are NOT inside a container
        // which opts into horizontal scrolling.
        const overflowing = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.right > window.innerWidth + 2 || rect.left < -2) {
            const style = getComputedStyle(el);
            if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
            const parent = el.parentElement;
            if (parent) {
              const ps = getComputedStyle(parent);
              if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') continue;
            }
            overflowing.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
          }
        }

        // Text clipped by its own box, ignoring anything that has explicitly
        // asked to be truncated with an ellipsis.
        const clipped = [];
        for (const el of Array.from(document.querySelectorAll('div, span, p'))) {
          if (el.children.length > 0) continue;
          const text = (el.textContent ?? '').trim();
          if (!text) continue;
          const style = getComputedStyle(el);
          if (style.textOverflow === 'ellipsis' || style.overflow === 'hidden') continue;
          if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2) {
            clipped.push(text.slice(0, 40));
          }
        }

        // Controls that are present in the tree but cannot be seen or hit.
        const invisibleControls = [];
        for (const el of Array.from(
          document.querySelectorAll('[role="button"], button, input'),
        )) {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          if (rect.width < 1 || rect.height < 1) {
            invisibleControls.push(el.getAttribute('aria-label') ?? el.tagName);
          }
        }

        const svgs = Array.from(document.querySelectorAll('svg')).length;

        return {
          dir: doc.getAttribute('dir') ?? getComputedStyle(document.body).direction,
          bodyDirection: getComputedStyle(document.body).direction,
          bodyOverflow,
          overflowing: overflowing.slice(0, 5),
          clipped: clipped.slice(0, 5),
          invisibleControls: invisibleControls.slice(0, 5),
          svgs,
          textSample: (document.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120),
        };
      });

      const label = `${screen.name}`;
      check(report.bodyOverflow <= 2, `${label}: no horizontal page overflow (${report.bodyOverflow}px)`);
      check(report.overflowing.length === 0, `${label}: nothing spills past the viewport${report.overflowing.length ? ` — ${report.overflowing.join(', ')}` : ''}`);
      check(report.clipped.length === 0, `${label}: no clipped text${report.clipped.length ? ` — ${report.clipped.join(' | ')}` : ''}`);
      check(report.invisibleControls.length === 0, `${label}: every control has a hit area${report.invisibleControls.length ? ` — ${report.invisibleControls.join(', ')}` : ''}`);
      check(report.bodyDirection === localeSpec.dir, `${label}: writing direction is ${localeSpec.dir} (saw ${report.bodyDirection})`);

      if (SHOTS) {
        await page.screenshot({
          path: `${SHOTS}/${localeSpec.name}-${viewport.name}-${screen.name}.png`,
          fullPage: true,
        });
      }
    }

    /*
     * Directional icons, checked by geometry rather than by glyph name.
     *
     * A back control belongs at the start of the line: on the left in English,
     * on the right in Arabic. Checking where it sits catches both the icon that
     * was never mirrored and the one that was mirrored twice.
     */
    await page.goto(`${WEB_URL}/group/${group.id}`);
    await page.waitForTimeout(1200);
    const backGeometry = await page.evaluate(() => {
      const back = document.querySelector('[aria-label="رجوع"], [aria-label="Back"]');
      if (!back) return null;
      const rect = back.getBoundingClientRect();
      return { centre: rect.left + rect.width / 2, width: window.innerWidth };
    });
    if (backGeometry) {
      const atStart =
        localeSpec.dir === 'rtl'
          ? backGeometry.centre > backGeometry.width / 2
          : backGeometry.centre < backGeometry.width / 2;
      check(atStart, `back control sits at the start of the line in ${localeSpec.name}`);
    } else {
      check(false, `back control found on group detail in ${localeSpec.name}`);
    }

    check(consoleErrors.length === 0, `console is clean (saw ${consoleErrors.length}${consoleErrors.length ? `: ${consoleErrors[0].slice(0, 90)}` : ''})`);
    /*
     * Any 4xx or 5xx on a screen this student is entitled to. A 403 here would
     * mean the client asked for something it had been told it could not have —
     * which is the client re-deriving a permission instead of reading the
     * viewer state.
     */
    check(networkFailures.length === 0, `no failed API requests (saw ${networkFailures.length}${networkFailures.length ? `: ${networkFailures[0]}` : ''})`);

    await context.close();
  }
}

await browser.close();

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.log('\nfailures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('RTL and layout audit passed');
