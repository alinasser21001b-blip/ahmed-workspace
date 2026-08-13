import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  nextCursorFrom,
  pinnedClock,
  type Cursor,
} from '../cursor.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('cursor codec', () => {
  it('round-trips a time cursor', () => {
    const cursor: Cursor = { kind: 'time', t: 1_700_000_000_000, id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('round-trips a rank cursor', () => {
    const cursor: Cursor = { kind: 'rank', n: 1_700_000_000_000, s: 4.25, id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('rejects a malformed cursor rather than silently resetting to page one', () => {
    // A silent reset would make a client bug look like a feed that loops.
    for (const bad of [
      'not-base64!!',
      Buffer.from('not json').toString('base64url'),
      Buffer.from(JSON.stringify({ kind: 'unknown' })).toString('base64url'),
      Buffer.from(JSON.stringify({ kind: 'time', t: 'soon', id: ID })).toString('base64url'),
      Buffer.from(JSON.stringify({ kind: 'time', t: 1, id: 'not-a-uuid' })).toString('base64url'),
      Buffer.from(JSON.stringify({ kind: 'rank', n: 1, s: null, id: ID })).toString('base64url'),
      Buffer.from(JSON.stringify(['array'])).toString('base64url'),
      Buffer.from(JSON.stringify(null)).toString('base64url'),
    ]) {
      expect(() => decodeCursor(bad), bad).toThrow(InvalidCursorError);
    }
  });

  it('does not let an injected id escape uuid validation', () => {
    const hostile = Buffer.from(
      JSON.stringify({ kind: 'time', t: 1, id: "' OR 1=1 --" }),
    ).toString('base64url');
    expect(() => decodeCursor(hostile)).toThrow(InvalidCursorError);
  });
});

describe('pinnedClock', () => {
  const now = new Date('2026-02-01T00:00:00Z');

  it('uses the wall clock when starting a page run', () => {
    expect(pinnedClock(null, now)).toEqual(now);
    expect(pinnedClock({ kind: 'time', t: 5, id: ID }, now)).toEqual(now);
  });

  it('reuses the pinned clock when continuing a ranked run', () => {
    // Page 2 must be scored against page 1's instant, or an item can drift
    // across the boundary and appear on both pages.
    const pinned = new Date('2026-01-31T00:00:00Z');
    expect(pinnedClock({ kind: 'rank', n: pinned.getTime(), s: 1, id: ID }, now)).toEqual(pinned);
  });
});

describe('nextCursorFrom', () => {
  const toCursor = (item: { id: string; t: number }): Cursor => ({
    kind: 'time',
    t: item.t,
    id: item.id,
  });

  it('returns null on a short page, which is how the client learns it is done', () => {
    expect(nextCursorFrom([{ id: ID, t: 1 }], 20, toCursor)).toBeNull();
    expect(nextCursorFrom([], 20, toCursor)).toBeNull();
  });

  it('returns a cursor built from the last item of a full page', () => {
    const items = [
      { id: ID, t: 2 },
      { id: '22222222-2222-4222-8222-222222222222', t: 1 },
    ];
    const cursor = nextCursorFrom(items, 2, toCursor);
    expect(cursor).not.toBeNull();
    expect(decodeCursor(cursor)).toEqual({ kind: 'time', t: 1, id: items[1]!.id });
  });
});
