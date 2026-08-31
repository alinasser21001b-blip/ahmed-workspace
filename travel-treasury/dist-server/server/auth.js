import argon2 from 'argon2';
import { newId, randomToken, sha256, unauthorized } from "./util.js";
const SESSION_TTL_HOURS = 24 * 14;
export async function hashPassword(password) {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(hash, password) {
    try {
        return await argon2.verify(hash, password);
    }
    catch {
        return false;
    }
}
export async function createSession(db, userId) {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString();
    await db.query(`INSERT INTO sessions (id, user_id, token_hash, csrf_token_hash, expires_at) VALUES ($1,$2,$3,$4,$5)`, [newId('sess'), userId, sha256(sessionToken), sha256(csrfToken), expiresAt]);
    return { sessionToken, csrfToken, expiresAt };
}
export async function revokeSession(db, sessionToken) {
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, [sha256(sessionToken)]);
}
export async function userForSession(db, sessionToken, csrfToken, requireCsrf) {
    if (!sessionToken)
        throw unauthorized();
    const res = await db.query(`SELECT s.user_id, s.csrf_token_hash, u.email, u.role, u.display_name, u.locale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`, [sha256(sessionToken)]);
    const row = res.rows[0];
    if (!row)
        throw unauthorized();
    if (requireCsrf) {
        if (!csrfToken || sha256(csrfToken) !== row.csrf_token_hash) {
            throw unauthorized('CSRF token missing or wrong', 'رمز الحماية غير صحيح');
        }
    }
    return {
        id: row.user_id,
        email: row.email,
        role: row.role,
        displayName: row.display_name,
        locale: row.locale,
    };
}
/** Simple fixed-window rate limiter for the login route. */
const attempts = new Map();
export function loginRateLimit(key, max = 10, windowMs = 15 * 60_000) {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
        attempts.set(key, { count: 1, windowStart: now });
        return true;
    }
    entry.count += 1;
    return entry.count <= max;
}
