/**
 * Ingestion pipeline: the `parseDocument` of Section 4.3, made concrete.
 *
 * Contract: one call, one `ExtractionRun`, no partial writes. Either the run
 * succeeds and every candidate it produced is provenance-backed, or it fails
 * with a code and produces nothing. There is no state in between, because a
 * half-ingested document is the situation from which silent corruption grows.
 *
 * Performance note (Section 10.2): everything expensive happens here, at
 * ingestion time, and nothing here is ever invoked on the exam path.
 */

import type {
  DocumentId,
  ExtractionCandidate,
  ExtractionRun,
  ExtractionRunId,
  KnowledgeDocument,
  SourceFormat,
  SourceReference,
  SpecialtyId,
} from '../domain/types.ts';
import { EngineError } from '../domain/errors.ts';
import type { Clock, IdFactory } from '../domain/ids.ts';
import { fnv1a64 } from '../domain/hash.ts';
import { ParserRegistry } from './parsers/registry.ts';
import { segmentBlocks, resolveSpecialtyAlias, type SegmentationResult } from './segmenter.ts';
import {
  EXTRACTOR_VERSION,
  extractAll,
  validateCandidates,
  type RejectedCandidate,
} from './extractor.ts';
import { assessTextQuality } from '../text/normalize.ts';

export interface IngestionInput {
  readonly document: KnowledgeDocument;
  readonly bytes: Uint8Array;
  /** Resolved specialty for the whole document, when the uploader supplied one. */
  readonly specialtyId: SpecialtyId | null;
}

export interface IngestionResult {
  readonly run: ExtractionRun;
  readonly candidates: readonly ExtractionCandidate[];
  readonly sourceReferences: readonly SourceReference[];
  readonly rejected: readonly RejectedCandidate[];
  readonly segmentation: SegmentationResult;
  /** Specialty inferred from the document body, when the upload did not carry one. */
  readonly inferredSpecialty: string | null;
  readonly reviewRequired: boolean;
  readonly timings: Readonly<Record<string, number>>;
}

