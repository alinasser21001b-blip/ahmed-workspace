import type { AdminUserSummary, ClassroomDetail, LectureSummary } from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  closeApp,
  ensureCohort,
  getApp,
  onboardedUser,
  platformAdmin,
  setVerificationLevel,
  signupUser,
  verifiedInstructor,
  type Cohort,
} from './helpers.js';

/**
 * Phase 5c — academic authority at the API boundary.
 *
 * The policy layer is covered exhaustively by fast unit tests. What these
 * prove is the thing unit tests cannot: that the *routes* actually consult it,
 * that no path around them exists, and that a client cannot talk its way past
 * one with a well-chosen request body.
 *
 * The numbered comments map to the regression matrix the phase was specified
 * with, so a reader can check coverage without reconstructing the mapping.
 */

let cohort: Cohort;

beforeAll(async () => {
  await getApp();
  cohort = await ensureCohort();
});

afterAll(async () => {
  await closeApp();
});

async function createClassroomRaw(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  payload: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof getApp>>['inject']>>> {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: '/v1/classrooms',
    headers: auth(session),
    payload: {
      courseId: cohort.courseIds[0],
      title: 'قاعة اختبار الصلاحيات',
      description: null,
      ...payload,
    },
  });
}

async function createClassroom(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
): Promise<ClassroomDetail> {
  const response = await createClassroomRaw(session);
  if (response.statusCode !== 201) {
    throw new Error(`create classroom failed (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}

async function joinClassroom(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  classroomId: string,
  joinCode: string | null = null,
): Promise<void> {
  const app = await getApp();
  const response = await app.inject({
    method: 'PUT',
    url: `/v1/classrooms/${classroomId}/membership`,
    headers: auth(session),
    payload: { joinCode },
  });
  if (response.statusCode !== 200) {
    throw new Error(`join failed (${response.statusCode}): ${response.body}`);
  }
}

const lecturePayload = {
  title: 'محاضرة اختبار',
  description: null,
  learningObjectives: [],
  keyConcepts: [],
};

async function publishLectureRaw(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  classroomId: string,
  payload: Record<string, unknown> = {},
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof getApp>>['inject']>>> {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url: `/v1/classrooms/${classroomId}/lectures`,
    headers: auth(session),
    payload: { ...lecturePayload, ...payload },
  });
}

// --- creating a classroom ---------------------------------------------------

describe('opening a classroom requires academic authority', () => {
  it('refuses an ordinary enrolled student', async () => {
    /*
     * Matrix 1, and the defect this phase exists to close. Before Phase 5c this
     * returned 201 and made the student an owner — which handed them the
     * ability to publish under the instructor claim.
     */
    const student = await onboardedUser();
    const response = await createClassroomRaw(student.session);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('allows a verified instructor enrolled in the course', async () => {
    // Matrix 2.
    const instructor = await verifiedInstructor();
    const response = await createClassroomRaw(instructor.session);

    expect(response.statusCode).toBe(201);
    expect(response.json().viewer.role).toBe('owner');
    expect(response.json().viewer.canTeach).toBe(true);
  });

  it('refuses a payload that tries to grant itself the credential', async () => {
    /*
     * Matrix 3. The request body is not an input to authorization: these fields
     * do not exist in the schema, and even if they did the actor is hydrated
     * from the database on every request and never from what was sent.
     */
    const student = await onboardedUser();
    const response = await createClassroomRaw(student.session, {
      verificationLevel: 'instructor',
      role: 'owner',
      teachingEligible: true,
      instructorId: student.session.user.id,
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses a verified instructor a course they are not in', async () => {
    const instructor = await verifiedInstructor({ stageId: cohort.stage4Id });
    const response = await createClassroomRaw(instructor.session);

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('refuses an unauthenticated caller outright', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/classrooms',
      payload: { courseId: cohort.courseIds[0], title: 'قاعة', description: null },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses an account that has signed up but not completed onboarding', async () => {
    const session = await signupUser();
    await setVerificationLevel(session.user.id, 'instructor');
    const response = await createClassroomRaw(session);

    // Verified, but enrolled in nothing: the credential is not a course scope.
    expect(response.statusCode).toBe(403);
  });
});

// --- publishing inside one ---------------------------------------------------

describe('publishing requires both halves of the invariant', () => {
  it('refuses a member with no teaching role', async () => {
    // Matrix 4.
    const instructor = await verifiedInstructor();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    await joinClassroom(student.session, classroom.id);

    const response = await publishLectureRaw(student.session, classroom.id);
    expect(response.statusCode).toBe(403);
  });

  it('refuses a verified instructor who is only an ordinary member here', async () => {
    /*
     * Matrix 6. Eligibility is not authority. A real instructor who joins a
     * colleague's classroom as a student does not get to publish in it.
     */
    const owner = await verifiedInstructor();
    const otherInstructor = await verifiedInstructor();
    const classroom = await createClassroom(owner.session);
    await joinClassroom(otherInstructor.session, classroom.id);

    const response = await publishLectureRaw(otherInstructor.session, classroom.id);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('allows an eligible owner', async () => {
    // Matrix 7.
    const instructor = await verifiedInstructor();
    const classroom = await createClassroom(instructor.session);

    const response = await publishLectureRaw(instructor.session, classroom.id);
    expect(response.statusCode).toBe(201);
    expect((response.json() as LectureSummary).classroomId).toBe(classroom.id);
  });

  it('refuses an owner whose eligibility was revoked, and keeps refusing materials', async () => {
    /*
     * Matrix 5 and 8. The owner is unchanged; only the global fact moved. The
     * Actor is hydrated per request, so this takes effect on the very next
     * call with the SAME access token — there is no cache and no re-login.
     */
    const instructor = await verifiedInstructor();
    const classroom = await createClassroom(instructor.session);
    const before = await publishLectureRaw(instructor.session, classroom.id);
    expect(before.statusCode).toBe(201);
    const lecture = before.json() as LectureSummary;

    await setVerificationLevel(instructor.session.user.id, 'student');

    const after = await publishLectureRaw(instructor.session, classroom.id);
    expect(after.statusCode).toBe(403);

    const app = await getApp();
    const material = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/materials`,
      headers: auth(instructor.session),
      payload: { title: 'ملف', externalUrl: 'https://example.org/a.pdf' },
    });
    expect(material.statusCode).toBe(403);
  });

  it('refuses a non-member with 404 rather than 403, whatever their credential', async () => {
    /*
     * Matrix 12 in its sharpest form: the denial must not confirm the room
     * exists. A verified instructor outside the room gets the same answer as
     * anyone else outside it.
     */
    const owner = await verifiedInstructor();
    const outsider = await verifiedInstructor();
    const classroom = await createClassroom(owner.session);

    const response = await publishLectureRaw(outsider.session, classroom.id);
    expect(response.statusCode).toBe(404);
  });
});

