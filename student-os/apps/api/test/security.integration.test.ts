import type { Profile } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, queryOne } from '../src/platform/db.js';
import { auth, closeApp, ensureCohort, getApp, onboardedUser, type Cohort } from './helpers.js';

/**
 * Security tests required by §81, exercised end-to-end against a real database.
 *
 * The unit tests in @sos/core prove the policy functions are correct. These
 * prove the API actually calls them — which is the failure mode that unit tests
 * cannot catch.
 */

let cohort: Cohort;

describe('cross-user access control', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });
  afterAll(async () => {
    await closeApp();
    await closePool();
  });

  it('lets cohort-mates see each other', async () => {
    const app = await getApp();
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${bob.handle}`,
      headers: auth(alice.session),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Profile>().handle).toBe(bob.handle);
  });

  it('hides a private profile behind 404, not 403', async () => {
    // 403 would confirm the account exists, which defeats a private profile.
    const app = await getApp();
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/privacy',
      headers: auth(bob.session),
      payload: { profileVisibility: 'private' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${bob.handle}`,
      headers: auth(alice.session),
    });
    expect(response.statusCode).toBe(404);
  });

  it('hides a profile from a different stage when scoped to the cohort', async () => {
    const app = await getApp();
    const fifthYear = await onboardedUser({ stageId: cohort.stage5Id });
    const fourthYear = await onboardedUser({ stageId: cohort.stage4Id });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${fifthYear.handle}`,
      headers: auth(fourthYear.session),
    });
    expect(response.statusCode).toBe(404);
  });

  it('applies a block in both directions', async () => {
    const app = await getApp();
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    await queryOne(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [
      alice.session.user.id,
      bob.session.user.id,
    ]);

    // The blocker cannot see the blocked...
    const forward = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${bob.handle}`,
      headers: auth(alice.session),
    });
    expect(forward.statusCode).toBe(404);

    // ...and the blocked cannot see the blocker either.
    const reverse = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${alice.handle}`,
      headers: auth(bob.session),
    });
    expect(reverse.statusCode).toBe(404);
  });

  it('reflects messaging permission in the viewer block of a profile', async () => {
    const app = await getApp();
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    const open = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${bob.handle}`,
      headers: auth(alice.session),
    });
    expect(open.json<Profile>().viewer?.canMessage).toBe(true);

    await app.inject({
      method: 'PATCH',
      url: '/v1/me/privacy',
      headers: auth(bob.session),
      payload: { whoCanMessage: 'followers' },
    });

    const closed = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${bob.handle}`,
      headers: auth(alice.session),
    });
    expect(closed.json<Profile>().viewer?.canMessage).toBe(false);
  });

  it('refuses to let one user read or write another user’s settings', async () => {
    const app = await getApp();
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    // There is no endpoint that accepts a target user id for these — the
    // identity always comes from the token. This asserts that a client cannot
    // smuggle one in through the body.
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(alice.session),
      payload: { displayName: 'Hijacked', userId: bob.session.user.id },
    });
    expect(response.statusCode).toBe(200);

    const bobProfile = await app.inject({
      method: 'GET',
      url: '/v1/me/profile',
      headers: auth(bob.session),
    });
    expect(bobProfile.json<Profile>().displayName).not.toBe('Hijacked');
  });

  it('denies a suspended account access to authenticated routes', async () => {
    const app = await getApp();
    const alice = await onboardedUser();

    await queryOne(`UPDATE users SET status = 'suspended' WHERE id = $1`, [alice.session.user.id]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me/profile',
      headers: auth(alice.session),
    });
    expect(response.statusCode).toBe(403);
  });

  it('denies a deleted account, and hides its profile from others', async () => {
    const app = await getApp();
    const alice = await onboardedUser();
    const bob = await onboardedUser();

    await queryOne(`UPDATE users SET deleted_at = now(), status = 'deleted' WHERE id = $1`, [
      bob.session.user.id,
    ]);

    const ownAccess = await app.inject({
      method: 'GET',
      url: '/v1/me/profile',
      headers: auth(bob.session),
    });
    expect(ownAccess.statusCode).toBe(401);

    const otherAccess = await app.inject({
      method: 'GET',
      url: `/v1/profiles/${bob.handle}`,
      headers: auth(alice.session),
    });
    expect(otherAccess.statusCode).toBe(404);
  });

  it('requires authentication on every profile route', async () => {
    const app = await getApp();
    const bob = await onboardedUser();

    for (const [method, url] of [
      ['GET', '/v1/me/profile'],
      ['PATCH', '/v1/me/profile'],
      ['GET', '/v1/me/privacy'],
      ['PATCH', '/v1/me/privacy'],
      ['GET', `/v1/profiles/${bob.handle}`],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('does not let a role be escalated through the signup payload', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: {
        email: `escalation-${Date.now()}@uob.edu.iq`,
        password: 'correct-horse-battery',
        role: 'admin',
        verificationLevel: 'official',
        status: 'active',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ user: { role: string; verificationLevel: string } }>();
    expect(body.user.role).toBe('student');
    expect(body.user.verificationLevel).toBe('unverified');
  });
});
