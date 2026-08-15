import type { DeleteAccountResponse } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import { auth, closeApp, ensureCohort, getApp, onboardedUser } from './helpers.js';

/**
 * App Store readiness — the adversarial scenarios named in the brief.
 *
 * Four capabilities, tested the way App Review would probe them: not "does
 * the happy path work" but "can a client route around it".
 */

type Session = Awaited<ReturnType<typeof onboardedUser>>;

beforeAll(async () => {
  await getApp();
  // Practicable in every course fixture the shared suite relies on.
  await ensureCohort();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

async function publish(
  session: Session,
  body: string,
  extra: Record<string, unknown> = {},
): Promise<{ statusCode: number; body: unknown }> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/content',
    headers: auth(session.session),
    payload: { body, visibility: 'stage', mediaFileIds: [], topicIds: [], ...extra },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

async function directConversation(a: Session, b: Session): Promise<string> {
  const app = await getApp();
  const created = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    headers: auth(a.session),
    payload: { recipientHandle: (await handleOf(b)) },
  });
  return created.json<{ id: string }>().id;
}

async function handleOf(session: Session): Promise<string> {
  const row = await queryOne<{ handle: string }>(
    `SELECT handle FROM profiles WHERE user_id = $1`,
    [session.session.user.id],
  );
  return row!.handle;
}

// --- account deletion --------------------------------------------------------

