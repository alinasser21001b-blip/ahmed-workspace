import type {
  AuthSession,
  AuthUser,
  BlockedAccount,
  ClassroomDetail,
  ClassroomMember,
  ClassroomSummary,
  College,
  Comment,
  CommentPage,
  ContentCorrection,
  ContentItem,
  ContentSource,
  Conversation,
  ConversationPage,
  Course,
  DeleteAccountResponse,
  FeedPage,
  Group,
  GroupMember,
  LearnOverview,
  LectureDetail,
  LectureSummary,
  MarkReadResponse,
  Message,
  MessagePage,
  PracticeAnswerResult,
  PracticeQuestion,
  PracticeSession,
  PrivacySettings,
  Profile,
  ProfileSummary,
  Program,
  Relationship,
  SearchResults,
  SendMessageResponse,
  Stage,
  SupportLinks,
  Topic,
  TopicDetail,
  University,
} from '@sos/contracts';

/**
 * The preview world.
 *
 * Invented people, invented posts, invented messages — nothing here is derived
 * from a real account, and the dataset is small enough to read end to end,
 * which is the point: a reviewer can confirm by inspection that no student's
 * data is in the preview build.
 *
 * The content is deliberately realistic rather than `Lorem ipsum` — the preview
 * exists to evaluate hierarchy, density and Arabic rendering, and placeholder
 * text would defeat all three. It mixes Arabic and English, includes the
 * clinical units and page references the RTL rules must handle (`pH 7.1`,
 * `18 g/L`, "Guyton and Hall، صفحة 214"), and gives at least one string in
 * every list a length that wraps at 360 px.
 *
 * State is mutable IN MEMORY ONLY. Answering a practice question, sending a
 * message, blocking a user, deleting the account — each mutates this module's
 * state and nothing else. A page reload starts the world over. That is the
 * entire preview-safety argument: there is no server to reach.
 */

// ---------------------------------------------------------------------------
// clock

/** Deterministic timestamps: a preview that shifts every reload is hard to review. */
const T0 = Date.parse('2026-08-10T09:00:00.000Z');
export const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

let idCounter = 0;
export const nextId = (prefix: string): string => `preview-${prefix}-${(idCounter += 1)}`;

// ---------------------------------------------------------------------------
// people

export const PREVIEW_USER_ID = 'preview-user-0001';

/**
 * Picks a name the way the server does.
 *
 * The API stores `name_ar` / `name_en` for every academic entity and resolves
 * one with `localised(ar, en, locale)` from the caller's Accept-Language. The
 * fixture transport never reaches the network, so no header exists to read —
 * and without this the Arabic UI rendered "الأحد، ١٦ أغسطس · Second year ·
 * College of Medicine", an Arabic sentence with two English nouns wedged into
 * it.
 *
 * The locale is read at access time, not captured at module load: these
 * fixtures are constructed once and serialised on every request, by which
 * point the student may have switched language.
 */
const localisedName = (ar: string, en: string): string =>
  typeof document !== 'undefined' && document.documentElement.lang.startsWith('ar') ? ar : en;

const person = (
  userId: string,
  handle: string,
  displayName: string,
  level: ProfileSummary['verificationLevel'] = 'student',
): ProfileSummary => ({
  userId,
  handle,
  displayName,
  avatarUrl: null,
  verificationLevel: level,
  get stageName() {
    return level === 'instructor' ? null : localisedName('المرحلة الثانية', 'Second year');
  },
  get collegeName() {
    return localisedName('كلية الطب', 'College of Medicine');
  },
});

export const me = person(PREVIEW_USER_ID, 'preview.student', 'Preview Student');
export const layla = person('preview-user-0002', 'layla.hassan', 'Layla Hassan');
export const omar = person('preview-user-0003', 'omar.k', 'Omar Al-Khafaji');
export const drSaleh = person('preview-user-0004', 'dr.saleh', 'د. صالح العبيدي', 'instructor');

// ---------------------------------------------------------------------------
// academic hierarchy (onboarding)

export const universities: University[] = [
  {
    id: 'u1',
    slug: 'uob',
    nameAr: 'جامعة بغداد',
    nameEn: 'University of Baghdad',
    country: 'Iraq',
    city: 'Baghdad',
    logoUrl: null,
  },
];

export const colleges: College[] = [
  { id: 'c1', slug: 'medicine', nameAr: 'كلية الطب', nameEn: 'College of Medicine', universityId: 'u1' },
];

export const programs: Program[] = [
  {
    id: 'p1',
    slug: 'mbchb',
    nameAr: 'الطب والجراحة العامة',
    nameEn: 'Medicine (MBChB)',
    collegeId: 'c1',
    degreeType: 'MBChB',
    durationYears: 6,
  },
];

export const stages: Stage[] = [
  { id: 's2', programId: 'p1', ordinal: 2, nameAr: 'المرحلة الثانية', nameEn: 'Second year' },
];

export const courses: Course[] = [
  {
    id: 'course-physio',
    slug: 'physiology',
    nameAr: 'الفسلجة',
    nameEn: 'Physiology',
    programId: 'p1',
    stageId: 's2',
    academicYearId: null,
    code: 'MED204',
    description: null,
    coverUrl: null,
  },
];

