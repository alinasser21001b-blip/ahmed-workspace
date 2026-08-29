/**
 * Publication: reviewed candidates -> canonical knowledge (Section 6).
 *
 * Two properties this module exists to guarantee.
 *
 * IDEMPOTENCE. Publishing the same document twice must not inflate any count.
 * The framework's acceptance test says so, and the mechanism is a deterministic
 * occurrence fingerprint over (examiner, case, question, year, document,
 * character offset). Re-publishing recomputes identical fingerprints; the
 * repository's UNIQUE index turns the second insert into a no-op. Counts are
 * then recomputed from the surviving occurrence rows rather than incremented,
 * so even a partial replay converges to the right number.
 *
 * DERIVED COUNTS. Section 3: "Counts such as 'asked 5 times' should be computed
 * from approved occurrences, never from extraction candidates or raw duplicate
 * strings." Every count here is a recount, never an increment. An increment is
 * a cached aggregate that drifts the first time anything is deleted or replayed.
 *
 * The plan/apply split exists because a Worker's transaction is short and a
 * publish may touch hundreds of rows. `planPublication` is pure and does all
 * the resolution and validation with no writes; the caller applies the plan
 * inside one transaction. That also makes the whole publication path testable
 * without a database.
 */

import type {
  AnswerKeyId,
  CandidateId,
  CaseId,
  DocumentId,
  ExaminerId,
  ExtractionCandidate,
  ExpectedAnswer,
  KeyPoint,
  OccurrenceId,
  QuestionCategory,
  QuestionId,
  QuestionOccurrence,
  SourceReference,
  SourceReferenceId,
  SpecialtyId,
  VariantId,
} from '../domain/types.ts';
import { EngineError } from '../domain/errors.ts';
import { fingerprint } from '../domain/hash.ts';
import type { Clock, IdFactory } from '../domain/ids.ts';
import { normalizeForDisplay, normalizeForMatching } from '../text/normalize.ts';
import { PUBLISHABLE_STATES, effectiveText } from '../review/state-machine.ts';

/**
 * Resolution decisions the reviewer has already made.
 *
 * Publication never resolves identity itself. If a candidate reaches here
 * without a resolved target, that is a bug in the review flow, and it fails
 * loudly rather than creating a duplicate entity.
 */
export interface ResolvedTargets {
  /** candidateId -> canonical examiner. */
  readonly examinerByCandidate: ReadonlyMap<string, ExaminerId>;
  readonly caseByCandidate: ReadonlyMap<string, CaseId>;
  /** candidateId -> existing canonical question, when the reviewer merged. */
  readonly questionByCandidate: ReadonlyMap<string, QuestionId>;
}

export interface PublicationPlan {
  readonly documentId: DocumentId;
  /** Questions that do not yet exist and must be created. */
  readonly newQuestions: readonly {
    readonly id: QuestionId;
    readonly canonicalText: string;
    readonly normalizedText: string;
    readonly category: QuestionCategory;
    readonly candidateId: CandidateId;
  }[];
  /** Observed wordings to preserve. */
  readonly newVariants: readonly {
    readonly id: VariantId;
    readonly questionId: QuestionId;
    readonly observedText: string;
    readonly sourceReferenceId: SourceReferenceId;
    readonly language: 'ar' | 'en' | 'mixed';
  }[];
  /** Occurrences to upsert. Duplicates by fingerprint are already removed. */
  readonly occurrences: readonly QuestionOccurrence[];
  /** Answer keys to attach, all of them reviewer-approved. */
  readonly answerKeys: readonly ExpectedAnswer[];
  /** Candidate ids that will move to PUBLISHED. */
  readonly candidateIdsToPublish: readonly CandidateId[];
  /** Links whose observation counts must be recomputed after the writes. */
  readonly examinerCaseLinks: readonly { examinerId: ExaminerId; caseId: CaseId }[];
  readonly examinerQuestionLinks: readonly {
    examinerId: ExaminerId;
    caseId: CaseId;
    questionId: QuestionId;
  }[];
  /** Fingerprints skipped because an identical occurrence already exists. */
  readonly skippedFingerprints: readonly string[];
}

export interface PlanInput {
  readonly documentId: DocumentId;
  readonly specialtyId: SpecialtyId;
  readonly candidates: readonly ExtractionCandidate[];
  readonly sourceReferences: readonly SourceReference[];
  readonly targets: ResolvedTargets;
  /** Fingerprints already present in the database, for idempotent replay. */
  readonly existingFingerprints: ReadonlySet<string>;
  /** Reviewer-curated answer keys, keyed by the ANSWER candidate id. */
  readonly curatedAnswers?: ReadonlyMap<string, { canonicalAnswer: string; keyPoints: readonly KeyPoint[]; approvedBy: string }>;
}

