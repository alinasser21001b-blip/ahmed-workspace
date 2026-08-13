import type { RealtimeServerFrame } from '@sos/contracts';

/**
 * The realtime fan-out registry.
 *
 * What this is: an in-process map from user id to open sockets, and a `publish`
 * that writes a frame to every socket a set of users has open.
 *
 * What this is NOT, deliberately:
 *
 *  - **A command channel.** Nothing arrives here and becomes a database write.
 *    Sending is `POST /conversations/:id/messages`; the socket announces what
 *    was committed. The inverse — client → socket → hope it persisted — loses
 *    messages whenever a process dies between the ack and the write, and the
 *    loss is invisible to both ends.
 *
 *  - **A source of truth.** A client that misses frames is not broken; it
 *    reconnects and asks for the gap by seq. Every frame is therefore an
 *    optimisation over polling, never the only delivery path. That property is
 *    what makes a dropped socket a latency problem rather than a data-loss one.
 *
 *  - **A message broker.** One process, one map. At cohort scale that is
 *    correct and it is not close. When a second process is needed, this file
 *    grows a Postgres `LISTEN/NOTIFY` bridge behind the same `publish`
 *    signature — the callers do not change, because they only ever knew
 *    `publish(userIds, frame)`.
 *
 * Authorization is not performed here. Sockets are added to a conversation's
 * audience only after `canSubscribe` — the same policy the REST read uses — has
 * admitted them, and every publish addresses a member list the caller resolved
 * from the database. There is no path by which a subscription grants access the
 * REST API would refuse.
 */

export interface RealtimeSocket {
  send: (data: string) => void;
  readonly closed: boolean;
}

interface Connection {
  userId: string;
  socket: RealtimeSocket;
  /** Conversations this connection is subscribed to. */
  subscriptions: Set<string>;
}

/** userId → their open connections. A student has several: phone, laptop, tab. */
const connections = new Map<string, Set<Connection>>();

export function register(userId: string, socket: RealtimeSocket): Connection {
  const connection: Connection = { userId, socket, subscriptions: new Set() };
  const existing = connections.get(userId);
  if (existing) existing.add(connection);
  else connections.set(userId, new Set([connection]));
  return connection;
}

export function unregister(connection: Connection): void {
  const set = connections.get(connection.userId);
  if (!set) return;
  set.delete(connection);
  if (set.size === 0) connections.delete(connection.userId);
}

export function subscribe(connection: Connection, conversationId: string): void {
  connection.subscriptions.add(conversationId);
}

export function unsubscribe(connection: Connection, conversationId: string): void {
  connection.subscriptions.delete(conversationId);
}

/** How many connections a user has open. Presence is derived from this. */
export function connectionCount(userId: string): number {
  return connections.get(userId)?.size ?? 0;
}

/**
 * Sends a frame to every connection these users have open.
 *
 * Never throws. A socket that fails to write is a socket that is gone, and the
 * caller — which has already committed a database transaction — must not have
 * its outcome changed by a dead client. The client will reconnect and resync.
 */
export function publish(userIds: readonly string[], frame: RealtimeServerFrame): void {
  const payload = JSON.stringify(frame);
  for (const userId of userIds) {
    const set = connections.get(userId);
    if (!set) continue;
    for (const connection of set) {
      if (connection.socket.closed) continue;
      try {
        connection.socket.send(payload);
      } catch {
        /* the socket is gone; the reconnect will resync by seq */
      }
    }
  }
}

/**
 * Sends to the subset of a conversation's members who are actually watching it.
 *
 * Used for ephemeral frames — typing, above all. A typing indicator for a
 * conversation nobody has open is a wasted write to every device that person
 * owns, several times a second.
 */
export function publishToWatchers(
  userIds: readonly string[],
  conversationId: string,
  frame: RealtimeServerFrame,
): void {
  const payload = JSON.stringify(frame);
  for (const userId of userIds) {
    const set = connections.get(userId);
    if (!set) continue;
    for (const connection of set) {
      if (connection.socket.closed) continue;
      if (!connection.subscriptions.has(conversationId)) continue;
      try {
        connection.socket.send(payload);
      } catch {
        /* gone */
      }
    }
  }
}

/** Test seam: the registry is process-global, and tests must not leak into each other. */
export function resetRegistry(): void {
  connections.clear();
}

export type { Connection };
