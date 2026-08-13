import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_RULES,
  notificationRecipient,
  notifies,
  shouldCollapse,
  type DomainEventKind,
  type NewDomainEvent,
} from '../domain-events.js';

const ALL_KINDS: DomainEventKind[] = [
  'group.membership.requested',
  'group.membership.approved',
  'group.membership.rejected',
  'group.membership.invited',
  'group.membership.removed',
  'group.ownership.transferred',
  'group.content.created',
  'content.comment.created',
  'content.reply.created',
  'content.mention.created',
  'conversation.created',
  'message.created',
  'message.read',
];

function event(overrides: Partial<NewDomainEvent> = {}): NewDomainEvent {
  return {
    kind: 'group.membership.approved',
    actorId: 'moderator',
    subjectId: 'applicant',
    targetType: 'group',
    targetId: 'g1',
    payload: {},
    ...overrides,
  };
}

describe('the notification rule table', () => {
  /*
   * Exhaustive rather than defaulted, on purpose. A new event kind with no
   * entry should be a decision someone made, not a silent "does not notify"
   * that nobody notices until a user asks why they were never told.
   */
  it('has an entry for every event kind', () => {
    for (const kind of ALL_KINDS) {
      expect(NOTIFICATION_RULES[kind], kind).toBeDefined();
    }
    expect(Object.keys(NOTIFICATION_RULES).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('keeps read receipts and conversation creation silent', () => {
    expect(notifies('message.read')).toBe(false);
    expect(notifies('conversation.created')).toBe(false);
  });

  it('keeps removal silent to the removed member', () => {
    // Telling someone they were ejected from a group they can no longer see
    // turns a quiet moderation action into a confrontation.
    expect(notifies('group.membership.removed')).toBe(false);
  });
});

describe('notificationRecipient', () => {
  it('never notifies an actor of their own action', () => {
    expect(notificationRecipient(event({ actorId: 'x', subjectId: 'x' }))).toBeNull();
  });

  it('returns the subject for an event that notifies', () => {
    expect(notificationRecipient(event())).toBe('applicant');
  });

  it('returns nobody for a broadcast event, which the consumer resolves', () => {
    expect(notificationRecipient(event({ kind: 'group.membership.requested', subjectId: null })))
      .toBeNull();
  });

  it('returns nobody for an event that does not notify', () => {
    expect(notificationRecipient(event({ kind: 'message.read' }))).toBeNull();
  });
});

describe('shouldCollapse', () => {
  const base = new Date('2026-01-01T12:00:00Z');
  const at = (minutes: number): Date => new Date(base.getTime() + minutes * 60_000);

  it('folds a burst of comments into one notification', () => {
    expect(shouldCollapse('content.comment.created', base, at(5))).toBe(true);
    expect(shouldCollapse('content.comment.created', base, at(20))).toBe(false);
  });

  it('never collapses when there is no previous notification', () => {
    expect(shouldCollapse('content.comment.created', null, base)).toBe(false);
  });

  it('never collapses an event with a zero window', () => {
    // A join request is a queue item; two requests are two decisions.
    expect(shouldCollapse('group.membership.requested', base, at(1))).toBe(false);
  });

  it('never collapses an event that does not notify', () => {
    expect(shouldCollapse('message.read', base, at(1))).toBe(false);
  });
});
