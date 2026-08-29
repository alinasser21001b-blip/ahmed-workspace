/**
 * Structural segmentation of OSCE recall documents.
 *
 * This is the module that most obviously "could just be an LLM call", so the
 * reasoning is worth stating plainly.
 *
 * OSCE recall files are not free prose. They are semi-structured documents
 * written to a handful of conventions that students copy from each other year
 * after year: a specialty heading, a doctor's name, a case title, numbered
 * questions, sometimes an answer line. A grammar recognises that structure
 * exactly, in microseconds, with a confidence score and a reason string
 * attached to every decision.
 *
 * An LLM would recognise the same structure with better recall on genuinely
 * malformed files, and in exchange would introduce: non-determinism across
 * runs, an inability to explain why a line was classified as it was, a network
 * round trip inside the ingestion path, per-document cost, and - the failure
 * that actually matters - a tendency to *invent* a plausible question when the
 * source contains none. Section 14's acceptance test for scanned PDFs demands
 * "zero fabricated candidates". A grammar cannot fabricate; it can only fail to
 * recognise, and failing to recognise routes the document to human review.
 *
 * The engine therefore uses the grammar as the system of record and exposes an
 * optional semantic extractor behind the same interface for the residue (see
 * `CandidateExtractionProvider`). That is the framework's own P2 recommendation,
 * and it keeps the AI strictly additive.
 */

import type { TextBlock } from './parsers/registry.ts';
import { normalizeForMatching } from '../text/normalize.ts';

export type LineLabel =
  | 'SPECIALTY'
  | 'EXAMINER'
  | 'CASE'
  | 'QUESTION'
  | 'ANSWER'
  | 'YEAR'
  | 'NOISE'
  | 'CONTINUATION';

export interface ClassifiedLine {
  readonly block: TextBlock;
  readonly label: LineLabel;
  /** 0..1. Drives review ordering; never used to auto-approve. */
  readonly confidence: number;
  /** Human-readable rule name that fired. Shown in the review UI. */
  readonly rule: string;
  /** The payload with the structural marker stripped. */
  readonly value: string;
  /** Question/answer ordinal when the line carried one ("Q3" -> 3). */
  readonly ordinal: number | null;
}

interface Rule {
  readonly name: string;
  readonly label: LineLabel;
  readonly confidence: number;
  readonly pattern: RegExp;
  /** Which capture group holds the payload. Defaults to 1. */
  readonly valueGroup?: number;
  /** Which capture group holds an ordinal, if any. */
  readonly ordinalGroup?: number;
}

/**
 * Rules are ordered: the first match wins.
 *
 * Explicit markers ("Examiner:", "Q1.") come before shape heuristics (a line
 * ending in "?"), because an explicit marker is evidence and a shape is an
 * inference. Confidence values encode that difference so the review queue
 * surfaces inferred lines first.
 */