export const academicTopics: Topic[] = [
  { id: 't-acid-base', slug: 'acid-base', nameAr: 'التوازن الحمضي القاعدي', nameEn: 'Acid–base balance', subjectId: 'subj-1', parentTopicId: null, ordinal: 1 },
  { id: 't-renal', slug: 'renal', nameAr: 'فسيولوجيا الكلية', nameEn: 'Renal physiology', subjectId: 'subj-1', parentTopicId: null, ordinal: 2 },
  { id: 't-cardio', slug: 'cardiac-cycle', nameAr: 'الدورة القلبية', nameEn: 'Cardiac cycle', subjectId: 'subj-2', parentTopicId: null, ordinal: 3 },
];

// ---------------------------------------------------------------------------
// the signed-in account

interface AccountState {
  onboardingCompleted: boolean;
  handle: string;
  displayName: string;
  deleted: boolean;
}

const initialAccount = (): AccountState => ({
  onboardingCompleted: true,
  handle: me.handle,
  displayName: me.displayName,
  deleted: false,
});

export let account: AccountState = initialAccount();

export function makeAuthUser(): AuthUser {
  return {
    id: PREVIEW_USER_ID,
    email: 'preview@student-os.example',
    role: 'student',
    verificationLevel: 'student',
    status: 'active',
    locale: 'ar',
    onboardingCompleted: account.onboardingCompleted,
    teachingEligible: false,
  };
}

export function makeAuthSession(): AuthSession {
  return {
    user: makeAuthUser(),
    tokens: {
      accessToken: 'preview-access-token-not-a-real-credential-000000',
      refreshToken: 'preview-refresh-token-not-a-real-credential-0000',
      expiresIn: 3600,
    },
  };
}

export function completeOnboarding(handle: string, displayName: string): void {
  account.onboardingCompleted = true;
  account.handle = handle;
  account.displayName = displayName;
}

export function makeMyProfile(): Profile {
  return {
    userId: PREVIEW_USER_ID,
    handle: account.handle,
    displayName: account.displayName,
    avatarUrl: null,
    bio: 'حساب تجريبي للمعاينة — Preview account. Second-year medical student.',
    verificationLevel: 'student',
    academic: {
      universityId: 'u1',
      universityName: localisedName('جامعة بغداد', 'University of Baghdad'),
      collegeId: 'c1',
      collegeName: localisedName('كلية الطب', 'College of Medicine'),
      programId: 'p1',
      programName: localisedName('الطب والجراحة العامة', 'Medicine (MBChB)'),
      stageId: 's2',
      stageName: localisedName('المرحلة الثانية', 'Second year'),
      academicYearId: null,
      academicYearLabel: null,
    },
    interests: [
      { id: 't-acid-base', nameEn: 'Acid–base balance', nameAr: 'التوازن الحمضي القاعدي' },
      { id: 't-renal', nameEn: 'Renal physiology', nameAr: 'فسيولوجيا الكلية' },
    ],
    contributionScore: 12,
    followerCount: 2,
    followingCount: 3,
    onboardingCompleted: account.onboardingCompleted,
    createdAt: at(-40_000),
    viewer: { isSelf: true, isFollowing: false, isBlocked: false, canMessage: false },
  };
}

// ---------------------------------------------------------------------------
// practice — the attempt store behind the before/after evidence contract

interface TopicEvidence {
  seen: number;
  correct: number;
}

interface AttemptState {
  attemptId: string;
  /** questionId → stored result, so a replayed submit returns the same row. */
  results: Map<string, PracticeAnswerResult>;
}

const initialEvidence = (): Map<string, TopicEvidence> =>
  new Map([
    ['t-acid-base', { seen: 6, correct: 4 }],
    ['t-renal', { seen: 2, correct: 1 }],
    ['t-cardio', { seen: 0, correct: 0 }],
  ]);

export let evidence = initialEvidence();
const attempts = new Map<string, AttemptState>();

const MIN_QUESTIONS_FOR_CONFIDENCE = 5;

const questionBank: Record<string, PracticeQuestion[]> = {
  't-acid-base': [
    {
      id: 'q1',
      kind: 'mcq_single',
      prompt:
        'A patient presents with pH 7.1, PaCO₂ 30 mmHg and HCO₃⁻ 12 mmol/L. Which disturbance is this?',
      options: [
        { id: 'q1a', label: 'Metabolic acidosis with respiratory compensation' },
        { id: 'q1b', label: 'Respiratory acidosis' },
        { id: 'q1c', label: 'Metabolic alkalosis' },
        { id: 'q1d', label: 'Respiratory alkalosis with metabolic compensation' },
      ],
      difficulty: 'medium',
      points: 1,
      answered: false,
    },
    {
      id: 'q2',
      kind: 'mcq_single',
      prompt: 'ما هي القيمة الطبيعية لتركيز البيكربونات HCO₃⁻ في المصل؟',
      options: [
        { id: 'q2a', label: '22–26 mmol/L' },
        { id: 'q2b', label: '12–16 mmol/L' },
        { id: 'q2c', label: '30–34 mmol/L' },
      ],
      difficulty: 'easy',
      points: 1,
      answered: false,
    },
    {
      id: 'q3',
      kind: 'mcq_multi',
      prompt: 'Which of the following raise the anion gap? Select every correct answer.',
      options: [
        { id: 'q3a', label: 'Diabetic ketoacidosis' },
        { id: 'q3b', label: 'Lactic acidosis' },
        { id: 'q3c', label: 'Diarrhoea' },
        { id: 'q3d', label: 'Salicylate poisoning' },
      ],
      difficulty: 'hard',
      points: 2,
      answered: false,
    },
    {
      id: 'q4',
      kind: 'true_false',
      prompt: 'الرئتان تعوّضان الحُماض الاستقلابي خلال دقائق، بينما تحتاج الكلية إلى أيام.',
      options: [
        { id: 'q4t', label: 'True — صحيح' },
        { id: 'q4f', label: 'False — خطأ' },
      ],
      difficulty: 'medium',
      points: 1,
      answered: false,
    },
  ],
  't-renal': [
    {
      id: 'q5',
      kind: 'mcq_single',
      prompt: 'Which segment of the nephron is the primary site of the countercurrent multiplier?',
      options: [
        { id: 'q5a', label: 'Loop of Henle' },
        { id: 'q5b', label: 'Proximal convoluted tubule' },
        { id: 'q5c', label: 'Collecting duct' },
      ],
      difficulty: 'medium',
      points: 1,
      answered: false,
    },
  ],
};

