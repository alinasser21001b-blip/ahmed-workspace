import type { Group, SearchResults } from '@sos/contracts';
import { normalizeArabic } from '@sos/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne, queryRows } from '../src/platform/db.js';
import {
  auth,
  closeApp,
  createPost,
  ensureCohort,
  getApp,
  onboardedUser,
  readFeed,
} from './helpers.js';

/**
 * Phase 3 closure.
 *
 * Each block below pins down a finding from the closure audit
 * (`docs/06-PHASE-3-AUDIT.md`). They are regressions, not illustrations: every
 * one of them fails against the code as it stood at the end of Phase 3.
 */

async function createGroup(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  payload: Record<string, unknown> = {},
): Promise<Group> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/groups',
    headers: auth(session),
    payload: { name: `Closure group ${Math.random().toString(36).slice(2, 8)}`, ...payload },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createGroup failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<Group>();
}

beforeAll(async () => {
  await getApp();
  // Every `onboardedUser` lands in this cohort, which is what makes the
  // visibility assertions below about membership rather than about placement.
  await ensureCohort();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

// --- F1 ---------------------------------------------------------------------

describe('a group cannot be left ownerless', () => {
  /*
   * The bug: the strand guard lived only in the service method behind
   * `DELETE /membership`. `DELETE /members/<own handle>` reached the same
   * removal without it, and produced a group with zero active owners — nobody
   * able to approve, promote, transfer or archive, and no product action able
   * to undo it.
   */
  it('refuses an owner’s self-removal through BOTH exits', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();

    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });
    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(member.session),
      payload: {},
    });

    const viaMembership = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(owner.session),
    });
    expect(viaMembership.statusCode).toBe(412);

    const viaMemberList = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/members/${owner.handle}`,
      headers: auth(owner.session),
    });
    expect(viaMemberList.statusCode).toBe(412);

    const owners = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM group_members
       WHERE group_id = $1 AND role = 'owner' AND status = 'active'`,
      [group.id],
    );
    expect(owners?.n).toBe('1');
  });

  it('reports the owner’s blocked exit in the viewer state, so no dead button is drawn', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });

    expect(group.viewer.canLeave).toBe(true); // sole owner: nothing to strand

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(member.session),
      payload: {},
    });

    const after = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}`,
      headers: auth(owner.session),
    });
    expect(after.json<Group>().viewer.canLeave).toBe(false);
  });

  it('still lets a sole owner leave, archiving the group behind them', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const group = await createGroup(owner.session);

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/members/${owner.handle}`,
      headers: auth(owner.session),
    });
    expect(response.statusCode).toBe(204);

    const row = await queryOne<{ archived_at: Date | null }>(
      `SELECT archived_at FROM groups WHERE id = $1`,
      [group.id],
    );
    expect(row?.archived_at).not.toBeNull();
  });

  it('lets an owner leave once ownership has been transferred', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const heir = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(heir.session),
      payload: {},
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${heir.handle}`,
      headers: auth(owner.session),
      payload: { role: 'owner' },
    });

    const leave = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(owner.session),
    });
    expect(leave.statusCode).toBe(204);

    const owners = await queryRows<{ user_id: string }>(
      `SELECT user_id FROM group_members
       WHERE group_id = $1 AND role = 'owner' AND status = 'active'`,
      [group.id],
    );
    expect(owners).toHaveLength(1);
  });
});

// --- F2 ---------------------------------------------------------------------

describe('a mute changes what the reader is shown', () => {
  /*
   * The bug: `PUT /mutes` wrote the row, the relationship endpoint reported it,
   * and no read surface consulted it. A mute was a label.
   */
  it('removes a muted author from the feed, and restores them on unmute', async () => {
    const app = await getApp();
    const reader = await onboardedUser();
    const noisy = await onboardedUser();
    const post = await createPost(noisy.session, { body: 'a muted voice in the cohort feed' });

    expect((await readFeed(reader.session)).items.map((i) => i.id)).toContain(post.body.id);

    const mute = await app.inject({
      method: 'PUT',
      url: '/v1/mutes',
      headers: auth(reader.session),
      payload: { targetType: 'user', targetId: noisy.session.user.id },
    });
    expect(mute.statusCode).toBe(204);

    expect((await readFeed(reader.session)).items.map((i) => i.id)).not.toContain(post.body.id);

    await app.inject({
      method: 'DELETE',
      url: '/v1/mutes',
      headers: auth(reader.session),
      payload: { targetType: 'user', targetId: noisy.session.user.id },
    });

    expect((await readFeed(reader.session)).items.map((i) => i.id)).toContain(post.body.id);
  });

  it('removes a muted group’s posts from the ambient feed', async () => {
    const app = await getApp();
    const reader = await onboardedUser();
    const owner = await onboardedUser();

    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });
    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(reader.session),
      payload: {},
    });

    const post = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(owner.session),
      payload: {
        body: 'a post inside a group about to be muted',
        visibility: 'group',
        groupId: group.id,
        mediaFileIds: [],
        topicIds: [],
      },
    });
    const postId = post.json<{ id: string }>().id;

    expect((await readFeed(reader.session)).items.map((i) => i.id)).toContain(postId);

    await app.inject({
      method: 'PUT',
      url: '/v1/mutes',
      headers: auth(reader.session),
      payload: { targetType: 'group', targetId: group.id },
    });

    expect((await readFeed(reader.session)).items.map((i) => i.id)).not.toContain(postId);

    /*
     * …but opening the group itself still shows it. Muting a group is a request
     * to stop hearing from it in passing, not a request to be locked out of it,
     * and an empty screen with no explanation reads as a bug rather than as a
     * setting.
     */
    const groupFeed = await app.inject({
      method: 'GET',
      url: `/v1/feed?scope=recent&groupId=${group.id}&limit=30`,
      headers: auth(reader.session),
    });
    expect(groupFeed.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toContain(postId);
  });

  it('does not let a mute grant access a block would have denied', async () => {
    // A mute is a preference and a block is a boundary. Muting someone who has
    // blocked you must not resurrect their content.
    const app = await getApp();
    const reader = await onboardedUser();
    const other = await onboardedUser();
    const post = await createPost(other.session, { body: 'behind a block' });

    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${reader.handle}/block`,
      headers: auth(other.session),
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/mutes',
      headers: auth(reader.session),
      payload: { targetType: 'user', targetId: other.session.user.id },
    });

    expect((await readFeed(reader.session)).items.map((i) => i.id)).not.toContain(post.body.id);
  });
});

