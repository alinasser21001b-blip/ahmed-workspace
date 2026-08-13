import type { DomainEvent, DomainEventKind, NewDomainEvent } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * The domain-event outbox.
 *
 * `append` takes the caller's transaction client and is **not optional about
 * it** in practice: every producer passes the transaction that made the change.
 * That is what makes the event and the write atomic, and it is the whole reason
 * this table exists rather than a direct call into a notifier.
 */

interface EventRow {
  id: string;
  kind: DomainEventKind;
  actor_id: string | null;
  subject_id: string | null;
  target_type: DomainEvent['targetType'];
  target_id: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

function toEvent(row: EventRow): DomainEvent {
  return {
    id: row.id,
    kind: row.kind,
    actorId: row.actor_id,
    subjectId: row.subject_id,
    targetType: row.target_type,
    targetId: row.target_id,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}

export async function append(event: NewDomainEvent, client?: Sql): Promise<DomainEvent> {
  const row = await queryOne<EventRow>(
    `INSERT INTO domain_events (kind, actor_id, subject_id, target_type, target_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id::text AS id, kind, actor_id, subject_id, target_type, target_id,
               payload, occurred_at`,
    [
      event.kind,
      event.actorId,
      event.subjectId,
      event.targetType,
      event.targetId,
      JSON.stringify(event.payload),
    ],
    client,
  );
  if (!row) throw new Error('domain event insert returned no row');
  return toEvent(row);
}

/**
 * The relay's read.
 *
 * `FOR UPDATE SKIP LOCKED` so that more than one relay can drain the table
 * without two of them delivering the same event. Nothing runs a relay yet —
 * Phase 8 does — but the query that will be hot is the one worth getting right
 * while the table is empty.
 */
export async function claimPending(limit: number, client?: Sql): Promise<DomainEvent[]> {
  const rows = await queryRows<EventRow>(
    `SELECT id::text AS id, kind, actor_id, subject_id, target_type, target_id,
            payload, occurred_at
     FROM domain_events
     WHERE processed_at IS NULL
     ORDER BY occurred_at, id
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit],
    client,
  );
  return rows.map(toEvent);
}

export async function markProcessed(ids: readonly string[], client?: Sql): Promise<void> {
  if (ids.length === 0) return;
  await queryOne(
    `UPDATE domain_events SET processed_at = now() WHERE id = ANY($1::bigint[])`,
    [ids],
    client,
  );
}

/** Events about one target, newest first. Moderation and audit read this. */
export async function listForTarget(
  targetType: DomainEvent['targetType'],
  targetId: string,
  limit: number,
  client?: Sql,
): Promise<DomainEvent[]> {
  const rows = await queryRows<EventRow>(
    `SELECT id::text AS id, kind, actor_id, subject_id, target_type, target_id,
            payload, occurred_at
     FROM domain_events
     WHERE target_type = $1 AND target_id = $2
     ORDER BY occurred_at DESC, id DESC
     LIMIT $3`,
    [targetType, targetId, limit],
    client,
  );
  return rows.map(toEvent);
}
