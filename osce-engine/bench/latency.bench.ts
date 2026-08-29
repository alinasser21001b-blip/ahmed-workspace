/**
 * Latency benchmark against the Section 10 / Section 14 targets.
 *
 * Measures the engine's own CPU cost only. Real endpoint latency adds I/O -
 * D1 round trips, R2 reads, TLS - which this cannot simulate. That is the point:
 * the framework's budgets are for whole endpoints, so knowing the compute share
 * tells you how much of each budget is left for I/O.
 *
 * Run: npm run bench
 */

import { performance } from 'node:perf_hooks';
import { compileStation } from '../src/station/compiler.ts';
import { DeterministicEvaluator } from '../src/evaluation/evaluator.ts';
import { QuestionDeduplicator } from '../src/resolution/question-dedup.ts';
import { ExaminerResolver } from '../src/resolution/examiner-resolver.ts';
import { ingest, ParserRegistry, contentHash } from '../src/ingestion/index.ts';
import { LatencyRecorder, KPI_TARGETS } from '../src/observability/events.ts';
import { makeIdFactory, systemClock } from '../src/domain/ids.ts';
import { asId } from '../src/domain/types.ts';
import type {
  CaseId,
  DocumentId,
  ExaminerId,
  Examiner,
  QuestionId,
  OccurrenceId,
  SourceReferenceId,
  SpecialtyId,
  StudentId,
} from '../src/domain/types.ts';
import { MemoryStore } from '../src/adapters/memory/repository.ts';
import { normalizeForMatching } from '../src/text/normalize.ts';

const ids = makeIdFactory();
const SPECIALTY = asId<SpecialtyId>('spc_bench');

/** Builds a knowledge base of the size a mature deployment would hold. */
function buildStore(examinerCount: number, casesPer: number, questionsPer: number): MemoryStore {
  const store = new MemoryStore();
  for (let e = 0; e < examinerCount; e++) {
    const examinerId = asId<ExaminerId>(`exm_${e}`);
    store.putExaminer({
      id: examinerId,
      specialtyId: SPECIALTY,
      canonicalName: `Dr. Examiner Number ${e}`,
      aliases: [],
      active: true,
      createdAt: 0,
    });
    for (let c = 0; c < casesPer; c++) {
      const caseId = asId<CaseId>(`cas_${e}_${c}`);
      store.putCase({
        id: caseId,
        specialtyId: SPECIALTY,
        title: `Clinical Case ${e}-${c}`,
        aliases: [],
        tags: [],
        active: true,
      });
      for (let q = 0; q < questionsPer; q++) {
        const questionId = asId<QuestionId>(`qst_${e}_${c}_${q}`);
        const text = `What are the key features of presentation ${e}-${c}-${q}?`;
        store.putQuestion({
          id: questionId,
          canonicalText: text,
          normalizedText: normalizeForMatching(text),
          category: (['HISTORY', 'DIAGNOSIS', 'MANAGEMENT', 'INVESTIGATION', 'COMPLICATION'] as const)[
            q % 5
          ] as 'HISTORY',
          createdAt: 0,
        });
        const occurrences = 1 + (q % 5);
        for (let o = 0; o < occurrences; o++) {
          store.putOccurrence({
            id: ids.occurrence<OccurrenceId>(),
            examinerId,
            caseId,
            questionId,
            academicYear: 2020 + (o % 5),
            sourceReferenceId: asId<SourceReferenceId>('src_bench'),
            fingerprint: `fp_${e}_${c}_${q}_${o}`,
            publishedAt: 0,
          });
        }
        store.publishLink(examinerId, caseId, questionId);
      }
    }
  }
  return store;
}

function measure(label: string, iterations: number, fn: (i: number) => void): LatencyRecorder {
  const recorder = new LatencyRecorder(iterations);
  // Warm-up so JIT compilation is not counted.
  for (let i = 0; i < Math.min(50, iterations); i++) fn(i);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn(i);
    recorder.record(performance.now() - start);
  }
  const s = recorder.summary;
  console.log(
    `  ${label.padEnd(42)} p50=${s.p50.toFixed(3)}ms  p95=${s.p95.toFixed(3)}ms  p99=${s.p99.toFixed(3)}ms  max=${s.max.toFixed(3)}ms  n=${s.count}`,
  );
  return recorder;
}

function budgetLine(kpiKey: string, observedP95: number): void {
  const target = KPI_TARGETS.find((t) => t.key === kpiKey);
  if (target === undefined) return;
  const share = (observedP95 / target.target) * 100;
  const verdict = observedP95 <= target.target ? 'PASS' : 'FAIL';
  console.log(
    `  ${verdict}  ${target.description.padEnd(38)} ${observedP95.toFixed(3)}ms of ${target.target}ms budget (${share.toFixed(2)}% consumed by compute)`,
  );
}

