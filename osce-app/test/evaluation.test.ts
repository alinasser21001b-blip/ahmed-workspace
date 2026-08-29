import assert from 'node:assert/strict';
import test from 'node:test';
import { DeterministicAnswerEvaluationProvider } from '../lib/evaluation';

const evaluate = (keyPoints: string[], studentAnswer: string) =>
  new DeterministicAnswerEvaluationProvider().evaluate({
    question: 'What are the complications of appendectomy?',
    referenceAnswer: keyPoints.join(', '),
    keyPoints,
    studentAnswer,
  });

const COMPLICATIONS = ['wound infection', 'bleeding', 'deep vein thrombosis', 'adhesions'];

/**
 * These cases are the ones the previous substring matcher got wrong. Each is
 * written against what a medical reviewer would mark, not against whatever the
 * implementation happens to return.
 */

test('credits a standard abbreviation', async () => {
  const result = await evaluate(COMPLICATIONS, 'wound infection, bleeding, DVT, adhesions');
  assert.equal(result.correctness, 'CORRECT');
  assert.equal(result.score, 1);
});

test('does NOT credit a negated mention', async () => {
  const result = await evaluate(
    COMPLICATIONS,
    'wound infection, bleeding, adhesions, but there is no evidence of deep vein thrombosis',
  );
  assert.equal(result.correctness, 'PARTIAL');
  assert.ok(
    result.missingPoints.includes('deep vein thrombosis'),
    'a point the student explicitly excluded must not be reported as covered',
  );
});

test('credits an Arabic answer against an English key', async () => {
  const result = await evaluate(COMPLICATIONS, 'التهاب الجرح، نزف، جلطة وريدية عميقة، التصاقات');
  assert.equal(result.correctness, 'CORRECT');
});

test('tolerates spelling errors', async () => {
  const result = await evaluate(COMPLICATIONS, 'wond infecton, bleding, deep vein thrombosis, adhesions');
  assert.equal(result.correctness, 'CORRECT');
});

test('credits a recognised synonym', async () => {
  const result = await evaluate(COMPLICATIONS, 'wound infection, haemorrhage, deep vein thrombosis, adhesions');
  assert.equal(result.correctness, 'CORRECT');
});

test('matches whole tokens, not substrings', async () => {
  // "inTESTinal" contains "test"; the student never mentioned a test.
  const result = await evaluate(['test', 'ultrasound'], 'the patient has intestinal obstruction seen on ultrasound');
  assert.equal(result.correctness, 'PARTIAL');
  assert.deepEqual(result.coveredPoints, ['ultrasound']);
  assert.deepEqual(result.missingPoints, ['test']);
});

test('discounts a hedged mention rather than crediting it in full', async () => {
  const result = await evaluate(['deep vein thrombosis'], 'possibly deep vein thrombosis');
  assert.equal(result.correctness, 'PARTIAL');
  assert.ok(result.score > 0 && result.score < 1);
});

test('gives partial credit for a broader but true answer', async () => {
  const result = await evaluate(['deep vein thrombosis'], 'thrombosis');
  assert.equal(result.correctness, 'PARTIAL');
});

test('preserves the previous contract for exact answers', async () => {
  const result = await evaluate(
    ['infection', 'thrombosis', 'hypovolemia'],
    'Infection and thrombosis.',
  );
  assert.equal(result.correctness, 'PARTIAL');
  assert.deepEqual(result.missingPoints, ['hypovolemia']);
});

test('reports point TEXT, not internal identifiers', async () => {
  const result = await evaluate(COMPLICATIONS, 'wound infection only');
  for (const point of [...result.coveredPoints, ...result.missingPoints]) {
    assert.ok(COMPLICATIONS.includes(point), `${point} must be one of the supplied key points`);
  }
});

test('feedback fits the stored column', async () => {
  const many = Array.from({ length: 30 }, (_, i) => `key point number ${i}`);
  const result = await evaluate(many, 'none of them');
  assert.ok(result.feedback.length <= 280);
});

test('refuses to score with no key points', async () => {
  await assert.rejects(() => evaluate([], 'anything'), /AI_EVALUATION_UNAVAILABLE/);
});

test('refuses to score an empty answer', async () => {
  await assert.rejects(() => evaluate(COMPLICATIONS, '   '), /AI_EVALUATION_UNAVAILABLE/);
});
