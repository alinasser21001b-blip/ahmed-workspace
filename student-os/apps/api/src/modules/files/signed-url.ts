import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../../platform/config.js';

/**
 * Signed media URLs (§49, §50).
 *
 * An `<Image src>` cannot carry an Authorization header, so private media has
 * to be reachable by URL alone. The honest framing of that: **a signed URL is a
 * bearer capability**. Anyone holding it can fetch the bytes until it expires.
 *
 * What makes it safe enough:
 *   * The authorization decision happens when the URL is MINTED — the policy
 *     layer runs then, against the real actor.
 *   * The window is short (15 minutes by default), so a leaked URL stops
 *     working quickly.
 *   * The signature covers the file id and the expiry together, so neither can
 *     be edited without invalidating it.
 *
 * This is the same model S3 presigned URLs use. What it is NOT is a substitute
 * for the policy check — a URL's existence must never be treated as ongoing
 * proof of access.
 */

const SIGNATURE_BYTES = 32;

function computeSignature(fileId: string, expiresAtSeconds: number): Buffer {
  return createHmac('sha256', getConfig().mediaUrlSecret)
    .update(`${fileId}:${expiresAtSeconds}`)
    .digest();
}

export interface SignedMediaUrl {
  url: string;
  expiresAt: string;
}

export function signMediaUrl(fileId: string, now: Date = new Date()): SignedMediaUrl {
  const ttl = getConfig().env.MEDIA_URL_TTL_SECONDS;
  const expiresAtSeconds = Math.floor(now.getTime() / 1000) + ttl;
  const signature = computeSignature(fileId, expiresAtSeconds).toString('base64url');

  return {
    url: `/v1/files/${fileId}/raw?exp=${expiresAtSeconds}&sig=${signature}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

/**
 * Verifies a signature in constant time and checks expiry.
 *
 * Returns a plain boolean: the caller must not learn *which* check failed, or
 * it becomes an oracle for distinguishing "wrong signature" from "expired".
 */
export function verifyMediaSignature(
  fileId: string,
  expiresAtRaw: string,
  signatureRaw: string,
  now: Date = new Date(),
): boolean {
  const expiresAtSeconds = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAtSeconds)) return false;
  if (expiresAtSeconds * 1000 <= now.getTime()) return false;

  let provided: Buffer;
  try {
    provided = Buffer.from(signatureRaw, 'base64url');
  } catch {
    return false;
  }
  if (provided.length !== SIGNATURE_BYTES) return false;

  return timingSafeEqual(provided, computeSignature(fileId, expiresAtSeconds));
}
