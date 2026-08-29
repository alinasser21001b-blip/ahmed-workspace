/**
 * Identifier generation.
 *
 * Uses a ULID-shaped, lexicographically sortable, 26-character Crockford
 * base-32 identifier: 48 bits of millisecond timestamp + 80 bits of entropy.
 *
 * Sortability is a performance decision, not an aesthetic one. The admin review
 * queue and the occurrence table are both read in insertion order; random
 * UUIDv4 primary keys scatter B-tree inserts across the whole index on every
 * write, which on D1/SQLite means a page fault per insert once the table
 * exceeds the page cache.
 */

import { asId } from './types.ts';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface Clock {
  now(): number;
}

export interface Random {
  /** Returns a float in [0, 1). */
  next(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoRandom: Random = {
  next: () => {
    const c = globalThis.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      const buf = new Uint32Array(1);
      c.getRandomValues(buf);
      return (buf[0] as number) / 0x100000000;
    }
    return Math.random();
  },
};

export function ulid(clock: Clock = systemClock, random: Random = cryptoRandom): string {
  let time = clock.now();
  const chars = new Array<string>(26);
  for (let i = 9; i >= 0; i--) {
    chars[i] = ALPHABET[time % 32] as string;
    time = Math.floor(time / 32);
  }
  for (let i = 10; i < 26; i++) {
    chars[i] = ALPHABET[Math.floor(random.next() * 32)] as string;
  }
  return chars.join('');
}

/** Prefixed ID factory: `exm_01J...`. The prefix makes logs self-describing. */
export function makeIdFactory(clock: Clock = systemClock, random: Random = cryptoRandom) {
  const gen =
    (prefix: string) =>
    <T extends string>(): T =>
      asId<T>(`${prefix}_${ulid(clock, random)}`);
  return {
    document: gen('doc'),
    extractionRun: gen('run'),
    sourceReference: gen('src'),
    specialty: gen('spc'),
    examiner: gen('exm'),
    case: gen('cas'),
    question: gen('qst'),
    variant: gen('var'),
    occurrence: gen('occ'),
    candidate: gen('cnd'),
    answerKey: gen('ans'),
    session: gen('ses'),
    sessionQuestion: gen('sqn'),
  };
}

export type IdFactory = ReturnType<typeof makeIdFactory>;
