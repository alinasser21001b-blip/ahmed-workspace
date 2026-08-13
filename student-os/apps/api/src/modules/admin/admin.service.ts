import type {
  AdminUserSearchQuery,
  AdminUserSummary,
  SetVerificationRequest,
  VerificationAuditEntry,
} from '@sos/contracts';
import { canSetVerificationLevel, isTeachingLevel, type Actor } from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import * as repo from './admin.repository.js';

/**
 * Admin V0 — granting and revoking academic authority.
 *
 * Every function here begins with the same gate, and it is the policy layer's
 * gate rather than a role comparison written out again: `canSetVerificationLevel`
 * is the one place that decides who may do this, so a second endpoint added
 * later cannot accidentally decide it differently.
 *
 * The gate returns **403, not 404**. The 404-for-invisible-resources rule
 * exists to avoid confirming that a *resource* exists to someone who cannot see
 * it; here the resource is the administrative surface itself, whose existence
 * is not a secret, and a silent 404 would make a misconfigured operator account
 * indistinguishable from a broken deployment.
 */

function assertMayAdminister(actor: Actor): void {
  const decision = canSetVerificationLevel(actor);
  if (!decision.allowed) throw errors.forbidden(decision.reason);
}

function toSummary(row: repo.AdminUserRow): AdminUserSummary {
  return {
    userId: row.user_id,
    email: row.email,
    handle: row.handle,
    displayName: row.display_name,
    role: row.role,
    verificationLevel: row.verification_level,
    // Projected from the same predicate the classroom gates use, so the console
    // can never show "eligible" for a level the rest of the system refuses.
    teachingEligible: isTeachingLevel(row.verification_level),
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export async function searchUsers(
  actor: Actor,
  query: AdminUserSearchQuery,
): Promise<{ items: AdminUserSummary[] }> {
  assertMayAdminister(actor);
  const rows = await repo.searchUsers(query.query, query.limit);
  return { items: rows.map(toSummary) };
}

export async function getUser(actor: Actor, userId: string): Promise<AdminUserSummary> {
  assertMayAdminister(actor);
  const row = await repo.findUser(userId);
  if (!row) throw errors.notFound('user');
  return toSummary(row);
}

/**
 * Sets a user's global academic eligibility.
 *
 * Grant and revoke are the same operation with different arguments, which is
 * why there is one endpoint rather than two: a revoke path written separately
 * would eventually forget to audit, or would audit a different shape, and the
 * history would only be readable if you knew which of the two wrote each row.
 *
 * The write and its audit entry share a transaction. An audit log that can lag
 * behind the fact it describes is worse than no audit log, because it is
 * trusted.
 *
 * Note what this deliberately does NOT do: it does not touch classroom
 * membership. Revoking instructor verification stops someone publishing
 * immediately — `canTeachInClassroom` consults the level on the next request,
 * hydrated fresh per request, with no cache to invalidate — while leaving them
 * the owner of any room they hold, so the room can be transferred or archived
 * rather than stranded. Losing a credential and losing a classroom are
 * different events, and the product only asked for the first.
 */
export async function setVerificationLevel(
  actor: Actor,
  targetUserId: string,
  body: SetVerificationRequest,
  requestId: string | null,
): Promise<AdminUserSummary> {
  assertMayAdminister(actor);

  const existing = await repo.findUser(targetUserId);
  if (!existing) throw errors.notFound('user');

  const updated = await withTransaction(async (tx) => {
    const row = await repo.updateVerificationLevel(targetUserId, body.verificationLevel, tx);
    if (!row) throw errors.notFound('user');
    await repo.insertAuditEntry(
      {
        actorId: actor.userId,
        action: repo.VERIFICATION_ACTION,
        targetKind: 'user',
        targetId: targetUserId,
        before: { verificationLevel: existing.verification_level },
        /*
         * `reason` rides in the after-image rather than in a column of its own.
         * `audit_log` has no `reason`, and adding one would be a migration that
         * every other future action would then have to decide whether to use.
         * The justification is part of what the administrator asserted when
         * they made the change, so it is recorded with the state they asserted.
         */
        after: { verificationLevel: body.verificationLevel, reason: body.reason },
        requestId,
      },
      tx,
    );
    return row;
  });

  return toSummary(updated);
}

export async function listVerificationHistory(
  actor: Actor,
  targetUserId: string,
): Promise<{ items: VerificationAuditEntry[] }> {
  assertMayAdminister(actor);
  const rows = await repo.listVerificationAudit(targetUserId, 50);
  return {
    items: rows.map((row) => ({
      id: row.id,
      actor: row.actor_id
        ? {
            userId: row.actor_id,
            handle: row.actor_handle,
            displayName: row.actor_display_name,
          }
        : null,
      targetUserId: row.target_id,
      before: row.before_level,
      after: row.after_level,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
    })),
  };
}