const answerKey: Record<string, string[]> = {
  q1: ['q1a'],
  q2: ['q2a'],
  q3: ['q3a', 'q3b', 'q3d'],
  q4: ['q4t'],
  q5: ['q5a'],
};

const explanations: Record<string, string | null> = {
  q1: 'A low pH with a low HCO₃⁻ is a metabolic acidosis; the low PaCO₂ is the respiratory compensation, not a second primary disturbance. Winter’s formula predicts PaCO₂ ≈ 1.5 × 12 + 8 = 26 ± 2, so compensation is appropriate.',
  q2: 'المدى المرجعي المعتاد هو 22–26 mmol/L، ويُقاس عادةً مع غازات الدم الشرياني. القيم الأدنى تشير إلى حُماض استقلابي أو تعويض تنفسي مزمن.',
  q3: 'Diarrhoea causes a normal-anion-gap (hyperchloraemic) acidosis through bicarbonate loss, so it is the exception here.',
  // Deliberately null: the spec requires the explanation-absent state to render
  // the revealed key and delta only, inventing nothing.
  q4: null,
  q5: 'The loop of Henle multiplies the medullary gradient; the collecting duct only exploits it under ADH.',
};

function topicName(topicId: string): string {
  const topic = academicTopics.find((entry) => entry.id === topicId);
  return topic ? topic.nameEn : 'Acid–base balance';
}

function progressFor(topicId: string): NonNullable<PracticeAnswerResult['progress']> {
  const state = evidence.get(topicId) ?? { seen: 0, correct: 0 };
  return {
    topicId,
    questionsSeen: state.seen,
    questionsCorrect: state.correct,
    weaknessScore: state.seen === 0 ? 0 : 1 - state.correct / state.seen,
    confidence: state.seen === 0 ? 0 : state.correct / state.seen,
    lowConfidence: state.seen < MIN_QUESTIONS_FOR_CONFIDENCE,
    lastActivityAt: state.seen > 0 ? at(30) : null,
  };
}

export function startPractice(topicId: string): PracticeSession | null {
  const bank = questionBank[topicId];
  if (!bank) return null;
  let attempt = attempts.get(topicId);
  if (!attempt) {
    attempt = { attemptId: nextId('attempt'), results: new Map() };
    attempts.set(topicId, attempt);
  }
  return {
    attemptId: attempt.attemptId,
    quizId: `preview-quiz-${topicId}`,
    quizTitle: `${topicName(topicId)} — set 1`,
    topicId,
    topicName: topicName(topicId),
    questions: bank.map((question) => ({
      ...question,
      answered: attempt.results.has(question.id),
    })),
    progress: progressFor(topicId),
  };
}

export function submitAnswer(
  attemptId: string,
  questionId: string,
  selectedOptionIds: string[],
): PracticeAnswerResult | null {
  const entry = [...attempts.entries()].find(([, state]) => state.attemptId === attemptId);
  if (!entry) return null;
  const [topicId, attempt] = entry;

  // Idempotent: a replayed submit returns the stored row with the flag set,
  // and the evidence is not counted twice — the same behaviour the real API
  // guarantees and the submit_failed → retry path depends on.
  const stored = attempt.results.get(questionId);
  if (stored) return { ...stored, alreadyAnswered: true };

  const key = answerKey[questionId] ?? [];
  const isCorrect =
    key.length === selectedOptionIds.length && key.every((id) => selectedOptionIds.includes(id));

  const state = evidence.get(topicId) ?? { seen: 0, correct: 0 };
  state.seen += 1;
  if (isCorrect) state.correct += 1;
  evidence.set(topicId, state);

  const bank = questionBank[topicId] ?? [];
  const answeredCount = attempt.results.size + 1;

  const result: PracticeAnswerResult = {
    questionId,
    isCorrect,
    correctOptionIds: key,
    explanation: explanations[questionId] ?? null,
    pointsAwarded: isCorrect ? 1 : 0,
    alreadyAnswered: false,
    attemptCompleted: answeredCount >= bank.length,
    progress: progressFor(topicId),
  };
  attempt.results.set(questionId, result);
  return result;
}

// ---------------------------------------------------------------------------
// learn + topic

export function makeLearnOverview(): LearnOverview {
  const focus = ['t-acid-base', 't-renal'].map((id) => {
    const progress = progressFor(id);
    return {
      id,
      name: topicName(id),
      subjectName: 'Physiology',
      questionsSeen: progress ? progress.questionsSeen : 0,
      weaknessScore: progress ? progress.weaknessScore : null,
      lowConfidence: progress ? progress.lowConfidence : true,
      lastActivityAt: progress ? progress.lastActivityAt : null,
    };
  });
  // Ranked by weakness, the only ordering weaknessScore may drive.
  focus.sort((a, b) => (b.weaknessScore ?? 0) - (a.weaknessScore ?? 0));
  return {
    focusTopics: focus,
    interestTopics: [{ id: 't-cardio', name: 'Cardiac cycle' }],
    savedCount: 7,
    meaningfulActionsThisWeek: 12,
  };
}

