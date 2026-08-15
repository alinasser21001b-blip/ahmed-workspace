import type { FeedPage, LearnOverview, Locale, TopicDetail } from '@sos/contracts';
import {
  computeWeakness,
  MIN_QUESTIONS_FOR_CONFIDENCE,
  visibilityScopesFor,
  type Actor,
} from '@sos/core';
import { errors } from '../../platform/errors.js';
import * as content from '../content/content.service.js';
import * as practiceRepo from '../learning/practice.repository.js';
import * as repo from './topics.repository.js';

/**
 * Topics and the Learn surface.
 *
 * The product direction names Topic as the most important navigation primitive,
 * and this is why: a good explanation posted today is reachable from the feed
 * for a day and from its topic forever. That is the difference between durable
 * knowledge and a timeline.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string {
  return ((locale === 'ar' ? ar : en) ?? en ?? ar ?? '') as string;
}

export async function getTopic(
  actor: Actor,
  topicId: string,
  locale: Locale,
): Promise<TopicDetail> {
  const row = await repo.findTopic(topicId);
  if (!row) throw errors.notFound('topic');

  /*
   * The academic hierarchy is reference data about institutions, not about
   * people — every signed-in student may read it, exactly as
   * `/v1/academic/*` already allows. What is permission-filtered is the
   * KNOWLEDGE inside the topic, and those counts run the feed's predicate.
   */
  const scopes = visibilityScopesFor(actor);
  const [subtopics, related, counts, progress, canPractice] = await Promise.all([
    repo.listSubtopics(topicId),
    repo.listRelated(topicId, 12),
    repo.knowledgeCounts(topicId, {
      userId: scopes.userId!,
      universityId: scopes.universityId,
      collegeId: scopes.collegeId,
      stageId: scopes.stageId,
      courseIds: scopes.courseIds,
      communityIds: scopes.communityIds,
      groupIds: scopes.groupIds,
      classroomIds: scopes.classroomIds,
      followingIds: scopes.followingIds,
      excludedUserIds: scopes.excludedUserIds,
    }),
    repo.viewerProgress(actor.userId, topicId),
    practiceRepo.hasPracticableQuestions(scopes.courseIds, topicId),
  ]);

  return {
    id: row.id,
    name: localised(row.name_ar, row.name_en, locale),
    slug: row.slug,
    subjectId: row.subject_id,
    subjectName: localised(row.subject_name_ar, row.subject_name_en, locale),
    courseId: row.course_id,
    courseName: localised(row.course_name_ar, row.course_name_en, locale),
    parentTopicId: row.parent_topic_id,
    parentTopicName: row.parent_topic_id
      ? localised(row.parent_name_ar, row.parent_name_en, locale)
      : null,
    subtopics: subtopics.map((sub) => ({
      id: sub.id,
      name: localised(sub.name_ar, sub.name_en, locale),
    })),
    related: related.map((rel) => ({
      id: rel.id,
      name: localised(rel.name_ar, rel.name_en, locale),
      subjectName: rel.subject_name_en ? localised(rel.subject_name_ar, rel.subject_name_en, locale) : null,
      relation: rel.relation,
      source: rel.source,
      strength: rel.strength,
    })),
    knowledgeCounts: counts.map((entry) => ({
      knowledgeType: entry.knowledge_type,
      count: Number(entry.count),
    })),
    viewer: {
      isInterest: progress?.is_interest ?? false,
      questionsSeen: progress?.questions_seen ?? 0,
      questionsCorrect: progress?.questions_correct ?? 0,
      weaknessScore: progress?.weakness_score ?? null,
      lastActivityAt: progress?.last_activity_at?.toISOString() ?? null,
      canPractice,
    },
  };
}

/**
 * Knowledge about a topic.
 *
 * Delegates to the feed rather than reimplementing it. The feed already carries
 * the permission predicate, the keyset pagination and the enrichment; a second
 * query here would be a second place for a leak to appear (ADR-0003).
 */
export async function listTopicKnowledge(
  actor: Actor,
  topicId: string,
  query: {
    knowledgeType?: string | undefined;
    difficulty?: string | undefined;
    language?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
  locale: Locale,
): Promise<FeedPage> {
  const topic = await repo.findTopic(topicId);
  if (!topic) throw errors.notFound('topic');

  return content.listFeed(
    actor,
    {
      scope: 'recent',
      topicId,
      knowledgeType: query.knowledgeType,
      difficulty: query.difficulty,
      language: query.language,
      cursor: query.cursor,
      limit: query.limit,
    } as Parameters<typeof content.listFeed>[1],
    locale,
  );
}

// --- the Learn surface ------------------------------------------------------

/**
 * What the Learn tab shows.
 *
 * Built only from signals that exist. Before Phase 5 this screen was a shell
 * with a dead button, and the honest reason was that there was nothing to put
 * on it: `learning_events` had no producers and `learning_progress` was empty.
 *
 * A section with no data is returned empty and hidden by the client rather than
 * rendered with a placeholder — the Phase 3 rule about dead controls applies to
 * whole sections too.
 */
export async function learnOverview(actor: Actor, locale: Locale): Promise<LearnOverview> {
  const [progressRows, interestRows, savedCount, meaningfulActionsThisWeek] = await Promise.all([
    repo.listLearnProgress(actor.userId, 10),
    repo.listInterestTopics(actor.userId, 12),
    repo.countBookmarks(actor.userId),
    repo.countMeaningfulActions(actor.userId, 7),
  ]);

  return {
    focusTopics: progressRows.map((row) => {
      // Recomputed here rather than trusting the stored column, so a row
      // written before the formula changed cannot silently misreport.
      const signal = computeWeakness({
        topicId: row.topic_id,
        questionsSeen: row.questions_seen,
        questionsCorrect: row.questions_correct,
        lastActivityAt: row.last_activity_at,
      });
      return {
        id: row.topic_id,
        name: localised(row.name_ar, row.name_en, locale),
        subjectName: localised(row.subject_name_ar, row.subject_name_en, locale),
        questionsSeen: row.questions_seen,
        weaknessScore: signal.weaknessScore,
        // Surfaced, not hidden: a weakness computed from two answers is not a
        // finding, and presenting it as one would be the exact overclaim the
        // product's "learning signals, not learning" rule forbids.
        lowConfidence: row.questions_seen < MIN_QUESTIONS_FOR_CONFIDENCE,
        lastActivityAt: row.last_activity_at?.toISOString() ?? null,
      };
    }),
    interestTopics: interestRows.map((row) => ({
      id: row.id,
      name: localised(row.name_ar, row.name_en, locale),
    })),
    savedCount,
    meaningfulActionsThisWeek,
  };
}
