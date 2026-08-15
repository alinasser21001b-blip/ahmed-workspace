import type { BlockedAccount } from '@sos/contracts';
import type { Actor } from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import { getLogger } from '../../platform/logger.js';
import { getStorage } from '../../platform/storage.js';
import { verifyPassword } from '../auth/password.js';
import * as authRepo from '../auth/auth.repository.js';
import * as repo from './account.repository.js';

/**
 * Account deletion (App Review Guideline 5.1.1(v): "If your app supports
 * account creation, you must also offer account deletion within the app").
 *
 * Three things this is NOT, because each is a way of appearing to comply while
 * not complying, and `0001_foundation.sql:9-11` proposed the first of them:
 *
 *   * not a soft disable — `status = 'deleted'` leaves every row in place and
 *     the person's name on their posts;
 *   * not a hidden profile — invisible is not deleted;
 *   * not "email support" — the guideline requires it inside the app.
 *
 * What it is: one transaction that ends with `DELETE FROM users`, preceded by
 * the three fixes the foreign keys cannot make for themselves (message
 * tombstones, container ownership, storage objects), and followed by a receipt
 * that proves the deletion happened without retaining who it was.
 */

/** Counts of what went, for the receipt and for the response. */
export interface DeletionSummary {
  messagesTombstoned: number;
  filesRemoved: number;
  objectsOrphaned: number;
  sessionsRevoked: number;
  pushTokensRemoved: number;
  groupsTransferred: number;
  groupsArchived: number;
  communitiesTransferred: number;
  communitiesArchived: number;
  classroomsTransferred: number;
  classroomsArchived: number;
}

/**
 * Deletes the caller's account.
 *
 * Re-authentication is required, and that is a deliberate cost. An access token
 * lifted from a shared laptop is enough to read someone's messages; it must not
 * also be enough to destroy their account irreversibly. Apple's guideline says
 * deletion must be available in-app, not that it must be one tap.
 *
 * Ordering inside the transaction is the whole design:
 *
 *   receipt → inventory → revoke sessions → tombstone messages
 *   → resolve ownership → delete the user row (64 foreign keys fire)
 *   → close the receipt
 *
 * The inventory of storage keys must be read BEFORE the delete, because
 * `files.owner_id` cascades and the rows are gone afterwards — that is exactly
 * how bytes get left in a bucket forever. The objects themselves are removed
 * after the commit: a bucket delete cannot be rolled back, so doing it inside
 * the transaction would destroy files for a deletion that then failed.
 */
export async function deleteOwnAccount(
  actor: Actor,
  input: { password: string },
): Promise<DeletionSummary> {
  const credentials = await authRepo.findUserById(actor.userId);
  if (!credentials) throw errors.unauthenticated('account_missing');

  const ok = await verifyPassword(input.password, credentials.password_hash);
  if (!ok) {
    // The same shape a wrong password gets everywhere else. A distinct error
    // here would make this endpoint a password oracle that does not rate-limit
    // like the login endpoint does.
    throw errors.unauthenticated('invalid_credentials');
  }

  const { summary, receiptId, objectKeys } = await withTransaction(async (client) => {
    const receiptId = await repo.openReceipt(actor.userId, client);
    const inventory = await repo.takeInventory(actor.userId, client);

    const sessionsRevoked = await repo.revokeAllSessions(actor.userId, client);
    const pushTokensRemoved = await repo.removePushTokens(actor.userId, client);
    const messagesTombstoned = await repo.tombstoneMessages(actor.userId, client);

    let groupsTransferred = 0;
    let groupsArchived = 0;
    for (const group of inventory.ownedGroups) {
      const outcome = await repo.resolveGroupOwnership(
        { groupId: group.id, successorId: group.successor_id },
        client,
      );
      if (outcome === 'transferred') groupsTransferred += 1;
      else groupsArchived += 1;
    }

    let communitiesTransferred = 0;
    let communitiesArchived = 0;
    for (const community of inventory.ownedCommunities) {
      const outcome = await repo.resolveCommunityOwnership(
        { communityId: community.id, successorId: community.successor_id },
        client,
      );
      if (outcome === 'transferred') communitiesTransferred += 1;
      else communitiesArchived += 1;
    }

    let classroomsTransferred = 0;
    let classroomsArchived = 0;
    for (const classroom of inventory.ownedClassrooms) {
      const outcome = await repo.resolveClassroomOwnership(
        { classroomId: classroom.id, successorId: classroom.successor_id },
        client,
      );
      if (outcome === 'transferred') classroomsTransferred += 1;
      else classroomsArchived += 1;
    }

    const deleted = await repo.deleteUserRow(actor.userId, client);
    if (!deleted) {
      // Already gone — a retry of a request that succeeded. Nothing to undo:
      // every step above is idempotent against an absent user.
      throw errors.notFound('account');
    }

    const summary: DeletionSummary = {
      messagesTombstoned,
      filesRemoved: inventory.files.length,
      objectsOrphaned: 0,
      sessionsRevoked,
      pushTokensRemoved,
      groupsTransferred,
      groupsArchived,
      communitiesTransferred,
      communitiesArchived,
      classroomsTransferred,
      classroomsArchived,
    };

    await repo.closeReceipt(
      { receiptId, removed: { ...summary } as unknown as Record<string, number> },
      client,
    );

    return {
      summary,
      receiptId,
      objectKeys: inventory.files.map((file) => file.storage_key),
    };
  });

  /*
   * The bytes.
   *
   * After the commit and outside it, because an object delete is not
   * transactional: doing it inside would mean a failed transaction had already
   * destroyed the files. Failures are collected rather than thrown — the
   * account IS deleted at this point, and reporting a 500 to someone whose
   * account no longer exists would be both wrong and untrue — and the keys are
   * recorded so a sweep can finish the job.
   */
  const orphaned: string[] = [];
  const storage = getStorage();
  for (const key of objectKeys) {
    try {
      await storage.delete(key);
    } catch (error) {
      orphaned.push(key);
      getLogger().error({ err: error, receiptId }, 'storage object survived account deletion');
    }
  }
  if (orphaned.length > 0) {
    await repo.recordOrphanedObjects({ receiptId, keys: orphaned });
  }

  return { ...summary, objectsOrphaned: orphaned.length };
}

/**
 * The accounts this student has blocked.
 *
 * Guideline 1.2 requires "the ability to block abusive users from the service".
 * Blocking existed; the list did not — and a block you cannot see is one you
 * cannot verify took effect and cannot lift when you blocked the wrong handle.
 *
 * The blocked person is never told, here or anywhere: this endpoint is scoped
 * to the caller's own `blocks` rows, so it cannot be used to discover who has
 * blocked YOU.
 */
export async function listBlockedAccounts(actor: Actor): Promise<BlockedAccount[]> {
  const rows = await repo.listBlockedProfiles(actor.userId);
  return rows.map((row) => ({
    profile: {
      userId: row.user_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      verificationLevel: row.verification_level,
      stageName: null,
      collegeName: null,
    },
    blockedAt: row.created_at.toISOString(),
  }));
}