/**
 * Occurrence fingerprint.
 *
 * Includes the document id and character offset, so the *same* question asked
 * by the same examiner in the same case and year, recorded in two different
 * uploads, is two occurrences - which is correct, because two students
 * independently recalling it is stronger evidence than one. Re-processing one
 * upload is not: same document, same offset, same fingerprint, one row.
 */
export function occurrenceFingerprint(parts: {
  examinerId: ExaminerId;
  caseId: CaseId;
  questionId: QuestionId;
  academicYear: number | null;
  documentId: DocumentId;
  charStart: number;
}): string {
  return fingerprint(
    'occ:v2',
    parts.examinerId,
    parts.caseId,
    parts.questionId,
    parts.academicYear,
    parts.documentId,
    parts.charStart,
  );
}

export function planPublication(
  input: PlanInput,
  deps: { ids: IdFactory; clock: Clock },
): PublicationPlan {
  const now = deps.clock.now();
  const referenceById = new Map(input.sourceReferences.map((r) => [r.id as string, r]));

  const publishable = input.candidates.filter((c) => PUBLISHABLE_STATES.includes(c.state));

  // Group by segment: a segment is one examiner/case context, and questions
  // must be attributed to the examiner and case of their own segment.
  const bySegment = new Map<string, ExtractionCandidate[]>();
  for (const candidate of publishable) {
    const bucket = bySegment.get(candidate.segmentKey);
    if (bucket === undefined) bySegment.set(candidate.segmentKey, [candidate]);
    else bucket.push(candidate);
  }

  // Mutable while building; the returned plan exposes them as readonly.
  const newQuestions: PublicationPlan['newQuestions'][number][] = [];
  const newVariants: PublicationPlan['newVariants'][number][] = [];
  const occurrences: QuestionOccurrence[] = [];
  const answerKeys: ExpectedAnswer[] = [];
  const candidateIdsToPublish: CandidateId[] = [];
  const examinerCaseLinks = new Map<string, { examinerId: ExaminerId; caseId: CaseId }>();
  const examinerQuestionLinks = new Map<
    string,
    { examinerId: ExaminerId; caseId: CaseId; questionId: QuestionId }
  >();
  const skippedFingerprints: string[] = [];

  // Fingerprints created in *this* plan, so a document containing the same
  // question twice at the same offset cannot self-duplicate either.
  const plannedFingerprints = new Set<string>();
  // Normalized question text -> id, so repeated wording inside one document
  // resolves to a single new question rather than several.
  const newQuestionByNormalized = new Map<string, QuestionId>();

  for (const [segmentKey, candidates] of bySegment) {
    const examinerCandidate = candidates.find((c) => c.type === 'EXAMINER');
    const caseCandidate = candidates.find((c) => c.type === 'CASE');

    const examinerId =
      examinerCandidate === undefined
        ? undefined
        : input.targets.examinerByCandidate.get(examinerCandidate.id as string);
    const caseId =
      caseCandidate === undefined
        ? undefined
        : input.targets.caseByCandidate.get(caseCandidate.id as string);

    if (examinerId === undefined || caseId === undefined) {
      // A segment whose identity a reviewer has not resolved cannot publish.
      // Failing here is the point: Section 14 requires publication to be
      // blocked until an ambiguous examiner is resolved.
      throw new EngineError(
        'AMBIGUOUS_EXAMINER',
        `Segment ${segmentKey} has no resolved examiner and case; publication blocked`,
        {
          documentId: input.documentId,
          segmentKey,
          hasExaminer: examinerId !== undefined,
          hasCase: caseId !== undefined,
        },
      );
    }

    examinerCaseLinks.set(`${examinerId}|${caseId}`, { examinerId, caseId });
    if (examinerCandidate !== undefined) candidateIdsToPublish.push(examinerCandidate.id);
    if (caseCandidate !== undefined) candidateIdsToPublish.push(caseCandidate.id);

    const questionCandidates = candidates.filter((c) => c.type === 'QUESTION');
    const answerCandidates = candidates.filter((c) => c.type === 'ANSWER');

    questionCandidates.forEach((candidate, index) => {
      const text = normalizeForDisplay(effectiveText(candidate));
      const normalized = normalizeForMatching(text);
      const reference = referenceById.get(candidate.sourceReferenceId as string);
      if (reference === undefined) {
        throw new EngineError(
          'MISSING_PROVENANCE',
          'Candidate has no resolvable source reference',
          { candidateId: candidate.id, sourceReferenceId: candidate.sourceReferenceId },
        );
      }

      // Reviewer merge target wins; then an identical question already planned
      // in this document; otherwise a new canonical question.
      let questionId = input.targets.questionByCandidate.get(candidate.id as string);
      if (questionId === undefined) {
        const alreadyPlanned = newQuestionByNormalized.get(normalized);
        if (alreadyPlanned !== undefined) {
          questionId = alreadyPlanned;
        } else {
          questionId = deps.ids.question<QuestionId>();
          newQuestionByNormalized.set(normalized, questionId);
          newQuestions.push({
            id: questionId,
            canonicalText: text,
            normalizedText: normalized,
            category: candidate.category ?? 'UNCLASSIFIED',
            candidateId: candidate.id,
          });
        }
      }

      // The observed wording is always preserved, even when merged away.
      newVariants.push({
        id: deps.ids.variant<VariantId>(),
        questionId,
        observedText: candidate.rawText,
        sourceReferenceId: candidate.sourceReferenceId,
        language: detectLanguage(text),
      });

      const fp = occurrenceFingerprint({
        examinerId,
        caseId,
        questionId,
        academicYear: candidate.academicYear,
        documentId: input.documentId,
        charStart: reference.charStart,
      });

      if (input.existingFingerprints.has(fp) || plannedFingerprints.has(fp)) {
        skippedFingerprints.push(fp);
      } else {
        plannedFingerprints.add(fp);
        occurrences.push({
          id: deps.ids.occurrence<OccurrenceId>(),
          examinerId,
          caseId,
          questionId,
          academicYear: candidate.academicYear,
          sourceReferenceId: candidate.sourceReferenceId,
          fingerprint: fp,
          publishedAt: now,
        });
      }

      examinerQuestionLinks.set(`${examinerId}|${caseId}|${questionId}`, {
        examinerId,
        caseId,
        questionId,
      });
      candidateIdsToPublish.push(candidate.id);

      // Attach a curated answer if the reviewer approved one for the paired
      // answer candidate. Pairing is positional within the segment, matching
      // how the extractor emitted them.
      const answerCandidate = answerCandidates[index];
      if (answerCandidate === undefined) return;
      const curated = input.curatedAnswers?.get(answerCandidate.id as string);
      if (curated === undefined) {
        // An answer that exists in the source but was never curated does NOT
        // become an evaluation reference. Section 8: a question may publish
        // with no answer, in which case evaluationReady is false and the
        // student self-scores. Silently promoting raw recall text to an answer
        // key is how a grader starts marking against a student's guess.
        candidateIdsToPublish.push(answerCandidate.id);
        return;
      }

      answerKeys.push({
        id: deps.ids.answerKey<AnswerKeyId>(),
        questionId,
        canonicalAnswer: curated.canonicalAnswer,
        keyPoints: curated.keyPoints,
        sourceType: 'REVIEWER_CURATED',
        approved: true,
        approvedBy: curated.approvedBy,
        approvedAt: now,
        sourceReferenceId: answerCandidate.sourceReferenceId,
      });
      candidateIdsToPublish.push(answerCandidate.id);
    });
  }

  return {
    documentId: input.documentId,
    newQuestions,
    newVariants,
    occurrences,
    answerKeys,
    candidateIdsToPublish,
    examinerCaseLinks: [...examinerCaseLinks.values()],
    examinerQuestionLinks: [...examinerQuestionLinks.values()],
    skippedFingerprints,
  };
}

function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  let arabic = 0;
  let latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0x0600 && cp <= 0x06ff) arabic++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  if (arabic > 0 && latin > 0) return arabic > latin * 4 ? 'ar' : latin > arabic * 4 ? 'en' : 'mixed';
  return arabic > 0 ? 'ar' : 'en';
}

/**
 * Whether a question is ready for automatic evaluation.
 *
 * Requires an approved answer key with at least one non-pitfall key point.
 * A key consisting only of pitfalls can penalise but cannot award, which would
 * make every answer INCORRECT - so such a question stays on self-scoring.
 */
export function isEvaluationReady(answer: ExpectedAnswer | null | undefined): boolean {
  if (answer === null || answer === undefined) return false;
  if (!answer.approved) return false;
  return answer.keyPoints.some((p) => !p.isPitfall && p.weight > 0);
}
