/**
 * Demo seed — a small, realistic cohort for visual inspection.
 *
 * Everything here is created **through the HTTP API**, as a real student would.
 * Nothing is inserted directly into tables that the product would not write
 * itself. That is the point: a demo built by INSERT statements can show screens
 * that the real authorization, validation and ranking paths would never
 * produce, and then the review is of a fiction.
 *
 * There is exactly one exception, marked where it occurs: promoting @amjad to
 * platform administrator. That one cannot go through the API by construction —
 * only an administrator may create an administrator — so the first one in any
 * database has to come from outside it. Everything downstream of it, including
 * granting instructor verification, then goes through the real admin endpoints,
 * which means this seed exercises the Phase 5c workflow rather than
 * short-circuiting it, and leaves a genuine audit trail behind.
 *
 * It therefore needs DATABASE_URL as well as API_URL, pointed at the same
 * database the API is serving.
 *
 * Run against a database that is NOT production:
 *   DATABASE_URL=postgres://…/studentos_demo pnpm db:reset
 *   DATABASE_URL=postgres://…/studentos_demo pnpm db:seed        # hierarchy
 *   (start the API against the same database)
 *   API_URL=http://localhost:4000 pnpm --filter @sos/api demo:seed
 */

import { closePool, queryOne } from '../src/platform/db.js';
import { bootstrapPlatformAdmin } from './bootstrap-admin.js';

const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = 'correct-horse-battery';

interface Session {
  user: { id: string };
  tokens: { accessToken: string; refreshToken: string };
}

interface Student {
  handle: string;
  displayName: string;
  email: string;
  session: Session;
}

async function call<T>(
  path: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Refuses to seed a database that already carries the demo cohort.
 *
 * Everything below signs students up, and a second run therefore used to die on
 * `409 An account with that email already exists` — halfway through, after
 * having written nothing useful. That reads as a broken script rather than as
 * "this is already done", and it makes the seed unsafe to put in any pipeline
 * that might run twice.
 *
 * The probe is a login rather than a table read, for the same reason the rest of
 * this file goes through HTTP: if the API cannot authenticate @amjad, the demo
 * is not really present no matter what the rows say.
 */
async function demoCohortExists(): Promise<boolean> {
  const response = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'amjad@uob.edu.iq', password: PASSWORD }),
  });
  return response.ok;
}

if (await demoCohortExists()) {
  log('The demo cohort is already present in this database — nothing to seed.');
  log('');
  log('Sign in with amjad@uob.edu.iq, zainab@uob.edu.iq or omar@uob.edu.iq');
  log(`  password: ${PASSWORD}`);
  log('');
  log('To rebuild it from nothing: `pnpm db:reset && pnpm db:seed`, then run this again.');
  process.exit(0);
}

// --- the academic hierarchy, read from the database, never invented ---------

interface Named {
  id: string;
  nameAr: string;
  nameEn: string;
  slug?: string;
}

/**
 * Reads the first node of a hierarchy level, or fails loudly.
 *
 * `noUncheckedIndexedAccess` is on, and rightly: a demo that silently seeds
 * against `undefined` produces a cohort nobody belongs to, and the first sign
 * of it is an empty feed that looks like a product bug.
 */
function first<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) throw new Error(`no ${what} found — run \`pnpm db:seed\` first`);
  return row;
}

const university = first(await call<Named[]>('/v1/academic/universities'), 'university');
const college = first(
  await call<Named[]>(`/v1/academic/colleges?universityId=${university.id}`),
  'college',
);
const program = first(
  await call<Named[]>(`/v1/academic/programs?collegeId=${college.id}`),
  'program',
);
const stages = await call<(Named & { ordinal: number })[]>(
  `/v1/academic/stages?programId=${program.id}`,
);
const year = first(
  await call<Named[]>(`/v1/academic/academic-years?universityId=${university.id}`),
  'academic year',
);

/*
 * The cohort is whichever stage actually carries courses — discovered, not
 * assumed. Hardcoding "stage 5" here would put a second piece of knowledge
 * about medicine at Baghdad outside the seed file.
 */
