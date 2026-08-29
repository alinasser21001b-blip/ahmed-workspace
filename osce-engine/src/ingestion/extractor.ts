/**
 * Candidate extraction.
 *
 * Turns segments into strictly-typed `ExtractionCandidate` records. Two rules
 * govern everything here, both from Section 4.2:
 *
 *   1. Candidates are typed records, never free-form prose. A candidate that
 *      does not satisfy the schema is dropped with a reason, not coerced.
 *
 *   2. Every candidate carries provenance. A candidate whose evidence cannot be
 *      located in the source is dropped, not published with a null pointer.
 *      This is the mechanism that makes "zero fabricated candidates" checkable
 *      rather than aspirational: a fabricated candidate has no source span, and
 *      a candidate with no source span cannot exist.
 */

import type {
  CandidateId,
  CandidateType,
  DocumentId,
  ExtractionCandidate,
  ExtractionRunId,
  QuestionCategory,
  SourceReference,
  SourceReferenceId,
  SpecialtyId,
} from '../domain/types.ts';
import { asId } from '../domain/types.ts';
import type { IdFactory } from '../domain/ids.ts';
import type { ClassifiedLine, Segment } from './segmenter.ts';
import { normalizeForDisplay } from '../text/normalize.ts';
import { tokenize } from '../text/tokenize.ts';

export const EXTRACTOR_VERSION = 'grammar-2.0.0';

/** Minimum characters for a question to be considered extractable. */
const MIN_QUESTION_LENGTH = 8;
/** Maximum, above which the line is almost certainly a paragraph, not a question. */
const MAX_QUESTION_LENGTH = 500;
const MIN_EXAMINER_LENGTH = 3;
const MAX_EXAMINER_LENGTH = 80;

export interface ExtractionOutput {
  readonly candidates: readonly ExtractionCandidate[];
  readonly sourceReferences: readonly SourceReference[];
  readonly rejected: readonly RejectedCandidate[];
}

export interface RejectedCandidate {
  readonly rawText: string;
  readonly type: CandidateType;
  readonly reason: string;
  readonly line: number;
}

/**
 * Category inference from interrogative shape.
 *
 * Keyword-driven and deliberately conservative: an unmatched question is
 * UNCLASSIFIED, which is honest, rather than being forced into the nearest
 * bucket. Category feeds the compiler's diversity bonus, so a wrong category
 * skews station composition - a reason to under-classify rather than guess.
 */
const CATEGORY_KEYWORDS: readonly (readonly [QuestionCategory, readonly string[]])[] = [
  ['DIAGNOSIS', ['diagnosis', 'diagnose', 'differential', 'dd', 'التشخيص', 'تشخيص']],
  ['INVESTIGATION', ['investigation', 'investigate', 'test', 'tests', 'imaging', 'lab', 'labs', 'الفحوصات', 'تحاليل', 'فحص']],
  ['MANAGEMENT', ['management', 'manage', 'treatment', 'treat', 'therapy', 'next step', 'العلاج', 'التدبير', 'علاج']],
  ['COMPLICATION', ['complication', 'complications', 'risk', 'risks', 'المضاعفات', 'مضاعفات', 'اختلاطات']],
  ['EXAMINATION', ['examination', 'examine', 'sign', 'signs', 'inspect', 'palpat', 'auscultat', 'الفحص السريري', 'العلامات']],
  ['HISTORY', ['history', 'ask', 'symptom', 'symptoms', 'presenting', 'complaint', 'التاريخ المرضي', 'الاعراض', 'اعراض']],
  ['ANATOMY', ['anatomy', 'anatomical', 'nerve', 'artery', 'muscle', 'التشريح', 'العصب', 'الشريان']],
  ['PHARMACOLOGY', ['drug', 'drugs', 'dose', 'dosage', 'side effect', 'contraindication', 'الدواء', 'الجرعه', 'الجرعة']],
  ['COUNSELLING', ['counsel', 'advice', 'advise', 'explain to the patient', 'reassure', 'النصيحه', 'ارشاد']],
];

