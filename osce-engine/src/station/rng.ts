/**
 * Seeded pseudo-random number generation.
 *
 * Section 7 flags this as a "professional improvement": make station
 * compilation deterministic per session by storing a seed, so a station can be
 * reproduced for debugging, dispute resolution and fair comparison between
 * students.
 *
 * `Math.random()` cannot do that - it has no seed and no reproducible sequence.
 * xoshiro128** is used instead: 128 bits of state, passes BigCrush, ~1ns per
 * draw, and eight lines of arithmetic with no dependencies.
 *
 * Reproducibility here is not a nicety. When a student disputes a station, the
 * only defensible answer is to re-run the compiler with the stored seed and
 * show that it produces exactly the same questions in exactly the same order.
 */

import { fnv1a32 } from '../domain/hash.ts';

export class SeededRandom {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  readonly seed: string;
  private draws = 0;

  constructor(seed: string) {
    this.seed = seed;
    // Derive four 32-bit words from the seed string. Distinct salts avoid the
    // degenerate all-zero state, which xoshiro cannot escape.
    this.s0 = fnv1a32('x0:' + seed) || 1;
    this.s1 = fnv1a32('x1:' + seed) || 2;
    this.s2 = fnv1a32('x2:' + seed) || 3;
    this.s3 = fnv1a32('x3:' + seed) || 4;
    // Discard the first few outputs so low-entropy seeds ("1", "2") diverge.
    for (let i = 0; i < 16; i++) this.nextUint32();
    this.draws = 0;
  }

  /** Raw 32-bit output. xoshiro128** scrambler. */
  nextUint32(): number {
    this.draws++;
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;

    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11) >>> 0;

    return result;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Integer in [0, bound). Rejection-sampled so the distribution stays uniform. */
  nextInt(bound: number): number {
    if (bound <= 0) throw new RangeError('bound must be positive');
    if ((bound & (bound - 1)) === 0) return this.nextUint32() & (bound - 1);
    // Reject the tail that would bias the modulo.
    const limit = Math.floor(0x100000000 / bound) * bound;
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return value % bound;
  }

  /** Fisher-Yates shuffle. Returns a new array; the input is untouched. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /**
   * Weighted sample without replacement.
   *
   * Uses the exponential-jump (A-Res) formulation: each item receives the key
   * `random^(1/weight)` and the top `count` keys are taken. One pass, no
   * cumulative-weight rebuild after each draw, and provably equivalent to
   * repeated weighted draws without replacement.
   */
  weightedSample<T>(items: readonly T[], weights: readonly number[], count: number): T[] {
    if (items.length !== weights.length) {
      throw new RangeError('items and weights must be the same length');
    }
    if (count >= items.length) return this.shuffle(items);

    const keyed = items.map((item, index) => {
      const weight = Math.max(1e-9, weights[index] as number);
      // Draw u in (0,1] then key = u^(1/w). Larger weight -> key nearer 1.
      const u = Math.max(Number.EPSILON, this.next());
      return { item, key: Math.pow(u, 1 / weight) };
    });
    keyed.sort((a, b) => b.key - a.key);
    return keyed.slice(0, count).map((k) => k.item);
  }

  /** Picks one item with probability proportional to its weight. */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty list');
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return items[this.nextInt(items.length)] as T;
    let target = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      target -= Math.max(0, weights[i] as number);
      if (target <= 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Number of draws taken. Exposed so tests can assert determinism precisely. */
  get drawCount(): number {
    return this.draws;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Builds a compiler seed.
 *
 * Composed from the inputs that define the station rather than from a random
 * value, so that "recompile this student's station" needs only data already in
 * the session row. A nonce is included because two students requesting the same
 * specialty in the same millisecond must not receive identical stations.
 */
export function makeCompilerSeed(parts: {
  readonly studentId: string;
  readonly specialtyId: string;
  readonly requestedAt: number;
  readonly nonce: string;
}): string {
  return `${parts.studentId}:${parts.specialtyId}:${parts.requestedAt}:${parts.nonce}`;
}