let stage: (Named & { ordinal: number }) | null = null;
let courses: Named[] = [];
for (const candidate of stages) {
  const found = await call<Named[]>(`/v1/academic/courses?stageId=${candidate.id}`);
  if (found.length > 0) {
    stage = candidate;
    courses = found;
    break;
  }
}
if (!stage) throw new Error('no stage carries courses — run `pnpm db:seed` first');

const pediatrics = courses.find((c) => c.slug === 'pediatrics') ?? first(courses, 'course');
const subjects = await call<Named[]>(`/v1/academic/courses/${pediatrics.id}/subjects`);
const topics = await call<Named[]>(`/v1/academic/topics?courseId=${pediatrics.id}`);

log(`hierarchy: ${university.nameEn} → ${college.nameEn} → ${program.nameEn} → ${stage.nameEn}`);
log(`  course: ${pediatrics.nameEn}, ${subjects.length} subjects, ${topics.length} topics`);

const topicId = (fragment: string): string[] => {
  const match = topics.find((t) => t.nameEn.toLowerCase().includes(fragment.toLowerCase()));
  return match ? [match.id] : [];
};

// --- practice questions -----------------------------------------------------
//
// The SECOND and last exception to "everything goes through the API", and it is
// the same kind as the administrator bootstrap: there is no route to go through.
// Phase 5d ships the practice loop — a student answering questions and the
// signal that produces — not a quiz composer, so the only way to put questions
// in front of the demo cohort is to write the rows an authoring path eventually
// will.
//
// They are written exactly as that path would: `published_at` set, every
// question carrying the topic edge that lets performance roll up, and the key
// living only in `quiz_options.is_correct` where the grader reads it. Nothing
// here writes `learning_progress` — that has to come from the student
// answering, or the demo would be showing a number the product did not earn.

interface SeedQuestion {
  prompt: string;
  explanation: string;
  options: { label: string; correct: boolean }[];
}

async function practiceSet(
  title: string,
  topicFragment: string,
  questions: SeedQuestion[],
): Promise<void> {
  const [topic] = topicId(topicFragment);
  if (!topic) {
    log(`  (no topic matching "${topicFragment}" — skipping the practice set)`);
    return;
  }

  const quiz = await queryOne<{ id: string }>(
    `INSERT INTO quizzes (course_id, title, visibility, question_count, published_at)
     VALUES ($1, $2, 'course', $3, now())
     RETURNING id`,
    [pediatrics.id, title, questions.length],
  );

  for (const [ordinal, question] of questions.entries()) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO quiz_questions (quiz_id, topic_id, kind, prompt, explanation, points, ordinal)
       VALUES ($1, $2, 'mcq_single', $3, $4, 1, $5)
       RETURNING id`,
      [quiz!.id, topic, question.prompt, question.explanation, ordinal],
    );
    for (const [index, option] of question.options.entries()) {
      await queryOne(
        `INSERT INTO quiz_options (question_id, label, is_correct, ordinal)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [row!.id, option.label, option.correct, index],
      );
    }
  }

  log(`  practice: “${title}” — ${questions.length} questions on ${topicFragment}`);
}

