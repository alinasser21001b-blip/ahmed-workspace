import { queryOne, type Sql } from '../../platform/db.js';

/**
 * Presence.
 *
 * One row per user, not one per connection and not one per heartbeat. The row
 * carries a connection count, so "is any device of theirs online?" is answered
 * without a write every fifteen seconds per device — which, for a hundred
 * students on three devices each, would be twenty writes a second to say that
 * nothing changed.
 *
 * The count is incremented on connect and decremented on disconnect, clamped at
 * zero so a missed close event degrades to "appears online slightly too long"
 * rather than to a negative counter that never recovers.
 *
 * Presence is deliberately not a source of truth for anything. It decorates a
 * profile and a chat header; no authorization decision reads it.
 */

export async function connect(userId: string, client?: Sql): Promise<void> {
  await queryOne(
    `INSERT INTO user_presence (user_id, status, last_seen_at, connection_count)
     VALUES ($1, 'online', now(), 1)
     ON CONFLICT (user_id) DO UPDATE SET
       status = 'online',
       last_seen_at = now(),
       connection_count = user_presence.connection_count + 1`,
    [userId],
    client,
  );
}

export async function disconnect(userId: string, client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE user_presence SET
       connection_count = GREATEST(0, connection_count - 1),
       status = CASE WHEN GREATEST(0, connection_count - 1) = 0 THEN 'offline' ELSE status END,
       last_seen_at = now()
     WHERE user_id = $1`,
    [userId],
    client,
  );
}

export interface PresenceRow {
  status: 'online' | 'away' | 'offline';
  last_seen_at: Date;
}

export async function find(userId: string, client?: Sql): Promise<PresenceRow | null> {
  return queryOne<PresenceRow>(
    `SELECT status, last_seen_at FROM user_presence WHERE user_id = $1`,
    [userId],
    client,
  );
}

/**
 * Resets every connection count.
 *
 * Called at startup: a process that died with sockets open left counts above
 * zero and users permanently "online". Without this the only cure is a manual
 * UPDATE, and the symptom is a presence dot that is subtly wrong forever.
 */
export async function resetAllConnections(client?: Sql): Promise<void> {
  await queryOne(
    `UPDATE user_presence SET connection_count = 0, status = 'offline'
     WHERE connection_count > 0 OR status <> 'offline'`,
    [],
    client,
  );
}