export function makeTopicDetail(topicId: string): TopicDetail | null {
  if (!academicTopics.some((topic) => topic.id === topicId)) return null;
  const progress = progressFor(topicId);
  const isAcidBase = topicId === 't-acid-base';
  return {
    id: topicId,
    name: topicName(topicId),
    slug: topicId,
    subjectId: 'subj-1',
    subjectName: 'Physiology',
    courseId: 'course-physio',
    courseName: 'Physiology',
    parentTopicId: null,
    parentTopicName: null,
    subtopics: isAcidBase
      ? [
          { id: 'sub-1', name: 'Anion gap' },
          { id: 'sub-2', name: 'Compensation rules' },
        ]
      : [],
    related: isAcidBase
      ? [
          { id: 't-renal', name: 'Renal physiology', subjectName: 'Physiology', relation: 'part_of', source: 'curated', strength: null },
          { id: 't-cardio', name: 'Cardiac cycle', subjectName: 'Physiology', relation: 'related', source: 'derived', strength: 0.4 },
        ]
      : [
          { id: 't-acid-base', name: 'Acid–base balance', subjectName: 'Physiology', relation: 'related', source: 'curated', strength: null },
        ],
    knowledgeCounts: isAcidBase
      ? [
          { knowledgeType: 'explanation', count: 5 },
          { knowledgeType: 'question', count: 4 },
          { knowledgeType: 'summary', count: 2 },
          { knowledgeType: 'case', count: 1 },
        ]
      : [{ knowledgeType: 'explanation', count: 2 }],
    viewer: {
      isInterest: topicId !== 't-cardio',
      questionsSeen: progress ? progress.questionsSeen : 0,
      questionsCorrect: progress ? progress.questionsCorrect : 0,
      weaknessScore: progress ? progress.weaknessScore : null,
      lastActivityAt: progress ? progress.lastActivityAt : null,
      canPractice: Boolean(questionBank[topicId]),
    },
  };
}

// ---------------------------------------------------------------------------
// content / feed

const signalsOf = (
  provenance: ContentItem['signals']['provenance'],
  overrides: Partial<ContentItem['signals']> = {},
): ContentItem['signals'] => ({
  sourceCount: 0,
  acceptedCorrectionCount: 0,
  openCorrectionCount: 0,
  helpfulCount: 0,
  hasAcceptedAnswer: false,
  provenance,
  ...overrides,
});

const makePost = (
  id: string,
  author: ProfileSummary,
  body: string,
  overrides: Partial<ContentItem>,
): ContentItem => ({
  id,
  kind: 'post',
  knowledgeType: 'explanation',
  difficulty: 'medium',
  language: 'mixed',
  signals: signalsOf('author_claim'),
  topics: [{ id: 't-acid-base', name: 'Acid–base balance', source: 'author' }],
  author,
  body,
  media: [],
  academic: {
    courseId: 'course-physio',
    courseName: 'Physiology',
    subjectId: 'subj-1',
    subjectName: 'Physiology',
    topics: [{ id: 't-acid-base', nameAr: 'التوازن الحمضي القاعدي', nameEn: 'Acid–base balance' }],
  },
  container: null,
  visibility: 'stage',
  counts: { likes: 4, comments: 1, bookmarks: 2, views: 40 },
  viewer: {
    reaction: null,
    hasBookmarked: false,
    hasViewed: false,
    canEdit: false,
    canDelete: false,
    canComment: true,
    isAuthor: false,
  },
  isPinned: false,
  editedAt: null,
  createdAt: at(-300),
  ...overrides,
});

export let contentItems: ContentItem[] = [];

function initialContent(): ContentItem[] {
  return [
    makePost(
      'post-1',
      layla,
      'In minimal change disease the heavy proteinuria comes from podocyte foot-process effacement — serum albumin can fall below 18 g/L before oedema is obvious. Guyton and Hall, p. 214, has the clearest diagram of the filtration barrier.',
      {
        language: 'en',
        signals: signalsOf('source_backed', { sourceCount: 2, helpfulCount: 9 }),
        createdAt: at(-90),
      },
    ),
    makePost(
      'post-2',
      drSaleh,
      'اليرقان الوليدي الفسيولوجي يظهر بعد 24 ساعة من الولادة ويبلغ ذروته في اليوم الثالث إلى الخامس. أي يرقان خلال الساعات الأربع والعشرين الأولى مرضيّ حتى يثبت العكس، ويستدعي قياس البيليروبين المصلي فوراً.',
      {
        language: 'ar',
        knowledgeType: 'summary',
        topics: [{ id: 't-renal', name: 'Renal physiology', source: 'author' }],
        signals: signalsOf('source_backed', { sourceCount: 1, helpfulCount: 14 }),
        counts: { likes: 11, comments: 3, bookmarks: 6, views: 120 },
        createdAt: at(-200),
      },
    ),
    makePost(
      'post-3',
      omar,
      'قاعدة سريعة: في الحُماض الاستقلابي، كل انخفاض 1 mmol/L في HCO₃⁻ يقابله انخفاض PaCO₂ بمقدار 1.2 mmHg تقريباً — لكن انتبهوا، القاعدة تنطبق على acute فقط.',
      {
        language: 'mixed',
        signals: signalsOf('disputed', { openCorrectionCount: 1, helpfulCount: 3 }),
        counts: { likes: 2, comments: 2, bookmarks: 1, views: 55 },
        createdAt: at(-45),
      },
    ),
    makePost(
      'post-4',
      me,
      'Why does chronic respiratory acidosis produce a smaller pH change than acute? Is renal compensation really that fast?',
      {
        kind: 'question',
        knowledgeType: 'question',
        language: 'en',
        signals: signalsOf('author_claim', { hasAcceptedAnswer: true, helpfulCount: 2 }),
        viewer: {
          reaction: null,
          hasBookmarked: true,
          hasViewed: true,
          canEdit: true,
          canDelete: true,
          canComment: true,
          isAuthor: true,
        },
        createdAt: at(-30),
      },
    ),
  ];
}