await practiceSet('تدريب: المتلازمة الكلوية', 'nephrotic', [
  {
    prompt: 'ما العلامة المخبرية الأساسية في المتلازمة الكلوية؟',
    explanation: 'البيلة البروتينية الشديدة (> 3.5 غم/24 ساعة) هي المعيار المُعرِّف.',
    options: [
      { label: 'بيلة بروتينية شديدة', correct: true },
      { label: 'بيلة دموية عيانية', correct: false },
      { label: 'ارتفاع الكرياتينين حصراً', correct: false },
    ],
  },
  {
    prompt: 'أي مما يلي يُتوقَّع في تحليل الدم لمريض المتلازمة الكلوية؟',
    explanation: 'نقص ألبومين الدم نتيجة الفقد البولي، مع ارتفاع الشحوم تعويضياً.',
    options: [
      { label: 'نقص ألبومين الدم', correct: true },
      { label: 'ارتفاع ألبومين الدم', correct: false },
      { label: 'نقص الشحوم الثلاثية', correct: false },
    ],
  },
  {
    prompt: 'ما أشيع سبب للمتلازمة الكلوية عند الأطفال؟',
    explanation: 'داء التغيّر الأدنى، ويستجيب عادةً للستيرويدات.',
    options: [
      { label: 'داء التغيّر الأدنى', correct: true },
      { label: 'اعتلال الكلية بالـ IgA', correct: false },
      { label: 'التهاب الكبيبات التالي للعقديات', correct: false },
    ],
  },
  {
    prompt: 'ما الخط العلاجي الأول المعتاد؟',
    explanation: 'البريدنيزولون؛ عدم الاستجابة بعد ٤ أسابيع يستدعي إعادة التقييم.',
    options: [
      { label: 'البريدنيزولون', correct: true },
      { label: 'المضادات الحيوية', correct: false },
      { label: 'غسيل الكلى الفوري', correct: false },
    ],
  },
  {
    prompt: 'أي اختلاط يجب ترقّبه بسبب فقد مضادات التخثر الطبيعية؟',
    explanation: 'فرط التخثر — فقد الأنتي‑ثرومبين III في البول يرفع خطر الخثار.',
    options: [
      { label: 'الخثار الوريدي', correct: true },
      { label: 'فقر الدم المنجلي', correct: false },
      { label: 'نقص الصفيحات المناعي', correct: false },
    ],
  },
]);

await practiceSet('تدريب: اليرقان الوليدي', 'jaundice', [
  {
    prompt: 'متى يُعتبر اليرقان الوليدي مَرَضياً لا فيزيولوجياً؟',
    explanation: 'الظهور خلال الـ ٢٤ ساعة الأولى يستدعي التقصّي دائماً.',
    options: [
      { label: 'إذا ظهر خلال أول ٢٤ ساعة', correct: true },
      { label: 'إذا ظهر في اليوم الثالث', correct: false },
      { label: 'إذا زال خلال أسبوع', correct: false },
    ],
  },
  {
    prompt: 'ما الخطر الرئيسي لفرط بيليروبين الدم غير المقترن الشديد؟',
    explanation: 'اليرقان النووي — ترسّب البيليروبين في النوى القاعدية.',
    options: [
      { label: 'اليرقان النووي', correct: true },
      { label: 'الفشل الكلوي', correct: false },
      { label: 'التهاب الكبد المزمن', correct: false },
    ],
  },
  {
    prompt: 'ما العلاج الأولي المعتاد قبل بلوغ عتبة تبديل الدم؟',
    explanation: 'المعالجة الضوئية، وفق مخططات العتبات حسب العمر بالساعات.',
    options: [
      { label: 'المعالجة الضوئية', correct: true },
      { label: 'إيقاف الرضاعة نهائياً', correct: false },
      { label: 'الستيرويدات', correct: false },
    ],
  },
]);

// --- students ---------------------------------------------------------------