const RULES: readonly Rule[] = [
  // --- Explicit labelled markers -----------------------------------------
  {
    name: 'examiner:labelled',
    label: 'EXAMINER',
    confidence: 0.95,
    pattern: /^(?:examiner|consultant|assessor|الممتحن|الفاحص|المقيم)\s*[:\-–]\s*(.+)$/iu,
  },
  {
    name: 'case:labelled',
    label: 'CASE',
    confidence: 0.95,
    pattern: /^(?:case|scenario|station|الحاله|الحالة|السيناريو|المحطه|المحطة)\s*(?:\d+)?\s*[:\-–]\s*(.+)$/iu,
  },
  {
    name: 'specialty:labelled',
    label: 'SPECIALTY',
    confidence: 0.95,
    pattern: /^(?:specialty|speciality|department|subject|التخصص|القسم|الماده|المادة)\s*[:\-–]\s*(.+)$/iu,
  },
  {
    name: 'answer:labelled',
    label: 'ANSWER',
    confidence: 0.9,
    pattern: /^(?:a|ans|answer|الجواب|الاجابه|الإجابة|ج)\s*(\d+)?\s*[:.\-–]\s*(.+)$/iu,
    valueGroup: 2,
    ordinalGroup: 1,
  },
  {
    name: 'question:labelled',
    label: 'QUESTION',
    confidence: 0.9,
    pattern: /^(?:q|question|السؤال|سؤال|س)\s*(\d+)?\s*[:.\-–)]\s*(.+)$/iu,
    valueGroup: 2,
    ordinalGroup: 1,
  },
  {
    name: 'year:labelled',
    label: 'YEAR',
    confidence: 0.9,
    pattern: /^(?:year|exam year|السنه|السنة|العام)\s*[:\-–]?\s*((?:19|20)\d{2})/iu,
  },

  // --- Title-prefixed names ----------------------------------------------
  {
    name: 'examiner:title-prefix',
    label: 'EXAMINER',
    confidence: 0.8,
    pattern: /^(?:dr|doctor|prof|professor)\.?\s+([\p{L}][\p{L}\s.'\-]{2,60})$/iu,
  },
  {
    name: 'examiner:arabic-title',
    label: 'EXAMINER',
    confidence: 0.8,
    pattern: /^(?:د|دكتور|دكتورة|الدكتور|الدكتورة|أ\.د|استاذ|الأستاذ)\.?\s+([\p{L}][\p{L}\s.'\-]{2,60})$/u,
  },

  // --- Numbered items ------------------------------------------------------
  {
    name: 'question:numbered-interrogative',
    label: 'QUESTION',
    confidence: 0.8,
    pattern: /^(\d{1,2})\s*[.)\-]\s*(.+[?؟])\s*$/u,
    valueGroup: 2,
    ordinalGroup: 1,
  },
  {
    name: 'question:numbered',
    label: 'QUESTION',
    confidence: 0.6,
    pattern: /^(\d{1,2})\s*[.)\-]\s*(.{8,})$/u,
    valueGroup: 2,
    ordinalGroup: 1,
  },

  // --- Shape heuristics ----------------------------------------------------
  {
    name: 'question:interrogative-mark',
    label: 'QUESTION',
    confidence: 0.7,
    pattern: /^(.{8,}[?؟])\s*$/u,
  },
  {
    name: 'question:interrogative-opening',
    label: 'QUESTION',
    confidence: 0.55,
    pattern:
      /^((?:what|which|how|why|when|where|who|name|list|mention|describe|give|state|define|enumerate|ما|ماذا|كيف|لماذا|متى|متي|أين|اين|من|اذكر|عدد|صف|عرف)\b.{5,})$/iu,
  },
  {
    name: 'year:bare',
    label: 'YEAR',
    confidence: 0.5,
    pattern: /^((?:19|20)\d{2})\s*(?:[-/]\s*(?:19|20)?\d{2})?\s*$/u,
  },
];

/** Lines that are structurally present but carry no knowledge. */
const NOISE_PATTERNS: readonly RegExp[] = [
  /^[\s\-_=*#.·•]+$/u, // rules and bullets
  /^page\s*\d+/iu,
  /^\d+\s*\/\s*\d+$/u, // page x/y
  /^(?:بسم الله|الحمد لله|بالتوفيق|good luck|best of luck)/iu,
  /^(?:note|ملاحظه|ملاحظة)\s*[:\-]/iu,
];

function isNoise(text: string): boolean {
  if (text.length < 2) return true;
  return NOISE_PATTERNS.some((p) => p.test(text));
}

/** Applies the rule table to one line. Pure and total: always returns a label. */
export function classifyLine(block: TextBlock): ClassifiedLine {
  const text = block.text;

  if (isNoise(text)) {
    return { block, label: 'NOISE', confidence: 0.9, rule: 'noise', value: text, ordinal: null };
  }

  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (match === null) continue;
    const value = (match[rule.valueGroup ?? 1] ?? text).trim();
    if (value.length === 0) continue;
    const ordinalRaw = rule.ordinalGroup === undefined ? undefined : match[rule.ordinalGroup];
    const ordinal = ordinalRaw === undefined ? null : Number.parseInt(ordinalRaw, 10);
    return {
      block,
      label: rule.label,
      confidence: rule.confidence,
      rule: rule.name,
      value,
      ordinal: Number.isNaN(ordinal as number) ? null : ordinal,
    };
  }

  return {
    block,
    label: 'CONTINUATION',
    confidence: 0.3,
    rule: 'fallthrough',
    value: text,
    ordinal: null,
  };
}

/**
 * A contiguous run of lines sharing one examiner/case/year context.
 *
 * Segments are the unit that candidate extraction operates on, and the unit
 * whose weak structure triggers REVIEW_REQUIRED.
 */
export interface Segment {
  readonly key: string;
  readonly specialtyHint: string | null;
  readonly examinerHint: string | null;
  readonly caseHint: string | null;
  readonly yearHint: number | null;
  /**
   * The lines the examiner/case hints were read from.
   *
   * Carried separately from the hint strings because provenance must point at
   * the line that actually stated the fact. Anchoring an examiner candidate to
   * the segment's first question line - which is what happens if only the
   * string is kept - produces an excerpt that does not contain the examiner's
   * name, and an audit trail that says the wrong thing while looking correct.
   */
  readonly examinerLine: ClassifiedLine | null;
  readonly caseLine: ClassifiedLine | null;
  readonly lines: readonly ClassifiedLine[];
  /** 0..1 measure of how confidently this segment's structure was recognised. */
  readonly structureScore: number;
}

export interface SegmentationResult {
  readonly segments: readonly Segment[];
  readonly classified: readonly ClassifiedLine[];
  /** True when structure was too weak to extract safely. */
  readonly reviewRequired: boolean;
  readonly diagnostics: {
    readonly totalLines: number;
    readonly questionLines: number;
    readonly examinerLines: number;
    readonly caseLines: number;
    readonly unclassifiedRatio: number;
  };
}

/**
 * Groups classified lines into segments.
 *
 * State machine: an EXAMINER line opens a new segment; a CASE line opens a new
 * segment within the current examiner; QUESTION/ANSWER lines accumulate into
 * the open segment. A CONTINUATION line attaches to the previous QUESTION or
 * ANSWER, which is how multi-line questions survive.
 */
export function segment(lines: readonly ClassifiedLine[]): SegmentationResult {
  const classified = lines;
  const segments: Segment[] = [];

  let specialtyHint: string | null = null;
  let examinerHint: string | null = null;
  let caseHint: string | null = null;
  let yearHint: number | null = null;
  let examinerLine: ClassifiedLine | null = null;
  let caseLine: ClassifiedLine | null = null;
  let current: ClassifiedLine[] = [];
  let sequence = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const hasQuestion = current.some((l) => l.label === 'QUESTION');
    if (!hasQuestion) {
      current = [];
      return;
    }
    sequence++;
    segments.push({
      key: `seg-${sequence}`,
      specialtyHint,
      examinerHint,
      caseHint,
      yearHint,
      examinerLine,
      caseLine,
      lines: current,
      structureScore: scoreStructure(current, examinerHint, caseHint),
    });
    current = [];
  };

  for (const line of classified) {
    switch (line.label) {
      case 'SPECIALTY':
        flush();
        specialtyHint = line.value;
        // A new specialty invalidates the examiner/case context below it.
        examinerHint = null;
        examinerLine = null;
        caseHint = null;
        caseLine = null;
        break;
      case 'EXAMINER':
        flush();
        examinerHint = line.value;
        examinerLine = line;
        caseHint = null;
        caseLine = null;
        break;
      case 'CASE':
        flush();
        caseHint = line.value;
        caseLine = line;
        break;
      case 'YEAR': {
        const parsed = Number.parseInt(line.value, 10);
        if (!Number.isNaN(parsed)) yearHint = parsed;
        break;
      }
      case 'NOISE':
        break;
      case 'QUESTION':
      case 'ANSWER':
      case 'CONTINUATION':
        current.push(line);
        break;
    }
  }
  flush();

  const questionLines = classified.filter((l) => l.label === 'QUESTION').length;
  const examinerLines = classified.filter((l) => l.label === 'EXAMINER').length;
  const caseLines = classified.filter((l) => l.label === 'CASE').length;
  const contentLines = classified.filter((l) => l.label !== 'NOISE').length;
  const unclassified = classified.filter((l) => l.label === 'CONTINUATION').length;
  const unclassifiedRatio = contentLines === 0 ? 1 : unclassified / contentLines;

  // Structure is "weak" when we found no examiner at all, or found no questions,
  // or more than half the content lines fell through the rule table.
  const reviewRequired =
    segments.length === 0 || examinerLines === 0 || questionLines === 0 || unclassifiedRatio > 0.5;

  return {
    segments,
    classified,
    reviewRequired,
    diagnostics: {
      totalLines: classified.length,
      questionLines,
      examinerLines,
      caseLines,
      unclassifiedRatio,
    },
  };
}

