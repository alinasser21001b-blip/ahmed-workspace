import { createHash } from 'node:crypto';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Account deletion persistence (App Review Guideline 5.1.1(v)).
 *
 * The schema already says what happens to most of a person's data: there are 64
 * foreign keys to `users(id)`, 39 of them `ON DELETE CASCADE` and 25
 * `ON DELETE SET NULL`, so `DELETE FROM users` removes their posts, comments,
 * reactions, bookmarks, memberships, messages receipts, learning record,
 * sessions, push tokens and profile, and anonymises the rows that must outlive
 * them for someone else's sake — an audit entry, a report they filed, a
 * correction they proposed to another student's note.
 *
 * What the schema does NOT do on its own is the three things below, and each is
 * a place where a plain `DELETE` would leave something wrong behind:
 *
 *   1. `messages.sender_id` is SET NULL, so a message SURVIVES the sender with
 *      its body intact. Conversation integrity needs the row — deleting it
 *      would silently rewrite the other person's history and renumber the
 *      thread — but the words are personal data. So the row becomes a tombstone.
 *   2. `files.owner_id` is CASCADE, so the row goes and the OBJECT stays. A
 *      database delete that leaves the bytes in the bucket is not a deletion.
 *   3. `groups.created_by` and `classrooms.instructor_id` are SET NULL, and
 *      `group_members` cascades — so deleting a sole owner leaves a container
 *      alive with nobody able to administer it.
 */

export interface DeletionInventory {
  files: { id: string; storage_key: string; bucket: string }[];
  ownedGroups: { id: string; successor_id: string | null }[];
  ownedCommunities: { id: string; successor_id: string | null }[];
  ownedClassrooms: { id: string; successor_id: string | null }[];
}

/**
 * Everything that needs handling before the row goes.
 *
 * Read inside the deletion transaction, so a group whose last other member
 * leaves concurrently cannot cause the successor chosen here to be gone by the
 * time it is promoted.
 */
export async function takeInventory(userId: string, client: Sql): Promise<DeletionInventory> {
  const files = await queryRows<{ id: string; storage_key: string; bucket: string }>(
    `SELECT id, storage_key, bucket FROM files WHERE owner_id = $1`,
    [userId],
    client,
  );

  /*
   * The successor rule, and it is the product's existing rule rather than a new
   * one: seniority by role then by how long they have been there
   * (`classroom_members_roster_idx` orders exactly this way). Where there is no
   * successor the container is archived, which is what `performLeave` in
   * groups.service already does when a sole owner walks out.
   */
  const ownedGroups = await queryRows<{ id: string; successor_id: string | null }>(
    `SELECT g.id,
            (SELECT m2.user_id FROM group_members m2
              WHERE m2.group_id = g.id AND m2.user_id <> $1 AND m2.status = 'active'
              ORDER BY CASE m2.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                       m2.joined_at
              LIMIT 1) AS successor_id
     FROM groups g
     JOIN group_members m ON m.group_id = g.id AND m.user_id = $1
     WHERE m.role = 'owner' AND m.status = 'active' AND g.archived_at IS NULL`,
    [userId],
    client,
  );

  const ownedCommunities = await queryRows<{ id: string; successor_id: string | null }>(
    `SELECT c.id,
            (SELECT m2.user_id FROM community_members m2
              WHERE m2.community_id = c.id AND m2.user_id <> $1 AND m2.status = 'active'
              ORDER BY CASE m2.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                       m2.joined_at
              LIMIT 1) AS successor_id
     FROM communities c
     JOIN community_members m ON m.community_id = c.id AND m.user_id = $1
     WHERE m.role = 'owner' AND m.status = 'active' AND c.archived_at IS NULL`,
    [userId],
    client,
  );

  const ownedClassrooms = await queryRows<{ id: string; successor_id: string | null }>(
    `SELECT k.id,
            (SELECT m2.user_id FROM classroom_members m2
              WHERE m2.classroom_id = k.id AND m2.user_id <> $1 AND m2.status = 'active'
              ORDER BY CASE m2.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                       m2.joined_at
              LIMIT 1) AS successor_id
     FROM classrooms k
     LEFT JOIN classroom_members m ON m.classroom_id = k.id AND m.user_id = $1
     WHERE NOT k.is_archived
       AND (k.instructor_id = $1 OR (m.role = 'owner' AND m.status = 'active'))`,
    [userId],
    client,
  );

  return { files, ownedGroups, ownedCommunities, ownedClassrooms };
}

/**
 * Turns every message the user sent into a tombstone.
 *
 * The row survives — `seq` is a gapless per-conversation counter and removing
 * one would renumber the other person's thread — and everything personal in it
 * does not: body, attachments, edit history, metadata. `deleted_at` is the
 * column the read path already honours, so both clients render the same
 * "message deleted" placeholder they render for any deleted message, with no
 * new client work and no new state to explain.
 *
 * `sender_id` is left to the foreign key, which nulls it when the user row
 * goes. Doing it here as well would be a second implementation of a rule the
 * schema already states.
 */
export async function tombstoneMessages(userId: string, client: Sql): Promise<number> {
  const rows = await queryRows<{ id: string }>(
    `UPDATE messages
     SET body = NULL, metadata = '{}'::jsonb, edited_at = NULL, deleted_at = COALESCE(deleted_at, now())
     WHERE sender_id = $1
     RETURNING id`,
    [userId],
    client,
  );

  if (rows.length > 0) {
    await queryOne(
      `DELETE FROM message_attachments WHERE message_id = ANY($1::uuid[]) RETURNING message_id`,
      [rows.map((r) => r.id)],
      client,
    );
  }
  return rows.length;
}

