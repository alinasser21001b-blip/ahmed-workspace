import type {
  AddSourceRequest,
  ContentCorrection,
  ContentSource,
  KnowledgeSignals,
  ProposeCorrectionRequest,
} from '@sos/contracts';
import {
  canDeleteContent,
  canViewContent,
  provenanceOf,
  type Actor,
  type ContentRef,
} from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import * as content from '../content/content.repository.js';
import { emit } from '../events/events.service.js';
import * as signals from '../learning/signals.service.js';
import * as repo from './knowledge.repository.js';

/**
 * Knowledge: provenance and corrections.
 *
 * Every read here goes through `canViewContent` first. A source or a correction
 * is *about* a piece of content, so its visibility is the content's visibility —
 * deriving a second rule would be a second authorization implementation, which
 * ADR-0003 exists to forbid.
 */

function toProfile(
  handle: string | null,
  displayName: string | null,
  avatarUrl: string | null,
  verification: 'unverified' | 'student' | 'instructor' | 'official' | null,
  userId: string | null,
): ContentSource['addedBy'] {
  if (!handle || !userId) return null;
  return {
    userId,
    handle,
    displayName: displayName ?? handle,
    avatarUrl,
    verificationLevel: verification ?? 'unverified',
    stageName: null,
    collegeName: null,
  };
}

function toSource(row: repo.SourceRow): ContentSource {
  return {
    id: row.id,
    kind: row.kind,
    citation: row.citation,
    url: row.url,
    fileId: row.file_id,
    pageRef: row.page_ref,
    addedBy: toProfile(
      row.adder_handle,
      row.adder_display_name,
      row.adder_avatar_url,
      row.adder_verification_level,
      row.added_by,
    ),
    createdAt: row.created_at.toISOString(),
  };
}

