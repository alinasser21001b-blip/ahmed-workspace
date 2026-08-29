/**
 * Test fixtures and a deterministic environment.
 *
 * Every test runs against a fixed clock and a counter-based ID source, so IDs
 * and timestamps are reproducible and a failure is always reproducible too.
 */

import { makeIdFactory, type Clock, type Random } from '../src/domain/ids.ts';
import { asId } from '../src/domain/types.ts';
import type {
  CaseId,
  ClinicalCase,
  Examiner,
  ExaminerId,
  ExpectedAnswer,
  AnswerKeyId,
  KeyPoint,
  Question,
  QuestionCategory,
  QuestionId,
  OccurrenceId,
  SourceReferenceId,
  SpecialtyId,
  StudentId,
} from '../src/domain/types.ts';
import { MemoryStore } from '../src/adapters/memory/repository.ts';
import { normalizeForMatching } from '../src/text/normalize.ts';

export class FixedClock implements Clock {
  private t: number;
  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

/** Deterministic pseudo-random source so generated IDs are stable across runs. */
export class CountingRandom implements Random {
  private n = 0;
  next(): number {
    this.n += 1;
    // Irrational multiplier gives a well-spread low-discrepancy sequence.
    return (this.n * 0.6180339887498949) % 1;
  }
}

export function makeEnv() {
  const clock = new FixedClock();
  const random = new CountingRandom();
  const ids = makeIdFactory(clock, random);
  return { clock, random, ids };
}

export const SURGERY = asId<SpecialtyId>('spc_surgery');
export const PEDIATRICS = asId<SpecialtyId>('spc_pediatrics');

export function examiner(
  id: string,
  name: string,
  specialtyId: SpecialtyId = SURGERY,
  aliases: string[] = [],
): Examiner {
  return {
    id: asId<ExaminerId>(id),
    specialtyId,
    canonicalName: name,
    aliases,
    active: true,
    createdAt: 0,
  };
}

export function clinicalCase(
  id: string,
  title: string,
  specialtyId: SpecialtyId = SURGERY,
): ClinicalCase {
  return {
    id: asId<CaseId>(id),
    specialtyId,
    title,
    aliases: [],
    tags: [],
    active: true,
  };
}

export function question(
  id: string,
  text: string,
  category: QuestionCategory = 'UNCLASSIFIED',
): Question {
  return {
    id: asId<QuestionId>(id),
    canonicalText: text,
    normalizedText: normalizeForMatching(text),
    category,
    createdAt: 0,
  };
}

export function keyPoint(
  id: string,
  text: string,
  synonyms: string[] = [],
  weight = 1,
  isPitfall = false,
): KeyPoint {
  return { id, text, synonyms, weight, isPitfall };
}

export function answerKey(
  id: string,
  questionId: string,
  canonicalAnswer: string,
  keyPoints: KeyPoint[],
  approved = true,
): ExpectedAnswer {
  return {
    id: asId<AnswerKeyId>(id),
    questionId: asId<QuestionId>(questionId),
    canonicalAnswer,
    keyPoints,
    sourceType: 'REVIEWER_CURATED',
    approved,
    approvedBy: approved ? 'reviewer-1' : null,
    approvedAt: approved ? 1 : null,
    sourceReferenceId: null,
  };
}

export const STUDENT = asId<StudentId>('stu_1');

/**
 * A small published knowledge base:
 *   Surgery / Dr. Ahmed Hassan / Acute Appendicitis  - 4 questions
 *   Surgery / Dr. Sara Al-Kadhimi / Bowel Obstruction - 3 questions
 *   Pediatrics / Dr. Layla Amiri / Neonatal Jaundice  - 2 questions
 *
 * Occurrence counts are created as real occurrence rows so that every derived
 * count in the tests is genuinely derived, exactly as in production.
 */
export function seededStore(): MemoryStore {
  const store = new MemoryStore();
  const env = makeEnv();

  store.putExaminer(examiner('exm_hassan', 'Dr. Ahmed Hassan', SURGERY, ['Ahmed Hasan']));
  store.putExaminer(examiner('exm_kadhimi', 'Dr. Sara Al-Kadhimi', SURGERY));
  store.putExaminer(examiner('exm_amiri', 'Dr. Layla Amiri', PEDIATRICS));

  store.putCase(clinicalCase('cas_appendicitis', 'Acute Appendicitis'));
  store.putCase(clinicalCase('cas_obstruction', 'Bowel Obstruction'));
  store.putCase(clinicalCase('cas_jaundice', 'Neonatal Jaundice', PEDIATRICS));

  const spec: [string, string, QuestionCategory, string, string, number][] = [
    // id, text, category, examiner, case, observation count
    ['qst_appx_comp', 'What are the complications of appendectomy?', 'COMPLICATION', 'exm_hassan', 'cas_appendicitis', 5],
    ['qst_appx_dx', 'How do you confirm the diagnosis of appendicitis?', 'DIAGNOSIS', 'exm_hassan', 'cas_appendicitis', 3],
    ['qst_appx_ix', 'What investigations would you order?', 'INVESTIGATION', 'exm_hassan', 'cas_appendicitis', 2],
    ['qst_appx_mx', 'How would you manage this patient?', 'MANAGEMENT', 'exm_hassan', 'cas_appendicitis', 4],
    ['qst_obs_causes', 'What are the causes of intestinal obstruction?', 'UNCLASSIFIED', 'exm_kadhimi', 'cas_obstruction', 3],
    ['qst_obs_mx', 'Mention the initial management steps.', 'MANAGEMENT', 'exm_kadhimi', 'cas_obstruction', 2],
    ['qst_obs_ix', 'Which imaging confirms obstruction?', 'INVESTIGATION', 'exm_kadhimi', 'cas_obstruction', 1],
    ['qst_jaun_causes', 'What are the causes of neonatal jaundice?', 'UNCLASSIFIED', 'exm_amiri', 'cas_jaundice', 4],
    ['qst_jaun_mx', 'How is severe neonatal jaundice managed?', 'MANAGEMENT', 'exm_amiri', 'cas_jaundice', 2],
  ];

  for (const [qid, text, category, exmId, casId, count] of spec) {
    store.putQuestion(question(qid, text, category));
    const examinerId = asId<ExaminerId>(exmId);
    const caseId = asId<CaseId>(casId);
    for (let i = 0; i < count; i++) {
      store.putOccurrence({
        id: env.ids.occurrence<OccurrenceId>(),
        examinerId,
        caseId,
        questionId: asId<QuestionId>(qid),
        academicYear: 2020 + (i % 5),
        sourceReferenceId: asId<SourceReferenceId>('src_seed'),
        fingerprint: `fp:${qid}:${i}`,
        publishedAt: 0,
      });
    }
    store.publishLink(examinerId, caseId, asId<QuestionId>(qid));
  }

  // One question has an approved answer key: evaluationReady must be true for
  // exactly that one and false for the rest.
  store.putAnswer(
    answerKey('ans_appx_comp', 'qst_appx_comp', 'Wound infection, bleeding, DVT, adhesions.', [
      keyPoint('kp_infection', 'wound infection', ['surgical site infection', 'ssi']),
      keyPoint('kp_bleeding', 'bleeding', ['haemorrhage', 'hemorrhage']),
      keyPoint('kp_dvt', 'deep vein thrombosis', ['dvt']),
      keyPoint('kp_adhesions', 'adhesions'),
    ]),
  );

  return store;
}

/** Reads a fixture file as bytes. */
export async function fixtureBytes(name: string): Promise<Uint8Array> {
  const fs = await import('node:fs/promises');
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return new Uint8Array(await fs.readFile(url));
}