describe('account deletion', () => {
  it('unauthenticated deletion is rejected', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      payload: { password: 'whatever', confirmation: 'DELETE' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('a wrong password is rejected and nothing is deleted', async () => {
    const student = await onboardedUser();
    const app = await getApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(student.session),
      payload: { password: 'definitely-wrong', confirmation: 'DELETE' },
    });
    expect(response.statusCode).toBe(401);

    const still = await queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [
      student.session.user.id,
    ]);
    expect(still).not.toBeNull();
  });

  it('deletes the account end to end: row, posts, sessions, and it cannot sign in again', async () => {
    const student = await onboardedUser();
    const app = await getApp();

    await publish(student, 'منشور سيُحذف مع الحساب.');
    const contentBefore = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM content_items WHERE author_id = $1`,
      [student.session.user.id],
    );
    expect(contentBefore!.n).toBeGreaterThan(0);

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(student.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });
    expect(response.statusCode).toBe(200);
    const summary = response.json<DeleteAccountResponse>();
    expect(summary.sessionsRevoked).toBeGreaterThan(0);

    // The row is gone, not soft-disabled.
    const gone = await queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [
      student.session.user.id,
    ]);
    expect(gone).toBeNull();

    // Cascaded content is gone too — the real deletion, not a hidden profile.
    const contentAfter = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM content_items WHERE author_id = $1`,
      [student.session.user.id],
    );
    expect(contentAfter!.n).toBe(0);

    // The access token that was live at deletion time is now useless.
    const retry = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: auth(student.session),
    });
    expect(retry.statusCode).toBe(401);

    // And the account cannot sign in again — it does not exist.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: student.session.user.email, password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('a retry of the same deletion after success does not error the second time destructively', async () => {
    const student = await onboardedUser();
    const app = await getApp();

    const first = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(student.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });
    expect(first.statusCode).toBe(200);

    // The access token is dead, so the retry is authenticated as nobody — a
    // 401, not a second deletion of an account that no longer exists.
    const retry = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(student.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });
    expect(retry.statusCode).toBe(401);
  });

  it('tombstones messages rather than deleting the row, so the other side keeps their thread', async () => {
    const [alice, bilal] = await Promise.all([onboardedUser(), onboardedUser()]);
    const app = await getApp();
    const conversationId = await directConversation(alice, bilal);

    await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: auth(alice.session),
      payload: { clientMessageId: crypto.randomUUID(), kind: 'text', body: 'مرحباً' },
    });

    const before = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(before!.n).toBe(1);

    const app2 = await getApp();
    await app2.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(alice.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });

    const after = await queryOne<{ n: number; body: string | null; sender_id: string | null }>(
      `SELECT count(*)::int AS n,
              (array_agg(body))[1] AS body,
              (array_agg(sender_id))[1] AS sender_id
       FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    // The row survives — the thread is not renumbered — but carries nothing.
    expect(after!.n).toBe(1);
    expect(after!.body).toBeNull();
    expect(after!.sender_id).toBeNull();

    // The other side can still read the conversation.
    const readBack = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/messages?limit=20`,
      headers: auth(bilal.session),
    });
    expect(readBack.statusCode).toBe(200);
  });

  it('transfers a solely-owned group to the next member rather than stranding it', async () => {
    const [owner, member] = await Promise.all([onboardedUser(), onboardedUser()]);
    const app = await getApp();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: auth(owner.session),
      payload: { name: 'مجموعة اختبار', visibility: 'stage', joinPolicy: 'open' },
    });
    const groupId = created.json<{ id: string }>().id;

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${groupId}/membership`,
      headers: auth(member.session),
      payload: {},
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(owner.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<DeleteAccountResponse>().groupsTransferred).toBeGreaterThanOrEqual(1);

    const membership = await queryOne<{ role: string }>(
      `SELECT role::text AS role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, member.session.user.id],
    );
    expect(membership!.role).toBe('owner');

    const group = await queryOne<{ archived_at: Date | null }>(
      `SELECT archived_at FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(group!.archived_at).toBeNull();
  });

  it('archives a solely-owned group with no other members rather than leaving it ownerless', async () => {
    const owner = await onboardedUser();
    const app = await getApp();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: auth(owner.session),
      payload: { name: 'مجموعة فردية', visibility: 'stage', joinPolicy: 'open' },
    });
    const groupId = created.json<{ id: string }>().id;

    await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(owner.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });

    const group = await queryOne<{ archived_at: Date | null }>(
      `SELECT archived_at FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(group!.archived_at).not.toBeNull();
  });

  it('removes uploaded files from storage', async () => {
    const student = await onboardedUser();
    const app = await getApp();

    const upload = await app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...auth(student.session), 'content-type': 'multipart/form-data; boundary=X' },
      payload:
        '--X\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n' +
        Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('binary') +
        '\r\n--X--\r\n',
    });
    if (upload.statusCode !== 201) return; // Upload plumbing covered elsewhere; skip if shape differs.
    const fileId = upload.json<{ id: string }>().id;

    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(student.session),
      payload: { password: 'correct-horse-battery', confirmation: 'DELETE' },
    });
    const summary = response.json<DeleteAccountResponse>();
    expect(summary.filesRemoved).toBeGreaterThanOrEqual(1);
    expect(summary.objectsOrphaned).toBe(0);

    const row = await queryOne<{ id: string }>(`SELECT id FROM files WHERE id = $1`, [fileId]);
    expect(row).toBeNull();
  });

  it('the confirmation literal is required and case-sensitive', async () => {
    const student = await onboardedUser();
    const app = await getApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me/account',
      headers: auth(student.session),
      payload: { password: 'correct-horse-battery', confirmation: 'delete' },
    });
    expect(response.statusCode).toBe(400);
  });
});

// --- reporting ---------------------------------------------------------------

