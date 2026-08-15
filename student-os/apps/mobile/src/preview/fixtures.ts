import type {
  Conversation,
  ConversationPage,
  LearnOverview,
  Message,
  MessagePage,
  PracticeAnswerResult,
  PracticeQuestion,
  PracticeSession,
  Profile,
} from '@sos/contracts';

/**
 * Preview fixtures.
 *
 * Invented people, invented posts, invented messages. Nothing here is derived
 * from a real account, and the dataset is small enough to read end to end,
 * which is the point: a reviewer can confirm by inspection that no student's
 * data is in the preview build.
 *
 * The content is deliberately realistic rather than `Lorem ipsum` — the preview
 * exists to evaluate hierarchy, density and Arabic rendering, and placeholder
 * text would defeat all three. It mixes Arabic and English, includes the
 * clinical units and page references the RTL rules have to handle, and gives at
 * least one string in every list a length that will wrap at 360 px.
 */

export const PREVIEW_USER_ID = 'preview-user-0001';

/** Deterministic timestamps: a preview that shifts every reload is hard to review. */
const T0 = Date.parse('2026-08-10T09:00:00.000Z');
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

export const previewProfile: Profile = {
  userId: PREVIEW_USER_ID,
  handle: 'preview.student',
  displayName: 'Preview Student',
  avatarUrl: null,
  bio: 'حساب تجريبي للمعاينة — Preview account. Second-year medical student.',
  verificationLevel: 'student',
  academic: {
    universityId: 'u1',
    universityName: 'University of Baghdad',
    collegeId: 'c1',
    collegeName: 'College of Medicine',
    programId: 'p1',
    programName: 'Medicine',
    stageId: 's2',
    stageName: 'Second year',
    academicYearId: null,
    academicYearLabel: null,
  },
  interests: [
    { id: 't-acid-base', nameEn: 'Acid–base balance', nameAr: 'التوازن الحمضي القاعدي' },
    { id: 't-renal', nameEn: 'Renal physiology', nameAr: 'فسيولوجيا الكلية' },
  ],
  contributionScore: 0,
  followerCount: 0,
  followingCount: 0,
  onboardingCompleted: true,
  createdAt: at(-10000),
  viewer: { isSelf: true, isFollowing: false, isBlocked: false, canMessage: false },
};

/**
 * The topic the core journey runs through. Acid–base is chosen because its real
 * content carries exactly the mixed-script hazards the RTL spec calls out:
 * `pH 7.1`, `18 g/L`, and an English textbook title inside an Arabic sentence.
 */
export const previewLearn: LearnOverview = {
  focusTopics: [
    {
      id: 't-acid-base',
      name: 'Acid–base balance',
      subjectName: 'Physiology',
      questionsSeen: 6,
      weaknessScore: 0.34,
      lowConfidence: false,
      lastActivityAt: at(30),
    },
    {
      id: 't-renal',
      name: 'Renal physiology and the countercurrent multiplier',
      subjectName: 'Physiology',
      questionsSeen: 2,
      weaknessScore: 0.61,
      lowConfidence: true,
      lastActivityAt: at(-1440),
    },
  ],
  interestTopics: [{ id: 't-cardio', name: 'Cardiac cycle' }],
  savedCount: 7,
  meaningfulActionsThisWeek: 12,
};

const questions: PracticeQuestion[] = [
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
    prompt: 'ما هي القيمة الطبيعية لتركيز البيكربونات في المصل؟',
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
];

/** Answer keys live here, not on the question, so the client cannot grade. */
const answerKey: Record<string, string[]> = {
  q1: ['q1a'],
  q2: ['q2a'],
  q3: ['q3a', 'q3b', 'q3d'],
};

const explanations: Record<string, string> = {
  q1: 'A low pH with a low HCO₃⁻ is a metabolic acidosis; the low PaCO₂ is the respiratory compensation, not a second primary disturbance.',
  q2: 'المدى المرجعي المعتاد هو 22–26 mmol/L، ويُقاس عادةً مع غازات الدم الشرياني.',
  q3: 'Diarrhoea causes a normal-anion-gap (hyperchloraemic) acidosis through bicarbonate loss, so it is the exception here.',
};

export function makePracticeSession(topicId: string): PracticeSession {
  return {
    attemptId: `preview-attempt-${topicId}`,
    quizId: `preview-quiz-${topicId}`,
    quizTitle: 'Acid–base balance — set 1',
    topicId,
    topicName:
      [...previewLearn.focusTopics, ...previewLearn.interestTopics].find((topic) => topic.id === topicId)
        ?.name ?? 'Acid–base balance',
    questions: questions.map((question) => ({ ...question })),
    progress: {
      topicId,
      questionsSeen: 6,
      questionsCorrect: 4,
      weaknessScore: 0.34,
      confidence: 0.66,
      lowConfidence: false,
      lastActivityAt: at(30),
    },
  };
}