contentItems = initialContent();

export function makeFeedPage(scope: {
  authorHandle?: string | undefined;
  groupId?: string | undefined;
}): FeedPage {
  let items = contentItems;
  if (scope.authorHandle) {
    items = items.filter((item) => item.author.handle === scope.authorHandle);
  }
  if (scope.groupId) {
    items = items.filter((item) => item.container?.id === scope.groupId);
  }
  return { items, nextCursor: null };
}

export function contentById(id: string): ContentItem | null {
  return contentItems.find((item) => item.id === id) ?? null;
}

export function createPost(body: string, knowledgeType: ContentItem['knowledgeType']): ContentItem {
  const created = makePost(nextId('post'), { ...me, handle: account.handle, displayName: account.displayName }, body, {
    knowledgeType,
    language: /[؀-ۿ]/.test(body) ? (/[a-z]/i.test(body) ? 'mixed' : 'ar') : 'en',
    counts: { likes: 0, comments: 0, bookmarks: 0, views: 0 },
    signals: signalsOf('author_claim'),
    viewer: {
      reaction: null,
      hasBookmarked: false,
      hasViewed: true,
      canEdit: true,
      canDelete: true,
      canComment: true,
      isAuthor: true,
    },
    createdAt: at(200),
  });
  contentItems = [created, ...contentItems];
  return created;
}

const commentStore = new Map<string, Comment[]>([
  [
    'post-1',
    [
      {
        id: 'comment-1',
        contentId: 'post-1',
        parentId: null,
        author: omar,
        body: 'شكراً — صفحة 214 فعلاً أوضح شرح للحاجز الترشيحي.',
        likeCount: 2,
        replyCount: 0,
        isAccepted: false,
        editedAt: null,
        createdAt: at(-60),
        viewer: { reaction: null, canEdit: false, canDelete: false },
      },
    ],
  ],
]);

export function commentsFor(contentId: string): CommentPage {
  return { items: commentStore.get(contentId) ?? [], nextCursor: null };
}

export function addComment(contentId: string, body: string): Comment {
  const created: Comment = {
    id: nextId('comment'),
    contentId,
    parentId: null,
    author: { ...me, handle: account.handle, displayName: account.displayName },
    body,
    likeCount: 0,
    replyCount: 0,
    isAccepted: false,
    editedAt: null,
    createdAt: at(210),
    viewer: { reaction: null, canEdit: true, canDelete: true },
  };
  const existing = commentStore.get(contentId) ?? [];
  commentStore.set(contentId, [...existing, created]);
  const item = contentById(contentId);
  if (item) item.counts = { ...item.counts, comments: item.counts.comments + 1 };
  return created;
}

export function sourcesFor(contentId: string): ContentSource[] {
  if (contentId !== 'post-1') return [];
  return [
    {
      id: 'source-1',
      kind: 'textbook',
      citation: 'Guyton and Hall, Textbook of Medical Physiology, 14th ed.',
      url: null,
      fileId: null,
      pageRef: 'p. 214',
      addedBy: layla,
      createdAt: at(-89),
    },
    {
      id: 'source-2',
      kind: 'guideline',
      citation: 'KDIGO Clinical Practice Guideline on Glomerular Diseases',
      url: 'https://kdigo.org/guidelines/gd/',
      fileId: null,
      pageRef: null,
      addedBy: layla,
      createdAt: at(-88),
    },
  ];
}

export function correctionsFor(contentId: string): ContentCorrection[] {
  if (contentId !== 'post-3') return [];
  return [
    {
      id: 'correction-1',
      contentId: 'post-3',
      body: 'القاعدة معكوسة: التعويض المتوقع هو انخفاض PaCO₂ بمقدار 1.2 mmHg لكل 1 mmol/L نقص في البيكربونات — وهي تنطبق على الحُماض الاستقلابي بغضّ النظر عن كونه حاداً أو مزمناً. القاعدة الحادة/المزمنة تخص الاضطرابات التنفسية.',
      status: 'proposed',
      proposedBy: layla,
      resolvedBy: null,
      resolvedAt: null,
      source: null,
      createdAt: at(-20),
    },
  ];
}

// ---------------------------------------------------------------------------
// groups + community

const groupViewerMember: Group['viewer'] = {
  membershipStatus: 'active',
  role: 'member',
  joinOutcome: 'joined',
  canJoin: false,
  canRead: true,
  canWrite: true,
  canPost: true,
  canComment: true,
  canLeave: true,
  canInvite: false,
  canModerate: false,
  canManage: false,
};

