import type {
  ClassroomDetail,
  ClassroomSummary,
  ContentItem,
  FeedPage,
  LectureDetail,
  LectureSummary,
} from '@sos/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  closeApp,
  ensureCohort,
  getApp,
  onboardedUser,
  readFeed,
  signupUser,
  TINY_PNG,
  uploadImage,
  type Cohort,
} from './helpers.js';

/**
 * Classrooms, lectures and materials (Phase 5b).
 *
 * The exit criterion for this phase is one sentence — "a student opens a
 * classroom, reads a lecture, and downloads a resource through a signed URL
 * that a non-member cannot use" — and the tests below are organised around
 * proving each clause of it, plus the ways a caller might try to get round it.
 *
 * The cases that matter most are the negative ones. A classroom that shows the
 * right things to its members is easy; a classroom that shows nothing to a
 * non-member who holds a lecture id, a classroom id or a signed material URL is
 * the actual product requirement.
 */

let cohort: Cohort;

beforeAll(async () => {
  await getApp();
  cohort = await ensureCohort();
});

afterAll(async () => {
  await closeApp();
});

async function createClassroom(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  overrides: Record<string, unknown> = {},
): Promise<ClassroomDetail> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/classrooms',
    headers: auth(session),
    payload: {
      courseId: cohort.courseIds[0],
      title: 'محاضرات طب الأطفال — المجموعة ب',
      description: 'Weekly pediatrics sessions.',
      ...overrides,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`create classroom failed (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}

async function publishLecture(
  session: Awaited<ReturnType<typeof onboardedUser>>['session'],
  classroomId: string,
  overrides: Record<string, unknown> = {},
): Promise<LectureSummary> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: `/v1/classrooms/${classroomId}/lectures`,
    headers: auth(session),
    payload: {
      title: 'المتلازمة الكلوية — الآلية والعلاج',
      description: 'Mechanism, presentation and management.',
      learningObjectives: ['Explain the mechanism of oedema'],
      keyConcepts: ['albumin', 'oncotic pressure'],
      ...overrides,
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`publish lecture failed (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}

describe('the phase 5b exit criterion', () => {
  it('lets a student open a classroom, read a lecture, and fetch its material', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const student = await onboardedUser();

    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    // A real uploaded file, placed into the classroom as it is attached.
    const file = await uploadImage(instructor.session, TINY_PNG);
    const material = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/materials`,
      headers: auth(instructor.session),
      payload: { title: 'Lecture slides', fileId: file.body.id },
    });
    expect(material.statusCode).toBe(201);

    // The student joins by enrolment — same course, course-visible room.
    const joined = await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(student.session),
      payload: { joinCode: null },
    });
    expect(joined.statusCode).toBe(200);
    expect((joined.json() as ClassroomSummary).viewer.isMember).toBe(true);

    const read = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lecture.id}`,
      headers: auth(student.session),
    });
    expect(read.statusCode).toBe(200);
    const detail = read.json() as LectureDetail;
    expect(detail.title).toBe('المتلازمة الكلوية — الآلية والعلاج');
    expect(detail.learningObjectives).toEqual(['Explain the mechanism of oedema']);
    expect(detail.materials).toHaveLength(1);

    // The URL is signed, and the bytes actually come back through it.
    const url = detail.materials[0]!.file!.url;
    expect(url).toContain('sig=');
    const bytes = await app.inject({ method: 'GET', url, headers: auth(student.session) });
    expect(bytes.statusCode).toBe(200);
  });

  /*
   * The phase's exit criterion says the resource comes "through a signed URL
   * that a non-member cannot use". What that means precisely, in this
   * architecture, is: **a non-member cannot obtain one.**
   *
   * A signed URL is a bearer capability by design and by prior decision — the
   * authorization runs when the URL is MINTED, the window is short, and the
   * signature covers id and expiry together (`signed-url.ts`, §49/§50; the same
   * model as an S3 presigned URL). An `<Image src>` cannot send an
   * Authorization header, so redemption cannot be authenticated without
   * breaking private media across the whole product.
   *
   * So the boundary this test defends is the mint, and the two ways to reach
   * one: the lecture that lists it, and the endpoint that re-mints it. Both
   * refuse a non-member. Asserting that a *replayed* URL fails would be
   * asserting a property the system does not claim, and does not have.
   */
  it('refuses a non-member every route to a signed material URL', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const outsider = await onboardedUser();

    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);
    const file = await uploadImage(instructor.session, TINY_PNG);
    await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/materials`,
      headers: auth(instructor.session),
      payload: { title: 'Slides', fileId: file.body.id },
    });

    // Route 1 — the lecture that carries the URL. 404, so no URL is handed out.
    const viaLecture = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lecture.id}`,
      headers: auth(outsider.session),
    });
    expect(viaLecture.statusCode).toBe(404);

    // Route 2 — minting one directly from the file id, which a leaked lecture
    // id would give them. `canAccessFile` resolves `visibility = 'classroom'`
    // against the actor's memberships, which is what attaching the material
    // set up.
    const viaMint = await app.inject({
      method: 'GET',
      url: `/v1/files/${file.body.id}`,
      headers: auth(outsider.session),
    });
    expect(viaMint.statusCode).toBe(404);

    // And the member's own mint still works, so the gate is discriminating
    // rather than simply broken.
    const member = await app.inject({
      method: 'GET',
      url: `/v1/files/${file.body.id}`,
      headers: auth(instructor.session),
    });
    expect(member.statusCode).toBe(200);
  });
});

