import { z } from 'zod';
import {
  contentLanguageSchema,
  difficultySchema,
  isoDateTimeSchema,
  knowledgeTypeSchema,
  uuidSchema,
} from '../common/primitives.js';
import { profileSummarySchema } from '../users/users.contract.js';

/**
 * Knowledge: classification, provenance, corrections and topics.
 *
 * The shapes here encode ADR-0013's central claim — **there is no score.** What
 * a reader receives is a set of counts, each of which is a number of rows they
 * can click into, plus a provenance class chosen by stated rules. A single
 * opaque float would render more easily and would be unarguable, which is
 * exactly why it is absent.
 */

// --- provenance -------------------------------------------------------------

export const sourceKindSchema = z.enum([
  'textbook',
  'lecture',
  'guideline',
  'paper',
  'website',
  'other',
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const contentSourceSchema = z.object({
  id: uuidSchema,
  kind: sourceKindSchema,
  /** What a reader would actually look up. */
  citation: z.string(),
  url: z.string().nullable(),
  fileId: uuidSchema.nullable(),
  /** "p. 412", "§3.2", "slide 14" — where in the source. */
  pageRef: z.string().nullable(),
  /** Who attached it. Not always the content's author. */
  addedBy: profileSummarySchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ContentSource = z.infer<typeof contentSourceSchema>;

export const addSourceRequestSchema = z.object({
  kind: sourceKindSchema,
  citation: z.string().trim().min(3).max(500),
  url: z.string().url().max(2000).nullable().default(null),
  fileId: uuidSchema.nullable().default(null),
  pageRef: z.string().trim().max(80).nullable().default(null),
});
export type AddSourceRequest = z.infer<typeof addSourceRequestSchema>;

// --- corrections ------------------------------------------------------------

export const correctionStatusSchema = z.enum([
  'proposed',
  'accepted',
  'rejected',
  'withdrawn',
]);
export type CorrectionStatus = z.infer<typeof correctionStatusSchema>;

export const contentCorrectionSchema = z.object({
  id: uuidSchema,
  contentId: uuidSchema,
  /** What is wrong, and what is right instead. */
  body: z.string(),
  status: correctionStatusSchema,
  proposedBy: profileSummarySchema.nullable(),
  /** The original author, or a moderator of the container. */
  resolvedBy: profileSummarySchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  /** A citation backing the correction, when one was given. */
  source: contentSourceSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ContentCorrection = z.infer<typeof contentCorrectionSchema>;

export const proposeCorrectionRequestSchema = z.object({
  body: z.string().trim().min(10).max(4000),
  /** Optional citation, attached to the content as a source if accepted. */
  source: addSourceRequestSchema.nullable().default(null),
});
export type ProposeCorrectionRequest = z.infer<typeof proposeCorrectionRequestSchema>;

export const resolveCorrectionRequestSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});
export type ResolveCorrectionRequest = z.infer<typeof resolveCorrectionRequestSchema>;

// --- the signals a reader sees ----------------------------------------------

export const provenanceClassSchema = z.enum([
  'corrected',
  'disputed',
  'source_backed',
  'author_claim',
]);
export type ProvenanceClass = z.infer<typeof provenanceClassSchema>;

/**
 * Everything a reader is told about how a piece of knowledge is founded.
 *
 * Counts, not a rating. `helpfulCount` counts distinct students who chose
 * `helpful` or `insightful` — a judgement about correctness — and deliberately
 * does NOT include `like`, which is affinity. Ranking may use both; it must
 * never add them together (ADR-0014).
 */
export const knowledgeSignalsSchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  acceptedCorrectionCount: z.number().int().nonnegative(),
  openCorrectionCount: z.number().int().nonnegative(),
  helpfulCount: z.number().int().nonnegative(),
  hasAcceptedAnswer: z.boolean(),
  provenance: provenanceClassSchema,
});
export type KnowledgeSignals = z.infer<typeof knowledgeSignalsSchema>;

/** The classification block carried by every content item. */
export const knowledgeClassificationSchema = z.object({
  knowledgeType: knowledgeTypeSchema.nullable(),
  difficulty: difficultySchema.nullable(),
  language: contentLanguageSchema.nullable(),
  topics: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      /**
       * Who said this content is about this topic. Carried through to the
       * client so a model-derived tag can never render as the author's
       * (ADR-0013) — even though nothing sets `ai` yet.
       */
      source: z.enum(['author', 'ai', 'moderator']),
    }),
  ),
});
export type KnowledgeClassification = z.infer<typeof knowledgeClassificationSchema>;

