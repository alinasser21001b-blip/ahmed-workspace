import type { ErrorEnvelope, Profile } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool } from '../src/platform/db.js';
import {
  auth,
  closeApp,
  ensureCohort,
  getApp,
  onboardedUser,
  signupUser,
  uniqueHandle,
  type Cohort,
} from './helpers.js';

/**
 * Phase 1 — identity. This covers the first half of the journey in §91:
 * signup → university → college → stage → profile.
 */

let cohort: Cohort;

describe('academic hierarchy', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });
  afterAll(async () => {
    await closeApp();
    await closePool();
  });

  it('exposes the hierarchy so onboarding can be driven entirely by data', async () => {
    const app = await getApp();

    const universities = await app.inject({ method: 'GET', url: '/v1/academic/universities' });
    expect(universities.statusCode).toBe(200);
    expect(universities.json<unknown[]>().length).toBeGreaterThan(0);

    const colleges = await app.inject({
      method: 'GET',
      url: `/v1/academic/colleges?universityId=${cohort.universityId}`,
    });
    expect(colleges.json<{ id: string }[]>().some((c) => c.id === cohort.collegeId)).toBe(true);

    const programs = await app.inject({
      method: 'GET',
      url: `/v1/academic/programs?collegeId=${cohort.collegeId}`,
    });
    expect(programs.json<{ id: string }[]>().some((p) => p.id === cohort.programId)).toBe(true);

    const stages = await app.inject({
      method: 'GET',
      url: `/v1/academic/stages?programId=${cohort.programId}`,
    });
    expect(stages.json<{ id: string }[]>().some((s) => s.id === cohort.stage5Id)).toBe(true);
  });

  it('returns both Arabic and English names at every level', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/v1/academic/universities' });
    const [first] = response.json<{ nameAr: string; nameEn: string }[]>();
    expect(first?.nameAr).toBeTruthy();
    expect(first?.nameEn).toBeTruthy();
  });

  it('rejects a malformed id instead of returning everything', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/v1/academic/colleges?universityId=nope' });
    expect(response.statusCode).toBe(400);
  });
});

