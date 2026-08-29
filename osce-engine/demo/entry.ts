/**
 * Browser entry point for the live demo.
 *
 * Bundles the real engine - the same modules the tests exercise - so the demo
 * page runs actual code rather than a reimplementation. The shipped evaluator
 * is reproduced faithfully alongside it so the two can be compared in the
 * browser on inputs the visitor chooses.
 */

import { DeterministicEvaluator } from '../src/evaluation/evaluator.ts';
import { defaultLexicon } from '../src/text/lexicon.ts';
import { normalizeForMatching } from '../src/text/normalize.ts';
import { tokenize } from '../src/text/tokenize.ts';
import { annotateContextDetailed } from '../src/text/negation.ts';
import { ingest, ParserRegistry, contentHash } from '../src/ingestion/index.ts';
import { ExaminerResolver } from '../src/resolution/examiner-resolver.ts';
import { compileStation } from '../src/station/compiler.ts';
import { MemoryStore } from '../src/adapters/memory/repository.ts';
import { makeIdFactory, systemClock } from '../src/domain/ids.ts';
import { asId } from '../src/domain/types.ts';
import { EngineError } from '../src/domain/errors.ts';
import type {
  CaseId,
  DocumentId,
  Examiner,
  ExaminerId,
  KeyPoint,
  OccurrenceId,
  QuestionCategory,
  QuestionId,
  SourceReferenceId,
  SpecialtyId,
} from '../src/domain/types.ts';

const ids = makeIdFactory();
const evaluator = new DeterministicEvaluator();

// ---------------------------------------------------------------------------
// The shipped evaluator, reproduced from lib/evaluation.ts + normalization.ts
// ---------------------------------------------------------------------------

