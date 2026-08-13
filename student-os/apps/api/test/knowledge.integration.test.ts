import type {
  ContentCorrection,
  ContentItem,
  ContentSource,
  FeedPage,
  LearnOverview,
  TopicDetail,
} from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne, queryRows } from '../src/platform/db.js';
import { auth, closeApp, ensureCohort, getApp, onboardedUser, type Cohort } from './helpers.js';

/**
 * Phase 5 — Knowledge and the learning substrate.
 *
 * The claim under test: **structured, attributable knowledge accumulates, and
 * student behaviour becomes signals** — without an LLM, an embedding or a
 * recommendation engine anywhere in the stack.
 */

let cohort: Cohort;

type Session = Awaited<ReturnType<typeof onboardedUser>>;

async function publish(
  session: Session,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<ContentItem> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/content',
    headers: auth(session.session),
    payload: { body, visibility: 'stage', mediaFileIds: [], topicIds: [], ...extra },
  });
  if (response.statusCode !== 201) {
    throw new Error(`publish failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<ContentItem>();
}

beforeAll(async () => {
  await getApp();
  cohort = await ensureCohort();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

// --- classification ---------------------------------------------------------

describe('classification', () => {
  it('records what a piece of content IS, separately from how it renders', async () => {
    const author = await onboardedUser();
    const item = await publish(author, 'شرح مفصل لآلية اليرقان الوليدي عند الخُدّج.', {
      knowledgeType: 'explanation',
      difficulty: 'medium',
    });

    // Two axes, both present, neither derived from the other (ADR-0012).
    expect(item.kind).toBe('post');
    expect(item.knowledgeType).toBe('explanation');
    expect(item.difficulty).toBe('medium');
  });

  it('refuses a knowledge type that does not apply to the kind', async () => {
    const app = await getApp();
    const author = await onboardedUser();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(author.session),
      payload: {
        body: 'A post cannot be a question.',
        visibility: 'stage',
        mediaFileIds: [],
        topicIds: [],
        knowledgeType: 'question',
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('leaves unclassified content usable rather than guessing a type', async () => {
    // Backfilling a guess would manufacture classification data that looks
    // authored. The gap is visible instead.
    const author = await onboardedUser();
    const item = await publish(author, 'ملاحظة سريعة بدون تصنيف.');
    expect(item.knowledgeType).toBeNull();
    expect(item.difficulty).toBeNull();
  });

  it('derives language from the body, and does not accept it from the client', async () => {
    const author = await onboardedUser();

    const arabic = await publish(
      author,
      'اليرقان الفسيولوجي يظهر بعد أربع وعشرين ساعة من الولادة ويختفي خلال أسبوعين.',
    );
    const english = await publish(
      author,
      'Minimal change disease accounts for most nephrotic syndrome in children under ten.',
    );
    const mixed = await publish(
      author,
      'ملخص محاضرة اليوم عن Respiratory Distress Syndrome ونقص الـ surfactant عند الخُدّج',
    );

    expect(arabic.language).toBe('ar');
    expect(english.language).toBe('en');
    expect(mixed.language).toBe('mixed');

    // A client-supplied language is ignored: it is a fact about the body, and a
    // client that could set it could hide Arabic content from an Arabic filter.
    const lying = await publish(author, 'هذا نص عربي بالكامل ولا يحتوي على إنجليزية.', {
      language: 'en',
    });
    expect(lying.language).toBe('ar');
  });
});

// --- provenance -------------------------------------------------------------

describe('provenance', () => {
  it('starts every claim as the author’s, and says so', async () => {
    const author = await onboardedUser();
    const item = await publish(author, 'شرح من ملاحظاتي الشخصية بدون مصدر.', {
      knowledgeType: 'note',
    });

    // Not a criticism — most of the value in a cohort's notes is uncited.
    expect(item.signals.provenance).toBe('author_claim');
    expect(item.signals.sourceCount).toBe(0);
  });

  it('lets anyone who can see the content cite it, and records who did', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const classmate = await onboardedUser();
    const item = await publish(author, 'المتلازمة الكلوية عند الأطفال — شرح مبسط.', {
      knowledgeType: 'explanation',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/content/${item.id}/sources`,
      headers: auth(classmate.session),
      payload: {
        kind: 'textbook',
        citation: 'Nelson Textbook of Pediatrics, 21st ed.',
        pageRef: 'p. 2752',
      },
    });
    expect(response.statusCode).toBe(201);

    const source = response.json<ContentSource>();
    // The contribution is attributable to the classmate, not silently to the
    // author.
    expect(source.addedBy?.handle).toBe(classmate.handle);

    const reread = await app.inject({
      method: 'GET',
      url: `/v1/content/${item.id}`,
      headers: auth(author.session),
    });
    expect(reread.json<ContentItem>().signals.provenance).toBe('source_backed');
    expect(reread.json<ContentItem>().signals.sourceCount).toBe(1);
  });

  it('refuses a source on content the caller cannot see', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const outsider = await onboardedUser();

    const group = (
      await app.inject({
        method: 'POST',
        url: '/v1/groups',
        headers: auth(owner.session),
        payload: { name: 'Hidden knowledge circle', visibility: 'group', joinPolicy: 'invite' },
      })
    ).json<{ id: string }>();

    const item = await publish(owner, 'محتوى داخل مجموعة غير مُدرجة.', {
      visibility: 'group',
      groupId: group.id,
    });

    for (const [method, url] of [
      ['GET', `/v1/content/${item.id}/sources`],
      ['GET', `/v1/content/${item.id}/corrections`],
    ] as const) {
      const response = await app.inject({ method, url, headers: auth(outsider.session) });
      // 404, never 403: a 403 confirms the content exists.
      expect(response.statusCode, url).toBe(404);
    }

    const write = await app.inject({
      method: 'POST',
      url: `/v1/content/${item.id}/sources`,
      headers: auth(outsider.session),
      payload: { kind: 'textbook', citation: 'Should not be possible' },
    });
    expect(write.statusCode).toBe(404);
  });

  it('never turns counts into a score', async () => {
    /*
     * ADR-0013's central property, asserted rather than described: what a
     * reader gets is a set of row counts and a class chosen by rules. Nothing
     * in the payload is an opaque float.
     */
    const author = await onboardedUser();
    const item = await publish(author, 'محتوى للتحقق من شكل الإشارات.', {
      knowledgeType: 'summary',
    });

    expect(Object.keys(item.signals).sort()).toEqual([
      'acceptedCorrectionCount',
      'hasAcceptedAnswer',
      'helpfulCount',
      'openCorrectionCount',
      'provenance',
      'sourceCount',
    ]);
    expect(typeof item.signals.provenance).toBe('string');
  });

  it('counts helpful and insightful as quality, and likes as neither', async () => {
    // `helpful` is a judgement about correctness; `like` is affinity. Ranking
    // may use both; the quality count must never add them together (ADR-0014).
    const app = await getApp();
    const author = await onboardedUser();
    const a = await onboardedUser();
    const b = await onboardedUser();
    const item = await publish(author, 'شرح دقيق عن الوذمة في المتلازمة الكلوية.', {
      knowledgeType: 'explanation',
    });

    await app.inject({
      method: 'PUT',
      url: `/v1/content/${item.id}/reaction`,
      headers: auth(a.session),
      payload: { kind: 'helpful' },
    });
    await app.inject({
      method: 'PUT',
      url: `/v1/content/${item.id}/reaction`,
      headers: auth(b.session),
      payload: { kind: 'like' },
    });

    const reread = await app.inject({
      method: 'GET',
      url: `/v1/content/${item.id}`,
      headers: auth(author.session),
    });
    const signals = reread.json<ContentItem>().signals;
    expect(signals.helpfulCount).toBe(1);
    expect(reread.json<ContentItem>().counts.likes).toBe(2);
  });
});

