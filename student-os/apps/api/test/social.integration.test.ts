import type { Comment, ContentItem, ErrorEnvelope } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import {
  auth,
  closeApp,
  createPost,
  ensureCohort,
  getApp,
  NOT_AN_IMAGE,
  onboardedUser,
  readFeed,
  uploadImage,
  type Cohort,
} from './helpers.js';

/**
 * Phase 2 — Social core.
 *
 * The phase exit criterion in the roadmap, as a test: *a student creates a post
 * with an image, it appears in cohort-mates' feeds and nowhere else, and
 * cross-cohort access is proven blocked.*
 */

let cohort: Cohort;

describe('the phase 2 exit criterion', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });
  afterAll(async () => {
    await closeApp();
    await closePool();
  });

  it('a post with an image reaches cohort-mates and nobody else', async () => {
    const author = await onboardedUser({ stageId: cohort.stage5Id });
    const cohortMate = await onboardedUser({ stageId: cohort.stage5Id });
    const otherStage = await onboardedUser({ stageId: cohort.stage4Id });

    const upload = await uploadImage(author.session);
    expect(upload.statusCode).toBe(201);
    expect(upload.body.width).toBe(1);

    const created = await createPost(author.session, {
      body: 'ملخص المتلازمة الكلوية',
      mediaFileIds: [upload.body.id],
      visibility: 'stage',
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.media).toHaveLength(1);
    expect(created.body.media[0]?.url).toContain('sig=');

    const mateFeed = await readFeed(cohortMate.session);
    expect(mateFeed.items.map((i) => i.id)).toContain(created.body.id);

    // The whole point of the phase: the cohort boundary holds.
    const outsiderFeed = await readFeed(otherStage.session);
    expect(outsiderFeed.items.map((i) => i.id)).not.toContain(created.body.id);

    const app = await getApp();
    const direct = await app.inject({
      method: 'GET',
      url: `/v1/content/${created.body.id}`,
      headers: auth(otherStage.session),
    });
    expect(direct.statusCode).toBe(404);
  });
});