/**
 * Keyword sets are pre-compiled to stemmed token n-grams, keyed by n.
 *
 * Substring matching cannot be used here. "What are the causes of inTESTinal
 * obstruction" contains "test", and a raw `includes` therefore classifies a
 * causes question as INVESTIGATION. Matching whole tokens - and whole token
 * n-grams for multi-word keywords - removes that entire class of error.
 */
const COMPILED_CATEGORIES: readonly {
  readonly category: QuestionCategory;
  readonly byLength: ReadonlyMap<number, ReadonlySet<string>>;
}[] = CATEGORY_KEYWORDS.map(([category, keywords]) => {
  const byLength = new Map<number, Set<string>>();
  for (const keyword of keywords) {
    const tokens = tokenize(keyword, { removeStopwords: false, minLength: 1 });
    if (tokens.length === 0) continue;
    const bucket = byLength.get(tokens.length) ?? new Set<string>();
    bucket.add(tokens.join(' '));
    byLength.set(tokens.length, bucket);
  }
  return { category, byLength };
});

export function inferCategory(questionText: string): QuestionCategory {
  const tokens = tokenize(questionText, { removeStopwords: false, minLength: 1 });
  if (tokens.length === 0) return 'UNCLASSIFIED';

  for (const { category, byLength } of COMPILED_CATEGORIES) {
    for (const [n, phrases] of byLength) {
      if (n > tokens.length) continue;
      for (let i = 0; i + n <= tokens.length; i++) {
        if (phrases.has(tokens.slice(i, i + n).join(' '))) return category;
      }
    }
  }
  return 'UNCLASSIFIED';
}

interface ExtractContext {
  readonly documentId: DocumentId;
  readonly extractionRunId: ExtractionRunId;
  readonly specialtyId: SpecialtyId | null;
  readonly ids: IdFactory;
  readonly now: number;
}

function makeSourceReference(
  line: ClassifiedLine,
  ctx: ExtractContext,
): SourceReference {
  return {
    id: ctx.ids.sourceReference<SourceReferenceId>(),
    documentId: ctx.documentId,
    extractionRunId: ctx.extractionRunId,
    page: line.block.page,
    lineStart: line.block.line,
    lineEnd: line.block.line,
    charStart: line.block.charStart,
    charEnd: line.block.charEnd,
    // Verbatim: the excerpt is the audit artefact and is never normalized.
    excerpt: line.block.text,
  };
}

function makeCandidate(
  ctx: ExtractContext,
  segment: Segment,
  line: ClassifiedLine,
  type: CandidateType,
  rawText: string,
  proposedText: string,
  sourceReferenceId: SourceReferenceId,
  category: QuestionCategory | null,
): ExtractionCandidate {
  return {
    id: ctx.ids.candidate<CandidateId>(),
    documentId: ctx.documentId,
    extractionRunId: ctx.extractionRunId,
    type,
    state: 'PENDING',
    rawText,
    proposedText,
    editedText: null,
    sourceReferenceId,
    // Segment structure quality and line rule confidence are independent
    // signals; their product is the joint confidence that this candidate is
    // both correctly typed and correctly scoped.
    confidence: Number((line.confidence * (0.5 + 0.5 * segment.structureScore)).toFixed(4)),
    segmentKey: segment.key,
    specialtyId: ctx.specialtyId,
    academicYear: segment.yearHint,
    category,
    mergedIntoCandidateId: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
  };
}

/**
 * Extracts candidates from one segment.
 *
 * Answer lines are attached to the immediately preceding question by ordinal
 * when both carry one, otherwise by position. Unattached answers are dropped:
 * an answer with no question is not curatable and would pollute the queue.
 */
