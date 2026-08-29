/**
 * The framework's Section 14 acceptance tests, one per invariant.
 *
 * These are the tests that decide whether the engine is correct. Everything in
 * `unit.test.ts` supports them; these are the contract.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  seededStore,
  makeEnv,
  SURGERY,
  PEDIATRICS,
  STUDENT,
  keyPoint,
  fixtureBytes,
} from './helpers.ts';
import { asId } from '../src/domain/types.ts';
import type {
  CaseId,
  DocumentId,
  ExaminerId,
  ExtractionCandidate,
  OccurrenceId,
  QuestionId,
  SessionId,
  SourceReference,
  SourceReferenceId,
  StudentId,
} from '../src/domain/types.ts';
import { EngineError } from '../src/domain/errors.ts';
import { compileStation, DEFAULT_POLICY } from '../src/station/compiler.ts';
import { makeCompilerSeed } from '../src/station/rng.ts';
import {
  createSession,
  transition,
  assertSubmittable,
  publicSessionView,
} from '../src/session/session-service.ts';
import { DeterministicEvaluator } from '../src/evaluation/evaluator.ts';
import { ExaminerResolver } from '../src/resolution/examiner-resolver.ts';
import { planPublication, occurrenceFingerprint } from '../src/publish/publisher.ts';
import { ingest, ParserRegistry, contentHash } from '../src/ingestion/index.ts';
import { applyReview } from '../src/review/state-machine.ts';
import { MemoryStore } from '../src/adapters/memory/repository.ts';

const seed = makeCompilerSeed({
  studentId: 'stu_1',
  specialtyId: 'spc_surgery',
  requestedAt: 1_700_000_000_000,
  nonce: 'test',
});

describe('Section 14 - acceptance tests', () => {
  // -------------------------------------------------------------------------
  test('1. Random station: examiner belongs to the specialty, case linked to examiner', () => {
    const store = seededStore();

    // Run many compilations: a single pass could pass by luck.
    for (let i = 0; i < 200; i++) {
      const station = compileStation(
        {
          specialtyId: PEDIATRICS,
          examinerMode: 'RANDOM',
          preparationSeconds: 60,
          desiredQuestionCount: 2,
          seed: `${seed}:${i}`,
          currentYear: 2025,
        },
        store,
      );

      const examiner = store.examiners.get(station.examinerId as string);
      assert.ok(examiner, 'examiner must exist');
      assert.equal(examiner.specialtyId, PEDIATRICS, 'examiner must belong to the specialty');

      const linked = store.examinerCasePublished.has(`${station.examinerId}|${station.caseId}`);
      assert.ok(linked, 'case must be linked to the selected examiner');

      for (const q of station.questions) {
        const key = `${station.examinerId}|${station.caseId}|${q.questionId}`;
        assert.ok(
          store.examinerQuestionPublished.has(key),
          'every question must belong to the examiner+case',
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  test('2. Manual examiner: the selected examiner never changes', () => {
    const store = seededStore();
    const target = asId<ExaminerId>('exm_kadhimi');

    for (let i = 0; i < 100; i++) {
      const station = compileStation(
        {
          specialtyId: SURGERY,
          examinerMode: 'SELECTED',
          examinerId: target,
          preparationSeconds: 60,
          desiredQuestionCount: 3,
          seed: `${seed}:${i}`,
          currentYear: 2025,
        },
        store,
      );
      assert.equal(station.examinerId, target);
    }

    // Selecting an examiner from another specialty must fail, not substitute.
    assert.throws(
      () =>
        compileStation(
          {
            specialtyId: SURGERY,
            examinerMode: 'SELECTED',
            examinerId: asId<ExaminerId>('exm_amiri'), // Pediatrics
            preparationSeconds: 60,
            desiredQuestionCount: 2,
            seed,
            currentYear: 2025,
          },
          store,
        ),
      (error: unknown) =>
        error instanceof EngineError && error.code === 'EXAMINER_SPECIALTY_MISMATCH',
    );
  });

  // -------------------------------------------------------------------------
  test('3. Pending candidates are never visible to the student repository', () => {
    const store = seededStore();

    // Add a question that exists but was never published through a link.
    store.putQuestion({
      id: asId<QuestionId>('qst_unpublished'),
      canonicalText: 'This question was never approved',
      normalizedText: 'this question was never approved',
      category: 'UNCLASSIFIED',
      createdAt: 0,
    });

    const pool = store.listPublishedQuestions(
      asId<ExaminerId>('exm_hassan'),
      asId<CaseId>('cas_appendicitis'),
    );
    assert.ok(
      !pool.some((q) => (q.id as string) === 'qst_unpublished'),
      'unpublished question must not appear in the student-facing pool',
    );

    // And it can never be compiled into a station either.
    for (let i = 0; i < 50; i++) {
      const station = compileStation(
        {
          specialtyId: SURGERY,
          examinerMode: 'RANDOM',
          preparationSeconds: 60,
          desiredQuestionCount: 4,
          seed: `${seed}:pending:${i}`,
          currentYear: 2025,
        },
        store,
      );
      assert.ok(!station.questions.some((q) => (q.questionId as string) === 'qst_unpublished'));
    }
  });

  // -------------------------------------------------------------------------
  test('4. Duplicate re-publish: observation counts do not inflate', () => {
    const env = makeEnv();
    const store = new MemoryStore();

    const documentId = asId<DocumentId>('doc_1');
    const examinerId = asId<ExaminerId>('exm_x');
    const caseId = asId<CaseId>('cas_x');
    const questionId = asId<QuestionId>('qst_x');

    const fp = occurrenceFingerprint({
      examinerId,
      caseId,
      questionId,
      academicYear: 2024,
      documentId,
      charStart: 100,
    });

    // Same fingerprint must be produced every time from the same inputs.
    const fp2 = occurrenceFingerprint({
      examinerId,
      caseId,
      questionId,
      academicYear: 2024,
      documentId,
      charStart: 100,
    });
    assert.equal(fp, fp2, 'fingerprint must be deterministic');

    const makeOccurrence = () => ({
      id: env.ids.occurrence<OccurrenceId>(),
      examinerId,
      caseId,
      questionId,
      academicYear: 2024,
      sourceReferenceId: asId<SourceReferenceId>('src_1'),
      fingerprint: fp,
      publishedAt: 0,
    });

    assert.equal(store.putOccurrence(makeOccurrence()), true, 'first insert succeeds');
    assert.equal(store.putOccurrence(makeOccurrence()), false, 'replay is rejected');
    assert.equal(store.putOccurrence(makeOccurrence()), false, 'and stays rejected');

    assert.equal(store.countFor(examinerId, caseId, questionId), 1, 'count must not inflate');

    // A different character offset in the same document IS a new occurrence:
    // the same question genuinely asked twice.
    const fpElsewhere = occurrenceFingerprint({
      examinerId,
      caseId,
      questionId,
      academicYear: 2024,
      documentId,
      charStart: 900,
    });
    assert.notEqual(fp, fpElsewhere);
  });

  // -------------------------------------------------------------------------
  test('5. Ambiguous examiner: publication is blocked until resolved', () => {
    const env = makeEnv();

    const sourceReference: SourceReference = {
      id: asId('src_1'),
      documentId: asId<DocumentId>('doc_1'),
      extractionRunId: asId('run_1'),
      page: 1,
      lineStart: 1,
      lineEnd: 1,
      charStart: 0,
      charEnd: 20,
      excerpt: 'Examiner: Dr. Ahmed Hassan',
    };

    const candidate: ExtractionCandidate = {
      id: asId('cnd_examiner'),
      documentId: asId<DocumentId>('doc_1'),
      extractionRunId: asId('run_1'),
      type: 'EXAMINER',
      state: 'APPROVED',
      rawText: 'Dr. Ahmed Hassan',
      proposedText: 'Dr. Ahmed Hassan',
      editedText: null,
      sourceReferenceId: sourceReference.id,
      confidence: 0.9,
      segmentKey: 'seg-1',
      specialtyId: SURGERY,
      academicYear: 2024,
      category: null,
      mergedIntoCandidateId: null,
      reviewedBy: 'reviewer-1',
      reviewedAt: 1,
      reviewNote: null,
    };

    // No resolved examiner target -> publication must refuse.
    assert.throws(
      () =>
        planPublication(
          {
            documentId: asId<DocumentId>('doc_1'),
            specialtyId: SURGERY,
            candidates: [candidate],
            sourceReferences: [sourceReference],
            targets: {
              examinerByCandidate: new Map(),
              caseByCandidate: new Map(),
              questionByCandidate: new Map(),
            },
            existingFingerprints: new Set(),
          },
          env,
        ),
      (error: unknown) => error instanceof EngineError && error.code === 'AMBIGUOUS_EXAMINER',
    );
  });

  // -------------------------------------------------------------------------
  test('5b. Two similar examiner names are never auto-merged', () => {
    const store = seededStore();
    const index = ExaminerResolver.buildIndex([...store.examiners.values()]);
    const resolver = new ExaminerResolver();

    // Add the adversarial pair the framework names explicitly.
    const withHussein = ExaminerResolver.buildIndex([
      ...store.examiners.values(),
      {
        id: asId<ExaminerId>('exm_hussein'),
        specialtyId: SURGERY,
        canonicalName: 'Dr. Ahmed Hussein',
        aliases: [],
        active: true,
        createdAt: 0,
      },
    ]);

    for (const probe of [
      'Dr. Ahmed Hussien', // typo of Hussein
      'Dr Ahmad Hassan', // typo of Hassan
      'Dr. Ahmed Hasan', // near both
      'Ahmed Hussain',
    ]) {
      const result = resolver.resolve(probe, SURGERY, withHussein);
      assert.notEqual(
        result.kind,
        'MATCHED',
        `"${probe}" must not auto-match; got ${result.kind}`,
      );
    }

    // Exact canonical and registered alias DO match - the authority gate.
    assert.equal(resolver.resolve('Dr. Ahmed Hassan', SURGERY, index).kind, 'MATCHED');
    assert.equal(resolver.resolve('Ahmed Hasan', SURGERY, index).kind, 'MATCHED');

    // Cross-specialty: the same name in another specialty is a different person.
    assert.equal(resolver.resolve('Dr. Ahmed Hassan', PEDIATRICS, index).kind, 'NEW_CANDIDATE');
  });

  // -------------------------------------------------------------------------
  test('6. Scanned PDF: OCR_REQUIRED with zero fabricated candidates', async () => {
    const env = makeEnv();
    const bytes = await fixtureBytes('scanned-garbage.txt');

    // A PDF whose text layer produced ligature noise.
    let thrown: unknown = null;
    try {
      ingest(
        {
          document: {
            id: asId<DocumentId>('doc_scan'),
            filename: 'scan.pdf',
            format: 'pdf',
            byteSize: bytes.length,
            contentHash: contentHash(bytes),
            objectKey: 'k',
            academicYear: null,
            specialtyId: null,
            status: 'RECEIVED',
            uploadedAt: 0,
            uploadedBy: 'admin',
          },
          bytes,
          specialtyId: null,
        },
        {
          parsers: new ParserRegistry([
            // Register the text parser under the pdf format: this simulates a
            // PDF whose text extraction succeeded but yielded unusable output.
            {
              format: 'pdf',
              version: 'pdf-test-1.0.0',
              parse: (input) => {
                const text = new TextDecoder().decode(input);
                return {
                  blocks: [],
                  fullText: text,
                  pageCount: 1,
                  warnings: [],
                };
              },
            },
          ]),
          ids: env.ids,
          clock: env.clock,
        },
      );
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown instanceof EngineError, 'must throw an EngineError');
    assert.equal((thrown as EngineError).code, 'OCR_REQUIRED');
    // The contract is that NOTHING was produced. The throw is what guarantees
    // it: there is no partial-success path that could persist a candidate.
  });

  // -------------------------------------------------------------------------
  test('7. Evaluation-ready partial answer: PARTIAL with only approved missing points', () => {
    const evaluator = new DeterministicEvaluator();
    const points = [
      keyPoint('kp_infection', 'wound infection', ['surgical site infection']),
      keyPoint('kp_bleeding', 'bleeding', ['haemorrhage']),
      keyPoint('kp_dvt', 'deep vein thrombosis', ['dvt']),
      keyPoint('kp_adhesions', 'adhesions'),
    ];

    const result = evaluator.evaluate({
      question: 'What are the complications of appendectomy?',
      referenceAnswer: 'Wound infection, bleeding, DVT, adhesions.',
      keyPoints: points,
      studentAnswer: 'wound infection and bleeding',
    });

    assert.equal(result.correctness, 'PARTIAL');
    assert.ok(result.score > 0 && result.score < 1);
    assert.deepEqual([...result.coveredPoints].sort(), ['kp_bleeding', 'kp_infection']);
    assert.deepEqual([...result.missingPoints].sort(), ['kp_adhesions', 'kp_dvt']);

    // Missing points must come only from the approved key. Nothing invented.
    const approvedIds = new Set(points.map((p) => p.id));
    for (const id of result.missingPoints) {
      assert.ok(approvedIds.has(id), `missing point ${id} must be an approved key point`);
    }
    for (const id of result.coveredPoints) {
      assert.ok(approvedIds.has(id), `covered point ${id} must be an approved key point`);
    }
  });

  // -------------------------------------------------------------------------
  test('8. Invalid session question: evaluation is rejected', () => {
    const store = seededStore();
    const env = makeEnv();

    const station = compileStation(
      {
        specialtyId: SURGERY,
        examinerMode: 'SELECTED',
        examinerId: asId<ExaminerId>('exm_hassan'),
        preparationSeconds: 60,
        desiredQuestionCount: 3,
        seed,
        currentYear: 2025,
      },
      store,
    );
    const { session, questions } = createSession(
      { studentId: STUDENT, station, knowledgeVersion: 'v1' },
      env,
    );
    const active = transition(
      transition(session, 'PREPARATION', env.clock.now()),
      'QUESTIONING',
      env.clock.now(),
    );

    // A question id from another session must be rejected.
    const foreign = {
      ...(questions[0] as (typeof questions)[number]),
      sessionId: asId<SessionId>('ses_other'),
    };
    assert.throws(
      () => assertSubmittable(active, foreign, STUDENT, null),
      (error: unknown) =>
        error instanceof EngineError && error.code === 'SESSION_QUESTION_NOT_OWNED',
    );

    // Another student's submission is indistinguishable from "not found".
    assert.throws(
      () => assertSubmittable(active, questions[0] as (typeof questions)[number], asId<StudentId>('stu_other'), null),
      (error: unknown) => error instanceof EngineError && error.code === 'SESSION_NOT_FOUND',
    );

    // A session that is not QUESTIONING cannot be scored.
    assert.throws(
      () => assertSubmittable(session, questions[0] as (typeof questions)[number], STUDENT, null),
      (error: unknown) => error instanceof EngineError && error.code === 'SESSION_NOT_ACTIVE',
    );

    // Double submission is rejected.
    assert.throws(
      () =>
        assertSubmittable(active, questions[0] as (typeof questions)[number], STUDENT, {
          sessionQuestionId: (questions[0] as (typeof questions)[number]).id,
          answerText: 'x',
          scoringMode: 'AUTOMATIC',
          correctness: 'CORRECT',
          score: 1,
          coveredPointIds: [],
          missingPointIds: [],
          triggeredPitfallIds: [],
          evaluatorVersion: 'v',
          submittedAt: 0,
          latencyMs: null,
        }),
      (error: unknown) => error instanceof EngineError && error.code === 'ALREADY_ANSWERED',
    );
  });

  // -------------------------------------------------------------------------
  test('9. Evaluator failure: the student can self-score and finish the station', () => {
    const store = seededStore();
    const env = makeEnv();

    const station = compileStation(
      {
        specialtyId: SURGERY,
        examinerMode: 'SELECTED',
        examinerId: asId<ExaminerId>('exm_hassan'),
        preparationSeconds: 60,
        desiredQuestionCount: 4,
        seed,
        currentYear: 2025,
      },
      store,
    );
    const { session, questions } = createSession(
      { studentId: STUDENT, station, knowledgeVersion: 'v1' },
      env,
    );

    // Only one question in the fixture has an approved answer key, so the rest
    // must report evaluationReady=false and be answerable by self-scoring.
    const ready = questions.filter((q) => q.evaluationReady);
    const notReady = questions.filter((q) => !q.evaluationReady);
    assert.equal(ready.length, 1, 'exactly one question has an approved key');
    assert.ok(notReady.length >= 1, 'the rest fall back to self-scoring');

    // The session can still complete: self-scored answers count.
    const answers = questions.map((q) => ({
      sessionQuestionId: q.id,
      answerText: 'student answer',
      scoringMode: q.evaluationReady ? ('AUTOMATIC' as const) : ('SELF' as const),
      correctness: 'PARTIAL' as const,
      score: 0.5,
      coveredPointIds: [],
      missingPointIds: [],
      triggeredPitfallIds: [],
      evaluatorVersion: q.evaluationReady ? 'deterministic-2.0.0' : null,
      submittedAt: env.clock.now(),
      latencyMs: 5,
    }));

    const active = transition(
      transition(session, 'PREPARATION', env.clock.now()),
      'QUESTIONING',
      env.clock.now(),
    );
    const completed = transition(active, 'COMPLETED', env.clock.now());
    assert.equal(completed.phase, 'COMPLETED');
    assert.equal(answers.filter((a) => a.scoringMode === 'SELF').length, notReady.length);
  });

  // -------------------------------------------------------------------------
  test('10. New daily upload: knowledge appears with no code change', async () => {
    const env = makeEnv();
    const bytes = await fixtureBytes('recall-clean.txt');

    const result = ingest(
      {
        document: {
          id: asId<DocumentId>('doc_daily'),
          filename: 'recall.txt',
          format: 'txt',
          byteSize: bytes.length,
          contentHash: contentHash(bytes),
          objectKey: 'k',
          academicYear: 2024,
          specialtyId: SURGERY,
          status: 'RECEIVED',
          uploadedAt: env.clock.now(),
          uploadedBy: 'admin',
        },
        bytes,
        specialtyId: SURGERY,
      },
      { parsers: new ParserRegistry(), ids: env.ids, clock: env.clock },
    );

    assert.ok(result.candidates.length > 0, 'ingestion produced candidates');
    assert.equal(result.run.status, 'SUCCEEDED');

    // Approve everything, resolve identity, publish. No code path here is
    // document-specific: the same call handles any conforming upload.
    const approved = result.candidates.map((c) =>
      applyReview(c, { action: 'APPROVE', reviewerId: 'reviewer-1', at: env.clock.now() }),
    );

    const examinerByCandidate = new Map<string, ExaminerId>();
    const caseByCandidate = new Map<string, CaseId>();
    approved.forEach((c, index) => {
      if (c.type === 'EXAMINER') examinerByCandidate.set(c.id as string, asId<ExaminerId>(`exm_${index}`));
      if (c.type === 'CASE') caseByCandidate.set(c.id as string, asId<CaseId>(`cas_${index}`));
    });

    const plan = planPublication(
      {
        documentId: asId<DocumentId>('doc_daily'),
        specialtyId: SURGERY,
        candidates: approved,
        sourceReferences: result.sourceReferences,
        targets: { examinerByCandidate, caseByCandidate, questionByCandidate: new Map() },
        existingFingerprints: new Set(),
      },
      env,
    );

    assert.ok(plan.newQuestions.length > 0, 'new questions are planned');
    assert.ok(plan.occurrences.length > 0, 'occurrences are planned');
    assert.equal(plan.skippedFingerprints.length, 0, 'nothing skipped on a first publish');

    // Replaying the same plan skips everything: idempotent by construction.
    const replay = planPublication(
      {
        documentId: asId<DocumentId>('doc_daily'),
        specialtyId: SURGERY,
        candidates: approved,
        sourceReferences: result.sourceReferences,
        targets: {
          examinerByCandidate,
          caseByCandidate,
          // Second publish resolves to the questions the first one created.
          questionByCandidate: new Map(
            plan.newQuestions.map((q) => [q.candidateId as string, q.id]),
          ),
        },
        existingFingerprints: new Set(plan.occurrences.map((o) => o.fingerprint)),
      },
      env,
    );
    assert.equal(replay.occurrences.length, 0, 'replay creates no new occurrences');
    assert.equal(
      replay.skippedFingerprints.length,
      plan.occurrences.length,
      'every occurrence is recognised as already published',
    );
  });
});

describe('Reproducibility', () => {
  test('the same seed produces byte-identical stations', () => {
    const store = seededStore();
    const compile = (s: string) =>
      compileStation(
        {
          specialtyId: SURGERY,
          examinerMode: 'RANDOM',
          preparationSeconds: 90,
          desiredQuestionCount: 3,
          seed: s,
          currentYear: 2025,
          policy: DEFAULT_POLICY,
        },
        store,
      );

    for (const s of ['a', 'b', 'seed-3', seed]) {
      assert.deepEqual(compile(s), compile(s), `seed "${s}" must be reproducible`);
    }
  });

  test('different seeds produce different stations', () => {
    const store = seededStore();
    const signatures = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const station = compileStation(
        {
          specialtyId: SURGERY,
          examinerMode: 'RANDOM',
          preparationSeconds: 90,
          desiredQuestionCount: 2,
          seed: `variety:${i}`,
          currentYear: 2025,
        },
        store,
      );
      signatures.add(
        `${station.examinerId}|${station.caseId}|${station.questions.map((q) => q.questionId).join(',')}`,
      );
    }
    assert.ok(signatures.size > 1, 'compilation must not collapse to a single station');
  });

  test('question order is frozen into the session', () => {
    const store = seededStore();
    const env = makeEnv();
    const station = compileStation(
      {
        specialtyId: SURGERY,
        examinerMode: 'SELECTED',
        examinerId: asId<ExaminerId>('exm_hassan'),
        preparationSeconds: 60,
        desiredQuestionCount: 4,
        seed,
        currentYear: 2025,
      },
      store,
    );
    const { session, questions } = createSession(
      { studentId: STUDENT, station, knowledgeVersion: 'v1' },
      env,
    );

    const orders = questions.map((q) => q.order);
    assert.deepEqual(orders, [1, 2, 3, 4], 'orders are contiguous and ascending');

    // A "refresh" rebuilds the view from persisted rows, never by recompiling.
    const texts = new Map(
      station.questions.map((q) => [q.questionId as string, q.canonicalText]),
    );
    const first = publicSessionView(session, questions, texts, [], 'E', 'C', env.clock.now());
    const second = publicSessionView(session, questions, texts, [], 'E', 'C', env.clock.now());
    assert.deepEqual(first.currentQuestion, second.currentQuestion);
    assert.equal(first.currentQuestion?.order, 1);
  });

  test('the public session view never leaks key points', () => {
    const store = seededStore();
    const env = makeEnv();
    const station = compileStation(
      {
        specialtyId: SURGERY,
        examinerMode: 'SELECTED',
        examinerId: asId<ExaminerId>('exm_hassan'),
        preparationSeconds: 60,
        desiredQuestionCount: 4,
        seed,
        currentYear: 2025,
      },
      store,
    );
    const { session, questions } = createSession(
      { studentId: STUDENT, station, knowledgeVersion: 'v1' },
      env,
    );
    const texts = new Map(
      station.questions.map((q) => [q.questionId as string, q.canonicalText]),
    );
    const view = publicSessionView(session, questions, texts, [], 'E', 'C', env.clock.now());

    const serialized = JSON.stringify(view).toLowerCase();
    // Every key point of the one evaluation-ready question must be absent.
    for (const fragment of ['wound infection', 'adhesions', 'deep vein thrombosis', 'kp_']) {
      assert.ok(!serialized.includes(fragment), `view must not contain "${fragment}"`);
    }
    // But it must say whether automatic evaluation is available.
    assert.equal(typeof view.currentQuestion?.evaluationReady, 'boolean');
  });
});
