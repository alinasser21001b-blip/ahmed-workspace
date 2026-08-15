import type { AuthSession } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as authService from '../src/modules/auth/auth.service.js';
import { closePool, queryOne } from '../src/platform/db.js';
import { auth, closeApp, getApp, signupUser } from './helpers.js';

/**
 * Password reset — the lifecycle App Store readiness requires: opaque
 * single-use token, hashed at rest, expiring, rate-limited, non-enumerating,
 * and ending in every other session being revoked.
 *
 * There is no email provider wired into this environment (`platform/
 * mailer.ts` documents why, and marks delivery
 * `EXTERNAL_INFRASTRUCTURE_REQUIRED`), so the plaintext token — which by
 * design never appears in an HTTP response — is captured here the same way
 * `platform/mailer.ts`'s `deliver` callback captures it in production: by
 * calling `authService.requestPasswordReset` directly with a callback that
 * stashes the token instead of emailing it. This is not a workaround for a
 * missing feature; it is the intended shape of the function, exercised the
 * way its one real caller (the route) exercises it, minus the unconfigured
 * mailer.
 */

async function captureResetToken(email: string): Promise<string | null> {
  let captured: string | null = null;
  await authService.requestPasswordReset(email, (input) => {
    captured = input.token;
  });
  return captured;
}

async function resetViaHttp(
  token: string,
  newPassword: string,
): Promise<{ statusCode: number; body: AuthSession | { error: { code: string } } }> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    payload: { token, newPassword },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

async function forgotPasswordViaHttp(email: string): Promise<{ statusCode: number; body: unknown }> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/forgot-password',
    payload: { email },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

beforeAll(async () => {
  await getApp();
});
afterAll(async () => {
  await closeApp();
  await closePool();
});

describe('the HTTP response never reveals whether the account exists', () => {
  it('a real account and a nonexistent one get byte-identical responses', async () => {
    const session = await signupUser();

    const real = await forgotPasswordViaHttp(session.user.email);
    const fake = await forgotPasswordViaHttp('definitely-nobody@uob.edu.iq');

    expect(real.statusCode).toBe(202);
    expect(fake.statusCode).toBe(202);
    expect(real.body).toEqual(fake.body);
  });
});

describe('the token lifecycle', () => {
  it('a fresh token resets the password and the new password works at login', async () => {
    const session = await signupUser('old-password-value-0123456789');
    const token = await captureResetToken(session.user.email);
    expect(token).not.toBeNull();

    const result = await resetViaHttp(token!, 'brand-new-password-9876543210');
    expect(result.statusCode).toBe(200);
    const newSession = result.body as AuthSession;
    expect(newSession.user.id).toBe(session.user.id);
    expect(newSession.tokens.accessToken).toBeTruthy();

    const app = await getApp();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: session.user.email, password: 'brand-new-password-9876543210' },
    });
    expect(login.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: session.user.email, password: 'old-password-value-0123456789' },
    });
    expect(oldLogin.statusCode).toBe(401);
  });

  it('is single-use: the same token cannot be redeemed twice', async () => {
    const session = await signupUser();
    const token = await captureResetToken(session.user.email);

    const first = await resetViaHttp(token!, 'first-reset-password-1111111111');
    expect(first.statusCode).toBe(200);

    const second = await resetViaHttp(token!, 'second-reset-password-2222222222');
    expect(second.statusCode).toBe(401);

    // The first reset's password is still the one that works.
    const app = await getApp();
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: session.user.email, password: 'first-reset-password-1111111111' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('a garbage token is rejected the same way an expired or reused one is', async () => {
    const result = await resetViaHttp('not-a-real-token-at-all-000000000000', 'whatever-password-000');
    expect(result.statusCode).toBe(401);
  });

  it('a second request supersedes the first — only the newest link works', async () => {
    const session = await signupUser();
    const firstToken = await captureResetToken(session.user.email);
    const secondToken = await captureResetToken(session.user.email);
    expect(firstToken).not.toBe(secondToken);

    const staleAttempt = await resetViaHttp(firstToken!, 'stale-link-password-3333333333');
    expect(staleAttempt.statusCode).toBe(401);

    const freshAttempt = await resetViaHttp(secondToken!, 'fresh-link-password-4444444444');
    expect(freshAttempt.statusCode).toBe(200);
  });

  it('an expired token is rejected even though it was never used', async () => {
    const session = await signupUser();
    const token = await captureResetToken(session.user.email);

    // Direct SQL to move the clock, the same way this suite ages
    // `learning_progress.last_activity_at` elsewhere — there is no API path
    // to fast-forward time, and there should not be one.
    await queryOne(
      `UPDATE password_resets SET expires_at = now() - interval '1 minute'
       WHERE user_id = $1`,
      [session.user.id],
    );

    const result = await resetViaHttp(token!, 'too-late-password-5555555555');
    expect(result.statusCode).toBe(401);
  });

  it('does not mint a token for an account that cannot use one', async () => {
    // No email provider is configured, so "nobody real" is the only unresettable
    // case exercisable without direct SQL to force a status — deliberately not
    // done here, since the eligibility predicate (`canResetPassword`) is
    // exactly the same set `refresh()` already relies on and re-tests.
    const token = await captureResetToken('this-email-was-never-registered@uob.edu.iq');
    expect(token).toBeNull();
  });
});

describe('redemption revokes every existing session', () => {
  it('a session opened before the reset stops working after it', async () => {
    const session = await signupUser();
    const preResetAuth = auth(session);

    const app = await getApp();
    const before = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: preResetAuth });
    expect(before.statusCode).toBe(200);

    const token = await captureResetToken(session.user.email);
    await resetViaHttp(token!, 'post-reset-password-6666666666');

    // The refresh token from before the reset is now a revoked session, not a
    // live one — a compromise assumption, not a courtesy.
    const staleRefresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.tokens.refreshToken },
    });
    expect(staleRefresh.statusCode).toBe(401);
  });

  it('issues a working session for the device that completed the reset', async () => {
    const session = await signupUser();
    const token = await captureResetToken(session.user.email);
    const result = await resetViaHttp(token!, 'issued-session-password-7777777777');
    const newSession = result.body as AuthSession;

    const app = await getApp();
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: auth(newSession),
    });
    expect(me.statusCode).toBe(200);
  });
});

describe('rate limiting', () => {
  it('the forgot-password endpoint refuses a burst beyond its budget', async () => {
    const session = await signupUser();
    const app = await getApp();

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email: session.user.email },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