export function extractSegment(segment: Segment, ctx: ExtractContext): ExtractionOutput {
  const candidates: ExtractionCandidate[] = [];
  const sourceReferences: SourceReference[] = [];
  const rejected: RejectedCandidate[] = [];

  // --- Examiner and case are segment-level, emitted once each -------------
  // Each is anchored to the line that actually stated it, so the stored excerpt
  // contains the examiner's name rather than the first question of the segment.
  if (segment.examinerHint !== null && segment.examinerLine !== null) {
    const examinerLine = segment.examinerLine;
    const name = normalizeForDisplay(segment.examinerHint);
    if (name.length < MIN_EXAMINER_LENGTH || name.length > MAX_EXAMINER_LENGTH) {
      rejected.push({
        rawText: segment.examinerHint,
        type: 'EXAMINER',
        reason: 'EXAMINER_LENGTH_OUT_OF_RANGE',
        line: examinerLine.block.line,
      });
    } else {
      const ref = makeSourceReference(examinerLine, ctx);
      sourceReferences.push(ref);
      candidates.push(
        makeCandidate(ctx, segment, examinerLine, 'EXAMINER', segment.examinerHint, name, ref.id, null),
      );
    }
  }

  if (segment.caseHint !== null && segment.caseLine !== null) {
    const caseLine = segment.caseLine;
    const title = normalizeForDisplay(segment.caseHint);
    if (title.length >= 2) {
      const ref = makeSourceReference(caseLine, ctx);
      sourceReferences.push(ref);
      candidates.push(
        makeCandidate(ctx, segment, caseLine, 'CASE', segment.caseHint, title, ref.id, null),
      );
    } else {
      rejected.push({
        rawText: segment.caseHint,
        type: 'CASE',
        reason: 'CASE_TITLE_TOO_SHORT',
        line: caseLine.block.line,
      });
    }
  }

  // --- Questions and their answers -----------------------------------------
  // Continuation lines are folded into the preceding question or answer first,
  // so that a question wrapped across two lines becomes one candidate.
  const folded = foldContinuations(segment.lines);

  let lastQuestionCandidate: ExtractionCandidate | null = null;

  for (const item of folded) {
    if (item.line.label === 'QUESTION') {
      const text = normalizeForDisplay(item.text);
      if (text.length < MIN_QUESTION_LENGTH) {
        rejected.push({
          rawText: item.text,
          type: 'QUESTION',
          reason: 'QUESTION_TOO_SHORT',
          line: item.line.block.line,
        });
        continue;
      }
      if (text.length > MAX_QUESTION_LENGTH) {
        rejected.push({
          rawText: item.text,
          type: 'QUESTION',
          reason: 'QUESTION_TOO_LONG',
          line: item.line.block.line,
        });
        continue;
      }
      const ref = makeSourceReference(item.line, ctx);
      sourceReferences.push(ref);
      const candidate = makeCandidate(
        ctx,
        segment,
        item.line,
        'QUESTION',
        item.text,
        text,
        ref.id,
        inferCategory(text),
      );
      candidates.push(candidate);
      lastQuestionCandidate = candidate;
      continue;
    }

    if (item.line.label === 'ANSWER') {
      const text = normalizeForDisplay(item.text);
      if (lastQuestionCandidate === null) {
        rejected.push({
          rawText: item.text,
          type: 'ANSWER',
          reason: 'ANSWER_WITHOUT_QUESTION',
          line: item.line.block.line,
        });
        continue;
      }
      if (text.length < 2) {
        rejected.push({
          rawText: item.text,
          type: 'ANSWER',
          reason: 'ANSWER_TOO_SHORT',
          line: item.line.block.line,
        });
        continue;
      }
      const ref = makeSourceReference(item.line, ctx);
      sourceReferences.push(ref);
      // The answer candidate is bound to its question through segmentKey plus
      // ordering; the review UI presents them as a pair.
      candidates.push(
        makeCandidate(ctx, segment, item.line, 'ANSWER', item.text, text, ref.id, null),
      );
    }
  }

  return { candidates, sourceReferences, rejected };
}