// --- topics -----------------------------------------------------------------

export const topicRelationSchema = z.enum(['related', 'prerequisite_of', 'part_of']);
export type TopicRelation = z.infer<typeof topicRelationSchema>;

export const relatedTopicSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  subjectName: z.string().nullable(),
  relation: topicRelationSchema,
  /**
   * `curated` — a person asserted this edge.
   * `derived` — the system counted co-tagging and found it.
   *
   * Kept on the row because they are different claims with different trust, and
   * a graph that merges them can never be un-merged (ADR-0013).
   */
  source: z.enum(['curated', 'derived']),
  /** Derived edges only: how often the two are tagged together. */
  strength: z.number().nullable(),
});
export type RelatedTopic = z.infer<typeof relatedTopicSchema>;

/** A topic as a place to navigate to — the Phase 5 primitive. */
export const topicDetailSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  subjectId: uuidSchema,
  subjectName: z.string(),
  courseId: uuidSchema,
  courseName: z.string(),
  parentTopicId: uuidSchema.nullable(),
  parentTopicName: z.string().nullable(),
  subtopics: z.array(z.object({ id: uuidSchema, name: z.string() })),
  related: z.array(relatedTopicSchema),
  /** Counts of visible knowledge, by type. Permission-filtered like everything. */
  knowledgeCounts: z.array(
    z.object({ knowledgeType: knowledgeTypeSchema, count: z.number().int().nonnegative() }),
  ),
  /** This reader's own signal for the topic, when there is one. */
  viewer: z.object({
    isInterest: z.boolean(),
    questionsSeen: z.number().int().nonnegative(),
    questionsCorrect: z.number().int().nonnegative(),
    weaknessScore: z.number().nullable(),
    lastActivityAt: isoDateTimeSchema.nullable(),
    /**
     * Whether there is anything for this student to practise here.
     *
     * Projected by the server rather than inferred by the client, for the same
     * reason every other capability flag is: the client cannot know which
     * quizzes are published in which of this student's courses, and a Practice
     * button that 404s is the dead control the product ruled out in Phase 3.
     */
    canPractice: z.boolean(),
  }),
});
export type TopicDetail = z.infer<typeof topicDetailSchema>;

export const listTopicKnowledgeQuerySchema = z.object({
  knowledgeType: knowledgeTypeSchema.optional(),
  difficulty: difficultySchema.optional(),
  language: contentLanguageSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListTopicKnowledgeQuery = z.infer<typeof listTopicKnowledgeQuerySchema>;

// --- the Learn surface ------------------------------------------------------

/**
 * What the Learn tab shows.
 *
 * Built only from signals that actually exist. A section with no data is absent
 * rather than shown empty with a placeholder — the Phase 3 rule about dead
 * controls applies to whole sections too.
 */
export const learnOverviewSchema = z.object({
  /** Topics this student has interacted with, weakest first. */
  focusTopics: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      subjectName: z.string().nullable(),
      questionsSeen: z.number().int().nonnegative(),
      weaknessScore: z.number().nullable(),
      /** True when the sample is too small to draw a conclusion from. */
      lowConfidence: z.boolean(),
      lastActivityAt: isoDateTimeSchema.nullable(),
    }),
  ),
  /** Topics from the student's declared interests, for a cold start. */
  interestTopics: z.array(z.object({ id: uuidSchema, name: z.string() })),
  savedCount: z.number().int().nonnegative(),
  /** Meaningful learning actions in the last seven days — the north-star, per student. */
  meaningfulActionsThisWeek: z.number().int().nonnegative(),
});
export type LearnOverview = z.infer<typeof learnOverviewSchema>;