// --- F4 ---------------------------------------------------------------------

describe('a moderator can reject a request, not only approve it', () => {
  it('clears a rejected request and lets the applicant ask again', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const applicant = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'request' });

    const first = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(applicant.session),
      payload: {},
    });
    expect(first.json<{ status: string }>().status).toBe('pending');

    const reject = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/members/${applicant.handle}`,
      headers: auth(owner.session),
    });
    expect(reject.statusCode).toBe(204);

    const queue = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}/members?status=pending&limit=20`,
      headers: auth(owner.session),
    });
    expect(queue.json<{ items: unknown[] }>().items).toHaveLength(0);

    // Rejection is not a ban: asking again is allowed.
    const again = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(applicant.session),
      payload: {},
    });
    expect(again.json<{ status: string }>().status).toBe('pending');
  });

  it('exposes the roster to members and refuses it to everyone else', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();
    const outsider = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(member.session),
      payload: {},
    });

    const asMember = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}/members?status=active&limit=50`,
      headers: auth(member.session),
    });
    expect(asMember.statusCode).toBe(200);
    expect(asMember.json<{ items: unknown[] }>().items).toHaveLength(2);

    // A discoverable group shows its size, not its roster: who is in a study
    // group is information about other students.
    const asOutsider = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}/members?status=active&limit=50`,
      headers: auth(outsider.session),
    });
    expect(asOutsider.statusCode).toBe(403);
  });
});

// --- F9 ---------------------------------------------------------------------