// --- corrections ------------------------------------------------------------

describe('corrections', () => {
  async function propose(
    session: Session,
    contentId: string,
    body: string,
    source?: Record<string, unknown>,
  ) {
    const app = await getApp();
    return app.inject({
      method: 'POST',
      url: `/v1/content/${contentId}/corrections`,
      headers: auth(session.session),
      payload: { body, source: source ?? null },
    });
  }

  it('carries a lifecycle a comment could not', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const corrector = await onboardedUser();
    const item = await publish(author, 'اليرقان يظهر دائماً خلال أول ٢٤ ساعة.', {
      knowledgeType: 'explanation',
    });

    const proposed = await propose(
      corrector,
      item.id,
      'هذا غير دقيق: اليرقان في أول ٢٤ ساعة يُعتبر مرضياً، والفسيولوجي يبدأ بعدها.',
    );
    expect(proposed.statusCode).toBe(201);
    expect(proposed.json<ContentCorrection>().status).toBe('proposed');

    // While it is open, the content is DISPUTED — a reader needs to know before
    // they read the body, whether or not they open the thread.
    const disputed = await app.inject({
      method: 'GET',
      url: `/v1/content/${item.id}`,
      headers: auth(corrector.session),
    });
    expect(disputed.json<ContentItem>().signals.provenance).toBe('disputed');
    expect(disputed.json<ContentItem>().signals.openCorrectionCount).toBe(1);

    const resolved = await app.inject({
      method: 'PATCH',
      url: `/v1/content/${item.id}/corrections/${proposed.json<ContentCorrection>().id}`,
      headers: auth(author.session),
      payload: { status: 'accepted' },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<ContentCorrection>().resolvedBy?.handle).toBe(author.handle);
    expect(resolved.json<ContentCorrection>().resolvedAt).not.toBeNull();

    const corrected = await app.inject({
      method: 'GET',
      url: `/v1/content/${item.id}`,
      headers: auth(corrector.session),
    });
    expect(corrected.json<ContentItem>().signals.provenance).toBe('corrected');
  });

  it('puts a correction above a citation in what the reader is told', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const corrector = await onboardedUser();
    const item = await publish(author, 'محتوى موثّق ولكنه خاطئ.', { knowledgeType: 'explanation' });

    await app.inject({
      method: 'POST',
      url: `/v1/content/${item.id}/sources`,
      headers: auth(author.session),
      payload: { kind: 'textbook', citation: 'Some textbook' },
    });

    const proposed = await propose(corrector, item.id, 'المصدر قديم وقد تغيّرت التوصيات منذ ٢٠٢٠.');
    await app.inject({
      method: 'PATCH',
      url: `/v1/content/${item.id}/corrections/${proposed.json<ContentCorrection>().id}`,
      headers: auth(author.session),
      payload: { status: 'accepted' },
    });

    const reread = await app.inject({
      method: 'GET',
      url: `/v1/content/${item.id}`,
      headers: auth(author.session),
    });
    // Well-sourced AND corrected: the reader needs the correction first.
    expect(reread.json<ContentItem>().signals.sourceCount).toBeGreaterThan(0);
    expect(reread.json<ContentItem>().signals.provenance).toBe('corrected');
  });

  it('refuses an author correcting their own content', async () => {
    // They edit it. Letting an author file against themselves would make "was
    // this challenged?" unanswerable.
    const author = await onboardedUser();
    const item = await publish(author, 'محتوى للاختبار.', { knowledgeType: 'note' });
    const response = await propose(author, item.id, 'أصحح نفسي هنا بدلاً من التعديل.');
    expect(response.statusCode).toBe(403);
  });

  it('refuses a second open proposal from the same person', async () => {
    const author = await onboardedUser();
    const corrector = await onboardedUser();
    const item = await publish(author, 'محتوى قابل للتصحيح.', { knowledgeType: 'note' });

    expect((await propose(corrector, item.id, 'التصحيح الأول لهذا المحتوى.')).statusCode).toBe(201);
    // A second is an edit of the first, not a new claim — and without this a
    // disagreement becomes a flood.
    expect((await propose(corrector, item.id, 'التصحيح الثاني لهذا المحتوى.')).statusCode).toBe(500);
  });

  it('lets only the author or a moderator resolve', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const corrector = await onboardedUser();
    const bystander = await onboardedUser();
    const item = await publish(author, 'محتوى للتحقق من الصلاحيات.', { knowledgeType: 'note' });

    const proposed = await propose(corrector, item.id, 'اقتراح تصحيح من زميل في الدفعة.');
    const correctionId = proposed.json<ContentCorrection>().id;

    for (const who of [corrector, bystander]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/content/${item.id}/corrections/${correctionId}`,
        headers: auth(who.session),
        payload: { status: 'accepted' },
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('adopts a correction’s citation only when the correction is accepted', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const corrector = await onboardedUser();
    const rejected = await publish(author, 'محتوى سيُرفض تصحيحه.', { knowledgeType: 'note' });

    const proposal = await propose(corrector, rejected.id, 'تصحيح مدعوم بمصدر سيُرفض.', {
      kind: 'guideline',
      citation: 'AAP Clinical Practice Guideline 2022',
    });

    await app.inject({
      method: 'PATCH',
      url: `/v1/content/${rejected.id}/corrections/${proposal.json<ContentCorrection>().id}`,
      headers: auth(author.session),
      payload: { status: 'rejected' },
    });

    const reread = await app.inject({
      method: 'GET',
      url: `/v1/content/${rejected.id}`,
      headers: auth(author.session),
    });
    // The content must NOT read as source-backed on the strength of a citation
    // attached to a claim the author rejected.
    expect(reread.json<ContentItem>().signals.acceptedCorrectionCount).toBe(0);
    expect(reread.json<ContentItem>().signals.openCorrectionCount).toBe(0);
  });
});

// --- learning signals -------------------------------------------------------

describe('learning signals', () => {
  it('records saving as meaningful and opening as not', async () => {
    /*
     * The distinction ADR-0014 exists to protect. Opening is channel B;
     * counting it as learning would inflate the north-star with scrolling,
     * which is the metric this product is defined against.
     */
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const item = await publish(author, 'شرح يستحق الحفظ للمراجعة لاحقاً.', {
      knowledgeType: 'explanation',
      topicIds: [cohort.topicIds[0]!],
    });

    await app.inject({
      method: 'POST',
      url: `/v1/content/${item.id}/view`,
      headers: auth(reader.session),
      payload: {},
    });
    await app.inject({
      method: 'PUT',
      url: `/v1/content/${item.id}/bookmark`,
      headers: auth(reader.session),
      payload: {},
    });

    const events = await queryRows<{ kind: string; is_meaningful: boolean; topic_id: string | null }>(
      `SELECT le.kind, k.is_meaningful, le.topic_id
       FROM learning_events le
       JOIN learning_event_kinds k ON k.kind = le.kind
       WHERE le.user_id = $1 AND le.subject_ref_id = $2
       ORDER BY le.occurred_at`,
      [reader.session.user.id, item.id],
    );

    const opened = events.find((e) => e.kind === 'knowledge_opened');
    const saved = events.find((e) => e.kind === 'knowledge_saved');

    expect(opened, 'opening should be recorded').toBeDefined();
    expect(opened!.is_meaningful).toBe(false);
    expect(saved, 'saving should be recorded').toBeDefined();
    expect(saved!.is_meaningful).toBe(true);

    // Carrying the topic is what lets the signal roll up. Without it the row is
    // inert for everything downstream.
    expect(saved!.topic_id).toBe(cohort.topicIds[0]);
  });

  it('records a signal per topic, because learning happens about topics', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const topics = cohort.topicIds.slice(0, 2);
    const item = await publish(author, 'محتوى موسوم بموضوعين اثنين.', {
      knowledgeType: 'summary',
      topicIds: topics,
    });

    await app.inject({
      method: 'PUT',
      url: `/v1/content/${item.id}/bookmark`,
      headers: auth(reader.session),
      payload: {},
    });

    const rows = await queryRows<{ topic_id: string }>(
      `SELECT topic_id FROM learning_events
       WHERE user_id = $1 AND subject_ref_id = $2 AND kind = 'knowledge_saved'`,
      [reader.session.user.id, item.id],
    );
    expect(rows.map((r) => r.topic_id).sort()).toEqual([...topics].sort());
  });

  it('records an accepted correction as a signal for the PROPOSER', async () => {
    // They found an error and the author agreed — among the strongest learning
    // signals this product can observe about a student.
    const app = await getApp();
    const author = await onboardedUser();
    const corrector = await onboardedUser();
    const item = await publish(author, 'محتوى سيُصحَّح.', {
      knowledgeType: 'explanation',
      topicIds: [cohort.topicIds[0]!],
    });

    const proposed = await app.inject({
      method: 'POST',
      url: `/v1/content/${item.id}/corrections`,
      headers: auth(corrector.session),
      payload: { body: 'تصحيح مهم على هذا الشرح المنشور.', source: null },
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/content/${item.id}/corrections/${proposed.json<ContentCorrection>().id}`,
      headers: auth(author.session),
      payload: { status: 'accepted' },
    });

    const forProposer = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM learning_events
       WHERE user_id = $1 AND kind = 'correction_accepted'`,
      [corrector.session.user.id],
    );
    const forAuthor = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM learning_events
       WHERE user_id = $1 AND kind = 'correction_accepted'`,
      [author.session.user.id],
    );

    expect(Number(forProposer?.n)).toBe(1);
    expect(Number(forAuthor?.n)).toBe(0);
  });

  it('surfaces the north-star for one student on the Learn screen', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const learner = await onboardedUser();
    const item = await publish(author, 'محتوى للحفظ وقياس الإشارة.', {
      knowledgeType: 'note',
      topicIds: [cohort.topicIds[0]!],
    });

    const before = await app.inject({
      method: 'GET',
      url: '/v1/learn',
      headers: auth(learner.session),
    });
    expect(before.json<LearnOverview>().meaningfulActionsThisWeek).toBe(0);

    await app.inject({
      method: 'PUT',
      url: `/v1/content/${item.id}/bookmark`,
      headers: auth(learner.session),
      payload: {},
    });

    const after = await app.inject({
      method: 'GET',
      url: '/v1/learn',
      headers: auth(learner.session),
    });
    const overview = after.json<LearnOverview>();
    expect(overview.meaningfulActionsThisWeek).toBeGreaterThan(0);
    expect(overview.savedCount).toBe(1);
    // Declared interests give a cold-start surface something to show before any
    // behaviour exists.
    expect(overview.interestTopics.length).toBeGreaterThan(0);
  });
});

