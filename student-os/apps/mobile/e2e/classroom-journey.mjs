import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

/**
 * E2E: the Phase 5b classroom journey.
 *
 *   instructor signs up → opens a classroom → publishes a lecture with a
 *   material → student signs up → finds the classroom → joins → opens the
 *   lecture → sees the material → asks a question in its discussion → RELOADS
 *   → state persists → the instructor sees the authoring control the student
 *   does not, and the server agrees → an outsider is refused the same
 *   classroom, lecture, material and discussion
 *
 * Everything runs against the real API and the real web bundle. Nothing here
 * is mocked, and no state is asserted that the database did not produce.
 *
 * The run is in Arabic because Arabic is the primary language and RTL is where
 * layout defects actually appear.
 */

const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:8081';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const SHOTS = process.env.E2E_SHOT_DIR ?? null;
const PASSWORD = 'correct-horse-battery';

const failures = [];
function check(condition, description) {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    failures.push(description);
    console.log(`  ✗ ${description}`);
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

async function call(path, options) {
  const { status, json } = await api(path, options);
  if (status >= 400) throw new Error(`${options?.method ?? 'GET'} ${path} → ${status}`);
  return json;
}

/**
 * Creates an onboarded student through the real API.
 *
 * The browser drives the *student's* journey; the instructor and the outsider
 * are set up over HTTP because a second and third full onboarding through the
 * UI would triple the run time while testing the onboarding screens a third
 * time — which `first-journey.mjs` already does.
 */
async function onboardedStudent(label, stageIndex = 0) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const email = `${label}-${stamp}@uob.edu.iq`;
  const session = await call('/v1/auth/signup', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  const token = session.tokens.accessToken;

  const [university] = await call('/v1/academic/universities', { token });
  const [college] = await call(`/v1/academic/colleges?universityId=${university.id}`, { token });
  const [program] = await call(`/v1/academic/programs?collegeId=${college.id}`, { token });
  const stages = await call(`/v1/academic/programs/${program.id}/stages`, { token }).catch(() =>
    call(`/v1/academic/stages?programId=${program.id}`, { token }),
  );
  const [year] = await call(`/v1/academic/academic-years?universityId=${university.id}`, { token });

  // The stage that actually has courses is discovered, never assumed: a
  // classroom belongs to a course, so a stage without one cannot host a room.
  const withCourses = [];
  for (const stage of stages) {
    const courses = await call(`/v1/academic/courses?stageId=${stage.id}`, { token });
    if (courses.length > 0) withCourses.push({ stage, courses });
  }
  if (withCourses.length === 0) throw new Error('no stage in the hierarchy has any courses');
  const chosen = withCourses[Math.min(stageIndex, withCourses.length - 1)];

  const handle = `${label}_${stamp.slice(-8)}`.slice(0, 30);
  const topics = await call(`/v1/academic/topics?courseId=${chosen.courses[0].id}`, { token });
  await call('/v1/me/onboarding', {
    method: 'POST',
    token,
    body: {
      handle,
      displayName: label === 'inst' ? 'د. أحمد الناصر' : 'زينب الحسيني',
      universityId: university.id,
      collegeId: college.id,
      programId: program.id,
      stageId: chosen.stage.id,
      academicYearId: year.id,
      interestTopicIds: topics.slice(0, 1).map((topic) => topic.id),
    },
  });

  return { email, token, handle, course: chosen.courses[0], stage: chosen.stage };
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: 'ar-IQ' });

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

const visibleText = (text) => page.getByText(text, { exact: true }).last();

/*
 * Every fixture this run creates carries a run stamp in its title.
 *
 * The browser reaches the classroom by clicking its name, and the database is
 * not reset between runs — so two runs whose rooms share a title put two
 * identical entries in the discovery list and the student joins whichever one
 * `.last()` happens to return. That is not a hypothetical: it made a run pass
 * against the *previous* run's classroom. Unique titles make "the room the
 * browser opened" and "the room this run created" the same room by
 * construction.
 */
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const ROOM_TITLE = `قاعة طب الأطفال — المجموعة ب ${RUN}`;
const LECTURE_TITLE = `المتلازمة الكلوية — الآلية والعلاج ${RUN}`;
const OTHER_LECTURE_TITLE = `التهاب السحايا — التشخيص المبكر ${RUN}`;
const MATERIAL_TITLE = `شرائح المحاضرة ${RUN}`;