describe('Arabic search', () => {
  async function search(
    session: Awaited<ReturnType<typeof onboardedUser>>['session'],
    q: string,
  ): Promise<SearchResults> {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${encodeURIComponent(q)}&kind=content&limit=20`,
      headers: auth(session),
    });
    if (response.statusCode !== 200) {
      throw new Error(`search failed (${response.statusCode}): ${response.body}`);
    }
    return response.json<SearchResults>();
  }

  /*
   * Measured before the fix, at the 0.15 similarity floor: a diacritised post
   * scored 0.07 against an undiacritised query and an alef-madda word scored
   * 0.14. Both are below the floor, so both returned nothing at all.
   */
  it('finds a diacritised post from an undiacritised query, and the reverse', async () => {
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const post = await createPost(author.session, {
      body: 'مُحَاضَرَة عَن المُتَلَازِمَة الكُلْوِيَّة عِنْد الأَطْفَال',
    });

    const hits = await search(reader.session, 'المتلازمة الكلوية');
    expect(hits.content.map((c) => c.id)).toContain(post.body.id);
  });

  it('finds a post across alef and ta-marbuta variants', async () => {
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const post = await createPost(author.session, { body: 'أمراض الكلى عند الأطفال' });

    for (const query of ['امراض الكلي', 'أمراض الكلى', 'امراض']) {
      const hits = await search(reader.session, query);
      expect(hits.content.map((c) => c.id), query).toContain(post.body.id);
    }
  });

  it('finds an Arabic medical term written with tatweel', async () => {
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const post = await createPost(author.session, { body: 'الـــتـــهاب الكبيبات الحاد' });

    const hits = await search(reader.session, 'التهاب الكبيبات');
    expect(hits.content.map((c) => c.id)).toContain(post.body.id);
  });

  it('finds mixed Arabic and English content from either language', async () => {
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const post = await createPost(author.session, {
      body: 'مراجعة Nephrotic Syndrome قبل الامتحان',
    });

    for (const query of ['Nephrotic', 'nephrotic syndrome', 'مراجعه']) {
      const hits = await search(reader.session, query);
      expect(hits.content.map((c) => c.id), query).toContain(post.body.id);
    }
  });

  it('finds English content case-insensitively', async () => {
    const author = await onboardedUser();
    const reader = await onboardedUser();
    const post = await createPost(author.session, { body: 'Acute Glomerulonephritis revision' });

    const hits = await search(reader.session, 'glomerulonephritis');
    expect(hits.content.map((c) => c.id)).toContain(post.body.id);
  });

  it('does not fold the definite article, because that would merge real words', async () => {
    // The boundary of what normalisation is allowed to do, asserted rather than
    // described: القلب and قلب stay distinguishable.
    expect(normalizeArabic('القلب')).not.toBe(normalizeArabic('قلب'));
  });

  /*
   * The application normalises the query; the database normalises the column.
   * If those two rules ever diverge, search silently returns nothing for Arabic
   * — the least visible failure this product could have. This test is the same
   * device as the feed's SQL/TypeScript ranking parity test.
   */
  it('normalises identically in TypeScript and in SQL', async () => {
    const cases = [
      'اَلْقَلْب',
      'آفة',
      'القـــلب',
      'أمراض الكلى',
      'مستشفى',
      'متلازمة Nephrotic',
      '٢٠٢٥ دفعة',
      '  spaced   OUT  ',
      'سؤال',
    ];

    const rows = await queryRows<{ i: number; v: string }>(
      `SELECT ordinality - 1 AS i, sos_normalize_arabic(t) AS v
       FROM unnest($1::text[]) WITH ORDINALITY AS x(t, ordinality)`,
      [cases],
    );

    for (const row of rows) {
      expect(row.v, cases[row.i]).toBe(normalizeArabic(cases[row.i] as string));
    }
  });
});

// --- Part 3: one matrix, three surfaces -------------------------------------

describe('the same permission matrix governs the API, the feed and search', () => {
  /*
   * The audit's central claim, tested as one table rather than as three
   * separate assertions. Every row is a (viewer, container) pair, and all three
   * surfaces must give the same verdict — a leak on any one of them is the
   * whole leak.
   */
  it('agrees on every visibility state for a group post', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();
    const outsider = await onboardedUser();
    const removed = await onboardedUser();
    const banned = await onboardedUser();

    const group = await createGroup(owner.session, {
      name: 'Matrix hidden circle',
      visibility: 'group',
      joinPolicy: 'open',
    });

    /*
     * An unlisted group cannot be joined by asking — the join path runs
     * `canViewGroup` first and 404s, which is the property under test two
     * assertions down. Membership therefore arrives by invitation, which is
     * the only way into a group whose existence is not public.
     */
    for (const user of [member, removed, banned]) {
      const invite = await app.inject({
        method: 'POST',
        url: `/v1/groups/${group.id}/invites`,
        headers: auth(owner.session),
        payload: { handle: user.handle },
      });
      expect(invite.statusCode).toBe(204);

      const accept = await app.inject({
        method: 'PUT',
        url: `/v1/groups/${group.id}/membership`,
        headers: auth(user.session),
        payload: {},
      });
      expect(accept.json<{ status: string }>().status).toBe('active');
    }
    await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/members/${removed.handle}`,
      headers: auth(owner.session),
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${banned.handle}`,
      headers: auth(owner.session),
      payload: { status: 'banned' },
    });

    const marker = 'zurbatiya';
    const created = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(owner.session),
      payload: {
        body: `${marker} — a note inside an unlisted group`,
        visibility: 'group',
        groupId: group.id,
        mediaFileIds: [],
        topicIds: [],
      },
    });
    const postId = created.json<{ id: string }>().id;

    const matrix: { who: string; user: typeof owner; sees: boolean; seesGroup: boolean }[] = [
      { who: 'owner', user: owner, sees: true, seesGroup: true },
      { who: 'member', user: member, sees: true, seesGroup: true },
      { who: 'outsider', user: outsider, sees: false, seesGroup: false },
      { who: 'removed member', user: removed, sees: false, seesGroup: false },
      { who: 'banned member', user: banned, sees: false, seesGroup: false },
    ];

    for (const row of matrix) {
      const headers = auth(row.user.session);

      // 1. Direct API read of the item.
      const item = await app.inject({ method: 'GET', url: `/v1/content/${postId}`, headers });
      expect(item.statusCode === 200, `${row.who}: direct read`).toBe(row.sees);

      // 2. The feed.
      const feed = await readFeed(row.user.session);
      expect(feed.items.map((i) => i.id).includes(postId), `${row.who}: feed`).toBe(row.sees);

      // 3. Search, by a term that appears nowhere else.
      const found = await app.inject({
        method: 'GET',
        url: `/v1/search?q=${marker}&kind=content&limit=20`,
        headers,
      });
      expect(
        found.json<SearchResults>().content.map((c) => c.id).includes(postId),
        `${row.who}: search`,
      ).toBe(row.sees);

      // 4. The container itself, by direct id and by name.
      const detail = await app.inject({ method: 'GET', url: `/v1/groups/${group.id}`, headers });
      expect(detail.statusCode === 200, `${row.who}: group detail`).toBe(row.seesGroup);

      const byName = await app.inject({
        method: 'GET',
        url: `/v1/search?q=${encodeURIComponent('Matrix hidden circle')}&kind=groups&limit=20`,
        headers,
      });
      expect(
        byName.json<SearchResults>().groups.map((g) => g.id).includes(group.id),
        `${row.who}: group search`,
      ).toBe(row.seesGroup);

      // 5. The roster.
      const roster = await app.inject({
        method: 'GET',
        url: `/v1/groups/${group.id}/members?status=active&limit=50`,
        headers,
      });
      expect(roster.statusCode === 200, `${row.who}: roster`).toBe(row.sees);
    }
  });

  it('gives a restricted account the reader’s view and none of the writer’s', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const restricted = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(restricted.session),
      payload: {},
    });
    const post = await createPost(owner.session, { body: 'readable by a restricted account' });

    await queryOne(`UPDATE users SET status = 'restricted' WHERE id = $1`, [
      restricted.session.user.id,
    ]);

    expect((await readFeed(restricted.session)).items.map((i) => i.id)).toContain(post.body.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}`,
      headers: auth(restricted.session),
    });
    const viewer = detail.json<Group>().viewer;
    expect(viewer.canRead).toBe(true);
    expect(viewer.canWrite).toBe(false);
    expect(viewer.canPost).toBe(false);

    const write = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(restricted.session),
      payload: {
        body: 'should not be publishable',
        visibility: 'group',
        groupId: group.id,
        mediaFileIds: [],
        topicIds: [],
      },
    });
    expect(write.statusCode).toBe(403);
  });
});