describe('onboarding', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('completes the profile and joins the cohort', async () => {
    const app = await getApp();
    const session = await signupUser();
    const handle = uniqueHandle();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(session),
      payload: {
        handle,
        displayName: 'أحمد',
        bio: 'طالب طب',
        universityId: cohort.universityId,
        collegeId: cohort.collegeId,
        programId: cohort.programId,
        stageId: cohort.stage5Id,
        academicYearId: cohort.academicYearId,
        interestTopicIds: cohort.topicIds.slice(0, 1),
      },
    });

    expect(response.statusCode).toBe(200);
    const profile = response.json<Profile>();
    expect(profile.handle).toBe(handle);
    expect(profile.displayName).toBe('أحمد');
    expect(profile.onboardingCompleted).toBe(true);
    expect(profile.academic.collegeId).toBe(cohort.collegeId);
    expect(profile.academic.stageId).toBe(cohort.stage5Id);
    expect(profile.interests).toHaveLength(1);

    // The auth surface must now agree that onboarding is done, because that is
    // what routes the client past the onboarding flow on next launch.
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(session) });
    expect(me.json<{ onboardingCompleted: boolean }>().onboardingCompleted).toBe(true);
  });

  it('refuses an academic placement that does not exist in the hierarchy', async () => {
    const app = await getApp();
    const session = await signupUser();

    // A stage that belongs to the right program, but a college id from nowhere.
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(session),
      payload: {
        handle: uniqueHandle(),
        displayName: 'Mismatched',
        universityId: cohort.universityId,
        collegeId: '00000000-0000-4000-8000-000000000000',
        programId: cohort.programId,
        stageId: cohort.stage5Id,
      },
    });

    expect(response.statusCode).toBe(412);
    expect(response.json<ErrorEnvelope>().error.code).toBe('PRECONDITION_FAILED');
  });

  it('refuses a duplicate handle', async () => {
    const app = await getApp();
    const first = await onboardedUser();
    const session = await signupUser();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(session),
      payload: {
        handle: first.handle,
        displayName: 'Copycat',
        universityId: cohort.universityId,
        collegeId: cohort.collegeId,
        programId: cohort.programId,
        stageId: cohort.stage5Id,
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('reports handle availability before the user commits to one', async () => {
    const app = await getApp();
    const { handle } = await onboardedUser();

    const taken = await app.inject({ method: 'GET', url: `/v1/handles/available?handle=${handle}` });
    expect(taken.json<{ available: boolean }>().available).toBe(false);

    const free = await app.inject({
      method: 'GET',
      url: `/v1/handles/available?handle=${uniqueHandle()}`,
    });
    expect(free.json<{ available: boolean }>().available).toBe(true);
  });

  it('rejects handles that break the format rule', async () => {
    const app = await getApp();
    for (const handle of ['ab', 'Has Capitals', 'has-dashes', 'x'.repeat(31)]) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/handles/available?handle=${encodeURIComponent(handle)}`,
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it('is idempotent, so a retried onboarding does not fail', async () => {
    const app = await getApp();
    const session = await signupUser();
    const handle = uniqueHandle();
    const payload = {
      handle,
      displayName: 'Retried',
      universityId: cohort.universityId,
      collegeId: cohort.collegeId,
      programId: cohort.programId,
      stageId: cohort.stage5Id,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(session),
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(session),
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });

  it('drops interest topics that do not exist rather than storing dangling ids', async () => {
    const app = await getApp();
    const session = await signupUser();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      headers: auth(session),
      payload: {
        handle: uniqueHandle(),
        displayName: 'Ghost interests',
        universityId: cohort.universityId,
        collegeId: cohort.collegeId,
        programId: cohort.programId,
        stageId: cohort.stage5Id,
        interestTopicIds: ['00000000-0000-4000-8000-000000000001'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Profile>().interests).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      payload: { handle: uniqueHandle(), displayName: 'x' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('profile and privacy', () => {
  beforeAll(async () => {
    await getApp();
    cohort = await ensureCohort();
  });

  it('updates own profile fields', async () => {
    const app = await getApp();
    const { session } = await onboardedUser();

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(session),
      payload: { displayName: 'Updated Name', bio: 'New bio' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Profile>().displayName).toBe('Updated Name');
    expect(response.json<Profile>().bio).toBe('New bio');
  });

  it('allows clearing a nullable field explicitly', async () => {
    const app = await getApp();
    const { session } = await onboardedUser();
    await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(session),
      payload: { bio: 'temporary' },
    });

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/v1/me/profile',
      headers: auth(session),
      payload: { bio: null },
    });
    expect(cleared.json<Profile>().bio).toBeNull();
  });

  it('defaults privacy to cohort scope, not public', async () => {
    const app = await getApp();
    const { session } = await onboardedUser();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/me/privacy',
      headers: auth(session),
    });

    expect(response.statusCode).toBe(200);
    const settings = response.json<{ profileVisibility: string; whoCanMessage: string }>();
    expect(settings.profileVisibility).toBe('stage');
    expect(settings.whoCanMessage).toBe('stage');
  });

  it('persists a privacy change', async () => {
    const app = await getApp();
    const { session } = await onboardedUser();

    const updated = await app.inject({
      method: 'PATCH',
      url: '/v1/me/privacy',
      headers: auth(session),
      payload: { profileVisibility: 'private', showLastSeen: false },
    });
    expect(updated.json<{ profileVisibility: string }>().profileVisibility).toBe('private');

    const reread = await app.inject({ method: 'GET', url: '/v1/me/privacy', headers: auth(session) });
    expect(reread.json<{ showLastSeen: boolean }>().showLastSeen).toBe(false);
  });

  it('rejects an unknown visibility value', async () => {
    const app = await getApp();
    const { session } = await onboardedUser();
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me/privacy',
      headers: auth(session),
      payload: { profileVisibility: 'everyone' },
    });
    expect(response.statusCode).toBe(400);
  });
});
