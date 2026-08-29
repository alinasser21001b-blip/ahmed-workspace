/**
 * Unit tests.
 *
 * Weighted toward the properties that would be silently wrong rather than
 * loudly broken: normalization idempotence, the review graph's safety property,
 * negation scoping, and the metric separations the thresholds depend on.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fnv1a64, fnv1a32, fingerprint } from '../src/domain/hash.ts';
import { ulid, makeIdFactory } from '../src/domain/ids.ts';
import {
  normalizeForDisplay,
  normalizeForMatching,
  detectScript,
  assessTextQuality,
  foldDigits,
} from '../src/text/normalize.ts';
import { tokenize, stemEnglish, stemArabic } from '../src/text/tokenize.ts';
import {
  levenshtein,
  jaro,
  jaroWinkler,
  diceCoefficient,
  compositeSimilarity,
  calibrateThreshold,
  buildIdf,
  weightedJaccard,
  containment,
} from '../src/text/similarity.ts';
import { phoneticKey, blockingKeys, stripTitles } from '../src/text/phonetic.ts';
import { simhash, hammingDistance, MinHasher, LshIndex } from '../src/text/simhash.ts';
import { Lexicon, defaultLexicon } from '../src/text/lexicon.ts';
import {
  annotateContext,
  annotateContextDetailed,
  externalSpanContext,
  spanContext,
} from '../src/text/negation.ts';
import {
  applyReview,
  pathsToPublished,
  REVIEWER_ACTIONS,
  legalActions,
  isStudentVisible,
} from '../src/review/state-machine.ts';
import { SeededRandom } from '../src/station/rng.ts';
import {
  updateRatings,
  expectedScore,
  wilsonLowerBound,
  pointBiserial,
  diagnose,
  INITIAL_ITEM,
  INITIAL_ABILITY,
} from '../src/psychometrics/elo.ts';
import { redactTags, MemorySink, LatencyRecorder, checkKpi } from '../src/observability/events.ts';
import { classifyLine, segmentBlocks, resolveSpecialtyAlias } from '../src/ingestion/segmenter.ts';
import { inferCategory } from '../src/ingestion/extractor.ts';
import { scorePair, decide, DEFAULT_THRESHOLDS } from '../src/resolution/fellegi-sunter.ts';
import { profileName, EXAMINER_FIELDS } from '../src/resolution/examiner-resolver.ts';
import { chooseCanonicalText } from '../src/resolution/question-dedup.ts';
import { makeEnv, keyPoint } from './helpers.ts';
import type { ExtractionCandidate } from '../src/domain/types.ts';
import { asId } from '../src/domain/types.ts';
import { EngineError } from '../src/domain/errors.ts';

describe('hash', () => {
  test('FNV-1a 64 matches the reference vectors', () => {
    assert.equal(fnv1a64(''), 'cbf29ce484222325');
    assert.equal(fnv1a64('a'), 'af63dc4c8601ec8c');
    assert.equal(fnv1a64('foobar'), '85944171f73967e8');
    assert.equal(fnv1a64('hello world'), '779a65e7023cd2e7');
  });

  test('FNV-1a 32 matches the reference vector', () => {
    assert.equal(fnv1a32('abc').toString(16), '1a47e90b');
  });

  test('fingerprint composition is unambiguous', () => {
    // The classic failure: naive concatenation makes these two collide.
    assert.notEqual(fingerprint('ab', 'c'), fingerprint('a', 'bc'));
    // null and empty string are distinguishable.
    assert.notEqual(fingerprint('x', null), fingerprint('x', ''));
    // and it is stable.
    assert.equal(fingerprint('a', 1, null), fingerprint('a', 1, null));
  });
});

describe('ids', () => {
  test('ULIDs are sortable by creation time', () => {
    const env = makeEnv();
    const first = ulid(env.clock, env.random);
    env.clock.advance(1000);
    const second = ulid(env.clock, env.random);
    assert.ok(first < second, 'later ULID must sort after earlier');
    assert.equal(first.length, 26);
  });

  test('prefixed ids carry their type', () => {
    const env = makeEnv();
    const ids = makeIdFactory(env.clock, env.random);
    assert.match(ids.examiner(), /^exm_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.match(ids.session(), /^ses_/);
  });
});

describe('normalization', () => {
  test('both levels are idempotent', () => {
    const samples = [
      '  What  are the COMPLICATIONS—of surgery?  ',
      'ما هي مُضاعفات الجِراحة؟',
      'مضاعفات DVT بعد العملية',
      'سنة ٢٠٢٣ و ۲۰۲۴',
      '',
    ];
    for (const sample of samples) {
      const displayOnce = normalizeForDisplay(sample);
      assert.equal(normalizeForDisplay(displayOnce), displayOnce, `display: ${sample}`);
      const matchOnce = normalizeForMatching(sample);
      assert.equal(normalizeForMatching(matchOnce), matchOnce, `matching: ${sample}`);
    }
  });

  test('display normalization preserves letters', () => {
    // Conservative level must not fold Arabic orthography.
    const input = 'الحالة أُولى';
    const out = normalizeForDisplay(input);
    assert.ok(out.includes('ة'), 'teh marbuta preserved for display');
    assert.ok(out.includes('أ'), 'hamza preserved for display');
  });

  test('matching normalization folds orthographic variation', () => {
    assert.equal(normalizeForMatching('الحالة'), normalizeForMatching('الحاله'));
    assert.equal(normalizeForMatching('أحمد'), normalizeForMatching('احمد'));
    assert.equal(normalizeForMatching('علي'), normalizeForMatching('على'));
  });

  test('digit folding covers both Arabic digit families', () => {
    assert.equal(foldDigits('٢٠٢٣'), '2023');
    assert.equal(foldDigits('۲۰۲۴'), '2024');
    assert.equal(foldDigits('2025'), '2025');
  });

  test('script detection', () => {
    assert.equal(detectScript('What are the complications?'), 'en');
    assert.equal(detectScript('ما هي المضاعفات؟'), 'ar');
    assert.equal(detectScript('مضاعفات deep vein thrombosis بعد'), 'mixed');
    assert.equal(detectScript('123 !!'), 'none');
  });

  test('text quality rejects unusable extraction', () => {
    assert.equal(assessTextQuality('   ').usable, false);
    assert.equal(assessTextQuality('(cid:3)(cid:36)(cid:70)(cid:88)(cid:87)').usable, false);
    assert.equal(
      assessTextQuality('Examiner: Dr Ahmed. Q1 What are the complications?').usable,
      true,
    );
  });
});

describe('tokenize', () => {
  test('stemming is conservative', () => {
    assert.equal(stemEnglish('complications'), 'complication');
    assert.equal(stemEnglish('arteries'), 'artery');
    assert.equal(stemEnglish('swelling'), 'swell');
    // Must NOT over-stem into a different word.
    assert.notEqual(stemEnglish('operative'), stemEnglish('operator'));
    // Short words untouched.
    assert.equal(stemEnglish('gas'), 'gas');
  });

  test('arabic stemmer never goes below the root length', () => {
    for (const word of ['المضاعفات', 'بالجراحة', 'والتشخيص', 'دم']) {
      assert.ok(stemArabic(word).length >= Math.min(3, word.length));
    }
  });

  test('negation words survive tokenization', () => {
    const tokens = tokenize('no fever', { removeStopwords: false });
    assert.ok(tokens.includes('no'), '"no" must survive; it inverts the clinical meaning');
  });

  test('numeric tokens survive the length filter', () => {
    assert.ok(tokenize('give 5 mg').includes('5'));
  });
});

describe('similarity', () => {
  test('levenshtein basics and banding', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('same', 'same'), 0);
    // Banded: returns maxDistance+1 rather than the true distance.
    assert.equal(levenshtein('kitten', 'sitting', 1), 2);
    assert.ok(levenshtein('abcdefgh', 'zzzzzzzz', 2) > 2);
  });

  test('jaro and jaro-winkler', () => {
    assert.equal(jaro('same', 'same'), 1);
    assert.ok(jaro('martha', 'marhta') > 0.94);
    // Winkler boosts a shared prefix.
    assert.ok(jaroWinkler('martha', 'marhta') > jaro('martha', 'marhta'));
  });

  test('dice is multiset-aware', () => {
    assert.equal(diceCoefficient('abc', 'abc'), 1);
    assert.ok(diceCoefficient('aaa', 'aaaaaa') < 1, 'repetition must not score as identical');
  });

  test('composite similarity separates same-question from different-question', () => {
    const corpus = [
      'what are the complications of this procedure',
      'what are the main complications',
      'causes of chest pain',
      'causes of abdominal pain',
      'what is the main diagnosis',
      'investigations for chest pain',
    ].map((s) => tokenize(s));
    const idf = buildIdf(corpus);

    const score = (a: string, b: string) =>
      compositeSimilarity(
        normalizeForMatching(a),
        normalizeForMatching(b),
        tokenize(a),
        tokenize(b),
        undefined,
        idf,
      );

    const same = [
      score('what are the complications', 'what are the main complications'),
      score('complications of appendectomy', 'appendectomy complications'),
      score('what is the diagnosis', 'what is your diagnosis'),
    ];
    const different = [
      score('causes of chest pain', 'causes of abdominal pain'),
      score('what is the diagnosis', 'what is the management'),
      score('risk factors for dvt', 'complications of dvt'),
    ];

    assert.ok(
      Math.min(...same) > Math.max(...different),
      `separation failed: same=${same.map((s) => s.toFixed(3))} different=${different.map((s) => s.toFixed(3))}`,
    );
    // And the default threshold sits inside the gap.
    assert.ok(Math.min(...same) > 0.78, 'same-question pairs clear the strong threshold');
    assert.ok(Math.max(...different) < 0.78, 'different-question pairs stay below it');
  });

  test('containment distinguishes insertion from substitution', () => {
    // Insertion: one set contains the other.
    assert.equal(containment(tokenize('complications'), tokenize('main complications')), 1);
    // Substitution: neither contains the other.
    assert.ok(containment(tokenize('chest pain'), tokenize('abdominal pain')) < 1);
  });

  test('weighted jaccard downweights corpus-common tokens', () => {
    const idf = buildIdf([
      ['common', 'a'],
      ['common', 'b'],
      ['common', 'c'],
      ['common', 'rare'],
    ]);
    // Dropping a common token costs less than dropping a rare one.
    const dropCommon = weightedJaccard(new Set(['rare']), new Set(['rare', 'common']), idf);
    const dropRare = weightedJaccard(new Set(['common']), new Set(['common', 'rare']), idf);
    assert.ok(dropCommon > dropRare);
  });

  test('threshold calibration finds a separating operating point', () => {
    const pairs = [
      ['what are the complications', 'what are the main complications', true],
      ['complications of appendectomy', 'appendectomy complications', true],
      ['causes of chest pain', 'causes of abdominal pain', false],
      ['what is the diagnosis', 'what is the management', false],
    ] as const;

    const result = calibrateThreshold(
      pairs.map(([a, b, same]) => ({
        a: normalizeForMatching(a),
        b: normalizeForMatching(b),
        aTokens: tokenize(a),
        bTokens: tokenize(b),
        same,
      })),
    );
    assert.equal(result.precision, 1);
    assert.equal(result.recall, 1);
    assert.ok(result.margin > 0, 'the classes must be linearly separable on this metric');
  });
});

describe('phonetic blocking', () => {
  test('transliteration variants share a block', () => {
    assert.equal(phoneticKey('Khalid'), phoneticKey('Khaled'));
    assert.equal(phoneticKey('Mohammed'), phoneticKey('Muhammad'));
    assert.equal(phoneticKey('Abdullah'), phoneticKey('Abdulah'));
    assert.equal(phoneticKey('Ali'), phoneticKey('Aly'));
  });

  test('keys never collapse to a single character', () => {
    for (const name of ['Ali', 'Ola', 'Ay', 'Ibrahim', 'Ahmed']) {
      assert.ok(phoneticKey(name).length >= 2, `${name} -> ${phoneticKey(name)}`);
    }
  });

  test('blocking is order-insensitive across name forms', () => {
    const a = blockingKeys(['dr', 'ahmed', 'hassan']);
    const b = blockingKeys(['hassan', 'ahmed']);
    assert.ok(a.some((k) => b.includes(k)), 'surname-first form must still share a key');
  });

  test('titles are stripped', () => {
    assert.deepEqual(stripTitles(['dr', 'ahmed', 'hassan']), ['ahmed', 'hassan']);
    assert.deepEqual(stripTitles(['دكتور', 'احمد']), ['احمد']);
  });
});

describe('near-duplicate structures', () => {
  test('simhash distance tracks textual similarity', () => {
    const a = simhash(tokenize('what are the complications of appendectomy'));
    const b = simhash(tokenize('what are the main complications of appendectomy'));
    const c = simhash(tokenize('describe the anatomy of the femoral canal'));
    assert.ok(hammingDistance(a, b) < hammingDistance(a, c));
  });

  test('minhash estimates jaccard', () => {
    const hasher = new MinHasher(256);
    const a = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const b = ['a', 'b', 'c', 'd', 'e', 'f', 'x', 'y'];
    const trueJaccard = 6 / 10;
    const estimate = MinHasher.estimateJaccard(hasher.signature(a), hasher.signature(b));
    assert.ok(Math.abs(estimate - trueJaccard) < 0.12, `estimate ${estimate} vs true ${trueJaccard}`);
  });

  test('lsh index retrieves similar items', () => {
    const hasher = new MinHasher(64);
    const index = new LshIndex<string>();
    const docs = [
      'what are the complications of appendectomy',
      'what are the main complications of appendectomy',
      'describe the anatomy of the femoral canal',
    ];
    for (const doc of docs) {
      index.add(hasher.bandKeys(hasher.signature(tokenize(doc))), doc);
    }
    const query = 'what are the complications of appendectomy surgery';
    const hits = index.query(hasher.bandKeys(hasher.signature(tokenize(query))));
    assert.ok(hits.includes(docs[0] as string), 'near-duplicate must be retrieved');
  });
});

describe('lexicon', () => {
  test('abbreviation and long form map to one concept', () => {
    const concepts = defaultLexicon.conceptsIn(tokenize('patient with DVT'));
    const longForm = defaultLexicon.conceptsIn(tokenize('deep vein thrombosis of the leg'));
    assert.deepEqual([...concepts], [...longForm]);
  });

  test('arabic and english surface forms map to one concept', () => {
    const en = defaultLexicon.conceptsIn(tokenize('deep vein thrombosis'));
    const ar = defaultLexicon.conceptsIn(tokenize('جلطة وريدية عميقة'));
    assert.deepEqual([...en], [...ar]);
  });

  test('longest form wins over its components', () => {
    const matches = defaultLexicon.annotate(tokenize('deep vein thrombosis'));
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.conceptId, 'C:DVT');
  });

  test('concept hierarchy supports broader matching', () => {
    assert.ok(defaultLexicon.isNarrowerOrEqual('C:DVT', 'C:THROMBOSIS'));
    assert.ok(!defaultLexicon.isNarrowerOrEqual('C:THROMBOSIS', 'C:DVT'));
    assert.ok(defaultLexicon.withBroader(new Set(['C:DVT'])).has('C:THROMBOSIS'));
  });

  test('a custom vocabulary can replace the default', () => {
    const custom = new Lexicon([
      { id: 'C:TEST', preferred: 'test concept', forms: ['foo', 'bar baz'] },
    ]);
    assert.equal(custom.size, 1);
    assert.ok(custom.conceptsIn(tokenize('bar baz here')).has('C:TEST'));
  });
});

describe('negation', () => {
  test('pre-trigger negates what follows', () => {
    const tokens = tokenize('there is no evidence of dvt', { removeStopwords: false });
    const context = annotateContext(tokens);
    const index = tokens.indexOf('dvt');
    assert.equal(context[index], 'NEGATED');
  });

  test('post-trigger negates what precedes', () => {
    const tokens = tokenize('dvt was ruled out', { removeStopwords: false });
    const context = annotateContext(tokens);
    assert.equal(context[tokens.indexOf('dvt')], 'NEGATED');
  });

  test('a terminator ends the negation scope', () => {
    const tokens = tokenize('no fever but there is pain', { removeStopwords: false });
    const context = annotateContext(tokens);
    assert.equal(context[tokens.indexOf('fever')], 'NEGATED');
    assert.equal(context[tokens.indexOf('pain')], 'AFFIRMED');
  });

  test('hedges are distinguished from negation', () => {
    const tokens = tokenize('possibly pulmonary embolism', { removeStopwords: false });
    const context = annotateContext(tokens);
    assert.equal(context[tokens.indexOf('embolism')], 'HEDGED');
  });

  test('a trigger inside the matched span does not negate that span', () => {
    // The regression that scored an asserted pitfall as CORRECT.
    const tokens = tokenize('antibiotics cure appendicitis without surgery', {
      removeStopwords: false,
    });
    const detailed = annotateContextDetailed(tokens);
    assert.equal(
      spanContext(detailed.map((d) => d.kind), 0, tokens.length),
      'NEGATED',
      'the naive reading is NEGATED',
    );
    assert.equal(
      externalSpanContext(detailed, 0, tokens.length),
      'AFFIRMED',
      'but a trigger inside the span is part of the claim',
    );
  });

  test('an external trigger still negates', () => {
    const tokens = tokenize('there is no deep vein thrombosis', { removeStopwords: false });
    const detailed = annotateContextDetailed(tokens);
    const start = tokens.indexOf('deep');
    assert.equal(externalSpanContext(detailed, start, start + 3), 'NEGATED');
  });

  test('detection survives stemmed tokens', () => {
    // "denied" stems to "deni"; the trigger table must still match it.
    const tokens = tokenize('patient denied fever', { removeStopwords: false });
    const context = annotateContext(tokens);
    assert.equal(context[tokens.indexOf('fever')], 'NEGATED');
  });
});

describe('review state machine', () => {
  const baseCandidate: ExtractionCandidate = {
    id: asId('cnd_1'),
    documentId: asId('doc_1'),
    extractionRunId: asId('run_1'),
    type: 'QUESTION',
    state: 'PENDING',
    rawText: 'Q1. What are the complications?',
    proposedText: 'What are the complications?',
    editedText: null,
    sourceReferenceId: asId('src_1'),
    confidence: 0.8,
    segmentKey: 'seg-1',
    specialtyId: null,
    academicYear: 2024,
    category: 'COMPLICATION',
    mergedIntoCandidateId: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
  };

  test('SAFETY: no path from PENDING to PUBLISHED skips a human', () => {
    const paths = pathsToPublished();
    assert.ok(paths.length > 0, 'there must be at least one publish path');
    for (const path of paths) {
      const hasHumanStep = path.some((action) => REVIEWER_ACTIONS.includes(action));
      assert.ok(
        hasHumanStep,
        `path [${path.join(' -> ')}] reaches PUBLISHED with no reviewer action`,
      );
    }
  });

  test('PUBLISH is rejected directly from PENDING', () => {
    assert.throws(
      () => applyReview(baseCandidate, { action: 'PUBLISH', reviewerId: null, at: 1 }),
      (error: unknown) =>
        error instanceof EngineError && error.code === 'INVALID_STATE_TRANSITION',
    );
  });

  test('reviewer actions require an identified reviewer', () => {
    assert.throws(
      () => applyReview(baseCandidate, { action: 'APPROVE', reviewerId: null, at: 1 }),
      (error: unknown) => error instanceof EngineError && error.code === 'UNREVIEWED_CANDIDATE',
    );
  });

  test('EDIT stores the corrected text', () => {
    const edited = applyReview(baseCandidate, {
      action: 'EDIT',
      reviewerId: 'r1',
      at: 5,
      editedText: 'What are the main complications?',
    });
    assert.equal(edited.state, 'EDITED');
    assert.equal(edited.editedText, 'What are the main complications?');
    assert.equal(edited.reviewedBy, 'r1');
  });

  test('MERGE requires a distinct target', () => {
    assert.throws(() =>
      applyReview(baseCandidate, {
        action: 'MERGE',
        reviewerId: 'r1',
        at: 5,
        mergeInto: baseCandidate.id,
      }),
    );
  });

  test('only PUBLISHED is student visible', () => {
    for (const state of ['PENDING', 'APPROVED', 'EDITED', 'REJECTED', 'MERGED'] as const) {
      assert.equal(isStudentVisible(state), false, `${state} must not be student visible`);
    }
    assert.equal(isStudentVisible('PUBLISHED'), true);
  });

  test('terminal states have no outgoing actions except REOPEN from REJECTED', () => {
    assert.deepEqual(legalActions('PUBLISHED'), []);
    assert.deepEqual(legalActions('REJECTED'), ['REOPEN']);
  });
});

describe('seeded rng', () => {
  test('the same seed reproduces the same sequence', () => {
    const a = new SeededRandom('seed-1');
    const b = new SeededRandom('seed-1');
    for (let i = 0; i < 100; i++) assert.equal(a.nextUint32(), b.nextUint32());
  });

  test('different seeds diverge, including adjacent low-entropy ones', () => {
    const a = new SeededRandom('1');
    const b = new SeededRandom('2');
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextUint32() === b.nextUint32()) same++;
    assert.ok(same < 3, `sequences must diverge, matched ${same}/100`);
  });

  test('nextInt is uniform enough and never out of range', () => {
    const rng = new SeededRandom('uniform');
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 70000; i++) {
      const value = rng.nextInt(7);
      assert.ok(value >= 0 && value < 7);
      counts[value]++;
    }
    for (const count of counts) {
      assert.ok(Math.abs(count - 10000) < 600, `bucket skew too large: ${counts.join(',')}`);
    }
  });

  test('shuffle is a permutation', () => {
    const rng = new SeededRandom('shuffle');
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    assert.deepEqual([...out].sort((a, b) => a - b), input);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6, 7, 8], 'input must not be mutated');
  });

  test('weighted sampling favours heavier items', () => {
    let heavyFirst = 0;
    for (let trial = 0; trial < 500; trial++) {
      const rng = new SeededRandom(`w:${trial}`);
      const picked = rng.weightedSample(['heavy', 'light'], [10, 1], 1);
      if (picked[0] === 'heavy') heavyFirst++;
    }
    assert.ok(heavyFirst > 300, `heavy item chosen ${heavyFirst}/500 times`);
  });
});

describe('psychometrics', () => {
  test('expected score follows the logistic curve', () => {
    assert.equal(expectedScore(0, 0), 0.5);
    assert.ok(expectedScore(2, 0) > 0.85);
    assert.ok(expectedScore(-2, 0) < 0.15);
  });

  test('elo converges toward a true difficulty', () => {
    let item = INITIAL_ITEM;
    let ability = { ...INITIAL_ABILITY, ability: 0 };
    // A learner of ability 0 answering an item of true difficulty +1 succeeds
    // about 27% of the time; feed that pattern and the estimate should rise.
    for (let i = 0; i < 400; i++) {
      const observed = i % 100 < 27 ? 1 : 0;
      const result = updateRatings(item, ability, observed);
      item = result.item;
      ability = { ...result.ability, ability: 0 }; // hold ability fixed
    }
    assert.ok(item.difficulty > 0.3, `difficulty should rise, got ${item.difficulty}`);
  });

  test('wilson bound orders small samples sensibly', () => {
    const oneOfOne = wilsonLowerBound(1, 1);
    const manyOfMany = wilsonLowerBound(480, 500);
    assert.ok(manyOfMany > oneOfOne, 'a large well-performing sample must outrank 1/1');
    assert.equal(wilsonLowerBound(0, 0), 0);
  });

  test('point-biserial detects a miskeyed item', () => {
    // Item scores anti-correlated with total scores.
    const total = [1, 2, 3, 4, 5, 6, 7, 8];
    const good = [0, 0, 0, 1, 0, 1, 1, 1];
    const bad = [1, 1, 1, 0, 1, 0, 0, 0];
    assert.ok(pointBiserial(good, total) > 0.5);
    assert.ok(pointBiserial(bad, total) < -0.5);
  });

  test('diagnose flags the right conditions', () => {
    const total = Array.from({ length: 40 }, (_, i) => i);
    const antiCorrelated = total.map((t) => (t < 20 ? 1 : 0));
    assert.equal(
      diagnose('q1', antiCorrelated, total, INITIAL_ITEM).flag,
      'NEGATIVE_DISCRIMINATION',
    );
    assert.equal(diagnose('q2', [1, 1, 1], [1, 2, 3], INITIAL_ITEM).flag, 'INSUFFICIENT_DATA');
    assert.equal(
      diagnose('q3', new Array(40).fill(1), total, INITIAL_ITEM).flag,
      'TOO_EASY',
    );
  });
});

describe('observability', () => {
  test('redaction is an allowlist', () => {
    const tags = redactTags({
      documentId: 'doc_1',
      studentAnswer: 'the patient has DVT',
      keyPoints: 'wound infection',
      sessionId: 'ses_1',
    });
    assert.deepEqual(tags, { documentId: 'doc_1', sessionId: 'ses_1' });
  });

  test('long values are truncated', () => {
    const tags = redactTags({ reason: 'x'.repeat(500) });
    assert.equal(tags?.['reason']?.length, 64);
  });

  test('memory sink redacts on emit', () => {
    const sink = new MemorySink();
    sink.emit({
      name: 'evaluation.success',
      stage: 'evaluation',
      at: 1,
      correlationId: 'c1',
      outcome: 'ok',
      tags: { sessionId: 's1', studentAnswer: 'leak' } as Record<string, string>,
    });
    assert.equal(sink.events[0]?.tags?.['studentAnswer'], undefined);
    assert.equal(sink.byName('evaluation.success').length, 1);
  });

  test('latency percentiles are exact', () => {
    const recorder = new LatencyRecorder();
    for (let i = 1; i <= 100; i++) recorder.record(i);
    assert.equal(recorder.percentile(50), 50);
    assert.equal(recorder.percentile(95), 95);
    assert.equal(recorder.summary.max, 100);
  });

  test('KPI checks compare in the right direction', () => {
    assert.equal(checkKpi('station.create.p95', 700)?.pass, true);
    assert.equal(checkKpi('station.create.p95', 900)?.pass, false);
    assert.equal(checkKpi('extraction.precision', 0.95)?.pass, true);
    assert.equal(checkKpi('extraction.precision', 0.85)?.pass, false);
    assert.equal(checkKpi('nonexistent', 1), null);
  });
});

describe('segmentation', () => {
  const block = (text: string, line: number) => ({
    text,
    page: null,
    line,
    charStart: 0,
    charEnd: text.length,
  });

  test('explicit markers beat shape heuristics', () => {
    assert.equal(classifyLine(block('Examiner: Dr. Ahmed Hassan', 1)).label, 'EXAMINER');
    assert.equal(classifyLine(block('Case: Acute Appendicitis', 2)).label, 'CASE');
    assert.equal(classifyLine(block('Q1. What are the complications?', 3)).label, 'QUESTION');
    assert.equal(classifyLine(block('A: Wound infection', 4)).label, 'ANSWER');
    assert.equal(classifyLine(block('Year: 2024', 5)).label, 'YEAR');
  });

  test('an explicit marker outranks an inferred one in confidence', () => {
    const explicit = classifyLine(block('Q1: What are the complications?', 1));
    const inferred = classifyLine(block('What are the complications?', 2));
    assert.ok(explicit.confidence > inferred.confidence);
  });

  test('noise is recognised', () => {
    for (const noise of ['-----', 'Page 3', '2 / 8', 'Good luck']) {
      assert.equal(classifyLine(block(noise, 1)).label, 'NOISE', noise);
    }
  });

  test('weak structure triggers review', () => {
    const blocks = ['Some prose about surgery.', 'More prose here.', 'And more.'].map((t, i) =>
      block(t, i + 1),
    );
    assert.equal(segmentBlocks(blocks).reviewRequired, true);
  });

  test('specialty aliases resolve, unknown ones do not', () => {
    assert.equal(resolveSpecialtyAlias('Paediatrics'), 'Pediatrics');
    assert.equal(resolveSpecialtyAlias('طب الاطفال'), 'Pediatrics');
    assert.equal(resolveSpecialtyAlias('Astrophysics'), null);
    assert.equal(resolveSpecialtyAlias(null), null);
  });

  test('category inference matches whole tokens only', () => {
    // The "inTESTinal" regression.
    assert.equal(inferCategory('What are the causes of intestinal obstruction?'), 'UNCLASSIFIED');
    assert.equal(inferCategory('Which tests confirm it?'), 'INVESTIGATION');
    assert.equal(inferCategory('What are the complications?'), 'COMPLICATION');
    assert.equal(inferCategory('ما هي مضاعفات العملية؟'), 'COMPLICATION');
  });
});

describe('fellegi-sunter', () => {
  test('identical names score far above different ones', () => {
    const a = profileName('Dr. Ahmed Hassan');
    const identical = scorePair(a, profileName('Dr. Ahmed Hassan'), EXAMINER_FIELDS);
    const different = scorePair(a, profileName('Dr. Sara Al-Kadhimi'), EXAMINER_FIELDS);
    assert.ok(identical.probability > different.probability);
    assert.ok(identical.matchWeight > different.matchWeight);
  });

  test('every field contributes an explainable weight', () => {
    const score = scorePair(
      profileName('Dr. Ahmed Hassan'),
      profileName('Dr. Ahmed Hussein'),
      EXAMINER_FIELDS,
    );
    assert.equal(score.evidence.length, EXAMINER_FIELDS.length);
    for (const item of score.evidence) {
      assert.ok(Number.isFinite(item.logBayesFactor));
      assert.ok(item.level.length > 0);
    }
  });

  test('the three-band decision covers the probability range', () => {
    assert.equal(decide({ matchWeight: 20, probability: 0.999, evidence: [] }), 'MATCH');
    assert.equal(decide({ matchWeight: 0, probability: 0.8, evidence: [] }), 'AMBIGUOUS');
    assert.equal(decide({ matchWeight: -20, probability: 0.01, evidence: [] }), 'NO_MATCH');
    assert.ok(DEFAULT_THRESHOLDS.matchAbove > DEFAULT_THRESHOLDS.noMatchBelow);
  });
});

describe('canonical text selection', () => {
  test('prefers the most complete phrasing', () => {
    const chosen = chooseCanonicalText([
      'complications',
      'What are the complications of appendectomy?',
      'and the complications',
    ]);
    assert.equal(chosen, 'What are the complications of appendectomy?');
  });

  test('handles an empty list', () => {
    assert.equal(chooseCanonicalText([]), '');
  });
});

describe('evaluation edge cases', () => {
  test('an empty key point list cannot produce a correct answer', async () => {
    const { DeterministicEvaluator } = await import('../src/evaluation/evaluator.ts');
    const result = new DeterministicEvaluator().evaluate({
      question: 'q',
      referenceAnswer: 'r',
      keyPoints: [],
      studentAnswer: 'anything at all',
    });
    assert.equal(result.correctness, 'INCORRECT');
    assert.equal(result.score, 0);
  });

  test('a pitfall-only key never awards credit', async () => {
    const { DeterministicEvaluator } = await import('../src/evaluation/evaluator.ts');
    const result = new DeterministicEvaluator().evaluate({
      question: 'q',
      referenceAnswer: 'r',
      keyPoints: [keyPoint('p1', 'give aspirin', [], 0, true)],
      studentAnswer: 'I would give aspirin',
    });
    assert.equal(result.correctness, 'INCORRECT');
    assert.deepEqual(result.triggeredPitfalls, ['p1']);
  });

  test('weights change the score proportionally', async () => {
    const { DeterministicEvaluator } = await import('../src/evaluation/evaluator.ts');
    const evaluator = new DeterministicEvaluator();
    const points = [keyPoint('a', 'alpha', [], 3), keyPoint('b', 'beta', [], 1)];
    const gotHeavy = evaluator.evaluate({
      question: 'q',
      referenceAnswer: 'r',
      keyPoints: points,
      studentAnswer: 'alpha',
    });
    const gotLight = evaluator.evaluate({
      question: 'q',
      referenceAnswer: 'r',
      keyPoints: points,
      studentAnswer: 'beta',
    });
    assert.equal(gotHeavy.score, 0.75);
    assert.equal(gotLight.score, 0.25);
  });

  test('unmatched terms are reported for reviewer feedback', async () => {
    const { DeterministicEvaluator } = await import('../src/evaluation/evaluator.ts');
    const result = new DeterministicEvaluator().evaluate({
      question: 'q',
      referenceAnswer: 'r',
      keyPoints: [keyPoint('a', 'bleeding')],
      studentAnswer: 'bleeding and pneumoperitoneum and evisceration',
    });
    // These two are real complications the vocabulary does not know yet.
    assert.ok(result.unmatchedTerms.some((t) => t.startsWith('pneumoperitoneum')));
    assert.ok(result.unmatchedTerms.some((t) => t.startsWith('eviscerat')));
  });
});
