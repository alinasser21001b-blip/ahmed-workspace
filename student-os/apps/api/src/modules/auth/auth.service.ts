import { randomBytes } from 'node:crypto';
import type { AuthSession, AuthUser, LoginRequest, SignupRequest } from '@sos/contracts';
import { isTeachingLevel } from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors, PG_UNIQUE_VIOLATION, pgErrorCode } from '../../platform/errors.js';
import * as repo from './auth.repository.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import {
  generatePasswordResetToken,
  generateRefreshToken,
  hashPasswordResetToken,
  hashRefreshToken,
  passwordResetExpiry,
  refreshTokenExpiry,
  signAccessToken,
} from './tokens.js';

/**
 * A password reset may act on this account. Deliberately the SAME set
 * `refresh()` treats as capable of holding a live session — `active` and
 * `restricted` — so a reset can never hand a session to an account that could
 * not otherwise be signed into. `deleted` never reaches this check at all:
 * `findUserByEmail`/`findUserById` already filter `deleted_at IS NULL`, so a
 * deleted account is indistinguishable from "no such email" one layer up.
 */
function canResetPassword(status: repo.UserRow['status']): boolean {
  return status === 'active' || status === 'restricted';
}

/**
 * Authentication business logic.
 */

export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

function toAuthUser(row: repo.UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    verificationLevel: row.verification_level,
    status: row.status,
    locale: row.locale,
    onboardingCompleted: row.onboarding_completed,
    /*
     * Projected, not left to the client to infer from `verificationLevel`.
     * A client that decides for itself which levels count would drift from the
     * server that enforces it, and the drift would surface as a Create
     * Classroom button that 403s.
     */
    teachingEligible: isTeachingLevel(row.verification_level),
  };
}

async function issueSession(
  user: repo.UserRow,
  meta: RequestMeta,
  client?: Parameters<typeof repo.insertSession>[1],
): Promise<AuthSession & { sessionId: string }> {
  const refreshToken = generateRefreshToken();
  const session = await repo.insertSession(
    {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: meta.userAgent,
      ip: meta.ip,
    },
    client,
  );

  const { token, expiresIn } = await signAccessToken({
    sub: user.id,
    sid: session.id,
    role: user.role,
  });

  return {
    sessionId: session.id,
    user: toAuthUser(user),
    tokens: { accessToken: token, refreshToken, expiresIn },
  };
}

export async function signup(input: SignupRequest, meta: RequestMeta): Promise<AuthSession> {
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (client) => {
    let user: repo.UserRow;
    try {
      user = await repo.insertUser(
        { email: input.email, passwordHash, locale: input.locale },
        client,
      );
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        // Deliberately explicit. Email enumeration is already possible through
        // any signup form; pretending otherwise costs real usability and buys
        // nothing, since an attacker can simply attempt signup.
        throw errors.conflict('An account with that email already exists.', {
          field: 'email',
        });
      }
      throw error;
    }

    return issueSession(user, meta, client);
  });
}

export async function login(input: LoginRequest, meta: RequestMeta): Promise<AuthSession> {
  const user = await repo.findUserByEmail(input.email);

  // Always run a verification, even when the user does not exist, so that
  // response timing does not distinguish "no such account" from "wrong
  // password". The dummy hash below is a real hash of a random value.
  const storedHash = user?.password_hash ?? (await dummyHash());
  const ok = await verifyPassword(input.password, storedHash);

  if (!user || !ok) {
    throw errors.unauthenticated('invalid_credentials');
  }
  if (user.status === 'banned' || user.status === 'suspended' || user.status === 'deleted') {
    throw errors.accountSuspended(user.status);
  }

  // Transparent parameter upgrade on successful login.
  if (needsRehash(user.password_hash)) {
    await repo.updatePasswordHash(user.id, await hashPassword(input.password));
  }
  await repo.touchLastActive(user.id);

  return issueSession(user, meta);
}

/**
 * Mints a reset token, if this email resolves to a resettable account, and
 * hands it — the plaintext, the only time it ever exists outside a hash — to
 * `deliver`.
 *
 * The token is a constructor argument to a callback rather than a return
 * value on purpose. A function that RETURNS the plaintext token is one
 * accidental future change away from a route that serialises it straight into
 * an HTTP response, which would turn "forgot password" into "here is anyone's
 * password reset token, just ask." Injecting delivery instead makes that
 * mistake require deliberately writing code to leak the token, not merely
 * forgetting to strip a field.
 *
 * `deliver` is never called when the account does not exist or cannot use a
 * reset — and the caller (the route) must not let that distinction leak: see
 * its own comment for why the HTTP response is identical either way. What is
 * NOT attempted here is disguising the timing difference between the two
 * branches with dummy work. `signup()`'s own comment already states this
 * codebase's position: email enumeration is not fully preventable this way,
 * and pretending otherwise here would add a scrypt-shaped unauthenticated
 * DoS lever for no real confidentiality gained. What is achievable, and what
 * is implemented, is that the response never varies.
 */