describe('classroom visibility', () => {
  it('lets an enrolled non-member see a course-visible room but not read it', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const peer = await onboardedUser();
    const classroom = await createClassroom(instructor.session);

    // Enrolment gets you the door…
    const seen = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}`,
      headers: auth(peer.session),
    });
    expect(seen.statusCode).toBe(200);
    const detail = seen.json() as ClassroomDetail;
    expect(detail.viewer.isMember).toBe(false);
    expect(detail.viewer.canJoin).toBe(true);
    expect(detail.viewer.canRead).toBe(false);
    // …but not the join code, which is a bearer credential.
    expect(detail.joinCode).toBeNull();

    // …and membership gets you the room.
    for (const path of ['lectures', 'members']) {
      const blocked = await app.inject({
        method: 'GET',
        url: `/v1/classrooms/${classroom.id}/${path}`,
        headers: auth(peer.session),
      });
      expect(blocked.statusCode, `${path} must require membership`).toBe(404);
    }
  });

  it('hides an unlisted room entirely, and opens it only with the join code', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const peer = await onboardedUser();
    const classroom = await createClassroom(instructor.session, { visibility: 'classroom' });

    // Invisible even to a cohort-mate enrolled in the same course.
    const hidden = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}`,
      headers: auth(peer.session),
    });
    expect(hidden.statusCode).toBe(404);

    const discover = await app.inject({
      method: 'GET',
      url: '/v1/classrooms?scope=discover',
      headers: auth(peer.session),
    });
    expect(
      (discover.json() as { items: ClassroomSummary[] }).items.some((c) => c.id === classroom.id),
      'an unlisted room must never appear in discovery',
    ).toBe(false);

    // Joining without the code is a 404, not a "wrong code" that confirms it exists.
    const refused = await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(peer.session),
      payload: { joinCode: null },
    });
    expect(refused.statusCode).toBe(404);

    const accepted = await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(peer.session),
      payload: { joinCode: classroom.joinCode },
    });
    expect(accepted.statusCode).toBe(200);
  });

  it('rejects an unknown join code identically to a room that does not exist', async () => {
    const app = await getApp();
    const student = await onboardedUser();
    const response = await app.inject({
      method: 'GET',
      url: '/v1/classrooms/lookup?joinCode=ZZZZZZZZ',
      headers: auth(student.session),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('teaching is a role, not a checkbox', () => {
  it('refuses to let a student publish a lecture or attach a material', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(student.session),
      payload: { joinCode: null },
    });

    const publishing = await app.inject({
      method: 'POST',
      url: `/v1/classrooms/${classroom.id}/lectures`,
      headers: auth(student.session),
      payload: { title: 'A lecture a student should not be able to publish' },
    });
    expect(publishing.statusCode).toBe(403);

    const attaching = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/materials`,
      headers: auth(student.session),
      payload: { title: 'Not mine to add', externalUrl: 'https://example.org/x' },
    });
    expect(attaching.statusCode).toBe(403);
  });

  it('shows drafts to teaching staff and hides them from students', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const draft = await publishLecture(instructor.session, classroom.id, {
      title: 'Unpublished draft',
      publish: false,
    });
    expect(draft.publishedAt).toBeNull();

    await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(student.session),
      payload: { joinCode: null },
    });

    const staffList = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}/lectures`,
      headers: auth(instructor.session),
    });
    expect((staffList.json() as { items: LectureSummary[] }).items.some((l) => l.id === draft.id)).toBe(
      true,
    );

    const studentList = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}/lectures`,
      headers: auth(student.session),
    });
    expect((studentList.json() as { items: LectureSummary[] }).items.some((l) => l.id === draft.id)).toBe(
      false,
    );

    // A direct lecture id must not reveal a draft either.
    const direct = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${draft.id}`,
      headers: auth(student.session),
    });
    expect(direct.statusCode).toBe(404);
  });

  it('refuses to let an owner strand their own classroom by leaving', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);

    const leaving = await app.inject({
      method: 'DELETE',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(instructor.session),
    });
    expect(leaving.statusCode).toBe(403);
    // The envelope deliberately carries no reason: telling the caller *why*
    // they were refused is exactly what the uniform message avoids.
    expect(leaving.json().error.code).toBe('FORBIDDEN');
  });
});

