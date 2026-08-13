import type { Community, ContentItem, ErrorEnvelope, Group, SearchResults } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import {
  auth,
  closeApp,
  createPost,
  ensureCohort,
  getApp,
  onboardedUser,
  readFeed,
  type Cohort,
} from './helpers.js';

/**
 * Phase 3 — Community.
 *
 * The exit criterion, as a test: *a private group's posts are invisible to
 * non-members through the API AND through search — one policy, more than one
 * surface.*
 */

let cohort: Cohort;

async function createGroup(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  payload: Record<string, unknown> = {},
): Promise<Group> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/groups',
    headers: auth(session),
    payload: { name: `Study group ${Math.random().toString(36).slice(2, 8)}`, ...payload },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createGroup failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<Group>();
}

describe('the phase 3 exit criterion', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });
  afterAll(async () => {
    await closeApp();
    await closePool();
  });

  it('keeps a private group’s posts out of the API and out of search', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();
    const outsider = await onboardedUser();

    // An unlisted group: invisible to anyone who is not in it.
    const group = await createGroup(owner.session, {
      name: 'Neuro secret circle',
      visibility: 'group',
      joinPolicy: 'invite',
    });

    await app.inject({
      method: 'POST',
      url: `/v1/groups/${group.id}/invites`,
      headers: auth(owner.session),
      payload: { handle: member.handle },
    });
    const joined = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(member.session),
      payload: {},
    });
    expect(joined.statusCode).toBe(200);

    const secret = 'sinusitis frontalis mnemonic that only members should see';
    const post = await createPost(owner.session, { body: secret, groupId: group.id });
    expect(post.statusCode).toBe(201);

    // Surface 1 — the member's feed has it, the outsider's does not.
    expect((await readFeed(member.session)).items.map((i) => i.id)).toContain(post.body.id);
    expect((await readFeed(outsider.session)).items.map((i) => i.id)).not.toContain(post.body.id);

    // Surface 2 — the single-item read.
    const direct = await app.inject({
      method: 'GET',
      url: `/v1/content/${post.body.id}`,
      headers: auth(outsider.session),
    });
    expect(direct.statusCode).toBe(404);

    // Surface 3 — search. This is the one that a separate filter would leak.
    const memberSearch = await app.inject({
      method: 'GET',
      url: '/v1/search?q=sinusitis&kind=content',
      headers: auth(member.session),
    });
    expect(memberSearch.json<SearchResults>().content.map((c) => c.id)).toContain(post.body.id);

    const outsiderSearch = await app.inject({
      method: 'GET',
      url: '/v1/search?q=sinusitis&kind=content',
      headers: auth(outsider.session),
    });
    expect(outsiderSearch.json<SearchResults>().content.map((c) => c.id)).not.toContain(
      post.body.id,
    );

    // And the group itself is unfindable.
    const groupSearch = await app.inject({
      method: 'GET',
      url: '/v1/search?q=Neuro%20secret&kind=groups',
      headers: auth(outsider.session),
    });
    expect(groupSearch.json<SearchResults>().groups.map((g) => g.id)).not.toContain(group.id);

    const groupRead = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}`,
      headers: auth(outsider.session),
    });
    expect(groupRead.statusCode).toBe(404);
  });
});

describe('groups', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('makes the founder the owner and counts them once', async () => {
    const owner = await onboardedUser();
    const group = await createGroup(owner.session);

    expect(group.memberCount).toBe(1);
    expect(group.viewer.role).toBe('owner');
    expect(group.viewer.canManage).toBe(true);
    expect(group.viewer.canPost).toBe(true);
  });

  it('reports whether joining will join or file a request', async () => {
    const owner = await onboardedUser();
    const student = await onboardedUser();

    const open = await createGroup(owner.session, { joinPolicy: 'open' });
    const gated = await createGroup(owner.session, { joinPolicy: 'request' });

    const app = await getApp();
    const openView = await app.inject({
      method: 'GET',
      url: `/v1/groups/${open.id}`,
      headers: auth(student.session),
    });
    expect(openView.json<Group>().viewer.joinOutcome).toBe('joined');

    const gatedView = await app.inject({
      method: 'GET',
      url: `/v1/groups/${gated.id}`,
      headers: auth(student.session),
    });
    expect(gatedView.json<Group>().viewer.joinOutcome).toBe('requested');
  });

  it('holds a request until a moderator approves it', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const student = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'request' });

    const requested = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(student.session),
      payload: { message: 'أرغب بالانضمام' },
    });
    expect(requested.json<{ status: string }>().status).toBe('pending');

    // Pending is not membership: no posting, no member list.
    const post = await createPost(student.session, { body: 'too early', groupId: group.id });
    expect(post.statusCode).toBe(403);

    const roster = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}/members`,
      headers: auth(student.session),
    });
    expect(roster.statusCode).toBe(403);

    const queue = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}/members?status=pending`,
      headers: auth(owner.session),
    });
    expect(queue.json<{ items: { message: string | null }[] }>().items).toHaveLength(1);
    expect(queue.json<{ items: { message: string | null }[] }>().items[0]?.message).toBe(
      'أرغب بالانضمام',
    );

    const approved = await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${student.handle}`,
      headers: auth(owner.session),
      payload: { status: 'active' },
    });
    expect(approved.statusCode).toBe(204);

    const nowPosting = await createPost(student.session, { body: 'now I am in', groupId: group.id });
    expect(nowPosting.statusCode).toBe(201);
  });

  it('refuses an invite-only group without an invitation, and accepts one with', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const student = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'invite' });

    const refused = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(student.session),
      payload: {},
    });
    expect(refused.statusCode).toBe(409);

    await app.inject({
      method: 'POST',
      url: `/v1/groups/${group.id}/invites`,
      headers: auth(owner.session),
      payload: { handle: student.handle },
    });

    const accepted = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(student.session),
      payload: {},
    });
    expect(accepted.json<{ status: string }>().status).toBe('active');
  });

  it('keeps member_count accurate across join, leave and rejoin', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const student = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'open' });

    const join = async (): Promise<number> => {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/groups/${group.id}/membership`,
        headers: auth(student.session),
        payload: {},
      });
      return response.json<{ group: Group }>().group.memberCount;
    };

    expect(await join()).toBe(2);

    await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(student.session),
    });
    const afterLeave = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}`,
      headers: auth(owner.session),
    });
    expect(afterLeave.json<Group>().memberCount).toBe(1);

    // Rejoining must not double-count.
    expect(await join()).toBe(2);
  });

  it('refuses to let a moderator outrank an admin', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const moderator = await onboardedUser();
    const admin = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'open' });

    for (const person of [moderator, admin]) {
      await app.inject({
        method: 'PUT',
        url: `/v1/groups/${group.id}/membership`,
        headers: auth(person.session),
        payload: {},
      });
    }
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${moderator.handle}`,
      headers: auth(owner.session),
      payload: { role: 'moderator' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${admin.handle}`,
      headers: auth(owner.session),
      payload: { role: 'admin' },
    });

    const attempt = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/members/${admin.handle}`,
      headers: auth(moderator.session),
    });
    expect(attempt.statusCode).toBe(403);

    // ...but an admin may remove the moderator.
    const permitted = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/members/${moderator.handle}`,
      headers: auth(admin.session),
    });
    expect(permitted.statusCode).toBe(204);
  });

  it('refuses to let a moderator mint more moderators', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const moderator = await onboardedUser();
    const student = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'open' });

    for (const person of [moderator, student]) {
      await app.inject({
        method: 'PUT',
        url: `/v1/groups/${group.id}/membership`,
        headers: auth(person.session),
        payload: {},
      });
    }
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${moderator.handle}`,
      headers: auth(owner.session),
      payload: { role: 'moderator' },
    });

    const attempt = await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${student.handle}`,
      headers: auth(moderator.session),
      payload: { role: 'moderator' },
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('stops an owner from stranding a group, and allows transfer', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const heir = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'open' });

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(heir.session),
      payload: {},
    });

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(owner.session),
    });
    expect(blocked.statusCode).toBe(412);

    const transferred = await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${heir.handle}`,
      headers: auth(owner.session),
      payload: { role: 'owner' },
    });
    expect(transferred.statusCode).toBe(204);

    const nowCanLeave = await app.inject({
      method: 'DELETE',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(owner.session),
    });
    expect(nowCanLeave.statusCode).toBe(204);
  });

  it('excludes a banned member from rejoining and from seeing the group', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const troublemaker = await onboardedUser();
    const group = await createGroup(owner.session, { joinPolicy: 'open' });

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(troublemaker.session),
      payload: {},
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/groups/${group.id}/members/${troublemaker.handle}`,
      headers: auth(owner.session),
      payload: { status: 'banned' },
    });

    const read = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}`,
      headers: auth(troublemaker.session),
    });
    expect(read.statusCode).toBe(404);

    const rejoin = await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(troublemaker.session),
      payload: {},
    });
    expect(rejoin.statusCode).toBe(404);
  });

  it('lists discoverable groups for the cohort but never unlisted ones', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const student = await onboardedUser();

    const open = await createGroup(owner.session, { visibility: 'stage', joinPolicy: 'open' });
    const secret = await createGroup(owner.session, { visibility: 'group' });

    const discover = await app.inject({
      method: 'GET',
      url: '/v1/groups?scope=discover&limit=50',
      headers: auth(student.session),
    });
    const ids = discover.json<{ items: Group[] }>().items.map((g) => g.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(secret.id);
  });

  /*
   * Until Phase 5b, `course_enrollments` had no producer at all, so
   * `actor.courseIds` was empty for everyone and this assertion held for the
   * wrong reason: it proved that nobody is ever enrolled, not that a
   * non-enrolled founder is refused. Onboarding now enrols a student in their
   * stage's courses, so the case needs a founder who genuinely is not in the
   * course — a student placed in a different stage. Both directions are
   * asserted, because a rule only tested in the negative is a rule that could
   * be refusing everyone.
   */
  it('refuses a group scoped to a course the founder is not enrolled in', async () => {
    const app = await getApp();
    const otherStage = await onboardedUser({ stageId: cohort.stage4Id });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: auth(otherStage.session),
      payload: { name: 'Not my course', visibility: 'course', courseId: cohort.courseIds[0] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('allows a group scoped to a course the founder IS enrolled in', async () => {
    const app = await getApp();
    const student = await onboardedUser();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: auth(student.session),
      payload: { name: 'My own course', visibility: 'course', courseId: cohort.courseIds[0] },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('communities', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('lists in-scope communities and lets a student join', async () => {
    const app = await getApp();
    const student = await onboardedUser();

    const community = await queryOne<{ id: string }>(
      `INSERT INTO communities (slug, name_ar, name_en, university_id, college_id, stage_id, visibility, is_official)
       VALUES ($1, 'مجتمع الاختبار', 'Test Community', $2, $3, $4, 'stage', true)
       RETURNING id`,
      [
        `test-community-${Date.now()}`,
        cohort.universityId,
        cohort.collegeId,
        cohort.stage5Id,
      ],
    );

    const discover = await app.inject({
      method: 'GET',
      url: '/v1/communities?scope=discover&limit=50',
      headers: auth(student.session),
    });
    expect(discover.statusCode, discover.body).toBe(200);
    expect(discover.json<{ items: Community[] }>().items.map((c) => c.id)).toContain(community!.id);

    const joined = await app.inject({
      method: 'PUT',
      url: `/v1/communities/${community!.id}/membership`,
      headers: auth(student.session),
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json<Community>().viewer.membershipStatus).toBe('active');
    expect(joined.json<Community>().viewer.canPost).toBe(true);
    expect(joined.json<Community>().memberCount).toBe(1);

    const mine = await app.inject({
      method: 'GET',
      url: '/v1/communities?scope=mine',
      headers: auth(student.session),
    });
    expect(mine.statusCode, mine.body).toBe(200);
    expect(mine.json<{ items: Community[] }>().items.map((c) => c.id)).toContain(community!.id);
  });

  it('hides a community scoped to another cohort', async () => {
    const app = await getApp();
    const otherStage = await onboardedUser({ stageId: cohort.stage4Id });

    const community = await queryOne<{ id: string }>(
      `INSERT INTO communities (slug, name_ar, name_en, university_id, college_id, stage_id, visibility)
       VALUES ($1, 'خاص', 'Fifth Year Only', $2, $3, $4, 'stage') RETURNING id`,
      [`fifth-only-${Date.now()}`, cohort.universityId, cohort.collegeId, cohort.stage5Id],
    );

    const read = await app.inject({
      method: 'GET',
      url: `/v1/communities/${community!.id}`,
      headers: auth(otherStage.session),
    });
    expect(read.statusCode).toBe(404);
  });
});

describe('search', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('finds cohort-mates by name and handle', async () => {
    const app = await getApp();
    const searcher = await onboardedUser();
    const target = await onboardedUser();

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(target.session),
      payload: { displayName: 'Zaynab Al-Rashid' },
    });

    const byName = await app.inject({
      method: 'GET',
      url: '/v1/search?q=Zaynab&kind=people',
      headers: auth(searcher.session),
    });
    expect(byName.json<SearchResults>().people.map((p) => p.userId)).toContain(
      target.session.user.id,
    );

    const byHandle = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${target.handle.slice(0, 6)}&kind=people`,
      headers: auth(searcher.session),
    });
    expect(byHandle.json<SearchResults>().people.map((p) => p.userId)).toContain(
      target.session.user.id,
    );
  });

  it('respects the searchable opt-out', async () => {
    const app = await getApp();
    const searcher = await onboardedUser();
    const hidden = await onboardedUser();

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(hidden.session),
      payload: { displayName: 'Khadija Unfindable' },
    });
    await app.inject({
      method: 'PATCH',
      url: '/v1/me/privacy',
      headers: auth(hidden.session),
      payload: { searchable: false },
    });

    const results = await app.inject({
      method: 'GET',
      url: '/v1/search?q=Khadija&kind=people',
      headers: auth(searcher.session),
    });
    expect(results.json<SearchResults>().people.map((p) => p.userId)).not.toContain(
      hidden.session.user.id,
    );
  });

  it('excludes blocked users from people search in both directions', async () => {
    const app = await getApp();
    const searcher = await onboardedUser();
    const blocked = await onboardedUser();

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(blocked.session),
      payload: { displayName: 'Mariam Blockedperson' },
    });
    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${blocked.handle}/block`,
      headers: auth(searcher.session),
      payload: {},
    });

    const results = await app.inject({
      method: 'GET',
      url: '/v1/search?q=Mariam&kind=people',
      headers: auth(searcher.session),
    });
    expect(results.json<SearchResults>().people.map((p) => p.userId)).not.toContain(
      blocked.session.user.id,
    );
  });

  it('does not return content from another cohort', async () => {
    const app = await getApp();
    const author = await onboardedUser({ stageId: cohort.stage5Id });
    const outsider = await onboardedUser({ stageId: cohort.stage4Id });

    const marker = `glomerulonephritis${Date.now()}`;
    const post = await createPost(author.session, { body: `شرح ${marker}`, visibility: 'stage' });

    const own = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${marker}&kind=content`,
      headers: auth(author.session),
    });
    expect(own.json<SearchResults>().content.map((c) => c.id)).toContain(post.body.id);

    const foreign = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${marker}&kind=content`,
      headers: auth(outsider.session),
    });
    expect(foreign.json<SearchResults>().content).toHaveLength(0);
  });

  it('rejects a query that is too short to be meaningful', async () => {
    const app = await getApp();
    const student = await onboardedUser();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/search?q=a',
      headers: auth(student.session),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorEnvelope>().error.code).toBe('VALIDATION_ERROR');
  });

  it('never returns deleted content', async () => {
    const app = await getApp();
    const author = await onboardedUser();
    const marker = `pyelonephritis${Date.now()}`;
    const post = await createPost(author.session, { body: `ملاحظة ${marker}` });

    await app.inject({
      method: 'DELETE',
      url: `/v1/content/${post.body.id}`,
      headers: auth(author.session),
    });

    const results = await app.inject({
      method: 'GET',
      url: `/v1/search?q=${marker}&kind=content`,
      headers: auth(author.session),
    });
    // Asserting absence rather than emptiness: trigram search is fuzzy by
    // design, so an unrelated post with a similar term is a correct hit and
    // says nothing about whether deleted content leaks.
    expect(results.json<SearchResults>().content.map((c) => c.id)).not.toContain(post.body.id);
  });
});

describe('group content', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('scopes a group feed to its members', async () => {
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

    const post = await createPost(owner.session, { body: 'group-only note', groupId: group.id });
    expect(post.statusCode).toBe(201);
    expect((post.body as ContentItem).container?.kind).toBe('group');

    const memberFeed = await readFeed(member.session, `?scope=recent&groupId=${group.id}`);
    expect(memberFeed.items.map((i) => i.id)).toContain(post.body.id);

    // An outsider can see the group exists (it is stage-scoped) but not read it.
    const outsiderSees = await app.inject({
      method: 'GET',
      url: `/v1/groups/${group.id}`,
      headers: auth(outsider.session),
    });
    expect(outsiderSees.statusCode).toBe(200);

    const outsiderFeed = await readFeed(outsider.session, `?scope=recent&groupId=${group.id}`);
    expect(outsiderFeed.items).toHaveLength(0);
  });
});
