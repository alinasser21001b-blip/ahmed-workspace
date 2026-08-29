/**
 * Structured event taxonomy (Section 11).
 *
 * The framework lists the minimum events; this makes them a closed, typed union
 * so that emitting an event with a misspelled name is a compile error rather
 * than a dashboard that silently reports zero.
 *
 * Rules the shape enforces:
 *   - every event carries `at`, `stage` and a correlation id, so a document can
 *     be traced from upload to student answer with one query;
 *   - no event field may contain raw student answers, key points, or file
 *     contents. `redact` strips anything not on the allowlist before emit,
 *     because "don't log secrets" as a convention fails the first time someone
 *     adds a field in a hurry.
 */

export type EngineStage =
  | 'upload'
  | 'extraction'
  | 'review'
  | 'publish'
  | 'compile'
  | 'session'
  | 'evaluation';

export type EngineEventName =
  | 'document.uploaded'
  | 'document.processing_started'
  | 'document.failed'
  | 'document.review_ready'
  | 'candidate.approved'
  | 'candidate.rejected'
  | 'candidate.merged'
  | 'knowledge.published'
  | 'exam.session_created'
  | 'exam.session_completed'
  | 'exam.session_abandoned'
  | 'evaluation.success'
  | 'evaluation.fallback'
  | 'evaluation.invalid_session'
  | 'resolution.ambiguous'
  | 'dedup.suggested';

export interface EngineEvent {
  readonly name: EngineEventName;
  readonly stage: EngineStage;
  readonly at: number;
  /** Ties every event of one logical operation together. */
  readonly correlationId: string;
  /** Duration of the operation, when the event marks its completion. */
  readonly durationMs?: number;
  readonly outcome: 'ok' | 'error';
  readonly errorCode?: string;
  /** Numeric dimensions. Safe to aggregate. */
  readonly metrics?: Readonly<Record<string, number>>;
  /** Low-cardinality string dimensions. Never free text. */
  readonly tags?: Readonly<Record<string, string>> | undefined;
}

export interface EventSink {
  emit(event: EngineEvent): void;
}

/**
 * Fields permitted in `tags`.
 *
 * An allowlist, not a denylist. Anything not named here is dropped, so adding a
 * field that happens to contain answer text cannot leak it into logs by
 * default - the developer has to come here and think about it first.
 */
const ALLOWED_TAG_KEYS: ReadonlySet<string> = new Set([
  'documentId', 'runId', 'candidateId', 'candidateType', 'examinerId', 'caseId',
  'questionId', 'sessionId', 'sessionQuestionId', 'specialtyId', 'studentId',
  'format', 'extractorVersion', 'evaluatorVersion', 'policyVersion',
  'correctness', 'scoringMode', 'reason', 'decision', 'matchedBy',
]);

/** Values longer than this are truncated: an id is short, free text is not. */
const MAX_TAG_LENGTH = 64;

export function redactTags(
  tags: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> | undefined {
  if (tags === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!ALLOWED_TAG_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    out[key] = String(value).slice(0, MAX_TAG_LENGTH);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** Emits to a callback. The Worker binds this to console.log as NDJSON. */
export class CallbackSink implements EventSink {
  private readonly write: (event: EngineEvent) => void;

  constructor(write: (event: EngineEvent) => void) {
    this.write = write;
  }

  emit(event: EngineEvent): void {
    this.write({ ...event, tags: redactTags(event.tags) });
  }
}

/** Collects events in memory. Used by tests to assert on observability itself. */
export class MemorySink implements EventSink {
  readonly events: EngineEvent[] = [];
  emit(event: EngineEvent): void {
    this.events.push({ ...event, tags: redactTags(event.tags) });
  }
  byName(name: EngineEventName): EngineEvent[] {
    return this.events.filter((e) => e.name === name);
  }
  clear(): void {
    this.events.length = 0;
  }
}

/** Drops everything. The default, so the engine never depends on a sink. */
export const nullSink: EventSink = { emit: () => {} };

/**
 * Latency recorder with exact percentiles over a bounded window.
 *
 * Exact rather than approximate because the sample sizes here are small enough
 * to sort, and because the KPI table states hard p95 targets - reporting an
 * approximation against a hard target invites arguing about the estimator
 * instead of about the latency.
 */
export class LatencyRecorder {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 1000) {
    this.maxSamples = maxSamples;
  }

  record(ms: number): void {
    if (this.samples.length >= this.maxSamples) this.samples.shift();
    this.samples.push(ms);
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    // Nearest-rank: the smallest value at or above p% of the distribution.
    const rank = Math.ceil((p / 100) * sorted.length);
    const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
    return sorted[index] as number;
  }

  get summary(): { count: number; p50: number; p95: number; p99: number; max: number } {
    return {
      count: this.samples.length,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.samples.length === 0 ? 0 : Math.max(...this.samples),
    };
  }
}

/**
 * The KPI targets from Section 14, as data.
 *
 * Machine-readable so CI can assert against them rather than a human comparing
 * a dashboard to a PDF.
 */
export interface KpiTarget {
  readonly key: string;
  readonly description: string;
  readonly target: number;
  readonly comparison: 'lte' | 'gte';
  readonly unit: 'ms' | 'ratio' | 'count';
}

export const KPI_TARGETS: readonly KpiTarget[] = Object.freeze([
  { key: 'station.create.p95', description: 'Station creation p95', target: 800, comparison: 'lte', unit: 'ms' },
  { key: 'evaluation.deterministic.p95', description: 'Deterministic evaluation p95', target: 300, comparison: 'lte', unit: 'ms' },
  { key: 'question.next.p95', description: 'Next-question client transition p95', target: 150, comparison: 'lte', unit: 'ms' },
  { key: 'admin.candidates.p95', description: 'Admin candidate list p95', target: 800, comparison: 'lte', unit: 'ms' },
  { key: 'upload.ack.p95', description: 'Upload acknowledgement p95', target: 1500, comparison: 'lte', unit: 'ms' },
  { key: 'station.create.failure_rate', description: 'Station creation failure rate', target: 0.005, comparison: 'lte', unit: 'ratio' },
  { key: 'extraction.precision', description: 'Extraction precision after review', target: 0.9, comparison: 'gte', unit: 'ratio' },
  { key: 'examiner.auto_merge_errors', description: 'Incorrect examiner auto-merges', target: 0, comparison: 'lte', unit: 'count' },
  { key: 'publish.duplicate_incidents', description: 'Duplicate publish incidents', target: 0, comparison: 'lte', unit: 'count' },
]);

export function checkKpi(key: string, observed: number): { pass: boolean; target: KpiTarget } | null {
  const target = KPI_TARGETS.find((t) => t.key === key);
  if (target === undefined) return null;
  const pass = target.comparison === 'lte' ? observed <= target.target : observed >= target.target;
  return { pass, target };
}
