/**
 * Feed ranking, V1 (§34).
 *
 * Deliberately a transparent weighted sum, not a model. Two reasons:
 *   1. At 100 users there is no behavioural data to train on, and a model
 *      trained on nothing produces confident noise.
 *   2. The product must optimise for USEFUL ACADEMIC ENGAGEMENT, not watch
 *      time. A hand-written scoring function can be inspected and argued about;
 *      an engagement-trained model quietly optimises for whatever correlates
 *      with clicks, which in a student app is usually distraction.
 *
 * Every weight below is a product decision, written where a product person can
 * read it.
 */

export interface FeedCandidate {
  contentId: string;
  authorId: string;
  createdAt: Date;
  /** Content is in a course the viewer is enrolled in. */
  inEnrolledCourse: boolean;
  /** Content is tagged with a topic the viewer declared or is weak in. */
  matchesInterestTopic: boolean;
  matchesWeakTopic: boolean;
  /** Same college + stage as the viewer. */
  sameCohort: boolean;
  /** Author is followed by, or shares a group with, the viewer. */
  socialProximity: number; // 0..1
  likeCount: number;
  commentCount: number;
  /** True for resources, questions, announcements — content with study value. */
  isAcademicKind: boolean;
  /** The author said what this is: an explanation, a case, a summary. */
  isClassified: boolean;
  /** At least one citation is attached. */
  hasSource: boolean;
  /** Someone has challenged its accuracy and it is unresolved. */
  isDisputed: boolean;
  /** Already seen by this viewer. */
  seen: boolean;
}

/*
 * The weights, and why engagement is the smallest of them.
 *
 * The product is an academic learning system, not a social network with course
 * material on it, and the direction is explicit that popularity must not be a
 * primary ranking signal. Every term above `engagement` is about whether a
 * piece of knowledge is relevant to THIS student's studies; `engagement` is the
 * only one about whether other people liked it.
 *
 * It is not zero, because on a cold start — a new student with no enrolments,
 * no interests and no answered questions — every academic term evaluates to
 * zero and the feed would be pure recency. A small popularity term is what
 * stops the first session being arbitrary. It is deliberately smaller than
 * classification, so a well-labelled explanation with two likes outranks an
 * unclassified post with twenty.
 */
export const FEED_WEIGHTS = {
  enrolledCourse: 3.0,
  weakTopic: 2.5,
  interestTopic: 1.8,
  cohort: 1.5,
  academicKind: 1.0,
  /** The author told the system what this is. Structured beats unstructured. */
  classified: 1.4,
  /** It cites something. The strongest quality signal available without a model. */
  sourced: 1.6,
  social: 1.2,
  /** Deliberately the smallest positive weight. See above. */
  engagement: 0.4,
  recency: 2.0,
  /**
   * Negative. Content whose accuracy is under challenge is demoted while the
   * challenge is open — not hidden, because the disagreement is often where the
   * learning is, but not promoted into other students' feeds either.
   */
  disputed: -1.5,
  /** Applied multiplicatively, not additively — a seen item is demoted, not banished. */
  seenPenalty: 0.35,
} as const;

/**
 * Recency decays with a 36-hour half-life: fast enough for a daily-use app.
 *
 * Exported because the feed query implements this same formula in SQL, and the
 * constants must have one source of truth. A parity test asserts the two
 * implementations agree.
 */
export const RECENCY_HALF_LIFE_HOURS = 36;

export function scoreFeedCandidate(candidate: FeedCandidate, now: Date = new Date()): number {
  const ageHours = Math.max(0, (now.getTime() - candidate.createdAt.getTime()) / 3_600_000);
  const recency = Math.exp((-ageHours * Math.LN2) / RECENCY_HALF_LIFE_HOURS);

  // Engagement is log-scaled so that one runaway post cannot dominate a feed
  // that only has a hundred participants.
  const engagement = Math.log1p(candidate.likeCount + candidate.commentCount * 2);

  let score =
    (candidate.inEnrolledCourse ? FEED_WEIGHTS.enrolledCourse : 0) +
    (candidate.matchesWeakTopic ? FEED_WEIGHTS.weakTopic : 0) +
    (candidate.matchesInterestTopic ? FEED_WEIGHTS.interestTopic : 0) +
    (candidate.sameCohort ? FEED_WEIGHTS.cohort : 0) +
    (candidate.isAcademicKind ? FEED_WEIGHTS.academicKind : 0) +
    (candidate.isClassified ? FEED_WEIGHTS.classified : 0) +
    (candidate.hasSource ? FEED_WEIGHTS.sourced : 0) +
    (candidate.isDisputed ? FEED_WEIGHTS.disputed : 0) +
    candidate.socialProximity * FEED_WEIGHTS.social +
    engagement * FEED_WEIGHTS.engagement +
    recency * FEED_WEIGHTS.recency;

  if (candidate.seen) score *= FEED_WEIGHTS.seenPenalty;
  return score;
}

export function rankFeed(candidates: readonly FeedCandidate[], now: Date = new Date()): FeedCandidate[] {
  return [...candidates].sort((a, b) => scoreFeedCandidate(b, now) - scoreFeedCandidate(a, now));
}

/**
 * Caps how many consecutive items may come from one author, so a single
 * prolific poster cannot own the cohort's feed. Applied after ranking.
 */
export function diversify(ranked: readonly FeedCandidate[], maxPerAuthorInWindow = 2, window = 5): FeedCandidate[] {
  const out: FeedCandidate[] = [];
  const deferred: FeedCandidate[] = [];

  for (const item of ranked) {
    const recent = out.slice(-window);
    const fromAuthor = recent.filter((r) => r.authorId === item.authorId).length;
    if (fromAuthor >= maxPerAuthorInWindow) deferred.push(item);
    else out.push(item);
  }
  return [...out, ...deferred];
}