let counter = 0;
async function student(handle: string, displayName: string): Promise<Student> {
  counter += 1;
  const email = `${handle}@uob.edu.iq`;
  const session = await call<Session>('/v1/auth/signup', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  await call('/v1/me/onboarding', {
    method: 'POST',
    token: session.tokens.accessToken,
    body: {
      handle,
      displayName,
      universityId: university.id,
      collegeId: college.id,
      programId: program.id,
      stageId: stage!.id,
      academicYearId: year.id,
      interestTopicIds: topics.slice(0, Math.min(3, topics.length)).map((t) => t.id),
      bio:
        counter === 1
          ? 'طالب طب — المرحلة الخامسة. مهتم بطب الأطفال وحديثي الولادة.'
          : counter === 2
            ? 'Stage 5 medicine. Cardiology and neonatal care.'
            : 'أحاول أن أشرح ما أتعلمه — أفضل طريقة للمراجعة.',
    },
  });
  log(`  student @${handle} — ${displayName}`);
  return { handle, displayName, email, session };
}

log('\nstudents');
const amjad = await student('amjad', 'أمجد الناصر');
const zainab = await student('zainab', 'زينب الحسيني');
const omar = await student('omar', 'Omar Al-Rawi');

const token = (s: Student): string => s.session.tokens.accessToken;

// --- content ----------------------------------------------------------------

interface Content {
  id: string;
}

async function post(
  author: Student,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<Content> {
  return call<Content>('/v1/content', {
    method: 'POST',
    token: token(author),
    body: {
      body,
      visibility: 'stage',
      mediaFileIds: [],
      topicIds: [],
      ...extra,
    },
  });
}

log('\ncontent');

const arabicPost = await post(
  amjad,
  'مراجعة سريعة لليرقان الوليدي:\n\n' +
    '• اليرقان الفسيولوجي يظهر بعد ٢٤ ساعة من الولادة ويختفي خلال أسبوعين.\n' +
    '• أي يرقان في أول ٢٤ ساعة يُعتبر مرضياً حتى يثبت العكس.\n' +
    '• قياس البيليروبين الكلي والمباشر ضروري قبل البدء بالعلاج الضوئي.\n\n' +
    'من عنده إضافة من محاضرة الدكتور؟',
  { topicIds: topicId('jaundice') },
);
log('  Arabic post — neonatal jaundice');

const englishPost = await post(
  omar,
  'Quick clinical pearl on nephrotic syndrome in children:\n\n' +
    'The classic tetrad is heavy proteinuria, hypoalbuminaemia, oedema and hyperlipidaemia. ' +
    'Minimal change disease accounts for roughly 90% of cases under 10, which is why we start ' +
    'steroids empirically rather than biopsying first.\n\n' +
    'Biopsy is reserved for steroid resistance, or an atypical presentation.',
  { topicIds: topicId('nephrotic') },
);
log('  English post — nephrotic syndrome');

const mixedPost = await post(
  zainab,
  'ملخص محاضرة اليوم عن Respiratory Distress Syndrome:\n\n' +
    'السبب الأساسي هو نقص الـ surfactant عند الخُدّج. العلامات: tachypnea، grunting، ' +
    'nasal flaring، و chest retractions.\n\n' +
    'العلاج: surfactant replacement + CPAP. الوقاية: antenatal corticosteroids للأم ' +
    'قبل الولادة المبكرة.',
  { topicIds: topicId('respiratory') },
);
log('  mixed Arabic/English post — RDS');

await post(
  zainab,
  'سؤال: متى نبدأ العلاج الضوئي في حالات اليرقان الوليدي عند الخديج مقارنة بالطفل مكتمل النمو؟ ' +
    'الجداول التي عندي متضاربة.',
  { topicIds: topicId('jaundice') },
);
log('  question post');

/*
 * A post with an image. The bytes are a real PNG — the upload path sniffs magic
 * bytes and reads dimensions from the IHDR chunk, so a placeholder would be
 * rejected, which is exactly what makes this worth including in a demo.
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAV0lEQVR42u3OMQEAAAgDoC251a3g' +
    'LWQgmXBnFRAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ' +
    'EBAQEBAQEPgWLBmuHb2DPUcAAAAASUVORK5CYII=',
  'base64',
);

async function uploadImage(author: Student): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'diagram.png');
  const response = await fetch(`${API}/v1/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token(author)}` },
    body: form,
  });
  if (!response.ok) {
    log(`  ! image upload failed (${response.status}) — continuing without it`);
    return null;
  }
  const file = (await response.json()) as { id: string };
  return file.id;
}

const imageFileId = await uploadImage(amjad);
if (imageFileId) {
  await post(amjad, 'مخطط تشخيص اليرقان الوليدي — من المحاضرة.', {
    mediaFileIds: [imageFileId],
    topicIds: topicId('jaundice'),
  });
  log('  post with image');
}

// --- interactions -----------------------------------------------------------

log('\ninteractions');

await call(`/v1/content/${arabicPost.id}/comments`, {
  method: 'POST',
  token: token(zainab),
  body: {
    body: 'إضافة مهمة: لازم نستثني incompatibility في فصائل الدم قبل ما نحكي فسيولوجي.',
  },
});
await call(`/v1/content/${arabicPost.id}/comments`, {
  method: 'POST',
  token: token(omar),
  body: { body: 'Also worth checking G6PD status — common here and easy to miss.' },
});
await call(`/v1/content/${englishPost.id}/comments`, {
  method: 'POST',
  token: token(amjad),
  body: { body: 'شكراً، هذا وضّح لي الفرق بين البدء بالستيرويد والخزعة.' },
});
log('  3 comments');

for (const [reader, target] of [
  [zainab, arabicPost],
  [omar, arabicPost],
  [amjad, englishPost],
  [zainab, englishPost],
  [amjad, mixedPost],
] as const) {
  await call(`/v1/content/${target.id}/reaction`, {
    method: 'PUT',
    token: token(reader),
    body: { kind: 'like' },
  });
}
log('  5 reactions');

// The bookmark route takes a body (an optional collection name); omitting it
// is a validation error, not a default.
await call(`/v1/content/${englishPost.id}/bookmark`, {
  method: 'PUT',
  token: token(amjad),
  body: {},
});
await call(`/v1/content/${mixedPost.id}/bookmark`, {
  method: 'PUT',
  token: token(amjad),
  body: {},
});
log('  2 saved items (for @amjad)');

for (const [follower, followee] of [
  [amjad, zainab],
  [amjad, omar],
  [zainab, amjad],
] as const) {
  await call(`/v1/profiles/${followee.handle}/follow`, {
    method: 'PUT',
    token: token(follower),
    body: {},
  });
}
log('  follows');

// --- groups -----------------------------------------------------------------

log('\ngroups');

interface Group {
  id: string;
  name: string;
}

const openGroup = await call<Group>('/v1/groups', {
  method: 'POST',
  token: token(amjad),
  body: {
    name: 'مجموعة مراجعة طب الأطفال',
    description: 'نراجع معاً قبل الامتحان النهائي — ملخصات وأسئلة وحالات سريرية.',
    visibility: 'stage',
    joinPolicy: 'open',
    maxMembers: 50,
    /*
     * NOT scoped to the Pediatrics course, deliberately.
     *
     * Course enrolment does now happen — completing onboarding enrols a student
     * in their stage's courses — so this group *could* be course-scoped. It
     * stays cohort-scoped so that the demo shows the two container kinds as
     * different things: a group is students organising themselves, and the
     * classroom below is a taught room with an instructor who publishes into
     * it. A course-scoped group would blur exactly the distinction a reviewer
     * is here to check.
     */
  },
});
log(`  open group — ${openGroup.name}`);