export const studyGroup: Group = {
  id: 'group-1',
  name: 'مجموعة مراجعة الفسلجة — Physiology revision circle',
  description: 'مراجعة أسبوعية لمواضيع الفسلجة، بالعربية والإنجليزية.',
  avatarUrl: null,
  visibility: 'stage',
  joinPolicy: 'open',
  memberCount: 9,
  maxMembers: 50,
  communityId: null,
  communityName: null,
  courseId: 'course-physio',
  courseName: 'Physiology',
  createdAt: at(-10_000),
  archivedAt: null,
  viewer: groupViewerMember,
  pendingRequestCount: null,
};

export function groupMembers(): GroupMember[] {
  return [me, layla, omar].map((profile) => ({
    profile,
    role: profile.userId === layla.userId ? 'owner' : 'member',
    status: 'active',
    joinedAt: at(-9_000),
    requestedAt: null,
    message: null,
  }));
}

// ---------------------------------------------------------------------------
// classroom

const classroomViewer: ClassroomSummary['viewer'] = {
  isMember: true,
  role: 'member',
  canRead: true,
  canJoin: false,
  canLeave: true,
  canParticipate: true,
  canManageMembership: false,
  canTeach: false,
  canManage: false,
};

export const classroom: ClassroomDetail = {
  id: 'classroom-1',
  title: 'قاعة الفسلجة — المرحلة الثانية',
  description: 'المحاضرات والمواد الرسمية لمقرر الفسلجة MED204.',
  courseId: 'course-physio',
  courseName: 'Physiology',
  instructor: drSaleh,
  visibility: 'course',
  isArchived: false,
  memberCount: 42,
  lectureCount: 2,
  createdAt: at(-20_000),
  viewer: classroomViewer,
  joinCode: null,
};

export const lectures: LectureSummary[] = [
  {
    id: 'lecture-1',
    classroomId: 'classroom-1',
    title: 'التوازن الحمضي القاعدي: من المعادلة إلى المريض',
    description: 'Henderson–Hasselbalch, compensation rules, and three worked cases.',
    ordinal: 1,
    durationMinutes: 50,
    materialCount: 2,
    publishedAt: at(-6_000),
    createdAt: at(-6_100),
  },
  {
    id: 'lecture-2',
    classroomId: 'classroom-1',
    title: 'Renal handling of acid: titratable acidity and NH₄⁺',
    description: null,
    ordinal: 2,
    durationMinutes: 45,
    materialCount: 1,
    publishedAt: at(-3_000),
    createdAt: at(-3_100),
  },
];

const lectureProgress = new Map<string, string>();

export function lectureDetail(id: string): LectureDetail | null {
  const summary = lectures.find((lecture) => lecture.id === id);
  if (!summary) return null;
  return {
    ...summary,
    author: drSaleh,
    learningObjectives: [
      'Classify a blood gas as one of the four primary disturbances.',
      'تطبيق قواعد التعويض المتوقعة والتمييز بين الاضطراب البسيط والمختلط.',
    ],
    keyConcepts: ['Anion gap', 'Winter’s formula', 'Base excess', 'التعويض الكلوي'],
    aiSummary: null,
    topics: [{ id: 't-acid-base', name: 'Acid–base balance' }],
    materials: [
      {
        id: 'material-1',
        title: 'محاضرة ١ — الشرائح (PDF)',
        description: 'الشرائح الرسمية كما عُرضت في القاعة.',
        ordinal: 1,
        file: null,
        // Materials that are not images can only be external links today —
        // the same limitation the production API has. Kept honest here.
        externalUrl: 'https://example.edu/preview/acid-base-slides.pdf',
        createdAt: at(-6_000),
      },
      {
        id: 'material-2',
        title: 'Worked cases handout',
        description: null,
        ordinal: 2,
        file: null,
        externalUrl: 'https://example.edu/preview/acid-base-cases.pdf',
        createdAt: at(-5_900),
      },
    ],
    viewer: { canTeach: false, completedAt: lectureProgress.get(id) ?? null },
  };
}

export function markLectureProgress(id: string, percent: number): void {
  if (percent >= 100) lectureProgress.set(id, at(220));
}

export function classroomMembers(): ClassroomMember[] {
  return [
    { user: drSaleh, role: 'owner', joinedAt: at(-20_000) },
    { user: me, role: 'member', joinedAt: at(-15_000) },
    { user: layla, role: 'member', joinedAt: at(-14_000) },
  ];
}

// ---------------------------------------------------------------------------
// conversations — HTTP semantics only, exactly like the deployed host

interface ConversationState {
  conversation: Conversation;
  messages: Message[];
}