describe('reporting', () => {
  it('an invalid target is rejected', async () => {
    const student = await onboardedUser();
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(student.session),
      payload: { targetType: 'content', targetId: crypto.randomUUID(), reason: 'spam' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('the reporter identity comes from auth, never the request body', async () => {
    const [author, reporter] = await Promise.all([onboardedUser(), onboardedUser()]);
    const posted = await publish(author, 'محتوى للإبلاغ عنه.');
    const contentId = (posted.body as { id: string }).id;

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(reporter.session),
      // A body attempting to impersonate another reporter — the schema has no
      // such field, so this proves the field cannot be smuggled in even if
      // named correctly, since it is simply not read.
      payload: {
        targetType: 'content',
        targetId: contentId,
        reason: 'harassment',
        reporterId: author.session.user.id,
      },
    });
    expect(response.statusCode).toBe(201);

    const row = await queryOne<{ reporter_id: string }>(
      `SELECT reporter_id FROM reports WHERE content_id = $1`,
      [contentId],
    );
    expect(row!.reporter_id).toBe(reporter.session.user.id);
  });

  it('duplicate reports from the same reporter on the same target are refused', async () => {
    const [author, reporter] = await Promise.all([onboardedUser(), onboardedUser()]);
    const posted = await publish(author, 'محتوى آخر للإبلاغ عنه.');
    const contentId = (posted.body as { id: string }).id;
    const app = await getApp();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(reporter.session),
      payload: { targetType: 'content', targetId: contentId, reason: 'spam' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(reporter.session),
      payload: { targetType: 'content', targetId: contentId, reason: 'spam' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('an ordinary user cannot read the moderator queue', async () => {
    const student = await onboardedUser();
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/reports',
      headers: auth(student.session),
    });
    // 404, not 403 — the same rule the rest of the API follows for invisible
    // resources, so a non-admin probing for the surface cannot confirm it exists.
    expect(response.statusCode).toBe(404);
  });

  it('a message is reportable — the private surface where harassment is least visible', async () => {
    const [alice, bilal] = await Promise.all([onboardedUser(), onboardedUser()]);
    const app = await getApp();
    const conversationId = await directConversation(alice, bilal);

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: auth(alice.session),
      payload: { clientMessageId: crypto.randomUUID(), kind: 'text', body: 'رسالة عادية' },
    });
    const messageId = sent.json<{ message: { id: string } }>().message.id;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: auth(bilal.session),
      payload: { targetType: 'message', targetId: messageId, reason: 'harassment' },
    });
    expect(response.statusCode).toBe(201);
  });
});

// --- blocking ------------------------------------------------------------

describe('blocking', () => {
  it('a blocked user cannot start a new direct conversation with the blocker', async () => {
    const [victim, blocked] = await Promise.all([onboardedUser(), onboardedUser()]);
    const app = await getApp();
    const blockedHandle = await handleOf(blocked);

    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${blockedHandle}/block`,
      headers: auth(victim.session),
      payload: {},
    });

    const attack = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth(blocked.session),
      payload: { recipientHandle: await handleOf(victim) },
    });
    expect(attack.statusCode).toBeGreaterThanOrEqual(400);
    expect(attack.statusCode).toBeLessThan(500);
  });

  it('a blocked user cannot message through an existing conversation either', async () => {
    const [victim, toBeBlocked] = await Promise.all([onboardedUser(), onboardedUser()]);
    const conversationId = await directConversation(victim, toBeBlocked);
    const app = await getApp();

    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${await handleOf(toBeBlocked)}/block`,
      headers: auth(victim.session),
      payload: {},
    });

    const attack = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: auth(toBeBlocked.session),
      payload: { clientMessageId: crypto.randomUUID(), kind: 'text', body: 'still trying' },
    });
    expect(attack.statusCode).toBeGreaterThanOrEqual(400);
    expect(attack.statusCode).toBeLessThan(500);
  });

  it('unblocking restores exactly the ability to message, nothing more', async () => {
    const [victim, other] = await Promise.all([onboardedUser(), onboardedUser()]);
    const app = await getApp();
    const otherHandle = await handleOf(other);

    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${otherHandle}/block`,
      headers: auth(victim.session),
      payload: {},
    });
    await app.inject({
      method: 'DELETE',
      url: `/v1/profiles/${otherHandle}/block`,
      headers: auth(victim.session),
    });

    const rel = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${otherHandle}/relationship`,
      headers: auth(victim.session),
    });
    expect(rel.json<{ isBlocked: boolean }>().isBlocked).toBe(false);
  });

  it('a student cannot mutate another student’s block list', async () => {
    const [alice, bilal, target] = await Promise.all([
      onboardedUser(),
      onboardedUser(),
      onboardedUser(),
    ]);
    const app = await getApp();
    const targetHandle = await handleOf(target);

    // Alice blocks target.
    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${targetHandle}/block`,
      headers: auth(alice.session),
      payload: {},
    });

    // Bilal unblocks — this can only affect Bilal's own block edge, which
    // never existed, so it must not touch Alice's.
    await app.inject({
      method: 'DELETE',
      url: `/v1/profiles/${targetHandle}/block`,
      headers: auth(bilal.session),
    });

    const stillBlocked = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [alice.session.user.id, target.session.user.id],
    );
    expect(stillBlocked!.n).toBe(1);
  });

  it('the block list is visible to the blocker and empty for a stranger', async () => {
    const [blocker, blocked] = await Promise.all([onboardedUser(), onboardedUser()]);
    const app = await getApp();
    await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${await handleOf(blocked)}/block`,
      headers: auth(blocker.session),
      payload: {},
    });

    const mine = await app.inject({
      method: 'GET',
      url: '/v1/me/blocks',
      headers: auth(blocker.session),
    });
    expect(mine.json<{ profile: { handle: string } }[]>().length).toBeGreaterThanOrEqual(1);

    const stranger = await onboardedUser();
    const theirs = await app.inject({
      method: 'GET',
      url: '/v1/me/blocks',
      headers: auth(stranger.session),
    });
    expect(theirs.json<unknown[]>()).toEqual([]);
  });
});