console.log('OSCE engine - latency benchmark');
console.log(`node ${process.version}  ${new Date().toISOString()}`);
console.log('');

// ---------------------------------------------------------------------------
console.log('Knowledge base: 200 examiners x 3 cases x 12 questions = 7,200 questions');
const store = buildStore(200, 3, 12);
console.log(`  occurrences: ${store.occurrences.size}`);
console.log('');

console.log('Station compilation (the exam-start critical path)');
const compileRecorder = measure('compileStation random, 5 questions', 2000, (i) => {
  compileStation(
    {
      specialtyId: SPECIALTY,
      examinerMode: 'RANDOM',
      preparationSeconds: 90,
      desiredQuestionCount: 5,
      seed: `bench:${i}`,
      currentYear: 2025,
    },
    store,
  );
});
console.log('');

// ---------------------------------------------------------------------------
console.log('Answer evaluation');
const evaluator = new DeterministicEvaluator();
const keyPoints = [
  { id: 'k1', text: 'wound infection', synonyms: ['surgical site infection', 'ssi'], weight: 1, isPitfall: false },
  { id: 'k2', text: 'bleeding', synonyms: ['haemorrhage'], weight: 1, isPitfall: false },
  { id: 'k3', text: 'deep vein thrombosis', synonyms: ['dvt'], weight: 1, isPitfall: false },
  { id: 'k4', text: 'adhesions', synonyms: [], weight: 1, isPitfall: false },
  { id: 'k5', text: 'intra-abdominal abscess', synonyms: ['collection'], weight: 1, isPitfall: false },
  { id: 'p1', text: 'no complications occur', synonyms: [], weight: 0, isPitfall: true },
];
const answers = [
  'wound infection, bleeding, DVT and adhesions',
  'التهاب الجرح، نزف، جلطة وريدية عميقة، التصاقات',
  'there is no evidence of DVT but wound infection and an intra-abdominal collection can occur',
  'wond infecton, bleding, dvt, adhesions and abscess formation in the pelvis',
  'possible thrombosis, some bleeding, and infection of the surgical site with a collection',
];
const evalRecorder = measure('evaluate, 6 key points, mixed answers', 5000, (i) => {
  evaluator.evaluate({
    question: 'What are the complications of appendectomy?',
    referenceAnswer: 'Wound infection, bleeding, DVT, adhesions, abscess.',
    keyPoints,
    studentAnswer: answers[i % answers.length] as string,
  });
});
console.log('');

// ---------------------------------------------------------------------------
console.log('Question deduplication');
const dedupCorpus = Array.from({ length: 5000 }, (_, i) => {
  const text = `What are the key features of presentation ${i % 900}-${i % 37}?`;
  return {
    id: asId<QuestionId>(`q_${i}`),
    canonicalText: text,
    normalizedText: normalizeForMatching(text),
    category: 'UNCLASSIFIED' as const,
    caseIds: [asId<CaseId>(`cas_${i % 100}`)],
  };
});

const dedupBuildStart = performance.now();
const deduplicator = new QuestionDeduplicator(dedupCorpus);
console.log(
  `  index build over 5,000 questions            ${(performance.now() - dedupBuildStart).toFixed(1)}ms  (${JSON.stringify(deduplicator.stats)})`,
);
measure('findDuplicates against 5,000 questions', 2000, (i) => {
  deduplicator.findDuplicates(
    `What are the main features of presentation ${i % 900}-${i % 37}?`,
    asId<CaseId>(`cas_${i % 100}`),
  );
});
console.log('');

// ---------------------------------------------------------------------------
console.log('Examiner resolution');

// Realistic Arabic/Iraqi naming, since blocking effectiveness depends entirely
// on how much phonetic variety the real name distribution carries.
const GIVEN = [
  'Ahmed', 'Mohammed', 'Ali', 'Hussein', 'Hassan', 'Omar', 'Yusuf', 'Ibrahim',
  'Layla', 'Zainab', 'Fatima', 'Sara', 'Noor', 'Maryam', 'Huda', 'Rana',
  'Karim', 'Tariq', 'Salim', 'Nabil', 'Wissam', 'Firas', 'Ghassan', 'Jaafar',
];
const FAMILY = [
  'Al-Kadhimi', 'Al-Obaidi', 'Al-Jubouri', 'Al-Amiri', 'Al-Hashimi', 'Al-Sadr',
  'Rashid', 'Mahmoud', 'Saleh', 'Khalil', 'Aziz', 'Rahman', 'Najjar', 'Hakim',
  'Zubaidi', 'Tikriti', 'Basri', 'Mosuli', 'Dulaimi', 'Shammari', 'Janabi',
  'Qaisi', 'Azzawi', 'Samarrai', 'Ubaidi', 'Kubaisi', 'Fahdawi', 'Luhaibi',
];