try {
  console.log('setup — an instructor opens a classroom and publishes a lecture');
  const instructor = await onboardedStudent('inst');
  const student = await onboardedStudent('stud');

  const classroom = await call('/v1/classrooms', {
    method: 'POST',
    token: instructor.token,
    body: {
      courseId: instructor.course.id,
      title: ROOM_TITLE,
      description: 'محاضرات أسبوعية وشرائح ومصادر للمراجعة.',
      visibility: 'course',
    },
  });
  check(Boolean(classroom.joinCode), 'the instructor receives a join code');

  const lecture = await call(`/v1/classrooms/${classroom.id}/lectures`, {
    method: 'POST',
    token: instructor.token,
    body: {
      title: LECTURE_TITLE,
      description: 'الوذمة، البروتين في البول، والعلاج الحديث.',
      learningObjectives: ['شرح آلية الوذمة في المتلازمة الكلوية'],
      keyConcepts: ['الألبومين', 'الضغط الجرمي'],
      durationMinutes: 50,
    },
  });

  await call(`/v1/lectures/${lecture.id}/materials`, {
    method: 'POST',
    token: instructor.token,
    body: {
      title: MATERIAL_TITLE,
      description: 'Nelson, 22nd edition — chapter 545.',
      externalUrl: 'https://example.org/pediatrics/nephrotic-syndrome.pdf',
    },
  });

  // A second lecture in the same room, so "the thread belongs to this lecture"
  // is an observable fact rather than a claim about a single-lecture room.
  const otherLecture = await call(`/v1/classrooms/${classroom.id}/lectures`, {
    method: 'POST',
    token: instructor.token,
    body: {
      title: OTHER_LECTURE_TITLE,
      description: 'العلامات السريرية وفحص السائل الدماغي الشوكي.',
    },
  });
  console.log(`  classroom ${classroom.id}, lectures ${lecture.id} / ${otherLecture.id}`);

  // --- the student's journey, in a real browser ----------------------------

  console.log('\nstep 1 — the student signs in');
  await page.goto(WEB_URL, { waitUntil: 'networkidle' });
  await settle('c01-signin');
  await page.locator('input:visible').nth(0).fill(student.email);
  await page.locator('input:visible').nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).last().click();
  await page.waitForTimeout(2500);
  await settle('c02-home');
  check(await visibleText('التعلّم').isVisible(), 'the student lands in the app shell');

  console.log('step 2 — Learn offers Classrooms');
  await visibleText('التعلّم').click();
  await settle('c03-learn');
  check(
    await page.getByText('القاعات الدراسية').last().isVisible(),
    'the Learn tab links to classrooms',
  );

  await page.getByText('القاعات الدراسية').last().click();
  await settle('c04-classroom-list');

  console.log('step 3 — the classroom is discoverable and joinable');
  await visibleText('متاحة للانضمام').click();
  await page.waitForTimeout(1200);
  await settle('c05-discover');
  check(
    await page.getByText(ROOM_TITLE).last().isVisible(),
    'the classroom appears in discovery for an enrolled student',
  );

  await page.getByText(ROOM_TITLE).last().click();
  await page.waitForTimeout(1500);
  await settle('c06-classroom-before-join');

  const beforeJoin = await page.locator('body').innerText();
  check(
    beforeJoin.includes('انضم لعرض المحاضرات والمصادر.'),
    'a non-member is told to join rather than shown the lectures',
  );
  check(
    !beforeJoin.includes('رمز الانضمام'),
    'the join code is never shown to a student',
  );

  console.log('step 4 — joining');
  await page.getByRole('button', { name: 'انضمام', exact: true }).last().click();
  await page.waitForTimeout(2000);
  await settle('c07-classroom-joined');
  const afterJoin = await page.locator('body').innerText();
  check(afterJoin.includes('المحاضرات'), 'the lecture section appears after joining');
  check(
    afterJoin.includes(LECTURE_TITLE),
    'the published lecture is listed',
  );
  check(afterJoin.includes('طالب'), 'the viewer’s role is shown');

  console.log('step 5 — reading the lecture and its material');
  await page.getByText(LECTURE_TITLE).last().click();
  await page.waitForTimeout(1800);
  await settle('c08-lecture');
  const lectureText = await page.locator('body').innerText();
  check(lectureText.includes('ما ينبغي أن تستطيع فعله'), 'learning objectives are rendered');
  check(
    lectureText.includes('شرح آلية الوذمة في المتلازمة الكلوية'),
    'the instructor’s own objective text is shown',
  );
  check(lectureText.includes('المفاهيم الأساسية'), 'key concepts are rendered');
  check(lectureText.includes(MATERIAL_TITLE), 'the material is listed');
  check(
    (await page.getByRole('button', { name: 'فتح' }).count()) > 0,
    'the material offers a way to open it',
  );

  console.log('step 6 — asking a question in the lecture’s discussion');
  const question = 'لماذا تحدث الوذمة قبل انخفاض الألبومين بوضوح؟';
  check(
    (await page.getByText('النقاش').count()) > 0,
    'the lecture carries a discussion of its own',
  );
  check(
    (await page.getByText('أضف مصدراً').count()) === 0,
    'a student is not offered the material-authoring control',
  );

  await page.getByPlaceholder('اسأل عن هذه المحاضرة…').last().fill(question);
  await page.getByRole('button', { name: 'انشر', exact: true }).last().click();
  await page.waitForTimeout(2000);
  await settle('c09-discussion');
  check(
    (await page.locator('body').innerText()).includes(question),
    'the question appears in the thread straight away',
  );

  console.log('step 7 — marking it read, then RELOADING the browser');
  await page.getByRole('button', { name: 'ضع علامة مقروء', exact: true }).last().click();
  await page.waitForTimeout(1800);
  await settle('c10-marked-read');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await settle('c11-after-reload');
  const reloaded = await page.locator('body').innerText();
  check(
    reloaded.includes(LECTURE_TITLE),
    'after a full reload the lecture is still there',
  );
  check(reloaded.includes('تم وضع علامة مقروء'), 'the read state survived the reload');
  check(reloaded.includes(question), 'the question survived the reload — it is in the database');
  check(reloaded.includes(MATERIAL_TITLE), 'the material is still listed after the reload');

  console.log('step 8 — the thread belongs to this lecture, not to the room');
  const hereThread = await call(`/v1/lectures/${lecture.id}/discussion`, { token: student.token });
  const thereThread = await call(`/v1/lectures/${otherLecture.id}/discussion`, {
    token: student.token,
  });
  check(
    hereThread.items.some((item) => item.body === question),
    'the question is in this lecture’s thread',
  );
  check(
    !thereThread.items.some((item) => item.body === question),
    'the question is absent from the other lecture’s thread',
  );
  check(
    hereThread.items.find((item) => item.body === question)?.visibility === 'classroom',
    'the server forced classroom visibility, whatever the client sent',
  );

  /*
   * The post is stamped into the classroom container rather than being an
   * ordinary cohort post that merely mentions a lecture. That container is what
   * the feed's permission predicate gates on, so it is the thing worth checking
   * — and the leak check itself belongs against a reader who is NOT a member,
   * which is step 11. An author seeing their own post in their own feed is not
   * a leak, and is how groups have behaved since Phase 3.
   */
  const asked = hereThread.items.find((item) => item.body === question);
  check(asked?.container?.kind === 'classroom', 'the post is inside the classroom container');
  check(asked?.container?.id === classroom.id, 'and inside THIS classroom');

  console.log('step 9 — instructor authority is the server’s answer, not the screen’s');
  // The student's own request is refused even though their screen never drew
  // the control — the boundary is server-side, and this proves it directly.
  const studentPublishes = await api(`/v1/classrooms/${classroom.id}/lectures`, {
    method: 'POST',
    token: student.token,
    body: { title: 'محاضرة من طالب', role: 'owner' },
  });
  check(studentPublishes.status === 403, 'a student cannot publish a lecture, even claiming a role');
  const studentAttaches = await api(`/v1/lectures/${lecture.id}/materials`, {
    method: 'POST',
    token: student.token,
    body: { title: 'مصدر من طالب', externalUrl: 'https://example.org/x.pdf' },
  });
  check(studentAttaches.status === 403, 'a student cannot attach a material');

  // ...and the instructor, in a real browser, is offered what the student was not.
  const staffPage = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: 'ar-IQ' });
  await staffPage.goto(WEB_URL, { waitUntil: 'networkidle' });
  await staffPage.waitForTimeout(1200);
  await staffPage.locator('input:visible').nth(0).fill(instructor.email);
  await staffPage.locator('input:visible').nth(1).fill(PASSWORD);
  await staffPage.getByRole('button', { name: 'تسجيل الدخول', exact: true }).last().click();
  await staffPage.waitForTimeout(3000);
  await staffPage.goto(`${WEB_URL}/lecture/${lecture.id}`, { waitUntil: 'networkidle' });
  await staffPage.waitForTimeout(2500);
  if (SHOTS) await staffPage.screenshot({ path: `${SHOTS}/c12-instructor.png` });
  const staffText = await staffPage.locator('body').innerText();
  check(staffText.includes('أضف مصدراً'), 'the instructor IS offered the material-authoring control');
  check(staffText.includes(question), 'the instructor sees the student’s question');
  await staffPage.close();

  console.log('step 10 — the membership persisted, not just the page');
  const mine = await call('/v1/classrooms?scope=mine', { token: student.token });
  const joined = mine.items.find((room) => room.id === classroom.id);
  check(Boolean(joined), 'the classroom is in the student’s own list on a fresh request');
  check(joined?.viewer.isMember === true, 'the server agrees the student is a member');
  check(joined?.lectureCount === 2, 'the lecture count comes from the database');

  console.log('step 11 — an outsider is refused everything');
  // A student in a different stage: enrolled in different courses entirely.
  const outsider = await onboardedStudent('out', 1);
  const outsiderIsElsewhere = outsider.course.id !== instructor.course.id;

  const roomForOutsider = await api(`/v1/classrooms/${classroom.id}`, { token: outsider.token });
  const lectureForOutsider = await api(`/v1/lectures/${lecture.id}`, { token: outsider.token });
  if (outsiderIsElsewhere) {
    check(roomForOutsider.status === 404, 'the classroom is 404 for a student in another cohort');
    check(lectureForOutsider.status === 404, 'the lecture is 404 for a student in another cohort');
  } else {
    /*
     * The seed only has one stage with courses, so the "outsider" is a
     * cohort-mate. The meaningful boundary is then membership rather than
     * enrolment: they may see the room, and must still be refused its contents.
     */
    check(roomForOutsider.status === 200, 'an enrolled non-member may see the room exists');
    check(
      roomForOutsider.json?.viewer?.canRead === false,
      'an enrolled non-member is not allowed to read it',
    );
    check(lectureForOutsider.status === 404, 'the lecture is 404 for a non-member');
  }

  const membersForOutsider = await api(`/v1/classrooms/${classroom.id}/members`, {
    token: outsider.token,
  });
  check(membersForOutsider.status === 404, 'the roster is 404 for a non-member');

  const discussionForOutsider = await api(`/v1/lectures/${lecture.id}/discussion`, {
    token: outsider.token,
  });
  check(discussionForOutsider.status === 404, 'the discussion is 404 for a non-member');
  const postByOutsider = await api(`/v1/lectures/${lecture.id}/discussion`, {
    method: 'POST',
    token: outsider.token,
    body: { body: 'دعني أدخل' },
  });
  check(postByOutsider.status === 404, 'a non-member cannot post into the discussion');

  // The real leak test: an ambient feed belonging to someone who is not in the
  // room. The container predicate, not the visibility level, is what refuses it.
  const outsiderFeed = await call('/v1/feed?scope=recent&limit=50', { token: outsider.token });
  check(
    !outsiderFeed.items.some((item) => item.body === question),
    'a classroom post never reaches a non-member’s ordinary feed',
  );

  const anonymous = await api(`/v1/classrooms/${classroom.id}`);
  check(anonymous.status === 401, 'the classroom requires authentication at all');
  const anonymousThread = await api(`/v1/lectures/${lecture.id}/discussion`);
  check(anonymousThread.status === 401, 'the discussion requires authentication at all');

  console.log('step 12 — RTL and console');
  const direction = await page.evaluate(() => document.documentElement.dir);
  check(direction === 'rtl', `the document direction is rtl (saw ${direction})`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 0, `no horizontal overflow (${overflow}px)`);
  check(jsErrors.length === 0, `no uncaught JS errors (saw ${jsErrors.length})`);
  if (jsErrors.length > 0) console.log(jsErrors.slice(0, 5));
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\nFAILED — ${failures.length} check(s):`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log('\nclassroom journey passed');