// --- what revocation does NOT do --------------------------------------------

describe('revocation removes authority, not the classroom', () => {
  it('leaves the owner owning, reading and running the room', async () => {
    /*
     * Matrix 9. This is the half that is easy to get wrong by deleting the
     * membership along with the credential, which would strand every student
     * in the room the moment an administrator corrected a verification.
     */
    const instructor = await verifiedInstructor();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    await joinClassroom(student.session, classroom.id);

    await setVerificationLevel(instructor.session.user.id, 'student');

    const app = await getApp();
    const after = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}`,
      headers: auth(instructor.session),
    });

    expect(after.statusCode).toBe(200);
    const detail = after.json() as ClassroomDetail;
    expect(detail.viewer.role).toBe('owner');
    expect(detail.viewer.isMember).toBe(true);
    expect(detail.viewer.canTeach).toBe(false);
    // Still able to run the room, so it can be handed over or archived.
    expect(detail.viewer.canManage).toBe(true);
    expect(detail.viewer.canManageMembership).toBe(true);
    expect(detail.viewer.canParticipate).toBe(true);
    // The join code is a roster fact, not an academic one, so it survives.
    expect(detail.joinCode).not.toBeNull();
  });

  it('leaves them able to take part in the discussion like any member', async () => {
    const instructor = await verifiedInstructor();
    const classroom = await createClassroom(instructor.session);
    const lecture = (await publishLectureRaw(instructor.session, classroom.id)).json() as LectureSummary;

    await setVerificationLevel(instructor.session.user.id, 'student');

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(instructor.session),
      payload: { body: 'سؤال بعد سحب التوثيق' },
    });
    expect(response.statusCode).toBe(201);
  });

  it('still shows them their own drafts, so the room can be handed over', async () => {
    const instructor = await verifiedInstructor();
    const classroom = await createClassroom(instructor.session);
    await publishLectureRaw(instructor.session, classroom.id, { publish: false });

    await setVerificationLevel(instructor.session.user.id, 'student');

    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}/lectures`,
      headers: auth(instructor.session),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });
});

