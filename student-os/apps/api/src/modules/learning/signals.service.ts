import type { Sql } from '../../platform/db.js';
import { recordLearningEvent } from '../analytics/events.service.js';
import {
  insertLearningEventPerTopic,
  updateTopicWeakness,
  upsertTopicProgress,
} from './signals.repository.js';

/**
 * Learning signals.
 *
 * `learning_events` and its data-driven `learning_event_kinds` taxonomy have
 * existed since Phase 0 with exactly ONE producer: a substantive comment on
 * academic content, in `comments.service`. Everything else the product observes
 * — saving, reading, answering, correcting, citing — went unrecorded.
 *
 * This module adds the missing producers. It deliberately does NOT add a second
 * way to write an event: `record` delegates to `recordLearningEvent`, which the
 * comment path already uses, so there stays one insert and one place to change
 * it. What is genuinely new here is `recordForContent` (fan-out per topic, so a
 * signal can roll up) and `touchTopicProgress` (the roll-up itself).
 *
 * Three rules, from ADR-0014, enforced here rather than left to callers:
 *
 *  1. **A view is not a learning event.** Opening something is channel B
 *     (content interaction, `content_views`). It reaches this module only as
 *     `knowledge_opened`, which is seeded `is_meaningful = false` — recorded so
 *     the pattern is visible, never counted toward the north-star.
 *
 *  2. **A signal is written inside the transaction that caused it.** `client`
 *     is required, not optional. A signal describing a write that rolled back
 *     is worse than a missing signal: it is silently wrong, and nothing will
 *     ever contradict it.
 *
 *  3. **What counts as meaningful is data.** This module never decides; it
 *     writes the kind and the reference table decides. Changing the north-star
 *     definition is an `UPDATE`, not a deploy.
 */

/**
 * Kinds this module can emit.
 *
 * A union rather than `string`, so a typo is a compile error instead of a
 * foreign-key violation discovered in production. The rows themselves live in
 * `learning_event_kinds`; this is the subset Phase 5 produces.
 */
export type SignalKind =
  | 'knowledge_opened'
  | 'knowledge_saved'
  | 'question_answered'
  | 'answer_accepted'
  | 'correction_proposed'
  | 'correction_accepted'
  | 'source_added'
  | 'academic_discussion_participated';

export interface SignalInput {
  userId: string;
  kind: SignalKind;
  /** Academic context, so the signal can roll up without a join back. */
  courseId?: string | null;
  topicId?: string | null;
  /** What the signal is about: 'content' | 'comment' | 'correction' | 'topic'. */
  refKind?: string | null;
  refId?: string | null;
  value?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records one learning signal.
 *
 * A thin typed wrapper over the existing `recordLearningEvent`, not a second
 * insert path. The value it adds is the `SignalKind` union: a typo becomes a
 * compile error rather than a row that silently fails the taxonomy guard.
 */
export async function record(client: Sql, input: SignalInput): Promise<void> {
  await recordLearningEvent(
    {
      userId: input.userId,
      kind: input.kind,
      courseId: input.courseId ?? null,
      topicId: input.topicId ?? null,
      subjectRefKind: input.refKind ?? null,
      subjectRefId: input.refId ?? null,
      value: input.value ?? null,
      metadata: input.metadata ?? {},
    },
    client,
  );
}

/**
 * Records one signal per topic a piece of content is tagged with.
 *
 * Learning happens about a *topic*, not about a post. A signal with no
 * `topic_id` cannot roll up into `learning_progress`, cannot inform weakness,
 * and is therefore inert for everything downstream — so a save of content
 * tagged with three topics is three signals, one per topic.
 *
 * Untagged content still emits a single context-free signal: the action
 * happened, and dropping it would under-count the student's activity because of
 * a classification gap that is not their fault.
 */
export async function recordForContent(
  client: Sql,
  input: Omit<SignalInput, 'topicId' | 'refKind' | 'refId'> & { contentId: string },
): Promise<void> {
  await insertLearningEventPerTopic(
    {
      userId: input.userId,
      kind: input.kind,
      contentId: input.contentId,
      metadata: input.metadata ?? {},
    },
    client,
  );
}

/**
 * Rolls answer activity up into the per-topic learning signal.
 *
 * `learning_progress` is the input to `computeWeakness` in `@sos/core`, which
 * has been unit-tested and uncalled since Phase 0. This is what finally gives
 * it data.
 *
 * `weakness_score` and `confidence` are deliberately NOT computed here: the
 * formula lives in `@sos/core` where it is pure and testable, and the service
 * writes what it returns. Two implementations of one formula is the mistake the
 * feed's parity test exists to catch, and it is not worth repeating.
 */
export async function touchTopicProgress(
  client: Sql,
  input: { userId: string; topicId: string; seen: number; correct: number },
): Promise<void> {
  await upsertTopicProgress(input, client);
}

/** Stores a weakness signal computed in `@sos/core`. */
export async function storeWeakness(
  client: Sql,
  input: { userId: string; topicId: string; weaknessScore: number; confidence: number },
): Promise<void> {
  await updateTopicWeakness(input, client);
}