describe('unauthorised access', () => {
  it('refuses every classroom surface without a token', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    const surfaces: [string, string][] = [
      ['GET', '/v1/classrooms'],
      ['GET', `/v1/classrooms/${classroom.id}`],
      ['GET', `/v1/classrooms/${classroom.id}/lectures`],
      ['GET', `/v1/classrooms/${classroom.id}/members`],
      ['GET', `/v1/lectures/${lecture.id}`],
    ];
    for (const [method, url] of surfaces) {
      const response = await app.inject({ method: method as 'GET', url });
      expect(response.statusCode, `${method} ${url} must require authentication`).toBe(401);
    }
  });

  it('refuses a signed-in account that has not completed onboarding', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    // Signed up, never onboarded: no stage, so no enrolment, so no course.
    const stranger = await signupUser();

    const response = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}`,
      headers: auth(stranger),
    });
    expect(response.statusCode).toBe(404);
  });

  it('does not let a classroom id from another cohort be opened', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    // A student placed in a different stage is enrolled in different courses.
    const otherStage = await onboardedUser({ stageId: cohort.stage4Id });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}`,
      headers: auth(otherStage.session),
    });
    expect(response.statusCode).toBe(404);
  });

  it('refuses to create a classroom for a course the actor is not enrolled in', async () => {
    const app = await getApp();
    const otherStage = await onboardedUser({ stageId: cohort.stage4Id });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/classrooms',
      headers: auth(otherStage.session),
      payload: { courseId: cohort.courseIds[0], title: 'Not my course' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('membership and persistence', () => {
  it('is idempotent: joining twice is one membership', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);

    for (let i = 0; i < 2; i += 1) {
      await app.inject({
        method: 'PUT',
        url: `/v1/classrooms/${classroom.id}/membership`,
        headers: auth(student.session),
        payload: { joinCode: null },
      });
    }

    const roster = await app.inject({
      method: 'GET',
      url: `/v1/classrooms/${classroom.id}/members`,
      headers: auth(student.session),
    });
    const members = roster.json() as { items: { user: { userId: string } }[] };
    const mine = members.items.filter((m) => m.user.userId !== instructor.session.user.id);
    expect(mine).toHaveLength(1);
  });

  it('persists: a joined classroom is still there on a fresh read', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    await publishLecture(instructor.session, classroom.id);

    await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(student.session),
      payload: { joinCode: null },
    });

    // A completely separate request, as a page reload would make.
    const mine = await app.inject({
      method: 'GET',
      url: '/v1/classrooms?scope=mine',
      headers: auth(student.session),
    });
    const found = (mine.json() as { items: ClassroomSummary[] }).items.find(
      (c) => c.id === classroom.id,
    );
    expect(found).toBeDefined();
    expect(found!.lectureCount).toBe(1);
    expect(found!.memberCount).toBe(2);
  });

  it('records reading progress without letting it go backwards', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    for (const percent of [100, 40]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/lectures/${lecture.id}/progress`,
        headers: auth(instructor.session),
        payload: { percent },
      });
      expect(response.statusCode).toBe(204);
    }

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lecture.id}`,
      headers: auth(instructor.session),
    });
    // Completion survives the later, lower report.
    expect((detail.json() as LectureDetail).viewer.completedAt).not.toBeNull();
  });
});