export async function requestPasswordReset(
  email: string,
  deliver: (input: { userId: string; token: string }) => Promise<void> | void,
): Promise<void> {
  const user = await repo.findUserByEmail(email);
  if (!user || !canResetPassword(user.status)) return;

  const token = generatePasswordResetToken();
  await withTransaction(async (client) => {
    await repo.supersedeActivePasswordResets(user.id, client);
    await repo.insertPasswordReset(
      { userId: user.id, tokenHash: hashPasswordResetToken(token), expiresAt: passwordResetExpiry() },
      client,
    );
  });
  await deliver({ userId: user.id, token });
}

/**
 * Redeems a reset token: sets the new password, consumes the token, and
 * revokes every existing session before issuing exactly one fresh one for the
 * device that completed the reset.
 *
 * The blanket revocation is a compromise assumption, not a courtesy: a
 * password reset is frequently how someone recovers from a credential theft,
 * and a session an attacker opened before that must not survive it. A user
 * who reset their password because they simply forgot it pays the same cost —
 * signing back in on their other devices — and that is the correct trade
 * given the alternative is a live attacker session outliving the reset that
 * was supposed to end it.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<AuthSession> {
  const tokenHash = hashPasswordResetToken(token);

  return withTransaction(async (client) => {
    const reset = await repo.findActivePasswordResetByTokenHashForUpdate(tokenHash, client);
    if (!reset || reset.expires_at.getTime() <= Date.now()) {
      throw errors.unauthenticated('invalid_or_expired_reset_token');
    }

    const user = await repo.findUserById(reset.user_id, client);
    if (!user || !canResetPassword(user.status)) {
      throw errors.unauthenticated('invalid_or_expired_reset_token');
    }

    await repo.consumePasswordReset(reset.id, client);
    await repo.updatePasswordHash(user.id, await hashPassword(newPassword), client);
    await repo.revokeAllSessionsForUser(user.id, client);

    return issueSession(user, meta, client);
  });
}

/**
 * Refresh with rotation and theft detection.
 *
 * Presenting a refresh token that has already been rotated means either a
 * replay or a stolen token. Either way the safe response is to revoke the whole
 * session chain for that user and force a fresh login.
 */
export async function refresh(refreshToken: string, meta: RequestMeta): Promise<AuthSession> {
  const tokenHash = hashRefreshToken(refreshToken);

  /*
   * Theft detection must SURVIVE the rejection.
   *
   * The obvious implementation — revoke the chain and then throw, both inside
   * one transaction — rolls the revocation back on the way out, so the stolen
   * token keeps working. The transaction therefore returns a decision, and the
   * revoke-and-throw happens after it has committed.
   */
  const outcome = await withTransaction(
    async (client): Promise<
      | { kind: 'ok'; session: AuthSession }
      | { kind: 'reuse'; userId: string }
      | { kind: 'reject'; reason: string }
      | { kind: 'suspended'; status: string }
    > => {
      const session = await repo.findSessionByTokenHashForUpdate(tokenHash, client);
      if (!session) return { kind: 'reject', reason: 'unknown_refresh_token' };

      if (session.revoked_at !== null) {
        return session.rotated_to_id !== null
          ? { kind: 'reuse', userId: session.user_id }
          : { kind: 'reject', reason: 'session_revoked' };
      }

      if (session.expires_at.getTime() <= Date.now()) {
        return { kind: 'reject', reason: 'session_expired' };
      }

      const user = await repo.findUserById(session.user_id, client);
      if (!user) return { kind: 'reject', reason: 'user_not_found' };
      if (user.status !== 'active' && user.status !== 'restricted') {
        return { kind: 'suspended', status: user.status };
      }

      const { sessionId, ...next } = await issueSession(user, meta, client);
      await repo.revokeSession(session.id, sessionId, client);
      return { kind: 'ok', session: next };
    },
  );

  switch (outcome.kind) {
    case 'ok':
      return outcome.session;
    case 'reuse':
      // Committed on its own, so it holds even though the request fails.
      await repo.revokeAllSessionsForUser(outcome.userId);
      throw errors.unauthenticated('refresh_token_reuse_detected');
    case 'suspended':
      throw errors.accountSuspended(outcome.status);
    case 'reject':
      throw errors.unauthenticated(outcome.reason);
  }
}

export async function logout(
  userId: string,
  options: { refreshToken?: string; allDevices: boolean },
): Promise<void> {
  if (options.allDevices) {
    await repo.revokeAllSessionsForUser(userId);
    return;
  }
  if (!options.refreshToken) return;

  const session = await repo.findSessionByTokenHash(hashRefreshToken(options.refreshToken));
  // Only the owner may revoke a session, even given a valid token value.
  if (session && session.user_id === userId) {
    await repo.revokeSession(session.id, null);
  }
}

export async function currentUser(userId: string): Promise<AuthUser> {
  const user = await repo.findUserById(userId);
  if (!user) throw errors.unauthenticated('user_not_found');
  return toAuthUser(user);
}

/**
 * A real hash of a random value, computed once and reused. Verifying against
 * it costs exactly what verifying a genuine hash costs, which is the point:
 * login timing must not distinguish "no such account" from "wrong password".
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}