function scoreStructure(
  lines: readonly ClassifiedLine[],
  examinerHint: string | null,
  caseHint: string | null,
): number {
  if (lines.length === 0) return 0;
  const questions = lines.filter((l) => l.label === 'QUESTION');
  if (questions.length === 0) return 0;

  const meanQuestionConfidence =
    questions.reduce((a, l) => a + l.confidence, 0) / questions.length;
  const continuationRatio = lines.filter((l) => l.label === 'CONTINUATION').length / lines.length;

  let score = meanQuestionConfidence;
  if (examinerHint !== null) score += 0.15;
  if (caseHint !== null) score += 0.1;
  score -= continuationRatio * 0.3;
  return Math.max(0, Math.min(1, score));
}

/** Convenience: classify then segment. */
export function segmentBlocks(blocks: readonly TextBlock[]): SegmentationResult {
  return segment(blocks.map(classifyLine));
}

/**
 * Normalizes a specialty hint against a controlled alias map.
 *
 * Section 5 marks specialty as the one entity safe to auto-normalize, because
 * the vocabulary is small, closed and administered.
 */
export const SPECIALTY_ALIASES: ReadonlyMap<string, string> = new Map([
  ['pediatrics', 'Pediatrics'],
  ['paediatrics', 'Pediatrics'],
  ['peds', 'Pediatrics'],
  ['طب الاطفال', 'Pediatrics'],
  ['الاطفال', 'Pediatrics'],
  ['medicine', 'Internal Medicine'],
  ['internal medicine', 'Internal Medicine'],
  ['im', 'Internal Medicine'],
  ['الباطنيه', 'Internal Medicine'],
  ['الباطنية', 'Internal Medicine'],
  ['surgery', 'Surgery'],
  ['general surgery', 'Surgery'],
  ['الجراحه', 'Surgery'],
  ['الجراحة', 'Surgery'],
  ['obstetrics', 'Obstetrics & Gynaecology'],
  ['gynaecology', 'Obstetrics & Gynaecology'],
  ['gynecology', 'Obstetrics & Gynaecology'],
  ['obgyn', 'Obstetrics & Gynaecology'],
  ['og', 'Obstetrics & Gynaecology'],
  ['النسائيه', 'Obstetrics & Gynaecology'],
  ['النسائية', 'Obstetrics & Gynaecology'],
  ['psychiatry', 'Psychiatry'],
  ['الطب النفسي', 'Psychiatry'],
  ['orthopedics', 'Orthopaedics'],
  ['orthopaedics', 'Orthopaedics'],
  ['العظام', 'Orthopaedics'],
]);

export function resolveSpecialtyAlias(hint: string | null): string | null {
  if (hint === null) return null;
  return SPECIALTY_ALIASES.get(normalizeForMatching(hint)) ?? null;
}
