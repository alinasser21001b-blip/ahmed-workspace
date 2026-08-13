import type { MembershipRole } from '@sos/contracts';
import {
  allow,
  canRead,
  deny,
  isBlockedEitherWay,
  type Decision,
  type MaybeActor,
} from './actor.js';

/**
 * Conversation authorization.
 *
 * One sentence governs this file: **a conversation is a container, and
 * membership is the only key.** Not cohort, not visibility, not a shared group,
 * not an admin role. Every gate below is a consequence of that.
 *
 * The most important consequence is the one that looks like an omission:
 * **there is no platform-admin bypass.** Content has one, because a post was
 * published to an audience and moderating it means reading what that audience
 * read. A private message was published to one person. A moderation tool that
 * opens it is a surveillance tool, and a product that has one has it forever.
 * Reported messages reach moderation by being reported — the report carries the
 * copy, supplied by a participant who was already entitled to it.
 *
 * The same shape as the group gates in `membership.policy`, deliberately: one
 * authorization vocabulary across the product (ADR-0003), so the realtime
 * transport, the REST API and the client all consult the same decisions rather
 * than three re-derivations of them.
 */

export type ConversationKind = 'direct' | 'group';

export interface ConversationRef {
  id: string;
  kind: ConversationKind;
  /** The group this is the conversation *of*, when there is one. */
  groupId: string | null;
}

export interface ConversationMembership {
  role: MembershipRole;
  /** Set when the member left. A departed member is not a member. */
  leftAt: Date | string | null;
}

export type MaybeConversationMembership = ConversationMembership | null;

export interface MessageRef {
  id: string;
  conversationId: string;
  /** Null when the sender's account was deleted. */
  senderId: string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
}

/** The counterparty in a direct conversation, when the caller has resolved it. */
export type Counterparty = string | null | undefined;

const MODERATE_ROLES: MembershipRole[] = ['owner', 'admin', 'moderator'];

function isActiveMember(membership: MaybeConversationMembership): boolean {
  return membership !== null && membership.leftAt === null;
}

/**
 * May the actor know this conversation exists, and open it?
 *
 * Restricted accounts are admitted: restriction removes the ability to write,
 * not the ability to read what was already said to them.
 */
export function canViewConversation(
  actor: MaybeActor,
  _conversation: ConversationRef,
  membership: MaybeConversationMembership,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (!isActiveMember(membership)) return deny('not_a_member');
  return allow('member');
}

/**
 * May the actor read the messages?
 *
 * Identical to `canViewConversation` today, and kept separate for the same
 * reason the group gates are: they are different questions, and a future
 * conversation that is listed before it is joined — an invitation to a group
 * chat — will answer them differently.
 */
export function canReadConversation(
  actor: MaybeActor,
  conversation: ConversationRef,
  membership: MaybeConversationMembership,
): Decision {
  return canViewConversation(actor, conversation, membership);
}

/**
 * May the actor send into it?
 *
 * `counterparty` is the other participant of a direct conversation, when the
 * caller has resolved it. Passing it is what lets a block sever an existing
 * thread rather than merely prevent a new one — the conversation row itself does
 * not carry the pair.
 */
export function canSendMessage(
  actor: MaybeActor,
  conversation: ConversationRef,
  membership: MaybeConversationMembership,
  counterparty?: Counterparty,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (!isActiveMember(membership)) return deny('not_a_member');

  if (conversation.kind === 'direct' && counterparty && isBlockedEitherWay(actor, counterparty)) {
    return deny('blocked');
  }

  return allow('member');
}

/**
 * May the actor move a read position?
 *
 * Only their own. Marking someone else's conversation read would let a sender
 * clear the recipient's unread badge, which is both a lie to the recipient and
 * a way to make a message disappear from the one surface that would have
 * surfaced it.
 */
export function canMarkRead(
  actor: MaybeActor,
  conversation: ConversationRef,
  membership: MaybeConversationMembership,
  targetUserId: string,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  const view = canViewConversation(actor, conversation, membership);
  if (!view.allowed) return view;
  if (targetUserId !== actor.userId) return deny('not_own_membership');
  return allow('own_membership');
}

/** Only the sender edits. A moderator removes a message; they never rewrite it. */
export function canEditMessage(actor: MaybeActor, message: MessageRef): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (message.deletedAt !== null) return deny('message_deleted');
  if (message.senderId !== actor.userId) return deny('not_sender');
  return allow('sender');
}

/**
 * Deletion is broader than editing: the sender, or a moderator of the
 * conversation.
 *
 * Note what is absent — the platform admin. See the file comment.
 */
export function canDeleteMessage(
  actor: MaybeActor,
  message: MessageRef,
  membership: MaybeConversationMembership,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (message.deletedAt !== null) return deny('message_deleted');
  if (!isActiveMember(membership)) return deny('not_a_member');
  if (message.senderId === actor.userId) return allow('sender');
  if (MODERATE_ROLES.includes(membership!.role)) return allow(`conversation_${membership!.role}`);
  return deny('not_permitted');
}

export interface DirectRecipient {
  userId: string;
  /**
   * Whether this user's privacy settings admit a message from this actor.
   *
   * Resolved by the caller from `privacy_settings.message_privacy`, because the
   * answer depends on a relationship (following, same cohort) that the policy
   * layer is given rather than looks up.
   */
  allowsMessages: boolean;
}

export function canStartDirectConversation(
  actor: MaybeActor,
  recipient: DirectRecipient,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (recipient.userId === actor.userId) return deny('self');
  if (isBlockedEitherWay(actor, recipient.userId)) return deny('blocked');
  if (!recipient.allowsMessages) return deny('recipient_does_not_accept_messages');
  return allow('permitted');
}

/**
 * Every gate for one conversation, resolved together.
 *
 * Separate Decisions, not one boolean — the same discipline as
 * `groupCapabilities`, for the same reason: the client renders these and does
 * not re-derive them, and a composer that is hidden rather than inert is only
 * possible if "may read" and "may send" are distinguishable.
 */
export interface ConversationCapabilities {
  canView: Decision;
  canRead: Decision;
  canSend: Decision;
  canMarkRead: Decision;
}

export function conversationCapabilities(
  actor: MaybeActor,
  conversation: ConversationRef,
  membership: MaybeConversationMembership,
  counterparty?: Counterparty,
): ConversationCapabilities {
  return {
    canView: canViewConversation(actor, conversation, membership),
    canRead: canReadConversation(actor, conversation, membership),
    canSend: canSendMessage(actor, conversation, membership, counterparty),
    // The actor's own id, so the aggregate answers "may I mark this read?"
    // rather than the meaningless "may I mark someone's read?".
    canMarkRead: canMarkRead(actor, conversation, membership, actor?.userId ?? ''),
  };
}