describe('lecture discussion', () => {
  /*
   * The chain that has to hold on every call:
   *   authenticated → member of the classroom → lecture belongs to that
   *   classroom → discussion belongs to that lecture.
   *
   * It is not a new social system. These are `content_items` in the classroom
   * container pointed at a lecture, so they inherit the feed's permission
   * predicate rather than getting a second one that would need securing again.
   */
  it('lets a member read and post, and keeps each lecture’s thread separate', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const student = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lectureA = await publishLecture(instructor.session, classroom.id, { title: 'Lecture A' });
    const lectureB = await publishLecture(instructor.session, classroom.id, { title: 'Lecture B' });

    await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(student.session),
      payload: { joinCode: null },
    });

    // A student may speak — a classroom where only staff post is a broadcast.
    const posted = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lectureA.id}/discussion`,
      headers: auth(student.session),
      payload: { body: 'سؤال عن آلية الوذمة في هذه المحاضرة تحديداً.', mediaFileIds: [] },
    });
    expect(posted.statusCode).toBe(201);
    const created = posted.json() as ContentItem;
    // Forced server-side: a post made inside a room must not be publishable to
    // the whole stage by a client that sends its own visibility.
    expect(created.visibility).toBe('classroom');

    const threadA = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lectureA.id}/discussion`,
      headers: auth(instructor.session),
    });
    expect(threadA.statusCode).toBe(200);
    expect((threadA.json() as FeedPage).items.some((item) => item.id === created.id)).toBe(true);

    // The post must not bleed into the sibling lecture.
    const threadB = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lectureB.id}/discussion`,
      headers: auth(instructor.session),
    });
    expect((threadB.json() as FeedPage).items.some((item) => item.id === created.id)).toBe(false);
  });

  it('refuses a non-member both reading and posting', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const outsider = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(instructor.session),
      payload: { body: 'A staff note that an outsider must not read.', mediaFileIds: [] },
    });

    const reading = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(outsider.session),
    });
    expect(reading.statusCode).toBe(404);

    const posting = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(outsider.session),
      payload: { body: 'An outsider should not be able to write this.', mediaFileIds: [] },
    });
    expect(posting.statusCode).toBe(404);
  });

  it('refuses an unauthenticated caller', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({
        method,
        url: `/v1/lectures/${lecture.id}/discussion`,
        ...(method === 'POST' ? { payload: { body: 'no token', mediaFileIds: [] } } : {}),
      });
      expect(response.statusCode, `${method} must require authentication`).toBe(401);
    }
  });

  it('does not leak a classroom post into the ordinary cohort feed', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const peer = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    const posted = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(instructor.session),
      payload: { body: 'Classroom-only discussion that must stay in the room.', mediaFileIds: [] },
    });
    const created = posted.json() as ContentItem;

    // `peer` is a cohort-mate enrolled in the same course but not in the room.
    const feed = await readFeed(peer.session);
    expect(feed.items.some((item) => item.id === created.id)).toBe(false);
  });

  it('persists: the discussion is still there on a fresh read', async () => {
    const app = await getApp();
    const instructor = await onboardedUser();
    const classroom = await createClassroom(instructor.session);
    const lecture = await publishLecture(instructor.session, classroom.id);

    const posted = await app.inject({
      method: 'POST',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(instructor.session),
      payload: { body: 'This must survive a completely separate request.', mediaFileIds: [] },
    });
    const created = posted.json() as ContentItem;

    const reread = await app.inject({
      method: 'GET',
      url: `/v1/lectures/${lecture.id}/discussion`,
      headers: auth(instructor.session),
    });
    expect((reread.json() as FeedPage).items.some((item) => item.id === created.id)).toBe(true);
  });
});

describe('instructor authority is derived server-side', () => {
  /*
   * The invariant: authority comes from `classroom_members.role`, read from the
   * database on every call. It is never taken from the request body, from
   * `users.verification_level`, or from anything the client can set — so there
   * is no payload that turns a student into teaching staff.
   */
  const instructorOnly = (classroomId: string, lectureId: string) =>
    [
      {
        name: 'publish a lecture',
        method: 'POST' as const,
        url: `/v1/classrooms/${classroomId}/lectures`,
        payload: { title: 'An instructor-only operation' },
      },
      {
        name: 'attach a material',
        method: 'POST' as const,
        url: `/v1/lectures/${lectureId}/materials`,
        payload: { title: 'Slides', externalUrl: 'https://example.org/x.pdf' },
      },
    ];

  it('allows the owner', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const classroom = await createClassroom(owner.session);
    const lecture = await publishLecture(owner.session, classroom.id);

    for (const op of instructorOnly(classroom.id, lecture.id)) {
      const response = await app.inject({
        method: op.method,
        url: op.url,
        headers: auth(owner.session),
        payload: op.payload,
      });
      expect(response.statusCode, `owner must be able to ${op.name}`).toBe(201);
    }
  });

  it('refuses a member, even one who claims a role in the payload', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const member = await onboardedUser();
    const classroom = await createClassroom(owner.session);
    const lecture = await publishLecture(owner.session, classroom.id);
    await app.inject({
      method: 'PUT',
      url: `/v1/classrooms/${classroom.id}/membership`,
      headers: auth(member.session),
      payload: { joinCode: null },
    });

    for (const op of instructorOnly(classroom.id, lecture.id)) {
      const response = await app.inject({
        method: op.method,
        url: op.url,
        headers: auth(member.session),
        // A role asserted by the client must change nothing.
        payload: { ...op.payload, role: 'owner', verificationLevel: 'instructor' },
      });
      expect(response.statusCode, `a member must not be able to ${op.name}`).toBe(403);
    }
  });

  it('refuses a non-member', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const outsider = await onboardedUser();
    const classroom = await createClassroom(owner.session);
    const lecture = await publishLecture(owner.session, classroom.id);

    for (const op of instructorOnly(classroom.id, lecture.id)) {
      const response = await app.inject({
        method: op.method,
        url: op.url,
        headers: auth(outsider.session),
        payload: op.payload,
      });
      // 404, not 403: a non-member is not told the room exists.
      expect(response.statusCode, `a non-member must not be able to ${op.name}`).toBe(404);
    }
  });

  it('refuses an unauthenticated caller', async () => {
    const app = await getApp();
    const owner = await onboardedUser();
    const classroom = await createClassroom(owner.session);
    const lecture = await publishLecture(owner.session, classroom.id);

    for (const op of instructorOnly(classroom.id, lecture.id)) {
      const response = await app.inject({ method: op.method, url: op.url, payload: op.payload });
      expect(response.statusCode, `${op.name} must require authentication`).toBe(401);
    }
  });
});