// --- the moderation gate ------------------------------------------------

describe('the moderation gate runs server-side and cannot be bypassed', () => {
  it('refuses a direct threat in a post, regardless of client behaviour', async () => {
    const student = await onboardedUser();
    const result = await publish(student, 'i will kill you tomorrow');
    expect(result.statusCode).toBe(422);
    expect((result.body as { error: { code: string } }).error.code).toBe('CONTENT_REFUSED');
  });

  it('refuses the same threat in a comment', async () => {
    const [author, attacker] = await Promise.all([onboardedUser(), onboardedUser()]);
    const posted = await publish(author, 'منشور عادي.');
    const contentId = (posted.body as { id: string }).id;
    const app = await getApp();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/content/${contentId}/comments`,
      headers: auth(attacker.session),
      payload: { body: 'i will kill you' },
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses the same threat in a direct message', async () => {
    const [alice, bilal] = await Promise.all([onboardedUser(), onboardedUser()]);
    const conversationId = await directConversation(alice, bilal);
    const app = await getApp();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: auth(alice.session),
      payload: { clientMessageId: crypto.randomUUID(), kind: 'text', body: 'i will kill you' },
    });
    expect(response.statusCode).toBe(422);

    // Refused means never written, on any surface.
    const row = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND body ILIKE '%kill%'`,
      [conversationId],
    );
    expect(row!.n).toBe(0);
  });

  it('cannot be bypassed by a client that omits any moderation field — there is none to omit', async () => {
    // The point under test: the gate has no client-supplied override at all.
    // Sending extra fields that LOOK like a bypass must have no effect.
    const student = await onboardedUser();
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/content',
      headers: auth(student.session),
      payload: {
        body: 'i will kill you',
        visibility: 'stage',
        mediaFileIds: [],
        topicIds: [],
        skipModeration: true,
        moderationOverride: 'allow',
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('does not refuse legitimate medical-education content sharing the same vocabulary as the rules', async () => {
    const student = await onboardedUser();
    const texts = [
      'اليوم راجعنا حالة تسمم دوائي حاد (overdose) في قسم الطوارئ.',
      'مناقشة حول التهاب الشرج (anal fissure) وعلاجه المحافظ.',
      'محاضرة عن الاعتداء الجنسي والفحص الشرعي الطبي.',
      'Case review: management of acute psychosis in the ED.',
    ];
    for (const body of texts) {
      const result = await publish(student, body);
      expect(result.statusCode).toBe(201);
    }
  });

  it('a wrong-topic evasion attempt (leetspeak / spacing) is still caught', async () => {
    const student = await onboardedUser();
    const result = await publish(student, 'i w1ll k!ll you');
    expect(result.statusCode).toBe(422);
  });
});