export function gradePreviewAnswer(
  topicId: string,
  questionId: string,
  selectedOptionIds: string[],
  seen: number,
  correct: number,
): PracticeAnswerResult {
  const key = answerKey[questionId] ?? [];
  const isCorrect =
    key.length === selectedOptionIds.length && key.every((id) => selectedOptionIds.includes(id));
  const nextSeen = seen + 1;
  const nextCorrect = correct + (isCorrect ? 1 : 0);
  return {
    questionId,
    isCorrect,
    correctOptionIds: key,
    explanation: explanations[questionId] ?? null,
    pointsAwarded: isCorrect ? 1 : 0,
    alreadyAnswered: false,
    attemptCompleted: false,
    progress: {
      topicId,
      questionsSeen: nextSeen,
      questionsCorrect: nextCorrect,
      weaknessScore: nextSeen === 0 ? 0 : 1 - nextCorrect / nextSeen,
      confidence: nextSeen === 0 ? 0 : nextCorrect / nextSeen,
      // Mirrors MIN_QUESTIONS_FOR_CONFIDENCE in @sos/core rather than inventing
      // a second threshold the Learn tab would eventually disagree with.
      lowConfidence: nextSeen < 5,
      lastActivityAt: at(140),
    },
  };
}

const summary = (
  userId: string,
  handle: string,
  displayName: string,
): NonNullable<Message['author']> => ({
  userId,
  handle,
  displayName,
  avatarUrl: null,
  verificationLevel: 'student',
  stageName: 'Second year',
  collegeName: 'College of Medicine',
});

const conversations: Conversation[] = [
  {
    id: 'conv-1',
    kind: 'direct',
    title: 'Layla Hassan',
    avatarUrl: null,
    groupId: null,
    counterpart: summary('preview-other-1', 'layla.hassan', 'Layla Hassan'),
    lastSeq: 3,
    lastMessageAt: at(118),
    lastMessagePreview: 'اقرأي الفصل السابع من Guyton and Hall، صفحة 214.',
    createdAt: at(0),
    viewer: {
      role: 'member',
      canRead: true,
      canSend: true,
      lastReadSeq: 1,
      unreadCount: 2,
      muted: false,
    },
  },
  {
    id: 'conv-2',
    kind: 'group',
    title: 'Physiology study group — مجموعة الفسلجة',
    avatarUrl: null,
    groupId: 'grp-1',
    counterpart: null,
    lastSeq: 9,
    lastMessageAt: at(60),
    lastMessagePreview: 'Sharing my notes on the countercurrent multiplier, p. 214.',
    createdAt: at(0),
    viewer: {
      role: 'member',
      canRead: true,
      canSend: true,
      lastReadSeq: 9,
      unreadCount: 0,
      muted: false,
    },
  },
];

const messages: Record<string, Message[]> = {
  'conv-1': [
    {
      id: 'm1',
      conversationId: 'conv-1',
      seq: 1,
      clientMessageId: 'cm1',
      kind: 'text',
      body: 'هل راجعت جدول قيم غازات الدم؟',
      author: summary('preview-other-1', 'layla.hassan', 'Layla Hassan'),
      replyToId: null,
      attachments: [],
      editedAt: null,
      deletedAt: null,
      createdAt: at(100),
    },
    {
      id: 'm2',
      conversationId: 'conv-1',
      seq: 2,
      clientMessageId: 'cm2',
      kind: 'text',
      body: 'Not yet — I am still on the compensation rules. pH 7.1 with HCO₃⁻ 12 mmol/L threw me.',
      author: summary(PREVIEW_USER_ID, 'preview.student', 'Preview Student'),
      replyToId: null,
      attachments: [],
      editedAt: null,
      deletedAt: null,
      createdAt: at(104),
    },
    {
      id: 'm3',
      conversationId: 'conv-1',
      seq: 3,
      clientMessageId: 'cm3',
      kind: 'text',
      body: 'اقرأي الفصل السابع من Guyton and Hall، صفحة 214.',
      author: summary('preview-other-1', 'layla.hassan', 'Layla Hassan'),
      replyToId: null,
      attachments: [],
      editedAt: null,
      deletedAt: null,
      createdAt: at(118),
    },
  ],
  'conv-2': [
    {
      id: 'm4',
      conversationId: 'conv-2',
      seq: 9,
      clientMessageId: 'cm4',
      kind: 'text',
      body: 'Sharing my notes on the countercurrent multiplier, p. 214.',
      author: summary('preview-other-2', 'omar.k', 'Omar Khalid'),
      replyToId: null,
      attachments: [],
      editedAt: null,
      deletedAt: null,
      createdAt: at(60),
    },
  ],
};

export function listConversations(): ConversationPage {
  return {
    items: conversations,
    nextCursor: null,
    totalUnread: conversations.reduce((sum, c) => sum + c.viewer.unreadCount, 0),
  };
}

export function listMessages(conversationId: string): MessagePage {
  const items = messages[conversationId] ?? [];
  return {
    items,
    nextBeforeSeq: null,
    lastSeq: items.length > 0 ? (items[items.length - 1]?.seq ?? 0) : 0,
  };
}

export function conversationById(conversationId: string): Conversation | null {
  return conversations.find((conversation) => conversation.id === conversationId) ?? null;
}