function toCorrection(row: repo.CorrectionRow, source: ContentSource | null): ContentCorrection {
  return {
    id: row.id,
    contentId: row.content_id,
    body: row.body,
    status: row.status,
    proposedBy: toProfile(
      row.proposer_handle,
      row.proposer_display_name,
      row.proposer_avatar_url,
      row.proposer_verification_level,
      row.proposed_by,
    ),
    resolvedBy: toProfile(
      row.resolver_handle,
      row.resolver_display_name,
      row.resolver_avatar_url,
      row.resolver_verification_level,
      row.resolved_by,
    ),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    source,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Loads a piece of content the actor may see, or 404s.
 *
 * 404 rather than 403 throughout, matching the rest of the product: a 403 on a
 * content id confirms that the content exists.
 */
async function loadVisible(actor: Actor, contentId: string): Promise<ContentRef> {
  const ref = await content.loadContentRef(contentId);
  if (!ref || !canViewContent(actor, ref).allowed) throw errors.notFound('content');
  return ref;
}

// --- signals ----------------------------------------------------------------

/**
 * The facts about a set of content items, as a reader is shown them.
 *
 * Batched, and returning a Map, because the feed calls this once for a whole
 * page. The provenance class is chosen in `@sos/core` from the counts — one
 * implementation of the rule, shared with the unit tests that pin it down.
 */
export async function signalsFor(
  contentIds: readonly string[],
): Promise<Map<string, KnowledgeSignals>> {
  const rows = await repo.loadSignals(contentIds);
  const out = new Map<string, KnowledgeSignals>();

  for (const [id, row] of rows) {
    const counts = {
      sourceCount: Number(row.source_count),
      acceptedCorrectionCount: Number(row.accepted_correction_count),
      openCorrectionCount: Number(row.open_correction_count),
      helpfulCount: Number(row.helpful_count),
      hasAcceptedAnswer: row.has_accepted_answer,
    };
    out.set(id, { ...counts, provenance: provenanceOf(counts) });
  }
  return out;
}

// --- sources ----------------------------------------------------------------

export async function listSources(actor: Actor, contentId: string): Promise<ContentSource[]> {
  await loadVisible(actor, contentId);
  return (await repo.listSources(contentId)).map(toSource);
}

/**
 * Attaches a source.
 *
 * **Anyone who can see the content may add one**, not only its author. That is
 * the deliberate product decision: a classmate who finds the textbook page for
 * someone else's explanation has improved the knowledge, and `added_by` records
 * who made the claim so the contribution is attributable rather than anonymous.
 */
export async function addSource(
  actor: Actor,
  contentId: string,
  input: AddSourceRequest,
): Promise<ContentSource> {
  const ref = await loadVisible(actor, contentId);
  if (actor.status === 'restricted') throw errors.forbidden('account_restricted');

  const { id } = await withTransaction(async (client) => {
    const created = await repo.insertSource(
      {
        contentId,
        kind: input.kind,
        citation: input.citation,
        url: input.url,
        fileId: input.fileId,
        pageRef: input.pageRef,
        addedBy: actor.userId,
      },
      client,
    );

    // Attaching a citation is a meaningful learning action: it requires having
    // found and read the source.
    await signals.recordForContent(client, {
      userId: actor.userId,
      kind: 'source_added',
      courseId: ref.courseId,
      metadata: { sourceKind: input.kind },
      contentId,
    });

    return created;
  });

  const stored = await repo.findSource(id);
  if (!stored) throw errors.internal('source vanished after insert');
  return toSource(stored);
}

/** Removing a source: whoever added it, or whoever could delete the content. */
export async function removeSource(
  actor: Actor,
  contentId: string,
  sourceId: string,
): Promise<void> {
  const ref = await loadVisible(actor, contentId);
  const source = await repo.findSource(sourceId);
  if (!source || source.content_id !== contentId) throw errors.notFound('source');

  const isAdder = source.added_by === actor.userId;
  if (!isAdder && !canDeleteContent(actor, ref).allowed) {
    throw errors.forbidden('not_permitted');
  }

  await repo.deleteSource(sourceId, contentId);
}

// --- corrections ------------------------------------------------------------

export async function listCorrections(
  actor: Actor,
  contentId: string,
): Promise<ContentCorrection[]> {
  await loadVisible(actor, contentId);

  const rows = await repo.listCorrections(contentId);
  const sources = new Map(
    (await repo.listSources(contentId)).map((source) => [source.id, toSource(source)]),
  );

  return rows.map((row) => toCorrection(row, row.source_id ? (sources.get(row.source_id) ?? null) : null));
}

/**
 * Proposes a correction.
 *
 * The author cannot correct their own content — they edit it. A correction is a
 * claim by someone *else* that the content is wrong, and letting an author file
 * one against themselves would make "was this challenged?" unanswerable.
 */
export async function proposeCorrection(
  actor: Actor,
  contentId: string,
  input: ProposeCorrectionRequest,
): Promise<ContentCorrection> {
  const ref = await loadVisible(actor, contentId);
  if (actor.status === 'restricted') throw errors.forbidden('account_restricted');
  if (ref.authorId === actor.userId) throw errors.forbidden('author_should_edit');

  const { id } = await withTransaction(async (client) => {
    /*
     * A citation offered with a correction is stored as a source of the
     * correction, not yet of the content. It becomes the content's source only
     * if the correction is accepted — otherwise a rejected claim would leave a
     * citation behind implying the content is backed by it.
     */
    let sourceId: string | null = null;
    if (input.source) {
      const source = await repo.insertSource(
        {
          contentId,
          kind: input.source.kind,
          citation: input.source.citation,
          url: input.source.url,
          fileId: input.source.fileId,
          pageRef: input.source.pageRef,
          addedBy: actor.userId,
        },
        client,
      );
      sourceId = source.id;
    }

    const created = await repo.insertCorrection(
      { contentId, proposedBy: actor.userId, body: input.body, sourceId },
      client,
    );

    // Recorded, but NOT meaningful: proposing is not yet being right. The
    // meaningful signal fires when the author agrees.
    await signals.recordForContent(client, {
      userId: actor.userId,
      kind: 'correction_proposed',
      courseId: ref.courseId,
      contentId,
    });

    await emit(client, {
      kind: 'content.correction.proposed',
      actorId: actor.userId,
      subjectId: ref.authorId,
      targetType: 'content',
      targetId: contentId,
      payload: { correctionId: created.id },
    });

    return created;
  });

  const stored = await repo.findCorrection(id);
  if (!stored) throw errors.internal('correction vanished after insert');
  const source = stored.source_id ? await repo.findSource(stored.source_id) : null;
  return toCorrection(stored, source ? toSource(source) : null);
}

/**
 * Accepts or rejects a correction.
 *
 * Only the content's author or someone who could delete the content — the same
 * rank logic `canDeleteContent` already encodes for container moderators. No
 * new authorization concept.
 */
export async function resolveCorrection(
  actor: Actor,
  contentId: string,
  correctionId: string,
  status: 'accepted' | 'rejected',
): Promise<ContentCorrection> {
  const ref = await loadVisible(actor, contentId);

  const correction = await repo.findCorrection(correctionId);
  if (!correction || correction.content_id !== contentId) throw errors.notFound('correction');

  const isAuthor = ref.authorId === actor.userId;
  if (!isAuthor && !canDeleteContent(actor, ref).allowed) {
    throw errors.forbidden('not_content_author');
  }
  if (correction.status !== 'proposed') throw errors.conflict('This correction is already resolved.');

  await withTransaction(async (client) => {
    const resolved = await repo.resolveCorrection(correctionId, status, actor.userId, client);
    if (!resolved) throw errors.conflict('This correction is already resolved.');

    if (status === 'accepted') {
      await repo.adoptCorrectionSource(correctionId, client);

      /*
       * The meaningful signal belongs to the PROPOSER, not the resolver. They
       * identified an error and the author agreed — among the strongest
       * learning signals this product can observe about a student.
       */
      if (correction.proposed_by) {
        await signals.recordForContent(client, {
          userId: correction.proposed_by,
          kind: 'correction_accepted',
          courseId: ref.courseId,
          contentId,
        });
      }
    }

    await emit(client, {
      kind: status === 'accepted' ? 'content.correction.accepted' : 'content.correction.rejected',
      actorId: actor.userId,
      subjectId: correction.proposed_by,
      targetType: 'content',
      targetId: contentId,
      payload: { correctionId },
    });
  });

  const stored = await repo.findCorrection(correctionId);
  if (!stored) throw errors.internal('correction vanished after resolution');
  const source = stored.source_id ? await repo.findSource(stored.source_id) : null;
  return toCorrection(stored, source ? toSource(source) : null);
}

export async function withdrawCorrection(
  actor: Actor,
  contentId: string,
  correctionId: string,
): Promise<void> {
  await loadVisible(actor, contentId);
  const withdrawn = await repo.withdrawCorrection(correctionId, actor.userId);
  if (!withdrawn) throw errors.notFound('correction');
}
