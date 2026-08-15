import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { getConfig } from '../../platform/config.js';

/**
 * Token issuance.
 *
 * Access token  — short-lived signed JWT, stateless, never stored.
 * Refresh token — long-lived opaque random string, stored ONLY as a SHA-256
 *                 hash, rotated on every use.
 *
 * The asymmetry is deliberate. A stateless access token is cheap to verify on
 * every request but cannot be revoked, so it expires in minutes. Revocation
 * lives on the refresh token, which is a database row we can delete.
 *
 * The refresh token is a high-entropy random value rather than a JWT, so
 * hashing it is sufficient — unlike a password, it is not user-chosen and not
 * subject to dictionary attack, which is why SHA-256 (not scrypt) is correct
 * here.
 */

const ISSUER = 'sos';
const AUDIENCE = 'sos-client';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getConfig().env.JWT_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<{
  token: string;
  expiresIn: number;
}> {
  const ttl = getConfig().env.ACCESS_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ sid: claims.sid, role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey());

  return { token, expiresIn: ttl };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return {
      sub: payload.sub,
      sid: payload.sid,
      role: typeof payload.role === 'string' ? payload.role : 'student',
    };
  } catch {
    // Expired, tampered, wrong issuer — all indistinguishable to the client.
    return null;
  }
}

/** 256 bits of entropy, URL-safe. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(now: Date = new Date()): Date {
  const days = getConfig().env.REFRESH_TOKEN_TTL_DAYS;
  return new Date(now.getTime() + days * 86_400_000);
}

/**
 * Password reset tokens — the same shape as a refresh token (256 bits of
 * random entropy, hashed with SHA-256 at rest) and named separately anyway.
 * A reset token and a refresh token being structurally identical does not
 * make them interchangeable: they live in different tables with different
 * hash columns, so a `password_resets` row can never be presented where a
 * `sessions` row is expected even by accident, and the distinct names are
 * what keep that true for a reader as well as for the schema.
 */
export function generatePasswordResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 30 minutes: long enough to open an email, short enough that a stale link is not a standing risk. */
const PASSWORD_RESET_TTL_MINUTES = 30;

export function passwordResetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000);
}
