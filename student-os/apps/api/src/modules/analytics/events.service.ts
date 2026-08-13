import type { Sql } from '../../platform/db.js';
import { getLogger } from '../../platform/logger.js';
import * as repo from './events.repository.js';

/**
 * Event recording (§83, §84).
 *
 * Two separate streams, deliberately not merged:
 *
 *   analytics_events — behavioural. How the product is used.
 *   learning_events  — the learning record. What counts toward the north-star
 *                      metric, and what later feeds recommendations.
 *
 * Merging them would make "weekly active learners" a query over a table that
 * also contains every screen view, and the definition would rot within a month.
 */

/**
 * Records a product analytics event.
 *
 * Never throws. Analytics is observability, and an observability failure must
 * not fail the user's action — a student's post is not lost because a metrics
 * insert deadlocked.
 */
export async function recordAnalytics(
  name: string,
  userId: string | null,
  properties: Record<string, unknown> = {},
  client?: Sql,
): Promise<void> {
  try {
    await repo.insertAnalyticsEvent(name, userId, properties, client);
  } catch (error) {
    getLogger().warn({ err: error, event: name }, 'analytics event dropped');
  }
}

/**
 * Records a learning event.
 *
 * This one DOES throw. It is part of the learning record, and a silently
 * dropped `quiz_completed` would corrupt a student's topic performance and the
 * north-star metric alike. It is written inside the caller's transaction so it
 * commits with the action it describes.
 */
export async function recordLearningEvent(
  input: {
    userId: string;
    kind: string;
    courseId?: string | null;
    topicId?: string | null;
    subjectRefKind?: string | null;
    subjectRefId?: string | null;
    value?: number | null;
    metadata?: Record<string, unknown>;
  },
  client?: Sql,
): Promise<void> {
  await repo.insertLearningEvent(
    {
      userId: input.userId,
      kind: input.kind,
      courseId: input.courseId ?? null,
      topicId: input.topicId ?? null,
      subjectRefKind: input.subjectRefKind ?? null,
      subjectRefId: input.subjectRefId ?? null,
      value: input.value ?? null,
      metadata: input.metadata ?? {},
    },
    client,
  );
}
