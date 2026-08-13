import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing.
 *
 * scrypt from Node's standard library, at OWASP-recommended parameters. Two
 * decisions worth stating:
 *
 *   * NOT a custom scheme. §15 is explicit — no bespoke cryptography. scrypt is
 *     a standard memory-hard KDF and Node ships it, so there is no native build
 *     step to fail in CI or on a deploy host.
 *   * VERSIONED HASH FORMAT. Every stored hash carries its algorithm and
 *     parameters, so moving to argon2id later is a rehash-on-next-login
 *     migration rather than a forced password reset for every user.
 *
 * Format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 */

const ALGORITHM = 'scrypt';
const N = 2 ** 16; // CPU/memory cost
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
// scrypt needs roughly 128 * N * r bytes; Node's default maxmem is too low for N=2^16.
const MAX_MEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEM,
  });
  return [ALGORITHM, N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row must
 * fail the login, not crash the endpoint. Comparison is constant-time.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [algorithm, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string, string, string, string, string, string,
  ];
  if (algorithm !== ALGORITHM) return false;

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(hashB64, 'base64');
    actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Whether a stored hash uses outdated parameters and should be transparently
 * upgraded on the user's next successful login.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return true;
  const [algorithm, n, r, p] = parts;
  return algorithm !== ALGORITHM || Number(n) < N || Number(r) < R || Number(p) < P;
}
