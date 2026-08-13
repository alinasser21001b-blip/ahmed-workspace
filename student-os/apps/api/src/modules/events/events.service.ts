import type { DomainEvent, DomainEventKind, DomainEventTargetType } from '@sos/core';
import type { Sql } from '../../platform/db.js';
import * as repo from './events.repository.js';

/**
 * Emitting domain events.
 *
 * The one rule callers must follow: **pass the transaction**. An event appended
 * outside the transaction that produced it can describe a write that rolled
 * back, and an event appended after commit can be lost between the two. The
 * signature makes the client a required argument rather than an optional one so
 * that omitting it is a compile error, not a race that shows up in production.
 *
 * Nothing consumes these yet. That is deliberate and stated rather than
 * implied: Phase 3 establishes the vocabulary and the atomicity, Phase 8 adds
 * the relay and delivery, and Phase 4's messaging events go through this same
 * function. The alternative — waiting until notifications are built to decide
 * how events are produced — is how a product ends up with two of them.
 */
export async function emit(
  client: Sql,
  event: {
    kind: DomainEventKind;
    actorId: string | null;
    subjectId?: string | null;
    targetType: DomainEventTargetType;
    targetId: string;
    payload?: Record<string, unknown>;
  },
): Promise<DomainEvent> {
  return repo.append(
    {
      kind: event.kind,
      actorId: event.actorId,
      subjectId: event.subjectId ?? null,
      targetType: event.targetType,
      targetId: event.targetId,
      payload: event.payload ?? {},
    },
    client,
  );
}

export { claimPending, listForTarget, markProcessed } from './events.repository.js';
