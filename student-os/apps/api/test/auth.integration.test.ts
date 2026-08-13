import type { AuthSession, ErrorEnvelope } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import { auth, closeApp, getApp, signupUser, uniqueEmail } from './helpers.js';

describe('auth', () => {
  beforeAll(async () => {
    await getApp();
  });
  afterAll(async () => {
    await closeApp();
    await closePool();
  });

  it('signs up, returns tokens, and marks onboarding incomplete', async () => {
    const app = await getApp();
    const email = uniqueEmail();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email, password: 'correct-horse-battery', locale: 'ar' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<AuthSession>();
    expect(body.user.email).toBe(email);
    expect(body.user.onboardingCompleted).toBe(false);
    expect(body.user.role).toBe('student');
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
  });

  it('never stores the password in plaintext', async () => {
    const app = await getApp();
    const email = uniqueEmail();
    const password = 'a-very-memorable-passphrase';
    await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, password } });

    const row = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    expect(row?.password_hash).not.toContain(password);
    expect(row?.password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a weak password with field-level detail', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email: uniqueEmail(), password: 'short' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorEnvelope>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.details?.some((d) => d.path === 'password')).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const app = await getApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email, password: 'correct-horse-battery' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email, password: 'correct-horse-battery' },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json<ErrorEnvelope>().error.code).toBe('CONFLICT');
  });

  it('treats email as case-insensitive', async () => {
    const app = await getApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email, password: 'correct-horse-battery' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: email.toUpperCase(), password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('rejects a wrong password and an unknown account identically', async () => {
    const app = await getApp();
    const email = uniqueEmail();
    await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { email, password: 'correct-horse-battery' },
    });

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'not-the-right-password' },
    });
    const unknownAccount = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: uniqueEmail(), password: 'not-the-right-password' },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownAccount.statusCode).toBe(401);
    // Identical bodies: the response must not distinguish the two cases.
    expect(wrongPassword.json<ErrorEnvelope>().error.code).toBe(
      unknownAccount.json<ErrorEnvelope>().error.code,
    );
    expect(wrongPassword.json<ErrorEnvelope>().error.message).toBe(
      unknownAccount.json<ErrorEnvelope>().error.message,
    );
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const app = await getApp();
    const session = await signupUser();

    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.tokens.refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json<AuthSession>();
    expect(next.tokens.refreshToken).not.toBe(session.tokens.refreshToken);

    // Reusing the rotated token is a theft signal.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.tokens.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('revokes the whole chain when a rotated token is replayed', async () => {
    const app = await getApp();
    const session = await signupUser();

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.tokens.refreshToken },
    });
    const rotated = first.json<AuthSession>();

    // Replay the original — this must burn the new token too.
    await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: session.tokens.refreshToken },
    });

    const afterTheft = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: rotated.tokens.refreshToken },
    });
    expect(afterTheft.statusCode).toBe(401);
  });

  it('returns the current user for a valid access token', async () => {
    const app = await getApp();
    const session = await signupUser();
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session) });

    expect(me.statusCode).toBe(200);
    expect(me.json<{ id: string }>().id).toBe(session.user.id);
  });

  it('rejects a missing, malformed, or forged token', async () => {
    const app = await getApp();

    for (const headers of [
      undefined,
      { authorization: 'Bearer not-a-jwt' },
      { authorization: 'Basic abc' },
      {
        authorization:
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhIiwic2lkIjoiYiJ9.forged',
      },
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        ...(headers ? { headers } : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json<ErrorEnvelope>().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('makes logout take effect immediately, before the access token expires', async () => {
    const app = await getApp();
    const session = await signupUser();

    const before = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session) });
    expect(before.statusCode).toBe(200);

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: auth(session),
      payload: { refreshToken: session.tokens.refreshToken, allDevices: false },
    });
    expect(loggedOut.statusCode).toBe(204);

    // The access token is still cryptographically valid but its session is gone.
    const after = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session) });
    expect(after.statusCode).toBe(401);
  });

  it('denies a suspended account at login', async () => {
    const app = await getApp();
    const session = await signupUser();
    await queryOne(`UPDATE users SET status = 'suspended' WHERE id = $1`, [session.user.id]);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: session.user.email, password: 'correct-horse-battery' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorEnvelope>().error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('denies a deleted account', async () => {
    const app = await getApp();
    const session = await signupUser();
    await queryOne(`UPDATE users SET deleted_at = now() WHERE id = $1`, [session.user.id]);

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session) });
    expect(me.statusCode).toBe(401);
  });

  it('echoes a request id on every response, including errors', async () => {
    const app = await getApp();
    const ok = await app.inject({ method: 'GET', url: '/health' });
    expect(ok.headers['x-request-id']).toBeTruthy();

    const failed = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(failed.json<ErrorEnvelope>().error.requestId).toBe(failed.headers['x-request-id']);
  });

  it('honours a caller-supplied request id and rejects a hostile one', async () => {
    const app = await getApp();
    const clean = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'client-abc-123' },
    });
    expect(clean.headers['x-request-id']).toBe('client-abc-123');

    const hostile = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'has spaces and \n newlines' },
    });
    expect(hostile.headers['x-request-id']).not.toBe('has spaces and \n newlines');
  });

  it('never leaks internals in an error body', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
    const raw = response.body;
    expect(raw).not.toMatch(/at .*\.ts:/);
    expect(raw).not.toMatch(/postgres:\/\//);
    expect(raw).not.toMatch(/SELECT /i);
  });
});
