import type { CorrectionStatus, KnowledgeType, SourceKind } from '@sos/contracts';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Knowledge persistence: sources, corrections, and the signals derived from
 * them.
 *
 * The one thing worth reading carefully is `loadSignals`. It computes what a
 * reader is told about a piece of knowledge **from rows, in the query**, and
 * stores nothing. That is ADR-0013's central claim expressed as SQL: a stored
 * score would be faster to read and impossible to argue with, and nobody could
 * improve it six months later because nobody would know what it meant.
 */

// --- sources ----------------------------------------------------------------

export interface SourceRow {
  id: string;
  content_id: string;
  kind: SourceKind;
  citation: string;
  url: string | null;
  file_id: string | null;
  page_ref: string | null;
  added_by: string | null;
  created_at: Date;
  adder_handle: string | null;
  adder_display_name: string | null;
  adder_avatar_url: string | null;
  adder_verification_level: 'unverified' | 'student' | 'instructor' | 'official' | null;
}

const SOURCE_SELECT = `
  SELECT s.id, s.content_id, s.kind, s.citation, s.url, s.file_id, s.page_ref,
         s.added_by, s.created_at,
         p.handle AS adder_handle,
         p.display_name AS adder_display_name,
         p.avatar_url AS adder_avatar_url,
         u.verification_level AS adder_verification_level
  FROM content_sources s
  LEFT JOIN profiles p ON p.user_id = s.added_by
  LEFT JOIN users u ON u.id = s.added_by
`;

export async function insertSource(
  input: {
    contentId: string;
    kind: SourceKind;
    citation: string;
    url: string | null;
    fileId: string | null;
    pageRef: string | null;
    addedBy: string;
  },
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO content_sources (content_id, kind, citation, url, file_id, page_ref, added_by)
     VALUES ($1, $2::source_kind, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.contentId,
      input.kind,
      input.citation,
      input.url,
      input.fileId,
      input.pageRef,
      input.addedBy,
    ],
    client,
  );
  if (!row) throw new Error('source insert returned no row');
  return row;
}

export async function listSources(contentId: string, client?: Sql): Promise<SourceRow[]> {
  return queryRows<SourceRow>(
    `${SOURCE_SELECT} WHERE s.content_id = $1 ORDER BY s.created_at`,
    [contentId],
    client,
  );
}

export async function findSource(sourceId: string, client?: Sql): Promise<SourceRow | null> {
  return queryOne<SourceRow>(`${SOURCE_SELECT} WHERE s.id = $1`, [sourceId], client);
}

export async function deleteSource(
  sourceId: string,
  contentId: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `DELETE FROM content_sources WHERE id = $1 AND content_id = $2 RETURNING id`,
    [sourceId, contentId],
    client,
  );
  return row !== null;
}

// --- corrections ------------------------------------------------------------

export interface CorrectionRow {
  id: string;
  content_id: string;
  body: string;
  status: CorrectionStatus;
  source_id: string | null;
  resolved_at: Date | null;
  created_at: Date;
  proposed_by: string | null;
  proposer_handle: string | null;
  proposer_display_name: string | null;
  proposer_avatar_url: string | null;
  proposer_verification_level: 'unverified' | 'student' | 'instructor' | 'official' | null;
  resolved_by: string | null;
  resolver_handle: string | null;
  resolver_display_name: string | null;
  resolver_avatar_url: string | null;
  resolver_verification_level: 'unverified' | 'student' | 'instructor' | 'official' | null;
}

const CORRECTION_SELECT = `
  SELECT c.id, c.content_id, c.body, c.status, c.source_id, c.resolved_at, c.created_at,
         c.proposed_by,
         pp.handle AS proposer_handle,
         pp.display_name AS proposer_display_name,
         pp.avatar_url AS proposer_avatar_url,
         pu.verification_level AS proposer_verification_level,
         c.resolved_by,
         rp.handle AS resolver_handle,
         rp.display_name AS resolver_display_name,
         rp.avatar_url AS resolver_avatar_url,
         ru.verification_level AS resolver_verification_level
  FROM content_corrections c
  LEFT JOIN profiles pp ON pp.user_id = c.proposed_by
  LEFT JOIN users pu ON pu.id = c.proposed_by
  LEFT JOIN profiles rp ON rp.user_id = c.resolved_by
  LEFT JOIN users ru ON ru.id = c.resolved_by
`;

export async function insertCorrection(
  input: { contentId: string; proposedBy: string; body: string; sourceId: string | null },
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO content_corrections (content_id, proposed_by, body, source_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [input.contentId, input.proposedBy, input.body, input.sourceId],
    client,
  );
  if (!row) throw new Error('correction insert returned no row');
  return row;
}

export async function findCorrection(
  correctionId: string,
  client?: Sql,
): Promise<CorrectionRow | null> {
  return queryOne<CorrectionRow>(`${CORRECTION_SELECT} WHERE c.id = $1`, [correctionId], client);
}

export async function listCorrections(
  contentId: string,
  client?: Sql,
): Promise<CorrectionRow[]> {
  return queryRows<CorrectionRow>(
    `${CORRECTION_SELECT} WHERE c.content_id = $1 ORDER BY c.created_at DESC`,
    [contentId],
    client,
  );
}

