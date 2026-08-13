import { describe, expect, it } from 'vitest';
import type { Actor } from '../actor.js';
import {
  canDeleteMessage,
  canEditMessage,
  canMarkRead,
  canReadConversation,
  canSendMessage,
  canStartDirectConversation,
  canViewConversation,
  conversationCapabilities,
  type ConversationMembership,
  type ConversationRef,
  type MessageRef,
} from '../conversation.policy.js';

/**
 * Phase 4 permissions, written before the implementation (§87 step 5).
 *
 * The rule under test throughout: **a conversation is a container, and
 * membership is the only key.** Not visibility, not cohort, not a shared group
 * — membership. Everything else in this file is a consequence of that.
 */

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'alice',
    role: 'student',
    status: 'active',
    verificationLevel: 'student',
    universityId: 'u1',
    collegeId: 'c1',
    programId: 'p1',
    stageId: 's5',
    courseIds: new Set(),
    communityIds: new Set(),
    groupIds: new Set(),
    classroomIds: new Set(),
    followingIds: new Set(),
    blockedUserIds: new Set(),
    blockedByUserIds: new Set(),
    mutedUserIds: new Set(),
    mutedGroupIds: new Set(),
    mutedCommunityIds: new Set(),
    mutedTopicIds: new Set(),
    ...overrides,
  };
}

function conversation(overrides: Partial<ConversationRef> = {}): ConversationRef {
  return { id: 'conv1', kind: 'direct', groupId: null, ...overrides };
}

function member(overrides: Partial<ConversationMembership> = {}): ConversationMembership {
  return { role: 'member', leftAt: null, ...overrides };
}

function message(overrides: Partial<MessageRef> = {}): MessageRef {
  return {
    id: 'm1',
    conversationId: 'conv1',
    senderId: 'alice',
    deletedAt: null,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    ...overrides,
  };
}

describe('canViewConversation', () => {
  it('admits an active member and nobody else', () => {
    expect(canViewConversation(actor(), conversation(), member()).allowed).toBe(true);
    expect(canViewConversation(actor(), conversation(), null)).toMatchObject({
      allowed: false,
      reason: 'not_a_member',
    });
  });

  it('shuts out a member who has left', () => {
    // Leaving is not a soft state. A departed member keeps nothing: not the
    // history, not the ability to read what was said after they left.
    expect(
      canViewConversation(actor(), conversation(), member({ leftAt: new Date() })).allowed,
    ).toBe(false);
  });

  it('gives a platform admin no way in', () => {
    /*
     * The deliberate divergence from content moderation. An admin can open a
     * reported post because a post was published to an audience. A private
     * conversation was not, and a moderation tool that reads other people's
     * messages is a surveillance tool. Reported messages reach moderation by
     * being reported — the reporter supplies the copy.
     */
    const admin = actor({ role: 'admin' });
    expect(canViewConversation(admin, conversation(), null).allowed).toBe(false);
    expect(canSendMessage(admin, conversation(), null).allowed).toBe(false);
  });

  it('does not admit a group member who is not in the group conversation', () => {
    // Group membership seeds conversation membership; it does not substitute
    // for it. Otherwise leaving a chat would be undone by the next request.
    const inGroup = actor({ groupIds: new Set(['g1']) });
    expect(
      canViewConversation(inGroup, conversation({ kind: 'group', groupId: 'g1' }), null).allowed,
    ).toBe(false);
  });

  it('refuses a suspended account and admits a restricted one', () => {
    expect(canViewConversation(actor({ status: 'suspended' }), conversation(), member()).allowed).toBe(
      false,
    );
    expect(canViewConversation(actor({ status: 'restricted' }), conversation(), member()).allowed).toBe(
      true,
    );
  });
});

describe('canReadConversation', () => {
  it('tracks canView — reading messages is what viewing a conversation is', () => {
    expect(canReadConversation(actor(), conversation(), member()).allowed).toBe(true);
    expect(canReadConversation(actor(), conversation(), null).allowed).toBe(false);
  });
});