// --- admin v0 ----------------------------------------------------------------

describe('only a platform administrator may change eligibility', () => {
  it('refuses an ordinary student', async () => {
    // Matrix 10.
    const admin = await onboardedUser();
    const target = await onboardedUser();
    const app = await getApp();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      headers: auth(admin.session),
      payload: { verificationLevel: 'instructor', reason: 'promoting myself' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('refuses a verified instructor — teaching is not administering', async () => {
    const instructor = await verifiedInstructor();
    const target = await onboardedUser();
    const app = await getApp();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      headers: auth(instructor.session),
      payload: { verificationLevel: 'instructor', reason: 'a colleague' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a user trying to verify themselves', async () => {
    const student = await onboardedUser();
    const app = await getApp();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${student.session.user.id}/verification`,
      headers: auth(student.session),
      payload: { verificationLevel: 'official', reason: 'trust me' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const target = await onboardedUser();
    const app = await getApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      payload: { verificationLevel: 'instructor', reason: 'nobody' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('hides the whole console from a non-administrator', async () => {
    const student = await onboardedUser();
    const app = await getApp();

    for (const url of [
      `/v1/admin/users?query=${student.handle}`,
      `/v1/admin/users/${student.session.user.id}`,
      `/v1/admin/users/${student.session.user.id}/verification-history`,
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: auth(student.session) });
      expect(response.statusCode).toBe(403);
    }
  });

  it('lets an administrator grant, and the grant takes effect immediately', async () => {
    const admin = await platformAdmin();
    const target = await onboardedUser();
    const app = await getApp();

    const before = await createClassroomRaw(target.session);
    expect(before.statusCode).toBe(403);

    const granted = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      headers: auth(admin.session),
      payload: { verificationLevel: 'instructor', reason: 'Faculty of Medicine staff list, 2026' },
    });
    expect(granted.statusCode).toBe(200);
    const summary = granted.json() as AdminUserSummary;
    expect(summary.verificationLevel).toBe('instructor');
    expect(summary.teachingEligible).toBe(true);

    // Same access token, no re-login: the Actor is rebuilt per request.
    const after = await createClassroomRaw(target.session);
    expect(after.statusCode).toBe(201);
  });

  it('lets an administrator revoke, and the revocation takes effect immediately', async () => {
    const admin = await platformAdmin();
    const target = await verifiedInstructor();
    const app = await getApp();

    const revoked = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      headers: auth(admin.session),
      payload: { verificationLevel: 'student', reason: 'left the department' },
    });
    expect(revoked.statusCode).toBe(200);
    expect((revoked.json() as AdminUserSummary).teachingEligible).toBe(false);

    const after = await createClassroomRaw(target.session);
    expect(after.statusCode).toBe(403);
  });

  it('requires a stated reason', async () => {
    const admin = await platformAdmin();
    const target = await onboardedUser();
    const app = await getApp();

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      headers: auth(admin.session),
      payload: { verificationLevel: 'instructor' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('404s an administrator asking about an account that does not exist', async () => {
    const admin = await platformAdmin();
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/users/00000000-0000-4000-8000-000000000000',
      headers: auth(admin.session),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('every change leaves an audit record', () => {
  it('records who, when, from what and to what — for grants and revocations alike', async () => {
    // Matrix 11.
    const admin = await platformAdmin();
    const target = await onboardedUser();
    const app = await getApp();

    for (const [level, reason] of [
      ['instructor', 'appointed lecturer, pediatrics'],
      ['student', 'appointment ended'],
    ] as const) {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/admin/users/${target.session.user.id}/verification`,
        headers: auth(admin.session),
        payload: { verificationLevel: level, reason },
      });
      expect(response.statusCode).toBe(200);
    }

    const history = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${target.session.user.id}/verification-history`,
      headers: auth(admin.session),
    });
    expect(history.statusCode).toBe(200);

    const items = history.json().items as {
      actor: { userId: string } | null;
      before: string | null;
      after: string | null;
      reason: string | null;
      createdAt: string;
    }[];

    expect(items).toHaveLength(2);
    /*
     * Newest first: the revocation, then the grant that preceded it.
     *
     * The grant's `before` is `unverified` rather than `student`, because
     * completing onboarding does not currently set a verification level —
     * confirming a cohort placement and confirming an identity are separate
     * acts, and only the second has ever been implemented. Asserting the real
     * value keeps this test honest about what the system does today.
     */
    expect(items[0]).toMatchObject({ before: 'instructor', after: 'student', reason: 'appointment ended' });
    expect(items[1]).toMatchObject({ before: 'unverified', after: 'instructor' });
    for (const entry of items) {
      expect(entry.actor?.userId).toBe(admin.session.user.id);
      expect(Number.isNaN(Date.parse(entry.createdAt))).toBe(false);
    }
  });

  it('is not written when the change was refused', async () => {
    const impostor = await onboardedUser();
    const target = await onboardedUser();
    const admin = await platformAdmin();
    const app = await getApp();

    await app.inject({
      method: 'PUT',
      url: `/v1/admin/users/${target.session.user.id}/verification`,
      headers: auth(impostor.session),
      payload: { verificationLevel: 'official', reason: 'should never land' },
    });

    const history = await app.inject({
      method: 'GET',
      url: `/v1/admin/users/${target.session.user.id}/verification-history`,
      headers: auth(admin.session),
    });
    expect(history.json().items).toHaveLength(0);
  });
});

// --- the client is told, and the server does not rely on it ------------------

describe('the session projects eligibility rather than leaving it to the client', () => {
  it('reports a student ineligible and a verified instructor eligible', async () => {
    const student = await onboardedUser();
    const instructor = await verifiedInstructor();
    const app = await getApp();

    const asStudent = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: auth(student.session),
    });
    const asInstructor = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: auth(instructor.session),
    });

    expect(asStudent.json().teachingEligible).toBe(false);
    expect(asInstructor.json().teachingEligible).toBe(true);
  });

  it('does not let a stale client win: the server refuses regardless', async () => {
    /*
     * Matrix 12. A client that cached `teachingEligible: true` from before a
     * revocation keeps rendering the control; the request it sends still fails.
     * The projection is a convenience, never the boundary.
     */
    const instructor = await verifiedInstructor();
    const app = await getApp();

    const stale = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: auth(instructor.session) });
    expect(stale.json().teachingEligible).toBe(true);

    await setVerificationLevel(instructor.session.user.id, 'student');

    const response = await createClassroomRaw(instructor.session);
    expect(response.statusCode).toBe(403);
  });
});