function shippedNormalize(value: string): string {
  return value.normalize('NFKC').replace(/[،؛]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function evaluateShipped(keyPointTexts: readonly string[], studentAnswer: string) {
  const answer = shippedNormalize(studentAnswer).toLocaleLowerCase();
  const keyPoints = keyPointTexts.map(shippedNormalize).filter(Boolean);
  if (!answer || !keyPoints.length) {
    return {
      correctness: 'UNAVAILABLE' as const,
      score: 0,
      coveredPoints: [] as string[],
      missingPoints: keyPoints,
    };
  }
  const coveredPoints = keyPoints.filter((p) => answer.includes(p.toLocaleLowerCase()));
  const missingPoints = keyPoints.filter((p) => !coveredPoints.includes(p));
  const score = coveredPoints.length / keyPoints.length;
  return {
    correctness: score === 1 ? ('CORRECT' as const) : score > 0 ? ('PARTIAL' as const) : ('INCORRECT' as const),
    score,
    coveredPoints,
    missingPoints,
  };
}

// ---------------------------------------------------------------------------
// V2 evaluation, with the negation trace the UI renders
// ---------------------------------------------------------------------------

export function evaluateV2(keyPoints: readonly KeyPoint[], studentAnswer: string) {
  const result = evaluator.evaluate({
    question: 'Demo question',
    referenceAnswer: keyPoints.map((p) => p.text).join(', '),
    keyPoints,
    studentAnswer,
  });

  const tokens = tokenize(studentAnswer, { removeStopwords: false, minLength: 1 });
  const context = annotateContextDetailed(tokens);
  const trace = tokens.map((token, i) => ({ token, kind: context[i]?.kind ?? 'AFFIRMED' }));
  const concepts = [...defaultLexicon.conceptsIn(tokens)].map((cid) => ({
    id: cid,
    preferred: defaultLexicon.getConcept(cid)?.preferred ?? cid,
  }));

  return { ...result, trace, concepts };
}

/** Concept identifiers a piece of text names. Used by the vocabulary panel. */
export function conceptsFor(text: string) {
  const tokens = tokenize(text, { removeStopwords: false, minLength: 1 });
  return defaultLexicon.annotate(tokens).map((m) => ({
    conceptId: m.conceptId,
    preferred: m.preferred,
    surfaceForm: m.surfaceForm,
  }));
}

export const lexiconSize = defaultLexicon.size;

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export function ingestText(text: string) {
  const bytes = new TextEncoder().encode(text);
  try {
    const result = ingest(
      {
        document: {
          id: asId<DocumentId>('doc_demo'),
          filename: 'demo.txt',
          format: 'txt',
          byteSize: bytes.length,
          contentHash: contentHash(bytes),
          objectKey: 'demo',
          academicYear: null,
          specialtyId: asId<SpecialtyId>('spc_demo'),
          status: 'RECEIVED',
          uploadedAt: Date.now(),
          uploadedBy: 'demo',
        },
        bytes,
        specialtyId: asId<SpecialtyId>('spc_demo'),
      },
      { parsers: new ParserRegistry(), ids, clock: systemClock },
    );

    const refs = new Map(result.sourceReferences.map((r) => [r.id as string, r]));
    return {
      ok: true as const,
      reviewRequired: result.reviewRequired,
      diagnostics: result.segmentation.diagnostics,
      segments: result.segmentation.segments.length,
      timings: result.timings,
      rejected: result.rejected.map((r) => ({ type: r.type, reason: r.reason, text: r.rawText })),
      candidates: result.candidates.map((c) => {
        const ref = refs.get(c.sourceReferenceId as string);
        return {
          type: c.type,
          text: c.proposedText,
          confidence: c.confidence,
          category: c.category,
          segment: c.segmentKey,
          line: ref?.lineStart ?? 0,
          excerpt: ref?.excerpt ?? '',
        };
      }),
    };
  } catch (error) {
    return {
      ok: false as const,
      code: error instanceof EngineError ? error.code : 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Examiner resolution
// ---------------------------------------------------------------------------

const DEMO_SPECIALTY = asId<SpecialtyId>('spc_surgery');

const DEMO_EXAMINERS: Examiner[] = [
  ['exm_hassan', 'Dr. Ahmed Hassan', ['Ahmed Hasan', 'A. Hassan']],
  ['exm_hussein', 'Dr. Ahmed Hussein', []],
  ['exm_kadhimi', 'Dr. Sara Al-Kadhimi', []],
  ['exm_obaidi', 'Dr. Mohammed Al-Obaidi', []],
  ['exm_jubouri', 'Dr. Ali Al-Jubouri', []],
].map(([id, name, aliases]) => ({
  id: asId<ExaminerId>(id as string),
  specialtyId: DEMO_SPECIALTY,
  canonicalName: name as string,
  aliases: aliases as string[],
  active: true,
  createdAt: 0,
}));

export const demoExaminerNames = DEMO_EXAMINERS.map((e) => e.canonicalName);

const examinerIndex = ExaminerResolver.buildIndex(DEMO_EXAMINERS);
const examinerResolver = new ExaminerResolver();

export function resolveExaminerName(observed: string) {
  const result = examinerResolver.resolve(observed, DEMO_SPECIALTY, examinerIndex);
  if (result.kind === 'MATCHED') {
    const examiner = DEMO_EXAMINERS.find((e) => e.id === result.examinerId);
    return {
      kind: result.kind,
      reason: result.reason,
      name: examiner?.canonicalName ?? '',
      alternatives: [] as { name: string; probability: number; evidence: { field: string; level: string; weight: number }[] }[],
    };
  }
  if (result.kind === 'AMBIGUOUS') {
    return {
      kind: result.kind,
      reason: 'NEEDS_HUMAN',
      name: '',
      alternatives: result.alternatives.map((a) => ({
        name: a.canonicalName,
        probability: a.probability,
        evidence: a.score.evidence.map((e) => ({
          field: e.field,
          level: e.level,
          weight: e.logBayesFactor,
        })),
      })),
    };
  }
  return {
    kind: result.kind,
    reason: 'NEW',
    name: result.suggestedCanonicalName,
    alternatives: [] as { name: string; probability: number; evidence: { field: string; level: string; weight: number }[] }[],
  };
}

// ---------------------------------------------------------------------------
// Station compiler
// ---------------------------------------------------------------------------

const QUESTION_SPEC: [string, string, QuestionCategory, string, string, number, number][] = [
  ['qst_c1', 'What are the complications of appendectomy?', 'COMPLICATION', 'exm_hassan', 'cas_appendicitis', 5, 2025],
  ['qst_c2', 'How do you confirm the diagnosis of appendicitis?', 'DIAGNOSIS', 'exm_hassan', 'cas_appendicitis', 3, 2024],
  ['qst_c3', 'What investigations would you order?', 'INVESTIGATION', 'exm_hassan', 'cas_appendicitis', 2, 2023],
  ['qst_c4', 'How would you manage this patient?', 'MANAGEMENT', 'exm_hassan', 'cas_appendicitis', 4, 2025],
  ['qst_c5', 'What is the differential diagnosis?', 'DIAGNOSIS', 'exm_hassan', 'cas_appendicitis', 2, 2022],
  ['qst_c6', 'Describe the anatomy of the appendix.', 'ANATOMY', 'exm_hassan', 'cas_appendicitis', 1, 2021],
  ['qst_o1', 'What are the causes of intestinal obstruction?', 'UNCLASSIFIED', 'exm_kadhimi', 'cas_obstruction', 3, 2025],
  ['qst_o2', 'Mention the initial management steps.', 'MANAGEMENT', 'exm_kadhimi', 'cas_obstruction', 4, 2024],
  ['qst_o3', 'Which imaging confirms obstruction?', 'INVESTIGATION', 'exm_kadhimi', 'cas_obstruction', 2, 2023],
  ['qst_o4', 'What are the complications of delayed surgery?', 'COMPLICATION', 'exm_kadhimi', 'cas_obstruction', 2, 2024],
];

function buildStationStore(): MemoryStore {
  const store = new MemoryStore();
  for (const [id, name, aliases] of [
    ['exm_hassan', 'Dr. Ahmed Hassan', []],
    ['exm_kadhimi', 'Dr. Sara Al-Kadhimi', []],
  ] as const) {
    store.putExaminer({
      id: asId<ExaminerId>(id),
      specialtyId: DEMO_SPECIALTY,
      canonicalName: name,
      aliases: aliases as unknown as string[],
      active: true,
      createdAt: 0,
    });
  }
  for (const [id, title] of [
    ['cas_appendicitis', 'Acute Appendicitis'],
    ['cas_obstruction', 'Bowel Obstruction'],
  ] as const) {
    store.putCase({
      id: asId<CaseId>(id),
      specialtyId: DEMO_SPECIALTY,
      title,
      aliases: [],
      tags: [],
      active: true,
    });
  }
  for (const [qid, text, category, exm, cas, count, year] of QUESTION_SPEC) {
    store.putQuestion({
      id: asId<QuestionId>(qid),
      canonicalText: text,
      normalizedText: normalizeForMatching(text),
      category,
      createdAt: 0,
    });
    const examinerId = asId<ExaminerId>(exm);
    const caseId = asId<CaseId>(cas);
    for (let i = 0; i < count; i++) {
      store.putOccurrence({
        id: ids.occurrence<OccurrenceId>(),
        examinerId,
        caseId,
        questionId: asId<QuestionId>(qid),
        academicYear: year - (i % 3),
        sourceReferenceId: asId<SourceReferenceId>('src_demo'),
        fingerprint: `fp:${qid}:${i}`,
        publishedAt: 0,
      });
    }
    store.publishLink(examinerId, caseId, asId<QuestionId>(qid));
  }
  // One question carries an approved answer key, so evaluationReady differs.
  store.putAnswer({
    id: asId('ans_demo'),
    questionId: asId<QuestionId>('qst_c1'),
    canonicalAnswer: 'Wound infection, bleeding, DVT, adhesions.',
    keyPoints: [
      { id: 'kp1', text: 'wound infection', synonyms: [], weight: 1, isPitfall: false },
    ],
    sourceType: 'REVIEWER_CURATED',
    approved: true,
    approvedBy: 'demo',
    approvedAt: 0,
    sourceReferenceId: null,
  });
  return store;
}

const stationStore = buildStationStore();

export function compileDemoStation(seed: string, questionCount: number) {
  try {
    const station = compileStation(
      {
        specialtyId: DEMO_SPECIALTY,
        examinerMode: 'RANDOM',
        preparationSeconds: 90,
        desiredQuestionCount: questionCount,
        seed,
        currentYear: 2026,
      },
      stationStore,
    );
    return {
      ok: true as const,
      examiner: station.examinerName,
      caseTitle: station.caseTitle,
      diagnostics: station.diagnostics,
      questions: station.questions.map((q) => ({
        order: q.order,
        text: q.canonicalText,
        category: q.category,
        evaluationReady: q.evaluationReady,
        reason: q.selectionReason,
      })),
    };
  } catch (error) {
    return {
      ok: false as const,
      code: error instanceof EngineError ? error.code : 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// Expose one namespace on the page.
const api = {
  evaluateShipped,
  evaluateV2,
  conceptsFor,
  lexiconSize,
  ingestText,
  resolveExaminerName,
  demoExaminerNames,
  compileDemoStation,
};

(globalThis as unknown as { OsceEngine: typeof api }).OsceEngine = api;

export default api;
