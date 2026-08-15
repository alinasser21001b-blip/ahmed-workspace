import type { ModerationTerm } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/** The active lexicon. Rows, so changing it is an INSERT rather than a deploy. */
export async function listActiveTerms(client?: Sql): Promise<ModerationTerm[]> {
  const rows = await queryRows<{
    id: string;
    pattern: string;
    category: ModerationTerm['category'];
    severity: ModerationTerm['severity'];
    match_kind: 'word' | 'substring';
  }>(
    `SELECT id, pattern, category, severity, match_kind
     FROM moderation_terms WHERE is_active
     ORDER BY pattern`,
    [],
    client,
  );
  return rows.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    category: row.category,
    severity: row.severity,
    match: row.match_kind,
  }));
}

/**
 * Records what the gate decided.
 *
 * The text is never stored — only a digest of it and the rule ids that fired.
 * Keeping the body of a refused submission would mean the service retains
 * exactly the material it just refused to accept.
 */
export async function recordDecision(
  input: {
    userId: string;
    surface: 'post' | 'comment' | 'message' | 'profile';
    verdict: 'block' | 'review';
    ruleIds: readonly string[];
    contentHash: string;
    targetKind?: string | null;
    targetId?: string | null;
  },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO moderation_decisions
       (user_id, surface, verdict, rule_ids, content_hash, target_kind, target_id)
     VALUES ($1, $2, $3, $4::text[], $5, $6, $7)
     RETURNING id`,
    [
      input.userId,
      input.surface,
      input.verdict,
      input.ruleIds,
      input.contentHash,
      input.targetKind ?? null,
      input.targetId ?? null,
    ],
    client,
  );
}

export interface ReportRow {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: Date;
  reporter_handle: string | null;
  target_kind: string;
  target_id: string;
}

/**
 * The moderator queue — open reports, oldest first.
 *
 * "Oldest first" is the whole point: Guideline 1.2 asks for "timely responses
 * to concerns", and a queue ordered newest-first is one where the oldest
 * complaint is never reached.
 */
export async function listOpenReports(
  input: { status: string[]; limit: number },
  client?: Sql,
): Promise<ReportRow[]> {
  return queryRows<ReportRow>(
    `SELECT r.id, r.reason, r.details, r.status::text AS status, r.created_at,
            p.handle AS reporter_handle,
            CASE
              WHEN r.content_id   IS NOT NULL THEN 'content'
              WHEN r.comment_id   IS NOT NULL THEN 'comment'
              WHEN r.message_id   IS NOT NULL THEN 'message'
              WHEN r.group_id     IS NOT NULL THEN 'group'
              WHEN r.community_id IS NOT NULL THEN 'community'
              WHEN r.profile_id   IS NOT NULL THEN 'profile'
              ELSE 'file'
            END AS target_kind,
            COALESCE(r.content_id, r.comment_id, r.message_id, r.group_id,
                     r.community_id, r.profile_id, r.file_id) AS target_id
     FROM reports r
     LEFT JOIN profiles p ON p.user_id = r.reporter_id
     WHERE r.status::text = ANY($1::text[])
     ORDER BY r.created_at ASC
     LIMIT $2`,
    [input.status, input.limit],
    client,
  );
}

/** Closes a report and records the moderator's action in one transaction. */
export async function resolveReport(
  input: {
    reportId: string;
    moderatorId: string;
    status: 'resolved' | 'dismissed';
    action: string;
    reason: string;
    notes: string | null;
  },
  client: Sql,
): Promise<{ id: string; target_user_id: string | null } | null> {
  const report = await queryOne<{ id: string; target_user_id: string | null }>(
    `UPDATE reports
     SET status = $3::report_status, resolved_by = $2, resolved_at = now()
     WHERE id = $1 AND status IN ('open', 'reviewing')
     RETURNING id,
       COALESCE(
         profile_id,
         (SELECT ci.author_id FROM content_items ci WHERE ci.id = reports.content_id),
         (SELECT c.author_id  FROM comments c      WHERE c.id = reports.comment_id),
         (SELECT m.sender_id  FROM messages m      WHERE m.id = reports.message_id)
       ) AS target_user_id`,
    [input.reportId, input.moderatorId, input.status],
    client,
  );
  if (!report) return null;

  await queryOne(
    `INSERT INTO moderation_actions
       (report_id, moderator_id, action, target_user_id, reason, notes)
     VALUES ($1, $2, $3::moderation_action_kind, $4, $5, $6)
     RETURNING id`,
    [input.reportId, input.moderatorId, input.action, report.target_user_id, input.reason, input.notes],
    client,
  );

  return report;
}

/**
 * Ejects a user in response to a report (Guideline 1.2 — "the ability to block
 * abusive users from the service" applies to the operator as well as the user).
 */
export async function setUserStatus(
  input: { userId: string; status: 'active' | 'suspended' | 'banned' },
  client: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE users SET status = $2::account_status WHERE id = $1 RETURNING id`,
    [input.userId, input.status],
    client,
  );
  // A suspended account keeps no live session. Without this the ejection takes
  // effect only when their access token happens to expire.
  if (input.status !== 'active') {
    await queryOne(
      `UPDATE sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
      [input.userId],
      client,
    );
  }
}
