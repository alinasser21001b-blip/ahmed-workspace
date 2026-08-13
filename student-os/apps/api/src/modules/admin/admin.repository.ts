import type { VerificationLevel } from '@sos/contracts';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Admin V0 persistence.
 *
 * Two tables, both of which already existed: `users.verification_level` is the
 * fact, and `audit_log` is the record of changing it. No table was added for
 * this phase. `audit_log` has been described since migration 0006 as the
 * "append-only record of privileged actions ... covers every admin mutation",
 * which is exactly what a verification change is — giving it a private log
 * would mean "what have administrators done" could only be answered by a union
 * over parallel tables, and one of them would eventually be forgotten.
 */

/** The single action name, so the writer and the reader cannot drift apart. */
export const VERIFICATION_ACTION = 'user.verification_level.set';

export interface AdminUserRow {
  user_id: string;
  email: string;
  handle: string | null;
  display_name: string | null;
  role: 'student' | 'instructor' | 'admin';
  verification_level: VerificationLevel;
  status: string;
  created_at: Date;
}

const ADMIN_USER_SELECT = `
  SELECT u.id AS user_id,
         u.email,
         p.handle,
         p.display_name,
         u.role,
         u.verification_level,
         u.status,
         u.created_at
  FROM users u
  LEFT JOIN profiles p ON p.user_id = u.id`;

export async function findUser(userId: string, client?: Sql): Promise<AdminUserRow | null> {
  return queryOne<AdminUserRow>(
    `${ADMIN_USER_SELECT} WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
    client,
  );
}

/**
 * Finds candidates by handle, display name or email.
 *
 * Deliberately a plain prefix/substring match rather than the ranked search
 * the product uses for people: an administrator looking up an account knows
 * the identifier, and relevance ordering would only make it harder to be sure
 * the right row was picked before changing someone's standing.
 */
export async function searchUsers(query: string, limit: number): Promise<AdminUserRow[]> {
  return queryRows<AdminUserRow>(
    `${ADMIN_USER_SELECT}
     WHERE u.deleted_at IS NULL
       AND (p.handle ILIKE $1 OR p.display_name ILIKE $1 OR u.email ILIKE $1)
     ORDER BY u.created_at DESC
     LIMIT $2`,
    [`%${query}%`, limit],
  );
}

/**
 * Sets the level and returns the row as it now stands.
 *
 * Takes the transaction so the write and its audit entry commit together. An
 * audit log that can lag behind the fact it describes is worse than none: it
 * would be trusted and wrong.
 */
export async function updateVerificationLevel(
  userId: string,
  level: VerificationLevel,
  client: Sql,
): Promise<AdminUserRow | null> {
  await queryOne(
    `UPDATE users SET verification_level = $2::verification_level, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [userId, level],
    client,
  );
  return findUser(userId, client);
}

export interface AuditEntryInput {
  actorId: string;
  action: string;
  targetKind: string;
  targetId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  requestId: string | null;
}

export async function insertAuditEntry(input: AuditEntryInput, client: Sql): Promise<void> {
  await queryOne(
    `INSERT INTO audit_log (actor_id, action, target_kind, target_id, before, after, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     RETURNING id`,
    [
      input.actorId,
      input.action,
      input.targetKind,
      input.targetId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.requestId,
    ],
    client,
  );
}

export interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_handle: string | null;
  actor_display_name: string | null;
  target_id: string;
  before_level: VerificationLevel | null;
  after_level: VerificationLevel | null;
  reason: string | null;
  created_at: Date;
}

/** The verification history of one account, newest first. */
export async function listVerificationAudit(
  targetUserId: string,
  limit: number,
): Promise<AuditRow[]> {
  return queryRows<AuditRow>(
    `SELECT a.id::text AS id,
            a.actor_id,
            p.handle       AS actor_handle,
            p.display_name AS actor_display_name,
            a.target_id,
            a.before->>'verificationLevel' AS before_level,
            a.after->>'verificationLevel'  AS after_level,
            a.after->>'reason'             AS reason,
            a.created_at
     FROM audit_log a
     LEFT JOIN profiles p ON p.user_id = a.actor_id
     WHERE a.action = $1 AND a.target_kind = 'user' AND a.target_id = $2
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $3`,
    [VERIFICATION_ACTION, targetUserId, limit],
  );
}
