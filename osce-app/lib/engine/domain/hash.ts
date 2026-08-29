/**
 * Dependency-free hashing.
 *
 * The engine must behave identically on Cloudflare Workers, Node, Deno and Bun.
 * WebCrypto's `digest` is async and unavailable synchronously in every runtime,
 * so fingerprints use FNV-1a 64-bit implemented over two 32-bit halves.
 *
 * This is a *fingerprint*, not a security primitive: it exists to make
 * publication idempotent, not to resist a chosen-prefix attack. Collision
 * budget at 64 bits is ~2.7e-8 across 10^6 occurrences, and publication
 * additionally carries a UNIQUE constraint on the natural key, so a collision
 * degrades to a rejected insert rather than a silent overwrite.
 */

// FNV-1a 64 constants, split into 32-bit halves.
// offset basis = 0xcbf29ce484222325, prime = 0x100000001b3
const OFFSET_HI = 0xcbf29ce4;
const OFFSET_LO = 0x84222325;
const PRIME_HI = 0x100;
const PRIME_LO = 0x1b3;

/** FNV-1a 64-bit over UTF-8 bytes, returned as 16 lowercase hex characters. */
export function fnv1a64(input: string): string {
  let hi = OFFSET_HI >>> 0;
  let lo = OFFSET_LO >>> 0;

  const bytes = utf8Bytes(input);
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ (bytes[i] as number)) >>> 0;

    // 64-bit multiply by PRIME, keeping every intermediate under 2^53.
    //   lo * PRIME_LO           < 2^41
    //   hi * PRIME_LO           < 2^41
    //   lo * PRIME_HI           < 2^40
    const loProduct = lo * PRIME_LO;
    const carry = Math.floor(loProduct / 4294967296);
    const nextHi = hi * PRIME_LO + lo * PRIME_HI + carry;

    lo = loProduct >>> 0;
    hi = nextHi >>> 0;
  }

  return hex32(hi) + hex32(lo);
}

/** 32-bit FNV-1a. Used where a compact bucket key suffices (LSH bands, seeds). */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5 >>> 0;
  const bytes = utf8Bytes(input);
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ (bytes[i] as number)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hex32(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function utf8Bytes(input: string): Uint8Array | number[] {
  if (encoder) return encoder.encode(input);
  const out: number[] = [];
  for (const ch of input) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

/**
 * Composes a fingerprint from ordered parts.
 *
 * Parts are length-prefixed so that ("ab", "c") and ("a", "bc") cannot produce
 * the same input string. A plain separator character is not enough: separators
 * can occur inside excerpt text.
 */
export function fingerprint(...parts: readonly (string | number | null | undefined)[]): string {
  let acc = '';
  for (const part of parts) {
    // A distinct nullity marker keeps `null` and `''` apart: without it, an
    // absent academic year and an empty one would fingerprint identically.
    if (part === null || part === undefined) {
      acc += 'n|';
      continue;
    }
    const s = String(part);
    acc += 'v' + s.length.toString(36) + ':' + s + '|';
  }
  return fnv1a64(acc);
}
