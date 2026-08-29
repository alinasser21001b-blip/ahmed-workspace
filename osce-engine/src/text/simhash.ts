/**
 * Near-duplicate detection: SimHash and MinHash/LSH.
 *
 * Question deduplication is the operation that grows quadratically. A corpus of
 * 20,000 published questions has 2x10^8 pairs; scoring each with the composite
 * similarity at ~3 microseconds is ten minutes of CPU per full pass, which is
 * far outside a Worker's budget.
 *
 * Both structures here reduce that to a linear pass plus a small number of
 * candidate comparisons:
 *
 *   SimHash - one 64-bit signature per question. Similar texts have signatures
 *             within a small Hamming distance. Cheap to store, cheap to compare,
 *             and its banded form gives an index.
 *
 *   MinHash - a signature vector whose collision probability *equals* Jaccard
 *             similarity. Banded LSH turns "find everything above 0.8 Jaccard"
 *             into a handful of hash-bucket lookups.
 *
 * Both are approximate; both are used only to *propose* candidate pairs, which
 * are then scored exactly and shown to a reviewer. No merge is ever executed on
 * a SimHash result alone.
 */

import { fnv1a32 } from '../domain/hash.ts';

// ---------------------------------------------------------------------------
// SimHash
// ---------------------------------------------------------------------------

/**
 * 64-bit SimHash over weighted features, returned as two 32-bit halves.
 *
 * Stored as a pair rather than a BigInt so that D1/SQLite can index it as two
 * INTEGER columns and Hamming distance stays branch-free integer arithmetic.
 */
export interface SimHash {
  readonly hi: number;
  readonly lo: number;
}

export function simhash(features: readonly string[]): SimHash {
  const vector = new Int32Array(64);
  for (const feature of features) {
    // Two independently salted 32-bit hashes supply the 64 bits.
    const h1 = fnv1a32('a#' + feature);
    const h2 = fnv1a32('b#' + feature);
    for (let bit = 0; bit < 32; bit++) {
      vector[bit] = (vector[bit] as number) + ((h1 >>> bit) & 1 ? 1 : -1);
      vector[bit + 32] = (vector[bit + 32] as number) + ((h2 >>> bit) & 1 ? 1 : -1);
    }
  }
  let lo = 0;
  let hi = 0;
  for (let bit = 0; bit < 32; bit++) {
    if ((vector[bit] as number) > 0) lo |= 1 << bit;
    if ((vector[bit + 32] as number) > 0) hi |= 1 << bit;
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

/** Population count of a 32-bit word (Hacker's Delight). */
function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (Math.imul(x, 0x01010101) >>> 24) & 0xff;
}

/** Hamming distance between two SimHash signatures, in [0, 64]. */
export function hammingDistance(a: SimHash, b: SimHash): number {
  return popcount32((a.hi ^ b.hi) >>> 0) + popcount32((a.lo ^ b.lo) >>> 0);
}

/**
 * Estimated cosine-like similarity from Hamming distance.
 * Exact for the SimHash construction: 1 - d/64.
 */
export function simhashSimilarity(a: SimHash, b: SimHash): number {
  return 1 - hammingDistance(a, b) / 64;
}

/**
 * Banded SimHash index keys.
 *
 * Splitting 64 bits into `bands` chunks and indexing each chunk means any two
 * signatures within Hamming distance < bands must share at least one chunk
 * (pigeonhole). Four bands catches everything within distance 3, which is the
 * practical near-duplicate threshold for question text.
 */
export function simhashBands(sig: SimHash, bands = 4): string[] {
  const bitsPerBand = 64 / bands;
  const keys: string[] = [];
  for (let b = 0; b < bands; b++) {
    const startBit = b * bitsPerBand;
    let value = 0;
    for (let i = 0; i < bitsPerBand; i++) {
      const bit = startBit + i;
      const word = bit < 32 ? sig.lo : sig.hi;
      const shift = bit < 32 ? bit : bit - 32;
      if ((word >>> shift) & 1) value |= 1 << i;
    }
    keys.push(`${b}:${(value >>> 0).toString(36)}`);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// MinHash + LSH
// ---------------------------------------------------------------------------

/**
 * MinHash signature.
 *
 * Uses the "one permutation via multiplicative hashing" scheme: instead of k
 * independent hash functions, one base hash is combined with k (a, b) pairs
 * drawn from a fixed seed. Deterministic across processes, which matters
 * because signatures are persisted and compared across deploys.
 */
export class MinHasher {
  private readonly a: Uint32Array;
  private readonly b: Uint32Array;
  readonly numHashes: number;

  constructor(numHashes = 64, seed = 0x5eed) {
    this.numHashes = numHashes;
    this.a = new Uint32Array(numHashes);
    this.b = new Uint32Array(numHashes);
    // xorshift32 keeps coefficient generation deterministic and dependency-free.
    let state = seed >>> 0 || 1;
    const nextRand = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state;
    };
    for (let i = 0; i < numHashes; i++) {
      // `a` must be odd for the multiplicative map to be a bijection mod 2^32.
      this.a[i] = (nextRand() | 1) >>> 0;
      this.b[i] = nextRand();
    }
  }

  signature(features: readonly string[]): Uint32Array {
    const sig = new Uint32Array(this.numHashes).fill(0xffffffff);
    if (features.length === 0) return sig;
    for (const feature of features) {
      const base = fnv1a32('a#' + feature);
      for (let i = 0; i < this.numHashes; i++) {
        const h = (Math.imul(base, this.a[i] as number) + (this.b[i] as number)) >>> 0;
        if (h < (sig[i] as number)) sig[i] = h;
      }
    }
    return sig;
  }

  /** Estimated Jaccard similarity: the fraction of agreeing signature slots. */
  static estimateJaccard(a: Uint32Array, b: Uint32Array): number {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;
    let agree = 0;
    for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
    return agree / n;
  }

  /**
   * LSH band keys.
   *
   * With `bands` bands of `rows = numHashes / bands` rows each, the probability
   * that two items with Jaccard s share at least one band is
   *   1 - (1 - s^rows)^bands
   * The default 16 bands x 4 rows gives ~0.03 at s=0.3 and ~0.98 at s=0.8:
   * a sharp threshold right where question dedup needs it.
   */
  bandKeys(signature: Uint32Array, bands = 16): string[] {
    const rows = Math.floor(signature.length / bands);
    if (rows === 0) return [];
    const keys: string[] = [];
    for (let b = 0; b < bands; b++) {
      let acc = '';
      for (let r = 0; r < rows; r++) {
        acc += (signature[b * rows + r] as number).toString(36) + ',';
      }
      keys.push(`${b}:${fnv1a32(acc).toString(36)}`);
    }
    return keys;
  }
}

/**
 * In-memory LSH index over band keys.
 *
 * The production deployment persists band keys as rows in a `question_lsh_band`
 * table and does the lookup as an indexed SELECT; this class is the same
 * algorithm for the ingest-time batch path, where the whole working set is
 * already in memory.
 */
export class LshIndex<T> {
  private readonly buckets = new Map<string, T[]>();

  add(keys: readonly string[], item: T): void {
    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (bucket === undefined) this.buckets.set(key, [item]);
      else bucket.push(item);
    }
  }

  /** Returns deduplicated candidates sharing at least one band with `keys`. */
  query(keys: readonly string[]): T[] {
    const seen = new Set<T>();
    for (const key of keys) {
      const bucket = this.buckets.get(key);
      if (bucket === undefined) continue;
      for (const item of bucket) seen.add(item);
    }
    return [...seen];
  }

  get bucketCount(): number {
    return this.buckets.size;
  }
}