describe('canSendMessage', () => {
  it('requires active membership', () => {
    expect(canSendMessage(actor(), conversation(), member()).allowed).toBe(true);
    expect(canSendMessage(actor(), conversation(), null)).toMatchObject({
      allowed: false,
      reason: 'not_a_member',
    });
  });

  it('refuses a restricted account, which may read and not write', () => {
    expect(canSendMessage(actor({ status: 'restricted' }), conversation(), member())).toMatchObject({
      allowed: false,
      reason: 'account_restricted',
    });
  });

  it('refuses a member who has left', () => {
    expect(
      canSendMessage(actor(), conversation(), member({ leftAt: new Date() })).allowed,
    ).toBe(false);
  });

  it('refuses a direct conversation with someone who blocked the sender', () => {
    /*
     * Blocking must sever an existing thread, not merely prevent a new one.
     * Both directions: whether they blocked me or I blocked them, the thread
     * stops. The counterparty is passed explicitly because a conversation row
     * does not carry it.
     */
    const blocked = actor({ blockedByUserIds: new Set(['bob']) });
    expect(canSendMessage(blocked, conversation(), member(), 'bob')).toMatchObject({
      allowed: false,
      reason: 'blocked',
    });

    const blocker = actor({ blockedUserIds: new Set(['bob']) });
    expect(canSendMessage(blocker, conversation(), member(), 'bob').allowed).toBe(false);
  });

  it('still allows reading a thread with someone who blocked you', () => {
    // The history was already delivered. Retroactively blanking it would be a
    // surprise, and blocking is about what happens next.
    const blocked = actor({ blockedByUserIds: new Set(['bob']) });
    expect(canReadConversation(blocked, conversation(), member()).allowed).toBe(true);
  });
});

describe('canMarkRead', () => {
  it('lets a member advance only their own read position', () => {
    expect(canMarkRead(actor(), conversation(), member(), 'alice').allowed).toBe(true);
    expect(canMarkRead(actor(), conversation(), member(), 'bob')).toMatchObject({
      allowed: false,
      reason: 'not_own_membership',
    });
  });

  it('refuses a non-member outright', () => {
    expect(canMarkRead(actor(), conversation(), null, 'alice').allowed).toBe(false);
  });
});

describe('canEditMessage', () => {
  it('permits only the sender', () => {
    expect(canEditMessage(actor(), message({ senderId: 'alice' })).allowed).toBe(true);
    expect(canEditMessage(actor(), message({ senderId: 'bob' }))).toMatchObject({
      allowed: false,
      reason: 'not_sender',
    });
  });

  it('refuses a deleted message', () => {
    expect(canEditMessage(actor(), message({ deletedAt: new Date() })).allowed).toBe(false);
  });

  it('refuses a restricted account', () => {
    expect(canEditMessage(actor({ status: 'restricted' }), message()).allowed).toBe(false);
  });
});

describe('canDeleteMessage', () => {
  it('permits the sender', () => {
    expect(canDeleteMessage(actor(), message({ senderId: 'alice' }), member()).allowed).toBe(true);
  });

  it('permits a moderator of the group behind a group conversation', () => {
    expect(
      canDeleteMessage(actor(), message({ senderId: 'bob' }), member({ role: 'moderator' })).allowed,
    ).toBe(true);
  });

  it('refuses an ordinary member deleting someone else’s message', () => {
    expect(
      canDeleteMessage(actor(), message({ senderId: 'bob' }), member()),
    ).toMatchObject({ allowed: false, reason: 'not_permitted' });
  });

  it('refuses a platform admin, who is not in the conversation', () => {
    expect(
      canDeleteMessage(actor({ role: 'admin' }), message({ senderId: 'bob' }), null).allowed,
    ).toBe(false);
  });
});

describe('canStartDirectConversation', () => {
  it('refuses a conversation with oneself', () => {
    expect(canStartDirectConversation(actor(), { userId: 'alice', allowsMessages: true })).toMatchObject(
      { allowed: false, reason: 'self' },
    );
  });

  it('refuses either direction of a block', () => {
    expect(
      canStartDirectConversation(actor({ blockedUserIds: new Set(['bob']) }), {
        userId: 'bob',
        allowsMessages: true,
      }).allowed,
    ).toBe(false);
    expect(
      canStartDirectConversation(actor({ blockedByUserIds: new Set(['bob']) }), {
        userId: 'bob',
        allowsMessages: true,
      }).allowed,
    ).toBe(false);
  });

  it('honours the recipient’s message privacy setting', () => {
    expect(
      canStartDirectConversation(actor(), { userId: 'bob', allowsMessages: false }),
    ).toMatchObject({ allowed: false, reason: 'recipient_does_not_accept_messages' });
  });

  it('refuses a restricted account', () => {
    expect(
      canStartDirectConversation(actor({ status: 'restricted' }), {
        userId: 'bob',
        allowsMessages: true,
      }).allowed,
    ).toBe(false);
  });
});

describe('conversationCapabilities', () => {
  it('reports each gate separately rather than as one verdict', () => {
    const caps = conversationCapabilities(
      actor({ status: 'restricted' }),
      conversation(),
      member(),
    );
    expect(caps.canView.allowed).toBe(true);
    expect(caps.canRead.allowed).toBe(true);
    expect(caps.canSend.allowed).toBe(false);
    expect(caps.canMarkRead.allowed).toBe(true);
  });

  it('closes everything for a non-member', () => {
    const caps = conversationCapabilities(actor(), conversation(), null);
    for (const [name, decision] of Object.entries(caps)) {
      expect(decision.allowed, name).toBe(false);
    }
  });
});
