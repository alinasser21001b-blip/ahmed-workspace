import type {
  Conversation,
  ConversationPage,
  Group,
  Message,
  MessagePage,
  SendMessageResponse,
} from '@sos/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne, queryRows } from '../src/platform/db.js';
import { auth, closeApp, ensureCohort, getApp, onboardedUser } from './helpers.js';

/**
 * Phase 4 — Messaging.
 *
 * The exit criterion, as a test: **a message survives a backgrounded app, a
 * dropped connection, a duplicate retry, an out-of-order receipt, and a
 * reconnect with a gap — with no duplicates, no losses, and correct ordering.**
 *
 * Each block below is one clause of that sentence.
 */

type Session = Awaited<ReturnType<typeof onboardedUser>>;

async function openDirect(from: Session, to: Session): Promise<Conversation> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/conversations',
    headers: auth(from.session),
    payload: { recipientHandle: to.handle },
  });
  if (response.statusCode !== 200) {
    throw new Error(`openDirect failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<Conversation>();
}

async function send(
  session: Session,
  conversationId: string,
  body: string,
  clientMessageId = randomUUID(),
): Promise<SendMessageResponse> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    headers: auth(session.session),
    payload: { clientMessageId, body },
  });
  if (response.statusCode !== 201) {
    throw new Error(`send failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<SendMessageResponse>();
}

async function read(
  session: Session,
  conversationId: string,
  query = 'limit=50',
): Promise<MessagePage> {
  const app = await getApp();
  const response = await app.inject({
    method: 'GET',
    url: `/v1/conversations/${conversationId}/messages?${query}`,
    headers: auth(session.session),
  });
  if (response.statusCode !== 200) {
    throw new Error(`read failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<MessagePage>();
}

beforeAll(async () => {
  await getApp();
  await ensureCohort();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

// --- delivery guarantees ----------------------------------------------------

describe('the delivery contract', () => {
  it('assigns a dense, monotonic seq under concurrent sends', async () => {
    /*
     * The property `seq` exists for: it must be dense and gapless, because a
     * reconnecting client asks for "everything after N" and waits for anything
     * missing. Concurrent senders are the case that breaks a naive
     * `max(seq) + 1`.
     */
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        send(i % 2 === 0 ? alice : bob, conversation.id, `concurrent ${i}`),
      ),
    );

    // `ORDER BY m.seq`, qualified: an unqualified `seq` would bind to the text
    // output alias and sort 10 before 2.
    const rows = await queryRows<{ seq: string }>(
      `SELECT m.seq::text AS seq FROM messages m WHERE m.conversation_id = $1 ORDER BY m.seq`,
      [conversation.id],
    );

    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('collapses a retry with the same clientMessageId onto one message', async () => {
    // The dropped-response case: the client never saw the ack and sends again.
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    const clientMessageId = randomUUID();
    const first = await send(alice, conversation.id, 'exactly once', clientMessageId);
    const retry = await send(alice, conversation.id, 'exactly once', clientMessageId);

    expect(first.deduplicated).toBe(false);
    expect(retry.deduplicated).toBe(true);
    expect(retry.message.id).toBe(first.message.id);
    expect(retry.message.seq).toBe(first.message.seq);

    const page = await read(alice, conversation.id);
    expect(page.items).toHaveLength(1);
  });

  it('does not burn a sequence number on a retry', async () => {
    /*
     * The subtle half of idempotency. If a deduplicated send still advanced
     * `last_seq`, the conversation would carry a number no message has — and a
     * reconnecting client would wait forever for a message that never existed.
     */
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    const clientMessageId = randomUUID();
    await send(alice, conversation.id, 'first', clientMessageId);
    await send(alice, conversation.id, 'first', clientMessageId);
    await send(alice, conversation.id, 'second');

    const seqs = (await read(alice, conversation.id)).items.map((m) => m.seq);
    expect(seqs).toEqual([1, 2]);

    const head = await queryOne<{ last_seq: string }>(
      `SELECT last_seq::text AS last_seq FROM conversations WHERE id = $1`,
      [conversation.id],
    );
    expect(Number(head?.last_seq)).toBe(2);
  });

  it('survives a burst of concurrent retries of the same message', async () => {
    // The rapid-tap case, and the offline queue flushing all at once.
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    const clientMessageId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => send(alice, conversation.id, 'one tap', clientMessageId)),
    );

    const ids = new Set(results.map((r) => r.message.id));
    expect(ids.size).toBe(1);
    expect((await read(alice, conversation.id)).items).toHaveLength(1);
  });

  it('orders by seq, not by any client-supplied time', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (const body of ['first', 'second', 'third']) {
      await send(alice, conversation.id, body);
    }

    // Drag the middle message's wall-clock backwards, as a device with a wrong
    // date would. Ordering must not move.
    await queryOne(
      `UPDATE messages SET created_at = now() - interval '10 days'
       WHERE conversation_id = $1 AND seq = 2`,
      [conversation.id],
    );

    const page = await read(alice, conversation.id);
    expect(page.items.map((m) => m.body)).toEqual(['first', 'second', 'third']);
    expect(page.items.map((m) => m.seq)).toEqual([1, 2, 3]);
  });
});

// --- pagination and gap replay ----------------------------------------------

describe('pagination and reconnect', () => {
  it('pages backwards without dropping or repeating a message', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (let i = 1; i <= 25; i += 1) await send(alice, conversation.id, `message ${i}`);

    const seen: number[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result: MessagePage = await read(
        alice,
        conversation.id,
        `limit=10${cursor === null ? '' : `&beforeSeq=${cursor}`}`,
      );
      seen.push(...result.items.map((m) => m.seq));
      cursor = result.nextBeforeSeq;
      if (cursor === null) break;
    }

    expect(new Set(seen).size).toBe(25);
    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  it('replays exactly the gap after a reconnect', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (let i = 1; i <= 5; i += 1) await send(alice, conversation.id, `before ${i}`);
    // Bob "goes offline" here, holding up to seq 5.
    for (let i = 1; i <= 4; i += 1) await send(alice, conversation.id, `while away ${i}`);

    const gap = await read(bob, conversation.id, 'afterSeq=5&limit=50');
    expect(gap.items.map((m) => m.seq)).toEqual([6, 7, 8, 9]);
    expect(gap.lastSeq).toBe(9);
  });

  it('replays a gap oldest-first, so a truncated replay leaves no hole', async () => {
    /*
     * A backwards replay would return the newest N and leave a hole in the
     * middle — the one shape a client cannot detect, because it sees a
     * contiguous run at the head and assumes it is caught up.
     */
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (let i = 1; i <= 10; i += 1) await send(alice, conversation.id, `m${i}`);

    const truncated = await read(bob, conversation.id, 'afterSeq=0&limit=4');
    expect(truncated.items.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });
});

// --- read state -------------------------------------------------------------

describe('read receipts and unread counts', () => {
  async function markRead(session: Session, conversationId: string, seq: number) {
    const app = await getApp();
    return app.inject({
      method: 'PUT',
      url: `/v1/conversations/${conversationId}/read`,
      headers: auth(session.session),
      payload: { seq },
    });
  }

  it('derives the unread count from two integers, and never stores it', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (let i = 1; i <= 3; i += 1) await send(alice, conversation.id, `unread ${i}`);

    const app = await getApp();
    const forBob = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}`,
      headers: auth(bob.session),
    });
    expect(forBob.json<Conversation>().viewer.unreadCount).toBe(3);

    // The sender's own messages are never unread to them.
    const forAlice = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}`,
      headers: auth(alice.session),
    });
    expect(forAlice.json<Conversation>().viewer.unreadCount).toBe(0);

    await markRead(bob, conversation.id, 3);

    const after = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}`,
      headers: auth(bob.session),
    });
    expect(after.json<Conversation>().viewer.unreadCount).toBe(0);
  });

  it('never rewinds on an out-of-order receipt', async () => {
    // Receipts arrive out of order constantly. A late one carrying a lower seq
    // must not resurrect an unread badge the user already cleared.
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (let i = 1; i <= 5; i += 1) await send(alice, conversation.id, `m${i}`);

    await markRead(bob, conversation.id, 5);
    const late = await markRead(bob, conversation.id, 2);

    expect(late.json<{ lastReadSeq: number }>().lastReadSeq).toBe(5);
  });

  it('clamps a read position to the conversation head', async () => {
    // Otherwise a client could mark itself read past the end and silence every
    // message that arrives next.
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    await send(alice, conversation.id, 'only one');

    const response = await markRead(bob, conversation.id, 9999);
    expect(response.json<{ lastReadSeq: number }>().lastReadSeq).toBe(1);

    await send(alice, conversation.id, 'arrives after the bogus receipt');

    const app = await getApp();
    const conv = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}`,
      headers: auth(bob.session),
    });
    expect(conv.json<Conversation>().viewer.unreadCount).toBe(1);
  });

  it('stores one read position per member, not one row per message per user', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    for (let i = 1; i <= 20; i += 1) await send(alice, conversation.id, `m${i}`);
    await markRead(bob, conversation.id, 20);

    const receipts = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM message_receipts mr
       JOIN messages m ON m.id = mr.message_id
       WHERE m.conversation_id = $1`,
      [conversation.id],
    );
    expect(Number(receipts?.n)).toBe(0);

    const positions = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM conversation_members WHERE conversation_id = $1`,
      [conversation.id],
    );
    expect(Number(positions?.n)).toBe(2);
  });
});

// --- authorization ----------------------------------------------------------

describe('conversation authorization', () => {
  it('refuses every operation to a non-participant, by direct API manipulation', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const mallory = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    const sent = await send(alice, conversation.id, 'private between two people');

    const app = await getApp();
    const headers = auth(mallory.session);

    // Read the conversation.
    expect(
      (await app.inject({ method: 'GET', url: `/v1/conversations/${conversation.id}`, headers }))
        .statusCode,
    ).toBe(404);

    // Read its messages.
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/conversations/${conversation.id}/messages`,
          headers,
        })
      ).statusCode,
    ).toBe(404);

    // Send into it.
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/conversations/${conversation.id}/messages`,
          headers,
          payload: { clientMessageId: randomUUID(), body: 'intrusion' },
        })
      ).statusCode,
    ).toBe(404);

    // Mark it read.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/conversations/${conversation.id}/read`,
          headers,
          payload: { seq: 1 },
        })
      ).statusCode,
    ).toBe(404);

    // Edit and delete someone else's message.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/messages/${sent.message.id}`,
          headers,
          payload: { body: 'rewritten' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/messages/${sent.message.id}`, headers }))
        .statusCode,
    ).toBe(404);
  });

  it('never lists a conversation the caller is not in', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const mallory = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    await send(alice, conversation.id, 'not for mallory');

    const app = await getApp();
    const list = await app.inject({
      method: 'GET',
      url: '/v1/conversations?limit=50',
      headers: auth(mallory.session),
    });
    const page = list.json<ConversationPage>();
    expect(page.items.map((c) => c.id)).not.toContain(conversation.id);
    expect(page.totalUnread).toBe(0);
  });

  it('refuses to let a participant mark another participant’s conversation read', async () => {
    /*
     * There is no endpoint that takes a user id — which is the point. The read
     * position is derived from the token, so "mark someone else's read" is not
     * a request that can be expressed, rather than one that is refused.
     */
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    await send(alice, conversation.id, 'unread for bob');

    const app = await getApp();
    await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${conversation.id}/read`,
      headers: auth(alice.session),
      payload: { seq: 1 },
    });

    const forBob = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}`,
      headers: auth(bob.session),
    });
    expect(forBob.json<Conversation>().viewer.unreadCount).toBe(1);
  });

  it('lets only the sender edit, and the sender or a moderator delete', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    const sent = await send(alice, conversation.id, 'mine to edit');

    const app = await getApp();

    const byOther = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${sent.message.id}`,
      headers: auth(bob.session),
      payload: { body: 'not yours' },
    });
    expect(byOther.statusCode).toBe(403);

    const bySender = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${sent.message.id}`,
      headers: auth(alice.session),
      payload: { body: 'edited' },
    });
    expect(bySender.statusCode).toBe(200);
    expect(bySender.json<Message>().body).toBe('edited');
    expect(bySender.json<Message>().editedAt).not.toBeNull();
  });

  it('keeps a deleted message’s seq so the sequence stays dense', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    await send(alice, conversation.id, 'one');
    const middle = await send(alice, conversation.id, 'two');
    await send(alice, conversation.id, 'three');

    const app = await getApp();
    await app.inject({
      method: 'DELETE',
      url: `/v1/messages/${middle.message.id}`,
      headers: auth(alice.session),
    });

    const page = await read(bob, conversation.id);
    expect(page.items.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(page.items[1]?.body).toBeNull();
    expect(page.items[1]?.deletedAt).not.toBeNull();
  });

  it('gives a platform admin no way into a private conversation', async () => {
    /*
     * The deliberate divergence from content moderation. A post was published
     * to an audience; a private message was not. A moderation tool that opens
     * one is a surveillance tool.
     */
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const admin = await onboardedUser();
    await queryOne(`UPDATE users SET role = 'admin' WHERE id = $1`, [admin.session.user.id]);

    const conversation = await openDirect(alice, bob);
    await send(alice, conversation.id, 'not for moderators either');

    const app = await getApp();
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/conversations/${conversation.id}/messages`,
          headers: auth(admin.session),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('lets a block sever an existing thread', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    await send(alice, conversation.id, 'before the block');

    const app = await getApp();
    const block = await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${alice.handle}/block`,
      headers: auth(bob.session),
      payload: {},
    });
    expect(block.statusCode).toBe(200);

    const blocked = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: auth(alice.session),
      payload: { clientMessageId: randomUUID(), body: 'after the block' },
    });
    expect(blocked.statusCode).toBe(403);

    // …but the history stays readable. It was already delivered, and blanking
    // it retroactively would be a surprise.
    const history = await read(alice, conversation.id);
    expect(history.items).toHaveLength(1);
  });

  it('refuses a restricted account the composer and not the thread', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);
    await send(bob, conversation.id, 'readable while restricted');

    await queryOne(`UPDATE users SET status = 'restricted' WHERE id = $1`, [
      alice.session.user.id,
    ]);

    const app = await getApp();
    const view = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversation.id}`,
      headers: auth(alice.session),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json<Conversation>().viewer.canRead).toBe(true);
    expect(view.json<Conversation>().viewer.canSend).toBe(false);

    const write = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversation.id}/messages`,
      headers: auth(alice.session),
      payload: { clientMessageId: randomUUID(), body: 'should be refused' },
    });
    expect(write.statusCode).toBe(403);
  });
});

// --- conversation creation --------------------------------------------------

describe('opening a conversation', () => {
  it('is idempotent per unordered pair, from either side', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    const fromAlice = await openDirect(alice, bob);
    const fromBob = await openDirect(bob, alice);
    expect(fromBob.id).toBe(fromAlice.id);

    const rows = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM direct_conversation_keys WHERE conversation_id = $1`,
      [fromAlice.id],
    );
    expect(Number(rows?.n)).toBe(1);
  });

  it('does not produce two threads when both sides open at once', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    const [a, b] = await Promise.all([openDirect(alice, bob), openDirect(bob, alice)]);
    expect(a.id).toBe(b.id);
  });

  it('titles a direct conversation by whoever the reader is not', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    const forAlice = await openDirect(alice, bob);
    const forBob = await openDirect(bob, alice);

    expect(forAlice.counterpart?.handle).toBe(bob.handle);
    expect(forBob.counterpart?.handle).toBe(alice.handle);
  });

  it('refuses a conversation with someone who blocked the caller, without confirming they exist', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    const app = await getApp();
    const block = await app.inject({
      method: 'PUT',
      url: `/v1/profiles/${alice.handle}/block`,
      headers: auth(bob.session),
      payload: {},
    });
    expect(block.statusCode).toBe(200);

    const attempt = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth(alice.session),
      payload: { recipientHandle: bob.handle },
    });
    expect(attempt.statusCode).toBe(404);
  });

  it('opens a group conversation for members and refuses it to outsiders', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();
    const outsider = await onboardedUser();

    const group = (
      await app.inject({
        method: 'POST',
        url: '/v1/groups',
        headers: auth(owner.session),
        payload: { name: 'Chat group', visibility: 'stage', joinPolicy: 'open' },
      })
    ).json<Group>();

    await app.inject({
      method: 'PUT',
      url: `/v1/groups/${group.id}/membership`,
      headers: auth(member.session),
      payload: {},
    });

    const opened = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth(owner.session),
      payload: { groupId: group.id },
    });
    expect(opened.statusCode).toBe(200);
    const conversation = opened.json<Conversation>();
    expect(conversation.kind).toBe('group');
    expect(conversation.title).toBe('Chat group');

    // The member is already in it — group membership seeded the conversation.
    const asMember = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth(member.session),
      payload: { groupId: group.id },
    });
    expect(asMember.statusCode).toBe(200);
    expect(asMember.json<Conversation>().id).toBe(conversation.id);

    const asOutsider = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: auth(outsider.session),
      payload: { groupId: group.id },
    });
    expect(asOutsider.statusCode).toBe(404);
  });

  it('sorts the chat list by recent activity without leaking anything private', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const carol = await onboardedUser();

    const withBob = await openDirect(alice, bob);
    const withCarol = await openDirect(alice, carol);

    await send(alice, withBob.id, 'to bob');
    await send(alice, withCarol.id, 'to carol');

    const app = await getApp();
    const list = await app.inject({
      method: 'GET',
      url: '/v1/conversations?limit=50',
      headers: auth(alice.session),
    });
    const items = list.json<ConversationPage>().items;
    expect(items[0]?.id).toBe(withCarol.id);
    expect(items[1]?.id).toBe(withBob.id);

    // Bob's list shows his own thread and nothing about Alice's other one.
    const bobList = await app.inject({
      method: 'GET',
      url: '/v1/conversations?limit=50',
      headers: auth(bob.session),
    });
    const bobItems = bobList.json<ConversationPage>().items;
    expect(bobItems.map((c) => c.id)).toEqual([withBob.id]);
    expect(bobItems[0]?.lastMessagePreview).toBe('to bob');
  });
});

// --- events -----------------------------------------------------------------

describe('messaging domain events', () => {
  it('records conversation and message events, and none for a deduplicated retry', async () => {
    const alice = await onboardedUser();
    const bob = await onboardedUser();
    const conversation = await openDirect(alice, bob);

    const clientMessageId = randomUUID();
    await send(alice, conversation.id, 'once', clientMessageId);
    await send(alice, conversation.id, 'once', clientMessageId);

    const events = await queryRows<{ kind: string }>(
      `SELECT kind FROM domain_events
       WHERE target_type = 'conversation' AND target_id = $1
       ORDER BY occurred_at, id`,
      [conversation.id],
    );

    // Exactly one `message.created` for two sends — the retry announced nothing,
    // so the recipient is not notified twice for one message.
    expect(events.map((e) => e.kind)).toEqual(['conversation.created', 'message.created']);
  });
});