for (const member of [zainab, omar]) {
  await call(`/v1/groups/${openGroup.id}/membership`, {
    method: 'PUT',
    token: token(member),
    body: {},
  });
}

await call('/v1/content', {
  method: 'POST',
  token: token(zainab),
  body: {
    body: 'رفعت ملخص محاضرة أمراض القلب الخلقية في ملفات المجموعة. من يريد المراجعة سوية يوم الخميس؟',
    visibility: 'group',
    groupId: openGroup.id,
    mediaFileIds: [],
    topicIds: [],
  },
});
await call('/v1/content', {
  method: 'POST',
  token: token(omar),
  body: {
    body: 'I can do Thursday. Bring the ECG cases — I still confuse the axis deviations.',
    visibility: 'group',
    groupId: openGroup.id,
    mediaFileIds: [],
    topicIds: [],
  },
});
log('  2 group posts');

/*
 * A private (unlisted) group. Only @amjad and @zainab are in it. @omar should
 * not be able to find it by browsing OR by search — which is the single most
 * important thing to check by eye during the review.
 */
const privateGroup = await call<Group>('/v1/groups', {
  method: 'POST',
  token: token(amjad),
  body: {
    name: 'حلقة نقاش الحالات السريرية',
    description: 'مجموعة مغلقة — بالدعوة فقط.',
    visibility: 'group',
    joinPolicy: 'invite',
    maxMembers: 10,
  },
});
await call(`/v1/groups/${privateGroup.id}/invites`, {
  method: 'POST',
  token: token(amjad),
  body: { handle: zainab.handle },
});
await call(`/v1/groups/${privateGroup.id}/membership`, {
  method: 'PUT',
  token: token(zainab),
  body: {},
});
await call('/v1/content', {
  method: 'POST',
  token: token(amjad),
  body: {
    body: 'حالة اليوم: رضيع عمره ٣ أيام، يرقان شديد، والأم فصيلتها O سالب. ما هي خطوتك الأولى؟',
    visibility: 'group',
    groupId: privateGroup.id,
    mediaFileIds: [],
    topicIds: [],
  },
});
log(`  private (unlisted) group — ${privateGroup.name} — @omar must NOT see it`);

