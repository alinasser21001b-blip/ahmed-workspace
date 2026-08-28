import { describe, expect, it } from 'vitest';
import { evaluateAgainstKey } from './service';

describe('heuristic evaluation', () => {
  it('scores an empty answer as incorrect without inventing facts', () => {
    const result = evaluateAgainstKey({
      question: 'What are the complications of nephrotic syndrome?',
      expectedAnswer: 'Infection, thrombosis, hypovolemia, acute kidney injury.',
      studentAnswer: '',
    });
    expect(result.correctness).toBe('INCORRECT');
    expect(result.score).toBe(0);
    expect(result.source).toBe('heuristic');
    expect(result.missingPoints.length).toBeGreaterThan(0);
  });

  it('gives partial credit when some expected points are covered', () => {
    const result = evaluateAgainstKey({
      question: 'What are the complications of nephrotic syndrome?',
      expectedAnswer: 'Infection. Thrombosis. Hypovolemia. Acute kidney injury.',
      studentAnswer: 'Infection and thrombosis',
    });
    expect(result.correctness).toBe('PARTIAL');
    expect(result.coveredPoints.join(' ').toLowerCase()).toMatch(/infection/);
    expect(result.missingPoints.join(' ').toLowerCase()).toMatch(/hypovolemia|kidney/);
  });

  it('accepts a close diagnosis match', () => {
    const result = evaluateAgainstKey({
      question: 'What is the most likely diagnosis?',
      expectedAnswer: 'Nephrotic syndrome.',
      studentAnswer: 'nephrotic syndrome',
    });
    expect(result.correctness).toBe('CORRECT');
    expect(result.score).toBeGreaterThanOrEqual(0.85);
  });
});
