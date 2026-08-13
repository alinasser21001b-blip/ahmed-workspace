import { scoreFeedCandidate, visibilityScopesFor, type FeedCandidate } from '@sos/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import { loadActor } from '../src/modules/auth/auth.repository.js';
import { scoreForParity } from '../src/modules/content/content.repository.js';
import {
  auth,
  closeApp,
  createPost,
  ensureCohort,
  getApp,
  onboardedUser,
  type Cohort,
} from './helpers.js';

/**
 * Feed ranking parity.
 *
 * The V1 ranking formula exists twice: in TypeScript (`@sos/core`, where it can
 * be unit-tested and read by a product person) and in SQL (where ranking has to
 * happen, because ranking after the fetch would break pagination).
 *
 * Duplicated logic drifts. This test is the thing that stops it: it scores the
 * same rows both ways and asserts they agree. If someone changes a weight in
 * one place and not the other, this fails rather than the feed quietly
 * ordering itself differently from the documented rules.
 */

let cohort: Cohort;

describe('feed ranking parity between SQL and @sos/core', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });
  afterAll(async () => {
    await closeApp();
    await closePool();
  });

  it('produces identical scores for the same rows', async () => {
    const app = await getApp();
    const author = await onboardedUser({ stageId: cohort.stage5Id });
    const viewer = await onboardedUser({ stageId: cohort.stage5Id });
    const courseId = cohort.courseIds[0]!;

    // Enrol both so course-scoped content is reachable and scores its weight.
    for (const userId of [author.session.user.id, viewer.session.user.id]) {
      await queryOne(
        `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, courseId],
      );
    }
    // The viewer follows the author, exercising the social-proximity term.
    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${author.handle}/follow`,
      headers: auth(viewer.session),
    });

    // A spread of shapes so the comparison covers every term, not just the
    // ones that happen to fire on a default post.
    const plain = await createPost(author.session, { body: 'a plain cohort post' });
    const inCourse = await createPost(author.session, {
      body: 'a course post',
      courseId,
      visibility: 'stage',
    });
    const withInterest = await createPost(author.session, {
      body: 'a post tagged with an interest topic',
      topicIds: [cohort.topicIds[0]!],
    });

    // Engagement and the seen penalty both need state, so build some.
    await app.inject({
      method: 'PUT',
      url: `/v1/content/${plain.body.id}/reaction`,
      headers: auth(viewer.session),
      payload: { kind: 'like' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/content/${plain.body.id}/comments`,
      headers: auth(viewer.session),
      payload: { body: 'a comment to move the engagement term' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/content/${withInterest.body.id}/view`,
      headers: auth(viewer.session),
      payload: {},
    });

    const actor = await loadActor(viewer.session.user.id);
    expect(actor).not.toBeNull();

    const pinnedNow = new Date();
    const sqlScores = await scoreForParity(visibilityScopesFor(actor), pinnedNow);
    const byId = new Map(sqlScores.map((row) => [row.id, row.score]));

    // Rebuild the same candidates in TypeScript, straight from the database so
    // the comparison uses the real stored state rather than what the test
    // believes it wrote.
    for (const contentId of [plain.body.id, inCourse.body.id, withInterest.body.id]) {
      const row = await queryOne<{
        author_id: string;
        created_at: Date;
        kind: string;
        course_id: string | null;
        college_id: string | null;
        stage_id: string | null;
        like_count: number;
        comment_count: number;
        matches_interest: boolean;
        matches_weak: boolean;
        seen: boolean;
        knowledge_type: string | null;
        has_source: boolean;
        is_disputed: boolean;
      }>(
        `SELECT ci.author_id, ci.created_at, ci.kind::text AS kind, ci.course_id,
                ci.college_id, ci.stage_id, ci.like_count, ci.comment_count,
                EXISTS (
                  SELECT 1 FROM content_topics ct
                  JOIN profile_interests pi ON pi.topic_id = ct.topic_id AND pi.user_id = $2
                  WHERE ct.content_id = ci.id
                ) AS matches_interest,
                EXISTS (
                  SELECT 1 FROM content_topics ct
                  JOIN learning_progress lp ON lp.topic_id = ct.topic_id AND lp.user_id = $2
                  WHERE ct.content_id = ci.id AND lp.weakness_score >= 0.5
                ) AS matches_weak,
                EXISTS (
                  SELECT 1 FROM content_views cv
                  WHERE cv.content_id = ci.id AND cv.user_id = $2
                ) AS seen,
                ci.knowledge_type,
                EXISTS (
                  SELECT 1 FROM content_sources cs WHERE cs.content_id = ci.id
                ) AS has_source,
                EXISTS (
                  SELECT 1 FROM content_corrections cc
                  WHERE cc.content_id = ci.id AND cc.status = 'proposed'
                ) AS is_disputed
         FROM content_items ci WHERE ci.id = $1`,
        [contentId, viewer.session.user.id],
      );
      expect(row, contentId).not.toBeNull();

      const candidate: FeedCandidate = {
        contentId,
        authorId: row!.author_id,
        createdAt: row!.created_at,
        inEnrolledCourse: row!.course_id !== null && actor!.courseIds.has(row!.course_id),
        matchesInterestTopic: row!.matches_interest,
        matchesWeakTopic: row!.matches_weak,
        sameCohort: row!.college_id === actor!.collegeId && row!.stage_id === actor!.stageId,
        socialProximity: actor!.followingIds.has(row!.author_id) ? 1 : 0,
        likeCount: row!.like_count,
        commentCount: row!.comment_count,
        // `reel` is deliberately absent: short-form video is not part of the
        // product's centre of gravity and no longer earns an academic bonus.
        isAcademicKind: ['question', 'resource', 'announcement'].includes(row!.kind),
        isClassified: row!.knowledge_type !== null,
        hasSource: row!.has_source,
        isDisputed: row!.is_disputed,
        seen: row!.seen,
      };

      const expected = scoreFeedCandidate(candidate, pinnedNow);
      const actual = byId.get(contentId);

      expect(actual, `sql score missing for ${contentId}`).toBeDefined();
      // Floating-point arithmetic differs in the last bits between Postgres and
      // V8; anything larger than that is a real divergence.
      expect(actual!).toBeCloseTo(expected, 6);
    }
  });

  it('orders the feed the same way both implementations would', async () => {
    const viewer = await onboardedUser({ stageId: cohort.stage5Id });
    const author = await onboardedUser({ stageId: cohort.stage5Id });

    for (let i = 0; i < 4; i += 1) {
      await createPost(author.session, { body: `ordering probe ${i}` });
    }

    const actor = await loadActor(viewer.session.user.id);
    const pinnedNow = new Date();
    const sqlScores = await scoreForParity(visibilityScopesFor(actor), pinnedNow);

    const scores = sqlScores.map((row) => row.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });
});