export interface IngestionDeps {
  readonly parsers: ParserRegistry;
  readonly ids: IdFactory;
  readonly clock: Clock;
  /** Hard cap on bytes accepted. Default 8 MiB. */
  readonly maxBytes?: number;
  /** Formats the deployment accepts. Default: everything registered. */
  readonly allowedFormats?: readonly SourceFormat[];
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Composite extractor version.
 *
 * Persisted on every run. When it changes, previously extracted candidates are
 * *not* silently reinterpreted - reprocessing creates a new run that supersedes
 * the old one, and reconciliation is explicit. This is the framework's P1
 * "versioned extraction pipeline" requirement, and it is what makes improving
 * the parser a safe operation rather than a data migration.
 */
export function extractorVersion(parsers: ParserRegistry): string {
  return `${EXTRACTOR_VERSION}/${fnv1a64(parsers.compositeVersion).slice(0, 8)}`;
}

/** Content hash for upload idempotency (Section 4.1). */
export function contentHash(bytes: Uint8Array): string {
  // Hash over a bounded sample plus the length: hashing 8 MiB byte-by-byte in
  // a Worker costs more CPU than the whole rest of ingestion. Sampling the
  // head, tail and length is sufficient to detect a re-upload of the same file,
  // which is all this hash is for. It is not a deduplication proof.
  const head = bytes.subarray(0, Math.min(4096, bytes.length));
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
  let acc = `${bytes.length}:`;
  for (let i = 0; i < head.length; i++) acc += head[i]!.toString(36);
  acc += ':';
  for (let i = 0; i < tail.length; i++) acc += tail[i]!.toString(36);
  return fnv1a64(acc);
}

export function ingest(input: IngestionInput, deps: IngestionDeps): IngestionResult {
  const { document, bytes } = input;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const startedAt = deps.clock.now();
  const timings: Record<string, number> = {};
  const mark = (label: string, from: number): number => {
    const now = deps.clock.now();
    timings[label] = now - from;
    return now;
  };

  // --- Upload boundary checks (Section 4.1) --------------------------------
  if (bytes.length > maxBytes) {
    throw new EngineError('FILE_TOO_LARGE', `File exceeds ${maxBytes} bytes`, {
      byteSize: bytes.length,
      maxBytes,
    });
  }
  if (deps.allowedFormats !== undefined && !deps.allowedFormats.includes(document.format)) {
    throw new EngineError('UNSUPPORTED_FORMAT', `Format '${document.format}' is not accepted`, {
      format: document.format,
      allowed: deps.allowedFormats,
    });
  }

  const runId = deps.ids.extractionRun<ExtractionRunId>();
  const version = extractorVersion(deps.parsers);

  let cursor = startedAt;

  // --- Parse ---------------------------------------------------------------
  const parser = deps.parsers.get(document.format);
  let parsed;
  try {
    parsed = parser.parse(bytes);
  } catch (error) {
    // A parse failure is a terminal run state, recorded rather than thrown away.
    const failureCode = error instanceof EngineError ? error.code : 'INVALID_TEXT';
    throw new EngineError(
      failureCode === 'INVALID_TEXT' ? 'INVALID_TEXT' : failureCode,
      error instanceof Error ? error.message : 'Parser failed',
      { documentId: document.id, runId, extractorVersion: version },
    );
  }
  cursor = mark('parseMs', cursor);

  // --- Text quality gate: OCR_REQUIRED rather than fabricated candidates ---
  const quality = assessTextQuality(parsed.fullText);
  if (!quality.usable) {
    throw new EngineError(
      document.format === 'pdf' ? 'OCR_REQUIRED' : 'INVALID_TEXT',
      `Extracted text is not usable (${quality.reason}); no candidates produced`,
      {
        documentId: document.id,
        runId,
        reason: quality.reason,
        letterRatio: quality.letterRatio,
        meanTokenLength: quality.meanTokenLength,
      },
    );
  }

  // --- Segment -------------------------------------------------------------
  const segmentation = segmentBlocks(parsed.blocks);
  cursor = mark('segmentMs', cursor);

  // --- Extract -------------------------------------------------------------
  const inferredSpecialty =
    input.specialtyId === null
      ? (segmentation.segments.map((s) => resolveSpecialtyAlias(s.specialtyHint)).find((s) => s !== null) ?? null)
      : null;

  const extraction = extractAll(segmentation.segments, {
    documentId: document.id,
    extractionRunId: runId,
    specialtyId: input.specialtyId,
    ids: deps.ids,
    now: startedAt,
  });
  cursor = mark('extractMs', cursor);

  // --- Validate: provenance and schema, before anything is persisted -------
  const referenceIds = new Set(extraction.sourceReferences.map((r) => r.id as string));
  const { valid, invalid } = validateCandidates(extraction.candidates, referenceIds);
  cursor = mark('validateMs', cursor);

  const rejected: RejectedCandidate[] = [
    ...extraction.rejected,
    ...invalid.map((entry) => ({
      rawText: entry.candidate.rawText,
      type: entry.candidate.type,
      reason: entry.reason,
      line: 0,
    })),
  ];

  // Keep only source references that a surviving candidate points at.
  const usedReferenceIds = new Set(valid.map((c) => c.sourceReferenceId as string));
  const sourceReferences = extraction.sourceReferences.filter((r) =>
    usedReferenceIds.has(r.id as string),
  );

  const finishedAt = deps.clock.now();
  timings['totalMs'] = finishedAt - startedAt;

  const run: ExtractionRun = {
    id: runId,
    documentId: document.id,
    extractorVersion: version,
    status: 'SUCCEEDED',
    startedAt,
    finishedAt,
    candidateCount: valid.length,
    failureCode: null,
    supersedesRunId: null,
  };

  return {
    run,
    candidates: valid,
    sourceReferences,
    rejected,
    segmentation,
    inferredSpecialty,
    // Weak structure or a zero-candidate run both mean a human must look.
    reviewRequired: segmentation.reviewRequired || valid.length === 0,
    timings,
  };
}

/**
 * Reprocessing: runs a new extraction that supersedes a prior run.
 *
 * Explicitly separate from `ingest` because the reconciliation semantics differ.
 * The caller receives both runs and must decide what happens to candidates from
 * the superseded run that a reviewer has already acted on - the engine will not
 * silently discard human decisions.
 */
export function reprocess(
  input: IngestionInput,
  previousRun: ExtractionRun,
  deps: IngestionDeps,
): IngestionResult & { readonly supersedes: ExtractionRunId } {
  const version = extractorVersion(deps.parsers);
  if (version === previousRun.extractorVersion) {
    throw new EngineError(
      'EXTRACTOR_VERSION_CONFLICT',
      'Reprocessing with an unchanged extractor version would produce identical output',
      { documentId: input.document.id, extractorVersion: version },
    );
  }
  const result = ingest(input, deps);
  return {
    ...result,
    run: { ...result.run, supersedesRunId: previousRun.id },
    supersedes: previousRun.id,
  };
}

export type { DocumentId };