describe('feed isolation', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('never shows private content to anyone but its author', async () => {
    const author = await onboardedUser();
    const other = await onboardedUser();

    const created = await createPost(author.session, {
      body: 'private note to self',
      visibility: 'private',
    });

    const ownFeed = await readFeed(author.session);
    expect(ownFeed.items.map((i) => i.id)).toContain(created.body.id);

    const otherFeed = await readFeed(other.session);
    expect(otherFeed.items.map((i) => i.id)).not.toContain(created.body.id);
  });

  it('shows followers-scoped content only to followers', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const follower = await onboardedUser();
    const stranger = await onboardedUser();

    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${author.handle}/follow`,
      headers: auth(follower.session),
    });

    const created = await createPost(author.session, {
      body: 'for my followers',
      visibility: 'followers',
    });

    expect((await readFeed(follower.session)).items.map((i) => i.id)).toContain(created.body.id);
    expect((await readFeed(stranger.session)).items.map((i) => i.id)).not.toContain(
      created.body.id,
    );
  });

  it('hides a blocked author’s content in both directions', async () => {
    const author = await onboardedUser();
    const blocker = await onboardedUser();

    const created = await createPost(author.session, { body: 'visible for now' });
    expect((await readFeed(blocker.session)).items.map((i) => i.id)).toContain(created.body.id);

    const app = await getApp();
    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${author.handle}/block`,
      headers: auth(blocker.session),
      payload: {},
    });

    // The blocker no longer sees the author...
    expect((await readFeed(blocker.session)).items.map((i) => i.id)).not.toContain(created.body.id);

    // ...and the author no longer sees the blocker either.
    const blockerPost = await createPost(blocker.session, { body: 'after the block' });
    expect((await readFeed(author.session)).items.map((i) => i.id)).not.toContain(
      blockerPost.body.id,
    );
  });

  it('excludes deleted content from every feed', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const mate = await onboardedUser();

    const created = await createPost(author.session, { body: 'about to go' });
    expect((await readFeed(mate.session)).items.map((i) => i.id)).toContain(created.body.id);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/content/${created.body.id}`,
      headers: auth(author.session),
    });
    expect(deleted.statusCode).toBe(204);

    expect((await readFeed(mate.session)).items.map((i) => i.id)).not.toContain(created.body.id);
    expect((await readFeed(author.session)).items.map((i) => i.id)).not.toContain(created.body.id);
  });

  /*
   * This test used to be named for `suspended` and set `banned`, so nothing
   * covered suspension at all — and suspension was in fact NOT excluded, in the
   * feed or anywhere else. Both statuses are asserted separately now, and
   * `restricted` is asserted to behave differently on purpose.
   */
  it.each(['suspended', 'banned'] as const)(
    'withdraws content from a %s author, in the feed and in the single-item read',
    async (status) => {
      const app = await getApp();
      const author = await onboardedUser();
      const mate = await onboardedUser();
      const created = await createPost(author.session, { body: `from a soon-to-be-${status} user` });

      await queryOne(`UPDATE users SET status = $2 WHERE id = $1`, [
        author.session.user.id,
        status,
      ]);

      expect((await readFeed(mate.session)).items.map((i) => i.id)).not.toContain(created.body.id);

      const item = await app.inject({
        method: 'GET',
        url: `/v1/content/${created.body.id}`,
        headers: auth(mate.session),
      });
      expect(item.statusCode).toBe(404);
    },
  );

  it('keeps a restricted author’s existing content visible', async () => {
    // Restriction removes the ability to write. It does not retract what was
    // already written — that is what separates it from a suspension.
    const author = await onboardedUser();
    const mate = await onboardedUser();
    const created = await createPost(author.session, { body: 'written before the restriction' });

    await queryOne(`UPDATE users SET status = 'restricted' WHERE id = $1`, [
      author.session.user.id,
    ]);

    expect((await readFeed(mate.session)).items.map((i) => i.id)).toContain(created.body.id);
  });
});

describe('feed pagination', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('pages without duplicating or dropping items', async () => {
    const author = await onboardedUser();
    const reader = await onboardedUser();

    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      const created = await createPost(author.session, { body: `post number ${i}` });
      ids.push(created.body.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query: string = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const result = await readFeed(reader.session, query);
      seen.push(...result.items.map((i) => i.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    const mine = seen.filter((id) => ids.includes(id));
    expect(new Set(mine).size).toBe(mine.length); // no duplicates across pages
    for (const id of ids) expect(mine).toContain(id); // nothing dropped
  });

  it('rejects a malformed cursor instead of silently restarting', async () => {
    const app = await getApp();
    const reader = await onboardedUser();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/feed?cursor=not-a-real-cursor',
      headers: auth(reader.session),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorEnvelope>().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('uploads', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('refuses a file whose bytes are not an image, whatever it claims to be', async () => {
    // The client says image/png and names it .png. The bytes say shell script.
    const result = await uploadImage(await freshSession(), NOT_AN_IMAGE, 'payload.png', 'image/png');
    expect(result.statusCode).toBe(415);
  });

  it('serves bytes for a valid signature and refuses a tampered one', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const upload = await uploadImage(author.session);

    const ok = await app.inject({ method: 'GET', url: upload.body.url });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');

    const tampered = upload.body.url.replace(/sig=[^&]+/, 'sig=' + 'A'.repeat(43));
    expect((await app.inject({ method: 'GET', url: tampered })).statusCode).toBe(404);

    const extended = upload.body.url.replace(/exp=\d+/, `exp=${Math.floor(Date.now() / 1000) + 99999}`);
    expect((await app.inject({ method: 'GET', url: extended })).statusCode).toBe(404);
  });

  it('refuses to attach media the poster does not own', async () => {
    const owner = await onboardedUser();
    const thief = await onboardedUser();
    const upload = await uploadImage(owner.session);

    const stolen = await createPost(thief.session, {
      body: 'not my image',
      mediaFileIds: [upload.body.id],
    });
    expect(stolen.statusCode).toBe(412);
  });

  it('refuses to reuse media already attached to another post', async () => {
    const author = await onboardedUser();
    const upload = await uploadImage(author.session);

    const first = await createPost(author.session, { body: 'first', mediaFileIds: [upload.body.id] });
    expect(first.statusCode).toBe(201);

    const second = await createPost(author.session, {
      body: 'second',
      mediaFileIds: [upload.body.id],
    });
    expect(second.statusCode).toBe(412);
  });

  it('keeps an unattached upload private to its owner', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const other = await onboardedUser();
    const upload = await uploadImage(owner.session);

    const asOwner = await app.inject({
      method: 'GET',
      url: `/v1/files/${upload.body.id}`,
      headers: auth(owner.session),
    });
    expect(asOwner.statusCode).toBe(200);

    const asOther = await app.inject({
      method: 'GET',
      url: `/v1/files/${upload.body.id}`,
      headers: auth(other.session),
    });
    expect(asOther.statusCode).toBe(404);
  });
});

describe('posting rules', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('refuses an empty post', async () => {
    const author = await onboardedUser();
    const result = await createPost(author.session, { body: '   ' });
    expect(result.statusCode).toBe(400);
  });

  it('ignores a client-supplied author and academic context', async () => {
    const author = await onboardedUser();
    const victim = await onboardedUser({ stageId: cohort.stage4Id });

    const created = await createPost(author.session, {
      body: 'attempting to publish as someone else',
      authorId: victim.session.user.id,
      collegeId: '00000000-0000-4000-8000-000000000000',
      likeCount: 9999,
    });

    expect(created.statusCode).toBe(201);
    expect(created.body.author.userId).toBe(author.session.user.id);
    expect(created.body.counts.likes).toBe(0);
  });

  it('refuses to post into a group the author is not in', async () => {
    const author = await onboardedUser();
    const group = await queryOne<{ id: string }>(
      `INSERT INTO groups (name, visibility) VALUES ('Closed group', 'group') RETURNING id`,
    );

    const result = await createPost(author.session, {
      body: 'sneaking in',
      groupId: group!.id,
    });
    expect(result.statusCode).toBe(403);
  });

  it('requires a completed profile before posting', async () => {
    const app = await getApp();
    const session = await freshSession();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(session),
      payload: { body: 'posting before onboarding' },
    });
    expect(response.statusCode).toBe(412);
  });

  it('lets only the author edit, and records the edit', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const other = await onboardedUser();
    const created = await createPost(author.session, { body: 'original' });

    const byOther = await app.inject({
      method: 'PATCH',
      url: `/v1/content/${created.body.id}`,
      headers: auth(other.session),
      payload: { body: 'hijacked' },
    });
    expect(byOther.statusCode).toBe(403);

    const byAuthor = await app.inject({
      method: 'PATCH',
      url: `/v1/content/${created.body.id}`,
      headers: auth(author.session),
      payload: { body: 'revised' },
    });
    expect(byAuthor.statusCode).toBe(200);
    expect(byAuthor.json<ContentItem>().body).toBe('revised');
    expect(byAuthor.json<ContentItem>().editedAt).not.toBeNull();
  });
});

describe('interactions', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('keeps the like counter in step with the reaction rows', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const mate = await onboardedUser();
    const created = await createPost(author.session, { body: 'react to me' });

    const liked = await app.inject({
      method: 'PUT',
      url: `/v1/content/${created.body.id}/reaction`,
      headers: auth(mate.session),
      payload: { kind: 'helpful' },
    });
    expect(liked.json<{ likeCount: number }>().likeCount).toBe(1);

    // Changing the reaction kind is an update, not a second like.
    const changed = await app.inject({
      method: 'PUT',
      url: `/v1/content/${created.body.id}/reaction`,
      headers: auth(mate.session),
      payload: { kind: 'insightful' },
    });
    expect(changed.json<{ likeCount: number }>().likeCount).toBe(1);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/content/${created.body.id}/reaction`,
      headers: auth(mate.session),
    });
    expect(removed.json<{ likeCount: number }>().likeCount).toBe(0);

    // Removing twice must not drive the counter negative.
    const again = await app.inject({
      method: 'DELETE',
      url: `/v1/content/${created.body.id}/reaction`,
      headers: auth(mate.session),
    });
    expect(again.json<{ likeCount: number }>().likeCount).toBe(0);
  });

  it('refuses to react to content the actor cannot see', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const outsider = await onboardedUser({ stageId: cohort.stage4Id });
    const created = await createPost(author.session, { body: 'cohort only', visibility: 'stage' });

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/content/${created.body.id}/reaction`,
      headers: auth(outsider.session),
      payload: { kind: 'like' },
    });
    // 404, not 403: a like must not confirm that a hidden post exists.
    expect(response.statusCode).toBe(404);
  });

  it('saves and lists bookmarks', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const created = await createPost(author.session, { body: 'worth saving' });

    await app.inject({
      method: 'PUT',
      url: `/v1/content/${created.body.id}/bookmark`,
      headers: auth(reader.session),
      payload: {},
    });

    const saved = await readFeed(reader.session, '?scope=saved');
    expect(saved.items.map((i) => i.id)).toContain(created.body.id);
    expect(saved.items[0]?.viewer.hasBookmarked).toBe(true);

    await app.inject({
      method: 'DELETE',
      url: `/v1/content/${created.body.id}/bookmark`,
      headers: auth(reader.session),
    });
    expect((await readFeed(reader.session, '?scope=saved')).items.map((i) => i.id)).not.toContain(
      created.body.id,
    );
  });

  it('records a view once per viewer', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const created = await createPost(author.session, { body: 'count me once' });

    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: `/v1/content/${created.body.id}/view`,
        headers: auth(reader.session),
        payload: {},
      });
    }

    const item = await app.inject({
      method: 'GET',
      url: `/v1/content/${created.body.id}`,
      headers: auth(reader.session),
    });
    expect(item.json<ContentItem>().counts.views).toBe(1);
    expect(item.json<ContentItem>().viewer.hasViewed).toBe(true);
  });
});

describe('comments', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('threads replies one level deep and keeps the counter accurate', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const mate = await onboardedUser();
    const post = await createPost(author.session, { body: 'discuss' });

    const top = await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(mate.session),
      payload: { body: 'first thought' },
    });
    expect(top.statusCode).toBe(201);
    const topId = top.json<Comment>().id;

    const reply = await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(author.session),
      payload: { body: 'a reply', parentId: topId },
    });
    expect(reply.json<Comment>().parentId).toBe(topId);

    // A reply to a reply flattens onto the same parent.
    const nested = await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(mate.session),
      payload: { body: 'reply to the reply', parentId: reply.json<Comment>().id },
    });
    expect(nested.json<Comment>().parentId).toBe(topId);

    const thread = await app.inject({
      method: 'GET',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(mate.session),
    });
    const items = thread.json<{ items: Comment[] }>().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.replies).toHaveLength(2);

    const item = await app.inject({
      method: 'GET',
      url: `/v1/content/${post.body.id}`,
      headers: auth(mate.session),
    });
    expect(item.json<ContentItem>().counts.comments).toBe(3);
  });

  it('lets the post author remove a comment on their own post', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const commenter = await onboardedUser();
    const post = await createPost(author.session, { body: 'my post, my thread' });

    const comment = await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(commenter.session),
      payload: { body: 'something the author wants gone' },
    });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/comments/${comment.json<Comment>().id}`,
      headers: auth(author.session),
    });
    expect(removed.statusCode).toBe(204);

    const item = await app.inject({
      method: 'GET',
      url: `/v1/content/${post.body.id}`,
      headers: auth(author.session),
    });
    expect(item.json<ContentItem>().counts.comments).toBe(0);
  });

  it('refuses to comment on content the actor cannot see', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const outsider = await onboardedUser({ stageId: cohort.stage4Id });
    const post = await createPost(author.session, { body: 'cohort only' });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(outsider.session),
      payload: { body: 'I should not be able to say this' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('records a substantive academic reply as a meaningful learning action', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const mate = await onboardedUser();

    // Enrol the author so the post carries a course, which is what makes the
    // discussion academic rather than merely social.
    await queryOne(
      `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [author.session.user.id, cohort.courseIds[0]],
    );

    const post = await createPost(author.session, {
      body: 'شرح المتلازمة الكلوية',
      courseId: cohort.courseIds[0],
      visibility: 'stage',
    });
    expect(post.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(mate.session),
      payload: {
        body: 'إضافة مهمة: البروتين في الإدرار يتجاوز ٣.٥ غرام في اليوم عند البالغين.',
      },
    });

    const event = await queryOne<{ kind: string }>(
      `SELECT kind FROM learning_events
       WHERE user_id = $1 AND kind = 'academic_discussion_participated'`,
      [mate.session.user.id],
    );
    expect(event?.kind).toBe('academic_discussion_participated');
  });

  it('does not count a one-word acknowledgement as academic discussion', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const mate = await onboardedUser();

    await queryOne(
      `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [author.session.user.id, cohort.courseIds[0]],
    );
    const post = await createPost(author.session, {
      body: 'محاضرة اليوم',
      courseId: cohort.courseIds[0],
    });

    await app.inject({
      method: 'POST',
      url: `/v1/content/${post.body.id}/comments`,
      headers: auth(mate.session),
      payload: { body: 'شكرا' },
    });

    const count = await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM learning_events
       WHERE user_id = $1 AND kind = 'academic_discussion_participated'`,
      [mate.session.user.id],
    );
    expect(count?.count).toBe(0);
  });
});

describe('reporting', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('files a report and refuses a duplicate', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const reporter = await onboardedUser();
    const post = await createPost(author.session, { body: 'reportable' });

    const first = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(reporter.session),
      payload: { targetType: 'content', targetId: post.body.id, reason: 'spam' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json<{ status: string }>().status).toBe('open');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(reporter.session),
      payload: { targetType: 'content', targetId: post.body.id, reason: 'spam' },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('returns 404 for a target that does not exist', async () => {
    const app = await getApp();
    const reporter = await onboardedUser();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(reporter.session),
      payload: {
        targetType: 'content',
        targetId: '00000000-0000-4000-8000-000000000000',
        reason: 'spam',
      },
    });
    expect(response.statusCode).toBe(404);
  });
});

/** A signed-up account that has NOT completed onboarding. */
async function freshSession() {
  const { signupUser } = await import('./helpers.js');
  return signupUser();
}
