import { describe, expect, it } from 'vitest';
import {
  computeWeakness,
  MIN_QUESTIONS_FOR_CONFIDENCE,
  rankWeakTopics,
  scoreMultiSelect,
  type TopicPerformance,
} from '../weakness.js';

const NOW = new Date('2026-01-31T00:00:00Z');

function perf(overrides: Partial<TopicPerformance> = {}): TopicPerformance {
  return {
    topicId: 't1',
    questionsSeen: 10,
    questionsCorrect: 5,
    lastActivityAt: new Date('2026-01-30T00:00:00Z'),
    ...overrides,
  };
}

describe('computeWeakness', () => {
  it('returns a zero signal when there is no data', () => {
    const s = computeWeakness(perf({ questionsSeen: 0, questionsCorrect: 0 }), NOW);
    expect(s).toMatchObject({ weaknessScore: 0, confidence: 0 });
  });

  it('scores a topic answered perfectly and recently as strong', () => {
    const s = computeWeakness(perf({ questionsCorrect: 10 }), NOW);
    expect(s.accuracy).toBe(1);
    expect(s.weaknessScore).toBeLessThan(0.1);
  });

  it('scores a topic answered badly as weak', () => {
    const s = computeWeakness(perf({ questionsCorrect: 1 }), NOW);
    expect(s.weaknessScore).toBeGreaterThan(0.6);
  });

  it('adds staleness for a topic not practised in months', () => {
    const recent = computeWeakness(perf({ questionsCorrect: 8 }), NOW);
    const stale = computeWeakness(
      perf({ questionsCorrect: 8, lastActivityAt: new Date('2025-06-01T00:00:00Z') }),
      NOW,
    );
    expect(stale.weaknessScore).toBeGreaterThan(recent.weaknessScore);
  });

  it('keeps the score inside 0..1 for every input', () => {
    for (const [seen, correct] of [
      [1, 0],
      [1, 1],
      [100, 0],
      [100, 100],
    ] as const) {
      const s = computeWeakness(perf({ questionsSeen: seen, questionsCorrect: correct }), NOW);
      expect(s.weaknessScore).toBeGreaterThanOrEqual(0);
      expect(s.weaknessScore).toBeLessThanOrEqual(1);
    }
  });

  it('clamps a corrupt row where correct exceeds seen', () => {
    const s = computeWeakness(perf({ questionsSeen: 3, questionsCorrect: 99 }), NOW);
    expect(s.accuracy).toBe(1);
  });

  it('grows confidence with sample size and saturates', () => {
    expect(computeWeakness(perf({ questionsSeen: 5, questionsCorrect: 2 }), NOW).confidence).toBeLessThan(
      computeWeakness(perf({ questionsSeen: 15, questionsCorrect: 6 }), NOW).confidence,
    );
    expect(computeWeakness(perf({ questionsSeen: 500, questionsCorrect: 200 }), NOW).confidence).toBe(1);
  });
});

describe('rankWeakTopics', () => {
  it('excludes topics with too small a sample rather than down-ranking them', () => {
    // Telling a student they are weak in a topic on the basis of two wrong
    // answers is worse than saying nothing.
    const ranked = rankWeakTopics(
      [
        perf({ topicId: 'tiny-sample', questionsSeen: 2, questionsCorrect: 0 }),
        perf({ topicId: 'real', questionsSeen: 20, questionsCorrect: 8 }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.topicId)).toEqual(['real']);
  });

  it('uses the documented minimum sample threshold', () => {
    const atThreshold = rankWeakTopics(
      [perf({ topicId: 'edge', questionsSeen: MIN_QUESTIONS_FOR_CONFIDENCE, questionsCorrect: 1 })],
      NOW,
    );
    expect(atThreshold).toHaveLength(1);
  });

  it('orders the weakest, best-evidenced topic first', () => {
    const ranked = rankWeakTopics(
      [
        perf({ topicId: 'strong', questionsSeen: 20, questionsCorrect: 19 }),
        perf({ topicId: 'weak', questionsSeen: 20, questionsCorrect: 4 }),
        perf({ topicId: 'middling', questionsSeen: 20, questionsCorrect: 12 }),
      ],
      NOW,
    );
    expect(ranked[0]?.topicId).toBe('weak');
    expect(ranked.at(-1)?.topicId).toBe('strong');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      perf({ topicId: `t${i}`, questionsSeen: 20, questionsCorrect: i }),
    );
    expect(rankWeakTopics(many, NOW, 5)).toHaveLength(5);
  });
});

describe('scoreMultiSelect', () => {
  it('awards full points for an exactly-correct selection', () => {
    expect(scoreMultiSelect(['a', 'b'], ['a', 'b'], 2)).toBe(2);
  });

  it('awards partial credit', () => {
    expect(scoreMultiSelect(['a'], ['a', 'b'], 2)).toBe(1);
  });

  it('penalises wrong selections so that selecting everything scores zero', () => {
    expect(scoreMultiSelect(['a', 'b', 'c', 'd'], ['a', 'b'], 2)).toBe(0);
  });

  it('never returns a negative score', () => {
    expect(scoreMultiSelect(['x', 'y', 'z'], ['a'], 5)).toBe(0);
  });

  it('returns zero when the question has no correct answer configured', () => {
    expect(scoreMultiSelect(['a'], [], 3)).toBe(0);
  });
});