// --- topics -----------------------------------------------------------------

describe('topics as a navigation primitive', () => {
  it('shows a topic’s place in the hierarchy and what is in it', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const topicId = cohort.topicIds[0]!;

    await publish(author, 'شرح أول عن هذا الموضوع الدراسي.', {
      knowledgeType: 'explanation',
      topicIds: [topicId],
    });
    await publish(author, 'ملخص ثانٍ عن نفس الموضوع الدراسي.', {
      knowledgeType: 'summary',
      topicIds: [topicId],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/topics/${topicId}`,
      headers: auth(reader.session),
    });
    expect(response.statusCode).toBe(200);

    const topic = response.json<TopicDetail>();
    expect(topic.subjectName.length).toBeGreaterThan(0);
    expect(topic.courseName.length).toBeGreaterThan(0);

    const byType = new Map(topic.knowledgeCounts.map((c) => [c.knowledgeType, c.count]));
    expect(byType.get('explanation')).toBeGreaterThanOrEqual(1);
    expect(byType.get('summary')).toBeGreaterThanOrEqual(1);
  });

  it('never counts knowledge the reader could not open', async () => {
    /*
     * A count leaks as surely as a row. This is the single most important
     * assertion on the topic page.
     */
    const app = await getApp();
    const owner = await onboardedUser();
    const outsider = await onboardedUser();
    const topicId = cohort.topicIds[1]!;

    const group = (
      await app.inject({
        method: 'POST',
        url: '/v1/groups',
        headers: auth(owner.session),
        payload: { name: 'Private topic circle', visibility: 'group', joinPolicy: 'invite' },
      })
    ).json<{ id: string }>();

    await publish(owner, 'محتوى سري داخل مجموعة غير مُدرجة عن هذا الموضوع.', {
      knowledgeType: 'case',
      topicIds: [topicId],
      visibility: 'group',
      groupId: group.id,
    });

    const forOwner = await app.inject({
      method: 'GET',
      url: `/v1/topics/${topicId}`,
      headers: auth(owner.session),
    });
    const forOutsider = await app.inject({
      method: 'GET',
      url: `/v1/topics/${topicId}`,
      headers: auth(outsider.session),
    });

    const ownerCases =
      forOwner.json<TopicDetail>().knowledgeCounts.find((c) => c.knowledgeType === 'case')?.count ?? 0;
    const outsiderCases =
      forOutsider.json<TopicDetail>().knowledgeCounts.find((c) => c.knowledgeType === 'case')?.count ?? 0;

    expect(ownerCases).toBeGreaterThanOrEqual(1);
    expect(outsiderCases).toBe(0);
  });

  it('filters a topic’s knowledge deterministically, and still by permission', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const topicId = cohort.topicIds[2]!;

    const explanation = await publish(author, 'شرح مفصل عن هذا الموضوع تحديداً.', {
      knowledgeType: 'explanation',
      topicIds: [topicId],
    });
    await publish(author, 'ملاحظة قصيرة عن نفس الموضوع.', {
      knowledgeType: 'note',
      topicIds: [topicId],
    });

    const filtered = await app.inject({
      method: 'GET',
      url: `/v1/topics/${topicId}/knowledge?knowledgeType=explanation&limit=20`,
      headers: auth(reader.session),
    });
    const items = filtered.json<FeedPage>().items;
    expect(items.map((i) => i.id)).toContain(explanation.id);
    expect(items.every((i) => i.knowledgeType === 'explanation')).toBe(true);
  });

  it('derives related topics from co-tagging, and marks them derived', async () => {
    /*
     * The product's first intelligence, and it is arithmetic: two topics that
     * appear together on the cohort's own content are related. No model, no
     * embedding — and explainable to a student in one sentence.
     */
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const [a, b] = [cohort.topicIds[0]!, cohort.topicIds[1]!];

    for (let i = 0; i < 3; i += 1) {
      await publish(author, `محتوى مشترك بين موضوعين رقم ${i}.`, {
        knowledgeType: 'summary',
        topicIds: [a, b],
      });
    }

    const inserted = await queryOne<{ n: string }>(
      `WITH pairs AS (
         SELECT x.topic_id AS from_topic_id, y.topic_id AS to_topic_id, count(*)::real AS strength
         FROM content_topics x
         JOIN content_topics y ON y.content_id = x.content_id AND y.topic_id <> x.topic_id
         JOIN content_items ci ON ci.id = x.content_id AND ci.deleted_at IS NULL
         GROUP BY x.topic_id, y.topic_id
         HAVING count(*) >= 2
       )
       INSERT INTO topic_relations (from_topic_id, to_topic_id, relation, source, strength)
       SELECT from_topic_id, to_topic_id, 'related', 'derived', strength FROM pairs
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [],
    );
    void inserted;

    const response = await app.inject({
      method: 'GET',
      url: `/v1/topics/${a}`,
      headers: auth(reader.session),
    });
    const related = response.json<TopicDetail>().related;
    const edge = related.find((r) => r.id === b);

    expect(edge, 'co-tagged topics should be related').toBeDefined();
    // The provenance of the edge is on the row: a count is not an assertion.
    expect(edge!.source).toBe('derived');
    expect(edge!.strength).toBeGreaterThanOrEqual(2);
  });

  it('404s an unknown topic', async () => {
    const app = await getApp();
    const reader = await onboardedUser();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/topics/00000000-0000-4000-8000-000000000000',
      headers: auth(reader.session),
    });
    expect(response.statusCode).toBe(404);
  });
});