const examiners: Examiner[] = [];
for (let i = 0; examiners.length < 3000; i++) {
  const given = GIVEN[i % GIVEN.length] as string;
  const family = FAMILY[Math.floor(i / GIVEN.length) % FAMILY.length] as string;
  const middle = GIVEN[(i * 7 + 3) % GIVEN.length] as string;
  examiners.push({
    id: asId<ExaminerId>(`exm_r_${i}`),
    specialtyId: SPECIALTY,
    canonicalName: `Dr. ${given} ${middle} ${family}`,
    aliases: [],
    active: true,
    createdAt: 0,
  });
}

const indexStart = performance.now();
const examinerIndex = ExaminerResolver.buildIndex(examiners);
const stats = examinerIndex.stats;
console.log(
  `  index build over 3,000 examiners            ${(performance.now() - indexStart).toFixed(1)}ms`,
);
console.log(
  `  blocking: ${stats.buckets} buckets, mean ${stats.meanBucket.toFixed(1)}, max ${stats.maxBucket}`,
);
const resolver = new ExaminerResolver();
measure('resolve against 3,000 examiners', 3000, (i) => {
  const given = GIVEN[i % GIVEN.length] as string;
  const family = FAMILY[Math.floor(i / GIVEN.length) % FAMILY.length] as string;
  // A misspelling, so the exact-match gate misses and the scorer actually runs.
  resolver.resolve(`Dr. ${given} ${family}i`, SPECIALTY, examinerIndex);
});

// The pathological case, measured deliberately rather than discovered later:
// a corpus whose names share one phonetic skeleton puts every record in one
// bucket, and resolution degrades from a bucket scan to a full table scan.
const degenerate: Examiner[] = Array.from({ length: 3000 }, (_, i) => ({
  id: asId<ExaminerId>(`exm_d_${i}`),
  specialtyId: SPECIALTY,
  // Digits are stripped by the phonetic key, so these 3000 names collapse to
  // one key. Real corpora do not look like this - synthetic benchmarks do.
  canonicalName: `Dr. Given${i} Family${i}`,
  aliases: [],
  active: true,
  createdAt: 0,
}));
const degenerateIndex = ExaminerResolver.buildIndex(degenerate);
const degenerateStats = degenerateIndex.stats;
console.log(
  `  degenerate corpus: ${degenerateStats.buckets} buckets, max ${degenerateStats.maxBucket}`,
);
measure('resolve when blocking fails (worst case)', 300, (i) => {
  resolver.resolve(`Dr. Given${i} Familyy${i}`, SPECIALTY, degenerateIndex);
});
console.log('');

// ---------------------------------------------------------------------------
console.log('Ingestion (off the exam path - runs once per upload)');
const sample = [
  'Specialty: Surgery',
  'Year: 2024',
  '',
  ...Array.from({ length: 40 }, (_, i) =>
    [
      `Examiner: Dr. Examiner ${i}`,
      `Case: Clinical Case ${i}`,
      `Q1. What are the complications of procedure ${i}?`,
      `A1: Infection, bleeding, thrombosis.`,
      `Q2. How do you confirm the diagnosis?`,
      `A2: Clinical assessment and imaging.`,
      `Q3. What is the initial management?`,
      '',
    ].join('\n'),
  ),
].join('\n');
const bytes = new TextEncoder().encode(sample);
const parsers = new ParserRegistry();
measure(`ingest a ${(bytes.length / 1024).toFixed(0)}KB recall file`, 200, () => {
  ingest(
    {
      document: {
        id: asId<DocumentId>('doc_bench'),
        filename: 'bench.txt',
        format: 'txt',
        byteSize: bytes.length,
        contentHash: contentHash(bytes),
        objectKey: 'k',
        academicYear: 2024,
        specialtyId: SPECIALTY,
        status: 'RECEIVED',
        uploadedAt: 0,
        uploadedBy: 'bench',
      },
      bytes,
      specialtyId: SPECIALTY,
    },
    { parsers, ids, clock: systemClock },
  );
});
console.log('');

// ---------------------------------------------------------------------------
console.log('Budget consumption against the framework KPI targets');
budgetLine('station.create.p95', compileRecorder.percentile(95));
budgetLine('evaluation.deterministic.p95', evalRecorder.percentile(95));
console.log('');
console.log('Note: these are engine CPU costs only. The remainder of each budget');
console.log('is available for database round trips, network and serialization.');

// Referenced so the unused-variable lint stays honest about intent.
void asId<StudentId>('stu_bench');