// --- Part 8 -----------------------------------------------------------------

describe('the domain-event outbox', () => {
  it('records membership events in the transaction that caused them', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const applicant = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'request' });

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(applicant.session),
      payload: { message: 'may I join?' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${applicant.handle}`,
      headers: auth(owner.session),
      payload: { status: 'active' },
    });

    const events = await queryRows<{ kind: string; subject_id: string | null }>(
      `SELECT kind, subject_id FROM domain_events
       WHERE target_type = 'group' AND target_id = $1
       ORDER BY occurred_at, id`,
      [group.id],
    );

    expect(events.map((e) => e.kind)).toEqual([
      'group.membership.requested',
      'group.membership.approved',
    ]);
    // A request has no single subject: the audience is whoever moderates, and
    // resolving it is the consumer's job, not the producer's.
    expect(events[0]?.subject_id).toBeNull();
    expect(events[1]?.subject_id).toBe(applicant.session.user.id);
  });

  it('leaves nothing behind when the transaction that produced it rolls back', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const stranger = await onboardedUser();
    const group = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });

    const before = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM domain_events WHERE target_id = $1`,
      [group.id],
    );

    /*
     * A refused invite: the request fails, and no event may describe it.
     *
     * 403 rather than 404 here because the group is cohort-visible — the
     * stranger may see that it exists and may not administer it. An unlisted
     * group would 404 instead, which is asserted in the matrix above.
     */
    const refused = await app.inject({
      method: 'POST',
      url: `/v1/groups/${group.id}/invites`,
      headers: auth(stranger.session),
      payload: { handle: owner.handle },
    });
    expect(refused.statusCode).toBe(403);

    const after = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM domain_events WHERE target_id = $1`,
      [group.id],
    );
    expect(after?.n).toBe(before?.n);
  });
});
