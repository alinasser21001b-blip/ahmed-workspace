/**
 * Head-to-head comparison: the shipped evaluator against the V2 evaluator.
 *
 * The shipped implementation is reproduced faithfully below from
 * `lib/evaluation.ts` and `lib/knowledge/normalization.ts` in the handoff
 * package, so the comparison runs the same logic rather than a description of
 * it. Nothing in the handoff package is modified.
 *
 * Run:  node --experimental-strip-types docs/compare_evaluators.ts
 */

import { DeterministicEvaluator } from '../src/evaluation/evaluator.ts';
import type { KeyPoint } from '../src/domain/types.ts';

// ---------------------------------------------------------------------------
// Shipped implementation, reproduced verbatim in behaviour.
//   lib/knowledge/normalization.ts  -> normalizeText
//   lib/evaluation.ts               -> DeterministicAnswerEvaluationProvider
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/[،؛]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface ShippedResult {
  correctness: 'CORRECT' | 'PARTIAL' | 'INCORRECT';
  score: number;
  coveredPoints: string[];
  missingPoints: string[];
}

function shippedEvaluate(keyPointTexts: string[], studentAnswer: string): ShippedResult {
  const answer = normalizeText(studentAnswer).toLocaleLowerCase();
  const keyPoints = keyPointTexts.map(normalizeText).filter(Boolean);
  if (!answer || !keyPoints.length) throw new Error('AI_EVALUATION_UNAVAILABLE');

  const coveredPoints = keyPoints.filter((point) => answer.includes(point.toLocaleLowerCase()));
  const missingPoints = keyPoints.filter((point) => !coveredPoints.includes(point));
  const score = coveredPoints.length / keyPoints.length;
  const correctness = score === 1 ? 'CORRECT' : score > 0 ? 'PARTIAL' : 'INCORRECT';
  return { correctness, score, coveredPoints, missingPoints };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const kp = (id: string, text: string, synonyms: string[] = []): KeyPoint => ({
  id,
  text,
  synonyms,
  weight: 1,
  isPitfall: false,
});

interface Case {
  readonly label: string;
  readonly keyPoints: readonly KeyPoint[];
  readonly answer: string;
  /** What a medical reviewer would mark this. */
  readonly truth: 'CORRECT' | 'PARTIAL' | 'INCORRECT';
  readonly why: string;
}

const APPENDECTOMY = [
  kp('k1', 'wound infection', ['surgical site infection', 'ssi']),
  kp('k2', 'bleeding', ['haemorrhage', 'hemorrhage']),
  kp('k3', 'deep vein thrombosis', ['dvt']),
  kp('k4', 'adhesions'),
];

const CASES: readonly Case[] = [
  {
    label: 'Exact wording, all four points',
    keyPoints: APPENDECTOMY,
    answer: 'wound infection, bleeding, deep vein thrombosis, adhesions',
    truth: 'CORRECT',
    why: 'Baseline. Both should agree.',
  },
  {
    label: 'Standard abbreviation',
    keyPoints: APPENDECTOMY,
    answer: 'wound infection, bleeding, DVT, adhesions',
    truth: 'CORRECT',
    why: 'DVT is the universal abbreviation. A student writing it has answered correctly.',
  },
  {
    label: 'NEGATED mention',
    keyPoints: APPENDECTOMY,
    answer: 'wound infection, bleeding, adhesions, but there is no evidence of deep vein thrombosis',
    truth: 'PARTIAL',
    why: 'The student explicitly EXCLUDED DVT. Crediting it awards a mark for the opposite of the answer.',
  },
  {
    label: 'Arabic answer against an English key',
    keyPoints: APPENDECTOMY,
    answer: 'التهاب الجرح، نزف، جلطة وريدية عميقة، التصاقات',
    truth: 'CORRECT',
    why: 'Bilingual cohort. The same four complications, written in Arabic.',
  },
  {
    label: 'Spelling errors',
    keyPoints: APPENDECTOMY,
    answer: 'wond infecton, bleding, deep vein thrombosis, adhesions',
    truth: 'CORRECT',
    why: 'Typing under exam pressure. The clinical content is complete.',
  },
  {
    label: 'British/American spelling variant',
    keyPoints: APPENDECTOMY,
    answer: 'wound infection, haemorrhage, deep vein thrombosis, adhesions',
    truth: 'CORRECT',
    why: 'Haemorrhage is a listed synonym of bleeding.',
  },
  {
    label: 'Singular where the key is plural',
    keyPoints: APPENDECTOMY,
    answer: 'wound infection, bleeding, deep vein thrombosis, adhesion',
    truth: 'CORRECT',
    why: 'Inflection only.',
  },
  {
    label: 'Substring false positive',
    keyPoints: [kp('t1', 'test'), kp('t2', 'ultrasound')],
    answer: 'the patient has intestinal obstruction seen on ultrasound',
    truth: 'PARTIAL',
    why: 'The student never mentioned a test. "inTESTinal" contains the key point as a substring.',
  },
  {
    label: 'Hedged mention',
    keyPoints: [kp('h1', 'deep vein thrombosis', ['dvt'])],
    answer: 'possibly deep vein thrombosis',
    truth: 'PARTIAL',
    why: 'Hedged, not asserted. Full credit overstates what the student committed to.',
  },
  {
    label: 'Broader but true answer',
    keyPoints: [kp('b1', 'deep vein thrombosis', ['dvt'])],
    answer: 'thrombosis',
    truth: 'PARTIAL',
    why: 'True but less specific. Zero is harsh; full credit is generous.',
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const v2 = new DeterministicEvaluator();

let shippedAgree = 0;
let v2Agree = 0;

console.log('Evaluator comparison: shipped implementation vs V2 engine');
console.log('='.repeat(112));
console.log('');

for (const testCase of CASES) {
  const keyTexts = testCase.keyPoints.map((p) => p.text);

  let shipped: ShippedResult | { correctness: string; score: number };
  try {
    shipped = shippedEvaluate(keyTexts, testCase.answer);
  } catch {
    shipped = { correctness: 'ERROR', score: 0 };
  }

  const modern = v2.evaluate({
    question: 'What are the complications?',
    referenceAnswer: keyTexts.join(', '),
    keyPoints: testCase.keyPoints,
    studentAnswer: testCase.answer,
  });

  const shippedOk = shipped.correctness === testCase.truth;
  const v2Ok = modern.correctness === testCase.truth;
  if (shippedOk) shippedAgree++;
  if (v2Ok) v2Agree++;

  console.log(`${testCase.label}`);
  console.log(`  answer   : ${testCase.answer}`);
  console.log(`  reviewer : ${testCase.truth}`);
  console.log(
    `  shipped  : ${(shippedOk ? 'ok  ' : 'WRONG')} ${shipped.correctness.padEnd(9)} score=${shipped.score.toFixed(2)}`,
  );
  console.log(
    `  V2       : ${(v2Ok ? 'ok  ' : 'WRONG')} ${modern.correctness.padEnd(9)} score=${modern.score.toFixed(2)}`,
  );
  if (!shippedOk) console.log(`  impact   : ${testCase.why}`);
  console.log('');
}

console.log('='.repeat(112));
console.log(`shipped implementation : ${shippedAgree}/${CASES.length} agree with a reviewer`);
console.log(`V2 engine              : ${v2Agree}/${CASES.length} agree with a reviewer`);