interface FoldedLine {
  readonly line: ClassifiedLine;
  readonly text: string;
}

/**
 * Attaches CONTINUATION lines to the QUESTION or ANSWER above them.
 *
 * A continuation before any question is discarded rather than promoted: text
 * that appears above the first question is a header, not content.
 */
function foldContinuations(lines: readonly ClassifiedLine[]): FoldedLine[] {
  const out: FoldedLine[] = [];
  for (const line of lines) {
    if (line.label === 'CONTINUATION') {
      const previous = out[out.length - 1];
      if (previous === undefined) continue;
      out[out.length - 1] = { line: previous.line, text: `${previous.text} ${line.value}`.trim() };
      continue;
    }
    if (line.label === 'QUESTION' || line.label === 'ANSWER') {
      out.push({ line, text: line.value });
    }
  }
  return out;
}

/** Extracts across all segments, preserving document order. */
export function extractAll(
  segments: readonly Segment[],
  ctx: {
    documentId: DocumentId;
    extractionRunId: ExtractionRunId;
    specialtyId: SpecialtyId | null;
    ids: IdFactory;
    now: number;
  },
): ExtractionOutput {
  const candidates: ExtractionCandidate[] = [];
  const sourceReferences: SourceReference[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const seg of segments) {
    const result = extractSegment(seg, ctx);
    candidates.push(...result.candidates);
    sourceReferences.push(...result.sourceReferences);
    rejected.push(...result.rejected);
  }

  return { candidates, sourceReferences, rejected };
}

/**
 * Runtime schema validation.
 *
 * Section 13 requires that every candidate contain provenance and confidence.
 * This is the gate that enforces it, and it is applied to the output of *any*
 * extraction provider - including an optional semantic one, whose output is by
 * definition untrusted. Returns the surviving candidates plus a reason for each
 * rejection.
 */
export function validateCandidates(
  candidates: readonly ExtractionCandidate[],
  sourceReferenceIds: ReadonlySet<string>,
): { valid: ExtractionCandidate[]; invalid: { candidate: ExtractionCandidate; reason: string }[] } {
  const valid: ExtractionCandidate[] = [];
  const invalid: { candidate: ExtractionCandidate; reason: string }[] = [];

  for (const candidate of candidates) {
    if (!sourceReferenceIds.has(candidate.sourceReferenceId)) {
      invalid.push({ candidate, reason: 'MISSING_PROVENANCE' });
      continue;
    }
    if (candidate.proposedText.trim().length === 0) {
      invalid.push({ candidate, reason: 'EMPTY_PROPOSED_TEXT' });
      continue;
    }
    if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
      invalid.push({ candidate, reason: 'CONFIDENCE_OUT_OF_RANGE' });
      continue;
    }
    if (candidate.state !== 'PENDING') {
      invalid.push({ candidate, reason: 'CANDIDATE_NOT_PENDING' });
      continue;
    }
    valid.push(candidate);
  }

  return { valid, invalid };
}

/** Provider interface from Section 13. A semantic extractor implements this too. */
export interface CandidateExtractionProvider {
  readonly name: string;
  readonly version: string;
  extract(
    segment: Segment,
    ctx: {
      documentId: DocumentId;
      extractionRunId: ExtractionRunId;
      specialtyId: SpecialtyId | null;
      ids: IdFactory;
      now: number;
    },
  ): Promise<ExtractionOutput> | ExtractionOutput;
}

/** The deterministic grammar extractor, exposed through the provider interface. */
export const grammarExtractionProvider: CandidateExtractionProvider = {
  name: 'grammar',
  version: EXTRACTOR_VERSION,
  extract: (segment, ctx) => extractSegment(segment, ctx),
};

/** Re-exported so adapters can persist ids without importing the branding helper. */
export { asId };