// A pending join request, so the moderator queue has something in it.
const requestGroup = await call<Group>('/v1/groups', {
  method: 'POST',
  token: token(amjad),
  body: {
    name: 'مجموعة الحالات الإكلينيكية',
    description: 'الانضمام بموافقة المشرف.',
    visibility: 'stage',
    joinPolicy: 'request',
    maxMembers: 30,
  },
});
await call(`/v1/groups/${requestGroup.id}/membership`, {
  method: 'PUT',
  token: token(omar),
  body: { message: 'أرجو الانضمام — أحتاج مراجعة الحالات قبل الامتحان.' },
});
log('  request-to-join group with 1 pending request (queue visible to @amjad)');

// --- classroom --------------------------------------------------------------

/*
 * A taught container, and the thing that separates it from every group above:
 * @amjad publishes into it and the others read. The demo needs one because a
 * fresh database leaves the Classrooms screen empty, and an empty screen tells
 * a reviewer nothing about whether the feature works.
 *
 * Course-scoped, which needs two things that are now both true: onboarding
 * enrols a student in their stage's courses, and @amjad was granted instructor
 * eligibility above. Either one missing and `POST /classrooms` refuses — which
 * is the Phase 5c invariant, demonstrated rather than asserted.
 */

log('\nacademic authority');

/*
 * THE ONE DIRECT WRITE. See the header: only a platform administrator can make
 * a platform administrator, so the first one is an operator action by
 * definition. It grants no academic authority of its own — @amjad still has to
 * be verified through the audited endpoint below, like anyone else.
 */
const bootstrapped = await bootstrapPlatformAdmin(amjad.email);
log(`  @${amjad.handle} is a platform administrator (bootstrapped out of band)`);

/*
 * And now the real workflow, over HTTP, by an administrator: @amjad grants
 * themselves instructor eligibility. @zainab and @omar are deliberately left
 * as ordinary students — the demo is only useful if it shows both sides of the
 * boundary, so one account can teach and two cannot.
 */
await call(`/v1/admin/users/${bootstrapped.userId}/verification`, {
  method: 'PUT',
  token: token(amjad),
  body: {
    verificationLevel: 'instructor',
    reason: 'Faculty of Medicine — pediatrics teaching staff, demo cohort',
  },
});
log(`  @${amjad.handle} verified as an instructor — through the admin API, and audited`);
log(`  @${zainab.handle} and @${omar.handle} remain ordinary students and cannot open a classroom`);

log('\nclassroom');

interface Classroom {
  id: string;
  title: string;
  joinCode: string | null;
}
interface Lecture {
  id: string;
  title: string;
}

const classroom = await call<Classroom>('/v1/classrooms', {
  method: 'POST',
  token: token(amjad),
  body: {
    courseId: pediatrics.id,
    title: 'قاعة طب الأطفال — المرحلة الخامسة',
    description: 'محاضرات المقرر، شرائحها، ونقاش الطلبة تحت كل محاضرة.',
    visibility: 'course',
  },
});
log(`  classroom — ${classroom.title}`);
log(`    join code ${classroom.joinCode} — shown to teaching staff only`);

