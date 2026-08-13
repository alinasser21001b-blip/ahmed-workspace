/**
 * Cursor pagination.
 *
 * Offset pagination is not offered anywhere in this product. On a feed that
 * receives writes while a student scrolls, offsets duplicate rows onto the next
 * page and skip others — and the bug is invisible in testing because it needs
 * concurrent writes to appear.
 *
 * Two cursor shapes, because the feed has two orderings:
 *
 *   time  — `(createdAt, id)`. Chronological surfaces.
 *   rank  — `(pinnedNow, score, id)`. The ranked home feed.
 *
 * `pinnedNow` is the reason the ranked cursor is not just `(score, id)`: the
 * score contains a recency decay, so it changes as time passes. Pinning the
 * clock into the cursor means page 2 is scored against the same instant as page
 * 1, and an item cannot drift across the page boundary and appear twice.
 *
 * Cursors are NOT signed. A tampered cursor can only reorder results the caller
 * is already permitted to see, because permission filtering happens
 * independently of the cursor. It is validated, though: a malformed cursor must
 * produce a clean rejection, never a 500.
 */

export interface TimeCursor {
  kind: 'time';
  /** Epoch milliseconds of the last item's createdAt. */
  t: number;
  id: string;
}

export interface RankCursor {
  kind: 'rank';
  /** Epoch milliseconds the page-1 scoring clock was pinned to. */
  n: number;
  /** Score of the last item on the previous page. */
  s: number;
  id: string;
}

export type Cursor = TimeCursor | RankCursor;

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid_cursor');
    this.name = 'InvalidCursorError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Decodes and validates. Returns null for an absent cursor (first page) and
 * throws `InvalidCursorError` for a present but unusable one — the caller maps
 * that to a 400, so a client bug is diagnosable rather than a silent reset to
 * page one.
 */
export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (raw === undefined || raw === null || raw === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }

  if (typeof parsed !== 'object' || parsed === null) throw new InvalidCursorError();
  const value = parsed as Record<string, unknown>;

  if (value.kind === 'time') {
    if (!isFiniteNumber(value.t) || !isUuid(value.id)) throw new InvalidCursorError();
    return { kind: 'time', t: value.t, id: value.id };
  }

  if (value.kind === 'rank') {
    if (!isFiniteNumber(value.n) || !isFiniteNumber(value.s) || !isUuid(value.id)) {
      throw new InvalidCursorError();
    }
    return { kind: 'rank', n: value.n, s: value.s, id: value.id };
  }

  throw new InvalidCursorError();
}

/**
 * The clock a ranked page is scored against: the cursor's pinned instant when
 * continuing a page run, or now when starting one.
 */
export function pinnedClock(cursor: Cursor | null, now: Date = new Date()): Date {
  return cursor?.kind === 'rank' ? new Date(cursor.n) : now;
}

/**
 * Builds the next-page cursor from a full page.
 *
 * Returns null when the page was short, which is what tells the client it has
 * reached the end. Requesting `limit + 1` rows and trimming is the caller's
 * job; this only decides whether a cursor is warranted.
 */
export function nextCursorFrom<T>(
  items: readonly T[],
  limit: number,
  toCursor: (last: T) => Cursor,
): string | null {
  if (items.length < limit) return null;
  const last = items[items.length - 1];
  if (last === undefined) return null;
  return encodeCursor(toCursor(last));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