/** Promotes the chosen successor, or archives the container when there is none. */
export async function resolveGroupOwnership(
  input: { groupId: string; successorId: string | null },
  client: Sql,
): Promise<'transferred' | 'archived'> {
  if (input.successorId) {
    await queryOne(
      `UPDATE group_members SET role = 'owner'
       WHERE group_id = $1 AND user_id = $2 RETURNING user_id`,
      [input.groupId, input.successorId],
      client,
    );
    return 'transferred';
  }
  await queryOne(
    `UPDATE groups SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`,
    [input.groupId],
    client,
  );
  return 'archived';
}

export async function resolveCommunityOwnership(
  input: { communityId: string; successorId: string | null },
  client: Sql,
): Promise<'transferred' | 'archived'> {
  if (input.successorId) {
    await queryOne(
      `UPDATE community_members SET role = 'owner'
       WHERE community_id = $1 AND user_id = $2 RETURNING user_id`,
      [input.communityId, input.successorId],
      client,
    );
    return 'transferred';
  }
  await queryOne(
    `UPDATE communities SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id`,
    [input.communityId],
    client,
  );
  return 'archived';
}

/**
 * A classroom is different from a group: teaching it requires global instructor
 * verification, so the successor must actually be allowed to teach. Promoting an
 * unverified student to owner would create a room whose owner cannot publish
 * into it — the exact stranded state this step exists to prevent.
 */
export async function resolveClassroomOwnership(
  input: { classroomId: string; successorId: string | null },
  client: Sql,
): Promise<'transferred' | 'archived'> {
  if (input.successorId) {
    const eligible = await queryOne<{ id: string }>(
      `SELECT id FROM users
       WHERE id = $1 AND verification_level IN ('instructor', 'official') AND deleted_at IS NULL`,
      [input.successorId],
      client,
    );
    if (eligible) {
      await queryOne(
        `UPDATE classroom_members SET role = 'owner'
         WHERE classroom_id = $1 AND user_id = $2 RETURNING user_id`,
        [input.classroomId, input.successorId],
        client,
      );
      await queryOne(
        `UPDATE classrooms SET instructor_id = $2 WHERE id = $1 RETURNING id`,
        [input.classroomId, input.successorId],
        client,
      );
      return 'transferred';
    }
  }
  await queryOne(
    `UPDATE classrooms SET is_archived = true WHERE id = $1 AND NOT is_archived RETURNING id`,
    [input.classroomId],
    client,
  );
  return 'archived';
}

/** Revoked explicitly, before the cascade, so a concurrent request fails now. */
export async function revokeAllSessions(userId: string, client: Sql): Promise<number> {
  const rows = await queryRows<{ id: string }>(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
    [userId],
    client,
  );
  return rows.length;
}

/** Unregistered explicitly so a push cannot be addressed to a deleted account. */
export async function removePushTokens(userId: string, client: Sql): Promise<number> {
  const rows = await queryRows<{ id: string }>(
    `DELETE FROM push_tokens WHERE user_id = $1 RETURNING id`,
    [userId],
    client,
  );
  return rows.length;
}

/** The row itself. Everything else follows from the foreign keys. */
export async function deleteUserRow(userId: string, client: Sql): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `DELETE FROM users WHERE id = $1 RETURNING id`,
    [userId],
    client,
  );
  return row !== null;
}

/**
 * Opens the receipt.
 *
 * `user_ref` is sha256(user_id || receipt_id): not reversible, not scannable
 * for a known user id (the receipt id salts it), and still verifiable by
 * someone who holds both. It is created BEFORE the deletion because after it
 * there is no user id left to hash.
 */
export async function openReceipt(userId: string, client: Sql): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO account_deletions (user_ref) VALUES ('pending') RETURNING id`,
    [],
    client,
  );
  const receiptId = row!.id;
  const ref = createHash('sha256').update(`${userId}:${receiptId}`).digest('hex');
  await queryOne(`UPDATE account_deletions SET user_ref = $2 WHERE id = $1 RETURNING id`, [
    receiptId,
    ref,
  ], client);
  return receiptId;
}

export async function closeReceipt(
  input: { receiptId: string; removed: Record<string, number | string[]> },
  client: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE account_deletions SET completed_at = now(), removed = $2::jsonb WHERE id = $1 RETURNING id`,
    [input.receiptId, JSON.stringify(input.removed)],
    client,
  );
}

/** Records objects the bucket refused to give up, so a sweep can retry them. */
export async function recordOrphanedObjects(
  input: { receiptId: string; keys: string[] },
  client?: Sql,
): Promise<void> {
  if (input.keys.length === 0) return;
  await queryOne(
    `UPDATE account_deletions SET orphaned_object_keys = $2::text[] WHERE id = $1 RETURNING id`,
    [input.receiptId, input.keys],
    client,
  );
}

export interface BlockedProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  created_at: Date;
}

/**
 * Who this user has blocked, most recent first.
 *
 * A LEFT JOIN on profiles rather than an inner one: an account blocked before
 * it finished onboarding has no profile row, and dropping it from the list
 * would leave a block the user cannot see and therefore cannot lift.
 */
export async function listBlockedProfiles(
  blockerId: string,
  client?: Sql,
): Promise<BlockedProfileRow[]> {
  return queryRows<BlockedProfileRow>(
    `SELECT b.blocked_id AS user_id,
            COALESCE(p.handle, '') AS handle,
            COALESCE(p.display_name, '') AS display_name,
            p.avatar_url,
            u.verification_level,
            b.created_at
     FROM blocks b
     JOIN users u ON u.id = b.blocked_id
     LEFT JOIN profiles p ON p.user_id = b.blocked_id
     WHERE b.blocker_id = $1
     ORDER BY b.created_at DESC
     LIMIT 200`,
    [blockerId],
    client,
  );
}