for (const member of [zainab, omar]) {
  await call(`/v1/classrooms/${classroom.id}/membership`, {
    method: 'PUT',
    token: token(member),
    body: { joinCode: null },
  });
}
log('  @zainab and @omar joined — @amjad is the owner');

const nephrotic = await call<Lecture>(`/v1/classrooms/${classroom.id}/lectures`, {
  method: 'POST',
  token: token(amjad),
  body: {
    title: 'المتلازمة الكلوية عند الأطفال',
    description: 'الوذمة، البيلة البروتينية، ونقص ألبومين الدم — الآلية والعلاج الأولي.',
    learningObjectives: [
      'شرح آلية الوذمة في المتلازمة الكلوية',
      'تمييز المتلازمة الكلوية عن المتلازمة الكلائية الحادة',
      'تحديد دواعي بدء الستيرويد قبل الخزعة',
    ],
    keyConcepts: ['الألبومين', 'الضغط الجرمي', 'البيلة البروتينية', 'الستيرويد'],
    topicIds: topicId('nephrotic'),
    durationMinutes: 50,
  },
});
log(`  lecture — ${nephrotic.title}`);

await call(`/v1/lectures/${nephrotic.id}/materials`, {
  method: 'POST',
  token: token(amjad),
  body: {
    title: 'شرائح المحاضرة',
    description: 'Nelson Textbook of Pediatrics, 22nd edition — chapter 545.',
    externalUrl: 'https://example.org/pediatrics/nephrotic-syndrome.pdf',
  },
});

/*
 * The second material is an uploaded file rather than a link, because the two
 * take different paths: attaching a file stamps it into the classroom and its
 * URL is signed per reader at read time. A demo with only external links would
 * never exercise that, and it is the half that can leak.
 */
const materialFileId = await uploadImage(amjad);
if (materialFileId) {
  await call(`/v1/lectures/${nephrotic.id}/materials`, {
    method: 'POST',
    token: token(amjad),
    body: { title: 'مخطط آلية الوذمة', ordinal: 1, fileId: materialFileId },
  });
  log('  2 materials — one external link, one uploaded file behind a signed URL');
} else {
  log('  1 material — external link only (upload unavailable)');
}

await call(`/v1/lectures/${nephrotic.id}/discussion`, {
  method: 'POST',
  token: token(omar),
  body: {
    body: 'لماذا تظهر الوذمة أحياناً قبل أن ينخفض الألبومين بشكل واضح في التحاليل؟',
    mediaFileIds: [],
    topicIds: [],
  },
});
await call(`/v1/lectures/${nephrotic.id}/discussion`, {
  method: 'POST',
  token: token(amjad),
  body: {
    body:
      'لأن إعادة توزيع السوائل تبدأ مع انخفاض الضغط الجرمي الموضعي قبل أن ينعكس ذلك ' +
      'على قياس الألبومين المصلي. القياس يتأخر عن الفيزيولوجيا، لا العكس.',
    mediaFileIds: [],
    topicIds: [],
  },
});
log('  discussion under it — a student question and the instructor’s answer');

// A second published lecture, so the discussion above is visibly attached to
// ONE lecture rather than to the room.
await call<Lecture>(`/v1/classrooms/${classroom.id}/lectures`, {
  method: 'POST',
  token: token(amjad),
  body: {
    title: 'التهاب السحايا الجرثومي — التشخيص المبكر',
    description: 'العلامات السريرية، فحص السائل الدماغي الشوكي، وتوقيت الصادات.',
    learningObjectives: ['تحديد العلامات التي توجب البزل القطني دون تأخير'],
    keyConcepts: ['البزل القطني', 'الصادات التجريبية'],
    ordinal: 1,
    durationMinutes: 45,
  },
});

/*
 * A draft. @amjad sees it; @zainab and @omar must not — the filter is in the
 * SQL, and this is the row that proves it by eye.
 */