function initialConversations(): Map<string, ConversationState> {
  const makeMessage = (
    id: string,
    conversationId: string,
    seq: number,
    author: ProfileSummary,
    body: string,
    minutes: number,
  ): Message => ({
    id,
    conversationId,
    seq,
    clientMessageId: `client-${id}`,
    kind: 'text',
    body,
    author,
    replyToId: null,
    attachments: [],
    editedAt: null,
    deletedAt: null,
    createdAt: at(minutes),
  });

  const direct: ConversationState = {
    conversation: {
      id: 'conv-1',
      kind: 'direct',
      title: layla.displayName,
      avatarUrl: null,
      groupId: null,
      counterpart: layla,
      lastSeq: 3,
      lastMessageAt: at(118),
      lastMessagePreview: 'اقرأي الفصل السابع من Guyton and Hall، صفحة 214.',
      createdAt: at(0),
      viewer: { role: 'member', canRead: true, canSend: true, lastReadSeq: 1, unreadCount: 2, muted: false },
    },
    messages: [
      makeMessage('m1', 'conv-1', 1, layla, 'هل راجعت جدول قيم غازات الدم؟', 100),
      makeMessage(
        'm2',
        'conv-1',
        2,
        me,
        'Not yet — I am still on the compensation rules. pH 7.1 with HCO₃⁻ 12 mmol/L threw me.',
        104,
      ),
      makeMessage('m3', 'conv-1', 3, layla, 'اقرأي الفصل السابع من Guyton and Hall، صفحة 214.', 118),
    ],
  };

  const group: ConversationState = {
    conversation: {
      id: 'conv-2',
      kind: 'group',
      title: 'مجموعة مراجعة الفسلجة',
      avatarUrl: null,
      groupId: 'group-1',
      counterpart: null,
      lastSeq: 2,
      lastMessageAt: at(60),
      lastMessagePreview: 'Sharing my notes on the countercurrent multiplier, p. 214.',
      createdAt: at(0),
      viewer: { role: 'member', canRead: true, canSend: true, lastReadSeq: 2, unreadCount: 0, muted: false },
    },
    messages: [
      makeMessage('m4', 'conv-2', 1, omar, 'من عنده ملاحظات محاضرة اليوم؟', 40),
      makeMessage('m5', 'conv-2', 2, omar, 'Sharing my notes on the countercurrent multiplier, p. 214.', 60),
    ],
  };

  return new Map([
    ['conv-1', direct],
    ['conv-2', group],
  ]);
}

export let conversationStore = initialConversations();

export function listConversations(): ConversationPage {
  const items = [...conversationStore.values()].map((state) => state.conversation);
  return {
    items,
    nextCursor: null,
    totalUnread: items.reduce((sum, conversation) => sum + conversation.viewer.unreadCount, 0),
  };
}

export function conversationById(id: string): Conversation | null {
  return conversationStore.get(id)?.conversation ?? null;
}

export function listMessages(id: string): MessagePage {
  const state = conversationStore.get(id);
  if (!state) return { items: [], nextBeforeSeq: null, lastSeq: 0 };
  return {
    items: state.messages,
    nextBeforeSeq: null,
    lastSeq: state.conversation.lastSeq,
  };
}

export function sendMessage(
  conversationId: string,
  clientMessageId: string,
  body: string,
): SendMessageResponse | null {
  const state = conversationStore.get(conversationId);
  if (!state) return null;

  // Idempotent by clientMessageId — a retried send is deduplicated, not
  // duplicated, which is the contract the mobile Outbox depends on.
  const existing = state.messages.find((message) => message.clientMessageId === clientMessageId);
  if (existing) return { message: existing, deduplicated: true };

  const seq = state.conversation.lastSeq + 1;
  const message: Message = {
    id: nextId('message'),
    conversationId,
    seq,
    clientMessageId,
    kind: 'text',
    body,
    author: { ...me, handle: account.handle, displayName: account.displayName },
    replyToId: null,
    attachments: [],
    editedAt: null,
    deletedAt: null,
    createdAt: at(230),
  };
  state.messages = [...state.messages, message];
  state.conversation = {
    ...state.conversation,
    lastSeq: seq,
    lastMessageAt: message.createdAt,
    lastMessagePreview: body,
    viewer: { ...state.conversation.viewer, lastReadSeq: seq },
  };
  return { message, deduplicated: false };
}

export function markRead(conversationId: string, seq: number): MarkReadResponse | null {
  const state = conversationStore.get(conversationId);
  if (!state) return null;
  const clamped = Math.min(seq, state.conversation.lastSeq);
  const lastReadSeq = Math.max(clamped, state.conversation.viewer.lastReadSeq);
  const unreadCount = state.messages.filter(
    (message) => message.seq > lastReadSeq && message.author?.userId !== PREVIEW_USER_ID,
  ).length;
  state.conversation = {
    ...state.conversation,
    viewer: { ...state.conversation.viewer, lastReadSeq, unreadCount },
  };
  return { lastReadSeq, unreadCount };
}

// ---------------------------------------------------------------------------
// profiles, relationships, blocking

interface RelationshipState {
  isFollowing: boolean;
  isBlocked: boolean;
  blockedAt: string | null;
}

const initialRelationships = (): Map<string, RelationshipState> =>
  new Map([
    [layla.handle, { isFollowing: true, isBlocked: false, blockedAt: null }],
    [omar.handle, { isFollowing: false, isBlocked: false, blockedAt: null }],
    [drSaleh.handle, { isFollowing: true, isBlocked: false, blockedAt: null }],
  ]);

export let relationships = initialRelationships();

const others: Record<string, ProfileSummary> = {
  [layla.handle]: layla,
  [omar.handle]: omar,
  [drSaleh.handle]: drSaleh,
};

