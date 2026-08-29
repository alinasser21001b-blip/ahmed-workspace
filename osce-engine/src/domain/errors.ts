/**
 * Typed error taxonomy.
 *
 * Every failure the engine can produce has a stable machine-readable code so
 * that dashboards, alerts and client UX branch on `code`, never on message
 * text. Codes are grouped by pipeline stage to keep metrics legible.
 */

export type EngineErrorCode =
  // Upload boundary
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'UPLOAD_UNAUTHORIZED'
  | 'DUPLICATE_UPLOAD'
  // Extraction
  | 'OCR_REQUIRED'
  | 'INVALID_TEXT'
  | 'REVIEW_REQUIRED'
  | 'INVALID_EXTRACTION_SCHEMA'
  | 'MISSING_PROVENANCE'
  | 'EXTRACTOR_VERSION_CONFLICT'
  // Resolution
  | 'AMBIGUOUS_EXAMINER'
  | 'AMBIGUOUS_CASE'
  | 'CROSS_SPECIALTY_MERGE'
  // Review / publish
  | 'INVALID_STATE_TRANSITION'
  | 'UNREVIEWED_CANDIDATE'
  | 'PUBLISH_CONFLICT'
  | 'ANSWER_NOT_APPROVED'
  // Station compiler
  | 'NO_PUBLISHED_EXAMINER'
  | 'NO_PUBLISHED_CASE'
  | 'INSUFFICIENT_QUESTIONS'
  | 'EXAMINER_SPECIALTY_MISMATCH'
  | 'CASE_NOT_LINKED_TO_EXAMINER'
  // Session / evaluation
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_ACTIVE'
  | 'SESSION_QUESTION_NOT_OWNED'
  | 'PREPARATION_NOT_FINISHED'
  | 'ALREADY_ANSWERED'
  | 'EVALUATION_NOT_READY'
  | 'EVALUATOR_UNAVAILABLE'
  // Generic
  | 'INVARIANT_VIOLATION';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  /** True when a caller can retry the same request unchanged and may succeed. */
  readonly retryable: boolean;

  constructor(
    code: EngineErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    retryable = false,
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = Object.freeze({ ...details });
    this.retryable = retryable;
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

export function fail(
  code: EngineErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new EngineError(code, message, details);
}

/**
 * Result type for operations where failure is an expected outcome rather than
 * an exception (resolution, evaluation). Keeps hot paths allocation-cheap and
 * forces callers to handle the failure branch.
 */
export type Result<T, E = EngineError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
