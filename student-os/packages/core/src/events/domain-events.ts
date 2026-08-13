/**
 * Domain events.
 *
 * The problem this exists to prevent: notifications, realtime delivery, the
 * activity feed and analytics each need to know that something happened, and if
 * each is wired directly into the service that made it happen, the fourth one
 * is written as a second architecture beside the first three.
 *
 * So there is one event vocabulary and one delivery mechanism — a transactional
 * outbox. A service that changes state appends an event **inside the same
 * transaction**; a relay drains the table afterwards. That ordering is the
 * entire point:
 *
 *   - An event can never describe a write that rolled back.
 *   - A write can never succeed while its event is silently lost.
 *
 * The alternative — publishing after commit, or to a broker in-line — gives up
 * one of those two, and it is never obvious which until something is missing in
 * production.
 *
 * Phase 3 defines the vocabulary and the outbox and produces membership events.
 * Phase 4 adds `message.created`, `message.read` and `conversation.created` as
 * three more entries in the same union, drained by the same relay, delivered
 * over the realtime transport. Nothing about that is a new architecture.
 */

/**
 * Every event the product can emit, including ones nothing consumes yet.
 *
 * Listing an unconsumed event is deliberate: it makes the shape of the next
 * phase visible, and it makes "who reacts to this?" a question with a written
 * answer rather than a search.
 */
export type DomainEventKind =
  // membership — produced in Phase 3
  | 'group.membership.requested'
  | 'group.membership.approved'
  | 'group.membership.rejected'
  | 'group.membership.invited'
  | 'group.membership.removed'
  | 'group.ownership.transferred'
  // content — produced in Phase 3
  | 'group.content.created'
  | 'content.comment.created'
  | 'content.reply.created'
  | 'content.mention.created'
  // knowledge — produced in Phase 5
  | 'content.correction.proposed'
  | 'content.correction.accepted'
  | 'content.correction.rejected'
  // messaging — Phase 4, contracted here so it extends this union
  | 'conversation.created'
  | 'message.created'
  | 'message.read';

/**
 * An event, as it is stored.
 *
 * `actorId` is who caused it. `subjectId` is who it is *about* — usually the
 * person who will be notified — and is null for events with a broadcast
 * audience that the consumer resolves (a new group post notifies the members,
 * and the event does not enumerate them, because a 200-member group would
 * otherwise write 200 rows inside the poster's transaction).
 */
export interface DomainEvent<K extends DomainEventKind = DomainEventKind> {
  id: string;
  kind: K;
  /** Who did it. Null for system-originated events. */
  actorId: string | null;
  /** Who it concerns, when that is a single person. */
  subjectId: string | null;
  /** What it happened to: a group id, a content id, a conversation id. */
  targetType: DomainEventTargetType;
  targetId: string;
  /** Kind-specific detail. Small, and never a substitute for reading the row. */
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}

export type DomainEventTargetType =
  | 'group'
  | 'community'
  | 'content'
  | 'comment'
  | 'conversation'
  | 'message'
  | 'user';

/** The insert shape. The id and timestamp are the database's to assign. */
export type NewDomainEvent = Omit<DomainEvent, 'id' | 'occurredAt'>;

/**
 * Which events become a notification, and how they collapse.
 *
 * `dedupeWindowMs` folds a burst into one notification: forty likes on one post
 * is one line in the tray, not forty. `groupBy` names the field the fold keys
 * on. An event absent from this map is one that is recorded and not notified —
 * which is a decision, and is why the map is exhaustive over the union rather
 * than a lookup with a default.
 */
export interface NotificationRule {
  /** Whether this event produces a notification at all. */
  notifies: boolean;
  /** Collapse events sharing this payload/target field within the window. */
  groupBy?: 'targetId';
  dedupeWindowMs?: number;
}

export const NOTIFICATION_RULES: Readonly<Record<DomainEventKind, NotificationRule>> = {
  'group.membership.requested': { notifies: true, groupBy: 'targetId', dedupeWindowMs: 0 },
  'group.membership.approved': { notifies: true },
  'group.membership.rejected': { notifies: true },
  'group.membership.invited': { notifies: true },
  // A removal is deliberately silent to the removed member: telling someone
  // they were ejected from a group they cannot see turns a quiet moderation
  // action into a confrontation. The audit log records it.
  'group.membership.removed': { notifies: false },
  'group.ownership.transferred': { notifies: true },

  'group.content.created': { notifies: true, groupBy: 'targetId', dedupeWindowMs: 3_600_000 },
  'content.comment.created': { notifies: true, groupBy: 'targetId', dedupeWindowMs: 900_000 },
  'content.reply.created': { notifies: true, groupBy: 'targetId', dedupeWindowMs: 900_000 },
  'content.mention.created': { notifies: true },

  // A challenge to your work is worth knowing about immediately, and there is
  // no burst to collapse: one person proposes one correction at a time.
  'content.correction.proposed': { notifies: true },
  'content.correction.accepted': { notifies: true },
  // A rejection is deliberately quiet. The proposer can see the status on the
  // content; a push notification saying "you were wrong" is not a thing this
  // product should send.
  'content.correction.rejected': { notifies: false },

  'conversation.created': { notifies: false },
  'message.created': { notifies: true, groupBy: 'targetId', dedupeWindowMs: 300_000 },
  // A read receipt moves a tick in the UI. It is never a notification.
  'message.read': { notifies: false },
};

export function notifies(kind: DomainEventKind): boolean {
  return NOTIFICATION_RULES[kind].notifies;
}

/**
 * Whether a new event should fold into an existing notification.
 *
 * Pure, so the collapsing rule is unit-testable without a database — the same
 * reason the rest of `@sos/core` is pure.
 */
export function shouldCollapse(
  kind: DomainEventKind,
  previousAt: Date | null,
  nextAt: Date,
): boolean {
  const rule = NOTIFICATION_RULES[kind];
  if (!rule.notifies || previousAt === null) return false;
  const window = rule.dedupeWindowMs ?? 0;
  if (window <= 0) return false;
  return nextAt.getTime() - previousAt.getTime() < window;
}

/**
 * Who, if anyone, must not be notified.
 *
 * An actor is never notified of their own action. This is the single most
 * common notification bug and it belongs in one function rather than in every
 * consumer.
 */
export function notificationRecipient(event: NewDomainEvent): string | null {
  if (!notifies(event.kind)) return null;
  if (event.subjectId === null) return null;
  if (event.subjectId === event.actorId) return null;
  return event.subjectId;
}