export function profileByHandle(handle: string): Profile | null {
  if (handle === account.handle || handle === me.handle) return makeMyProfile();
  const summary = others[handle];
  if (!summary) return null;
  const relationship = relationships.get(handle) ?? {
    isFollowing: false,
    isBlocked: false,
    blockedAt: null,
  };
  return {
    userId: summary.userId,
    handle: summary.handle,
    displayName: summary.displayName,
    avatarUrl: null,
    bio:
      summary.handle === drSaleh.handle
        ? 'أستاذ الفسلجة — كلية الطب، جامعة بغداد.'
        : 'Second-year medical student. أدرس الفسلجة هذا الفصل.',
    verificationLevel: summary.verificationLevel,
    academic: {
      universityId: 'u1',
      universityName: localisedName('جامعة بغداد', 'University of Baghdad'),
      collegeId: 'c1',
      collegeName: localisedName('كلية الطب', 'College of Medicine'),
      programId: 'p1',
      programName: localisedName('الطب والجراحة العامة', 'Medicine (MBChB)'),
      stageId: summary.verificationLevel === 'instructor' ? null : 's2',
      stageName:
        summary.verificationLevel === 'instructor'
          ? null
          : localisedName('المرحلة الثانية', 'Second year'),
      academicYearId: null,
      academicYearLabel: null,
    },
    interests: [
      { id: 't-acid-base', nameEn: 'Acid–base balance', nameAr: 'التوازن الحمضي القاعدي' },
    ],
    contributionScore: summary.handle === drSaleh.handle ? 120 : 25,
    followerCount: 4,
    followingCount: 3,
    onboardingCompleted: true,
    createdAt: at(-50_000),
    viewer: {
      isSelf: false,
      isFollowing: relationship.isFollowing,
      isBlocked: relationship.isBlocked,
      canMessage: !relationship.isBlocked,
    },
  };
}

export function relationshipFor(handle: string): Relationship | null {
  const summary = others[handle];
  if (!summary) return null;
  const state = relationships.get(handle) ?? {
    isFollowing: false,
    isBlocked: false,
    blockedAt: null,
  };
  return {
    userId: summary.userId,
    isFollowing: state.isFollowing,
    isFollowedBy: handle === layla.handle,
    isBlocked: state.isBlocked,
    isMuted: false,
    followerCount: 4,
  };
}

export function setFollowing(handle: string, following: boolean): void {
  const state = relationships.get(handle);
  if (state) state.isFollowing = following;
}

export function setBlocked(handle: string, blocked: boolean): void {
  const state = relationships.get(handle);
  if (!state) return;
  state.isBlocked = blocked;
  state.blockedAt = blocked ? at(240) : null;
  if (blocked) state.isFollowing = false;
}

export function blockedAccounts(): BlockedAccount[] {
  return [...relationships.entries()]
    .filter(([, state]) => state.isBlocked)
    .map(([handle, state]) => ({
      profile: others[handle] as ProfileSummary,
      blockedAt: state.blockedAt ?? at(240),
    }));
}

// ---------------------------------------------------------------------------
// search — only the result classes the contract actually supports

export function search(query: string): SearchResults {
  const q = query.trim().toLowerCase();
  const matches = (value: string | null): boolean =>
    value !== null && value.toLowerCase().includes(q);
  return {
    query,
    people: Object.values(others).filter(
      (profile) => matches(profile.displayName) || matches(profile.handle),
    ),
    content: contentItems
      .filter((item) => matches(item.body))
      .map((item) => ({
        id: item.id,
        body: item.body,
        author: item.author,
        createdAt: item.createdAt,
      })),
    groups: matches(studyGroup.name) || matches(studyGroup.description) ? [studyGroup] : [],
    communities: [],
    topics: academicTopics
      .filter((topic) => matches(topic.nameAr) || matches(topic.nameEn) || matches(topic.slug))
      .map((topic) => {
        const progress = evidence.get(topic.id);
        const seen = progress?.seen ?? 0;
        return {
          id: topic.id,
          name: localisedName(topic.nameAr, topic.nameEn),
          subjectName: localisedName('الفسلجة', 'Physiology'),
          courseName: localisedName('الفسلجة', 'Physiology'),
          viewer:
            seen > 0
              ? {
                  questionsSeen: seen,
                  questionsCorrect: progress?.correct ?? 0,
                  lowConfidence: seen < MIN_QUESTIONS_FOR_CONFIDENCE,
                }
              : null,
        };
      }),
    classrooms:
      matches(classroom.title) || matches(classroom.courseName) || matches('MED204')
        ? [
            {
              id: classroom.id,
              title: classroom.title,
              courseName: classroom.courseName,
              courseCode: 'MED204',
              memberCount: classroom.memberCount,
              viewer: { isMember: true, canRead: true, canJoin: false },
            },
          ]
        : [],
  };
}

// ---------------------------------------------------------------------------
// account deletion + support

export function deleteAccount(): DeleteAccountResponse {
  account.deleted = true;
  return {
    messagesTombstoned: 4,
    filesRemoved: 0,
    objectsOrphaned: 0,
    sessionsRevoked: 1,
    pushTokensRemoved: 0,
    groupsTransferred: 0,
    groupsArchived: 0,
    communitiesTransferred: 0,
    communitiesArchived: 0,
    classroomsTransferred: 0,
    classroomsArchived: 0,
  };
}

export const supportLinks: SupportLinks = {
  supportUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  supportEmail: null,
};

const initialPrivacy = (): PrivacySettings => ({
  profileVisibility: 'stage',
  defaultPostVisibility: 'stage',
  whoCanMessage: 'stage',
  showOnlineStatus: true,
  showLastSeen: true,
  showActivity: true,
  searchable: true,
});

export let privacy = initialPrivacy();

export function updatePrivacy(patch: Partial<PrivacySettings>): PrivacySettings {
  privacy = { ...privacy, ...patch };
  return privacy;
}

// ---------------------------------------------------------------------------
// reset — a deleted account (or a test) starts the world over

export function resetWorld(): void {
  account = initialAccount();
  evidence = initialEvidence();
  attempts.clear();
  contentItems = initialContent();
  conversationStore = initialConversations();
  relationships = initialRelationships();
  lectureProgress.clear();
  privacy = initialPrivacy();
  idCounter = 0;
}
