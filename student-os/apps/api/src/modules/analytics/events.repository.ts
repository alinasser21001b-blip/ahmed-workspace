import { queryOne, type Sql } from '../../platform/db.js';

/**
 * Event persistence. SQL only — the decision about whether a failure is fatal
 * belongs to the service, not here.
 */

export async function insertAnalyticsEvent(
  name: string,
  userId: string | null,
  properties: Record<string, unknown>,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO analytics_events (user_id, name, properties) VALUES ($1, $2, $3)`,
    [userId, name, JSON.stringify(properties)],
    client,
  );
}

export interface LearningEventInput {
  userId: string;
  kind: string;
  courseId: string | null;
  topicId: string | null;
  subjectRefKind: string | null;
  subjectRefId: string | null;
  value: number | null;
  metadata: Record<string, unknown>;
}

export async function insertLearningEvent(
  input: LearningEventInput,
  client?: Sql,
): Promise<void> {
  /*
   * `WHERE EXISTS` on the taxonomy rather than relying on the foreign key.
   *
   * A signal is an observation. An unknown kind is a bug in the caller, and a
   * foreign-key violation would abort the caller's transaction — costing the
   * student the action they actually took in order to fail at recording that
   * they took it. Losing the observation is the correct direction to fail.
   */
  await queryOne(
    `INSERT INTO learning_events (
       user_id, kind, course_id, topic_id, subject_ref_kind, subject_ref_id, value, metadata
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8
     WHERE EXISTS (SELECT 1 FROM learning_event_kinds k WHERE k.kind = $2)`,
    [
      input.userId,
      input.kind,
      input.courseId,
      input.topicId,
      input.subjectRefKind,
      input.subjectRefId,
      input.value,
      JSON.stringify(input.metadata),
    ],
    client,
  );
}