/**
 * Resolves a correction.
 *
 * Guarded on `status = 'proposed'` in the WHERE, so a second resolver racing
 * the first changes nothing and the caller can tell: an accepted correction
 * that silently flipped to rejected would rewrite an accountable decision.
 */
export async function resolveCorrection(
  correctionId: string,
  status: 'accepted' | 'rejected',
  resolvedBy: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE content_corrections
     SET status = $2::correction_status, resolved_by = $3, resolved_at = now()
     WHERE id = $1 AND status = 'proposed'
     RETURNING id`,
    [correctionId, status, resolvedBy],
    client,
  );
  return row !== null;
}

export async function withdrawCorrection(
  correctionId: string,
  proposedBy: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE content_corrections
     SET status = 'withdrawn'
     WHERE id = $1 AND proposed_by = $2 AND status = 'proposed'
     RETURNING id`,
    [correctionId, proposedBy],
    client,
  );
  return row !== null;
}

/** Attaches an accepted correction's citation to the content it corrected. */
export async function adoptCorrectionSource(
  correctionId: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE content_sources s
     SET content_id = c.content_id
     FROM content_corrections c
     WHERE c.id = $1 AND s.id = c.source_id`,
    [correctionId],
    client,
  );
}

// --- derived signals --------------------------------------------------------

export interface SignalsRow {
  content_id: string;
  source_count: string;
  accepted_correction_count: string;
  open_correction_count: string;
  helpful_count: string;
  has_accepted_answer: boolean;
}

/**
 * The facts a reader is shown, computed for a set of content items.
 *
 * Batched by `= ANY($1)` rather than called per row: the feed renders twenty
 * items, and twenty round trips to answer "how many sources?" would be the
 * classic N+1 that turns a fast page into a slow one.
 *
 * `helpful_count` counts DISTINCT users choosing `helpful` or `insightful` —
 * a judgement about correctness. It deliberately excludes `like`, which is
 * affinity. Ranking may use both; it must never add them together (ADR-0014).
 */
export async function loadSignals(
  contentIds: readonly string[],
  client?: Sql,
): Promise<Map<string, SignalsRow>> {
  if (contentIds.length === 0) return new Map();

  const rows = await queryRows<SignalsRow>(
    `SELECT ci.id AS content_id,
            (SELECT count(*) FROM content_sources s WHERE s.content_id = ci.id)::text
              AS source_count,
            (SELECT count(*) FROM content_corrections c
              WHERE c.content_id = ci.id AND c.status = 'accepted')::text
              AS accepted_correction_count,
            (SELECT count(*) FROM content_corrections c
              WHERE c.content_id = ci.id AND c.status = 'proposed')::text
              AS open_correction_count,
            (SELECT count(DISTINCT r.user_id) FROM reactions r
              WHERE r.content_id = ci.id AND r.kind IN ('helpful', 'insightful'))::text
              AS helpful_count,
            COALESCE(qd.is_resolved, false) AS has_accepted_answer
     FROM content_items ci
     LEFT JOIN question_details qd ON qd.content_id = ci.id
     WHERE ci.id = ANY($1::uuid[])`,
    [contentIds],
    client,
  );

  return new Map(rows.map((row) => [row.content_id, row]));
}

// --- classification ---------------------------------------------------------

export async function updateClassification(
  contentId: string,
  fields: {
    knowledgeType?: KnowledgeType | null;
    difficulty?: 'easy' | 'medium' | 'hard' | null;
  },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `UPDATE content_items SET
       knowledge_type = CASE WHEN $2 THEN $3::knowledge_type ELSE knowledge_type END,
       difficulty     = CASE WHEN $4 THEN $5::difficulty_level ELSE difficulty END
     WHERE id = $1`,
    [
      contentId,
      fields.knowledgeType !== undefined,
      fields.knowledgeType ?? null,
      fields.difficulty !== undefined,
      fields.difficulty ?? null,
    ],
    client,
  );
}

export interface ContentTopicRow {
  topic_id: string;
  name_ar: string;
  name_en: string;
  source: 'author' | 'ai' | 'moderator';
}

/**
 * Topics on a piece of content, WITH their source.
 *
 * The source is carried all the way to the client even though nothing sets
 * `ai` yet. A read path that drops it would have to be changed when a
 * classifier ships — and a system that has silently rendered model tags as
 * author tags for a year cannot be un-merged (ADR-0013).
 */
export async function listContentTopics(
  contentIds: readonly string[],
  client?: Sql,
): Promise<Map<string, ContentTopicRow[]>> {
  if (contentIds.length === 0) return new Map();

  const rows = await queryRows<ContentTopicRow & { content_id: string }>(
    `SELECT ct.content_id, ct.topic_id, t.name_ar, t.name_en, ct.source
     FROM content_topics ct
     JOIN topics t ON t.id = ct.topic_id
     WHERE ct.content_id = ANY($1::uuid[])
     ORDER BY t.name_en`,
    [contentIds],
    client,
  );

  const byContent = new Map<string, ContentTopicRow[]>();
  for (const row of rows) {
    const list = byContent.get(row.content_id) ?? [];
    list.push(row);
    byContent.set(row.content_id, list);
  }
  return byContent;
}
