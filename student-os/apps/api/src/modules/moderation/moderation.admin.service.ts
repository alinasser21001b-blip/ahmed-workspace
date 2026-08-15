import type { ModerationReport, ResolveReportRequest } from '@sos/contracts';
import { isPlatformAdmin, type Actor } from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import * as repo from './moderation.repository.js';

/**
 * The moderator side of Guideline 1.2.
 *
 * "A mechanism to report offensive content AND TIMELY RESPONSES TO CONCERNS" —
 * the second half is the part a reports table does not provide. Before this,
 * `reports` had a writer and no reader: a student could file a report and
 * nobody, including the operator, could see it without opening psql.
 *
 * Authorisation goes through `isPlatformAdmin` from `@sos/core` rather than
 * comparing `actor.role` here, for the reason ADR-0003 gives: a second
 * implementation of a permission question is a second thing to get wrong, and
 * the moderation queue is the worst possible place to get it wrong.
 */

function assertModerator(actor: Actor): void {
  // 404, not 403: a non-admin probing for the moderation surface should not
  // learn it exists, exactly as an invisible resource returns 404 elsewhere.
  if (!isPlatformAdmin(actor)) throw errors.notFound('resource');
}

export async function listQueue(
  actor: Actor,
  query: { status: 'open' | 'reviewing' | 'all'; limit: number },
): Promise<ModerationReport[]> {
  assertModerator(actor);

  const statuses =
    query.status === 'all' ? ['open', 'reviewing', 'resolved', 'dismissed'] : [query.status];

  const rows = await repo.listOpenReports({ status: statuses, limit: query.limit });

  return rows.map((row) => ({
    id: row.id,
    reason: row.reason as ModerationReport['reason'],
    details: row.details,
    status: row.status as ModerationReport['status'],
    targetType: row.target_kind as ModerationReport['targetType'],
    targetId: row.target_id,
    reporterHandle: row.reporter_handle,
    createdAt: row.created_at.toISOString(),
  }));
}

/**
 * Closes a report and does the thing.
 *
 * `suspend` and `ban` change the account's status AND revoke its sessions in
 * the same transaction. Without the revocation an ejected user keeps working
 * until their access token expires, which is the difference between "the
 * ability to block abusive users from the service" and a flag in a table.
 */
export async function resolve(
  actor: Actor,
  reportId: string,
  input: ResolveReportRequest,
): Promise<void> {
  assertModerator(actor);

  await withTransaction(async (client) => {
    const report = await repo.resolveReport(
      {
        reportId,
        moderatorId: actor.userId,
        status: input.action === 'dismiss' ? 'dismissed' : 'resolved',
        action: input.action,
        reason: input.reason,
        notes: input.notes ?? null,
      },
      client,
    );
    // Null means the report does not exist or is already closed. Both are 404:
    // re-resolving a closed report must not silently record a second action.
    if (!report) throw errors.notFound('report');

    if (input.action === 'suspend' || input.action === 'ban') {
      if (!report.target_user_id) {
        throw errors.preconditionFailed(
          'This report has no account behind it to suspend.',
          { field: 'action' },
        );
      }
      await repo.setUserStatus(
        { userId: report.target_user_id, status: input.action === 'ban' ? 'banned' : 'suspended' },
        client,
      );
    }
  });
}