await call<Lecture>(`/v1/classrooms/${classroom.id}/lectures`, {
  method: 'POST',
  token: token(amjad),
  body: {
    title: 'الربو عند الأطفال — مسودة غير منشورة',
    description: 'لم تُنشر بعد.',
    ordinal: 2,
    publish: false,
  },
});
log('  3 lectures — 2 published, 1 draft that only @amjad may see');

// --- conversations ----------------------------------------------------------

log('\nconversations');

interface Conversation {
  id: string;
}

const direct = await call<Conversation>('/v1/conversations', {
  method: 'POST',
  token: token(amjad),
  body: { recipientHandle: zainab.handle },
});

let clientId = 0;
const nextClientId = (): string =>
  `00000000-0000-4000-8000-${(++clientId).toString().padStart(12, '0')}`;

async function message(sender: Student, conversationId: string, body: string): Promise<void> {
  await call(`/v1/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: token(sender),
    body: { clientMessageId: nextClientId(), kind: 'text', body },
  });
}

await message(amjad, direct.id, 'سلام زينب، عندك ملخص محاضرة اليرقان؟');
await message(zainab, direct.id, 'أهلاً! نعم، رفعته في مجموعة المراجعة قبل شوي.');
await message(amjad, direct.id, 'ممتاز، شكراً جزيلاً 🙏');
await message(zainab, direct.id, 'Also — I added the phototherapy thresholds table at the end.');
await message(zainab, direct.id, 'خبريني إذا احتجت أي شي ثاني قبل الامتحان.');
log('  direct conversation @amjad ↔ @zainab (5 messages, 2 unread for @amjad)');

const groupConversation = await call<Conversation>('/v1/conversations', {
  method: 'POST',
  token: token(amjad),
  body: { groupId: openGroup.id },
});
await message(amjad, groupConversation.id, 'جماعة، نبدأ المراجعة الساعة ٧ مساءً؟');
await message(zainab, groupConversation.id, 'مناسب لي.');
await message(omar, groupConversation.id, 'Works for me. I will share the ECG cases beforehand.');
log('  group conversation (3 messages)');

/*
 * @amjad reads the group thread but NOT the direct one, so the chat list shows
 * a real unread badge on one row and a cleared one on the other — the state
 * worth looking at, and one that a fully-read demo would hide.
 */
await call(`/v1/conversations/${groupConversation.id}/read`, {
  method: 'PUT',
  token: token(amjad),
  body: { seq: 3 },
});

const conversationWithOmar = await call<Conversation>('/v1/conversations', {
  method: 'POST',
  token: token(omar),
  body: { recipientHandle: amjad.handle },
});
await message(omar, conversationWithOmar.id, 'Do you still have the cardiology slides from last week?');
log('  second direct conversation (1 unread for @amjad)');

// --- summary ----------------------------------------------------------------

log('\n─────────────────────────────────────────────');
log('demo data ready. Sign in with any of:');
for (const s of [amjad, zainab, omar]) {
  log(`  ${s.email}  /  ${PASSWORD}   (@${s.handle} — ${s.displayName})`);
}
log('');
log('Start with @amjad: they have unread messages, saved posts, a pending');
log('join request to approve, membership of the unlisted group that @omar');
log('must not be able to find, and ownership of the classroom — so they see');
log('the join code, the draft lecture and the material-authoring control that');
log('@zainab and @omar do not.');
log('');
log('');
log('For the learning loop: open a topic with practice on it and tap');
log('“اختبر فهمك”. Answer a few wrong on purpose, then look at the Learn');
log('tab — the topic appears under “مواضيع تحتاج مراجعة”, and the same');
log('signal now feeds the home feed’s weak-topic weighting. Nothing on');
log('those screens has any number in it until a student answers something.');
log('');
log(`Classroom  /classrooms/${classroom.id}`);
log(`Lecture    /lecture/${nephrotic.id}`);
log('─────────────────────────────────────────────');

// The bootstrap above opened a connection pool; without this the process keeps
// the event loop alive and the script appears to hang after printing.
await closePool();
