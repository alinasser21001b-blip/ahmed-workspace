import { describe, expect, it } from 'vitest';
import type { Actor } from '../actor.js';
import {
  canSetVerificationLevel,
  canTeachAcademically,
  isTeachingEligible,
  isTeachingLevel,
} from '../academic.policy.js';
import {
  canCreateClassroom,
  canManageClassroom,
  canManageClassroomMembership,
  canParticipateInClassroom,
  canReadClassroom,
  canTeachInClassroom,
  classroomCapabilities,
  type ClassroomRef,
} from '../classroom.policy.js';
import type { Membership } from '../membership.policy.js';

/**
 * Phase 5c — academic authority.
 *
 * The invariant these tests exist to protect:
 *
 *   canTeach = global teaching eligibility AND contextual teaching authority
 *
 * and its two halves, each of which is a real defect on its own:
 *
 *   * ownership must not confer eligibility — the Phase 5b hole, where any
 *     enrolled student could open a room and thereby become its instructor;
 *   * eligibility must not confer authority — a verified instructor is not
 *     staff of every classroom they happen to have joined.
 *
 * These run in milliseconds against pure functions, which is why the matrix is
 * exhaustive here and the integration suite proves only that the routes
 * actually consult it.
 */

const COURSE = 'course-pediatrics';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u-1',
    role: 'student',
    status: 'active',
    verificationLevel: 'student',
    universityId: 'uni-1',
    collegeId: 'col-1',
    programId: 'prog-1',
    stageId: 'stage-5',
    courseIds: new Set([COURSE]),
    communityIds: new Set(),
    groupIds: new Set(),
    classroomIds: new Set(['k1']),
    followingIds: new Set(),
    blockedUserIds: new Set(),
    blockedByUserIds: new Set(),
    mutedUserIds: new Set(),
    mutedGroupIds: new Set(),
    mutedCommunityIds: new Set(),
    mutedTopicIds: new Set(),
    ...overrides,
  };
}

const student = () => actor();
const instructor = () => actor({ verificationLevel: 'instructor' });
const official = () => actor({ verificationLevel: 'official' });
const platformAdmin = () => actor({ role: 'admin' });

const membership = (overrides: Partial<Membership> = {}): Membership => ({
  role: 'member',
  status: 'active',
  ...overrides,
});

const classroom = (overrides: Partial<ClassroomRef> = {}): ClassroomRef => ({
  id: 'k1',
  courseId: COURSE,
  instructorId: 'u-1',
  visibility: 'course',
  isArchived: false,
  ...overrides,
});

describe('global academic eligibility', () => {
  it('counts instructor and official, and nothing else', () => {
    expect(isTeachingLevel('instructor')).toBe(true);
    expect(isTeachingLevel('official')).toBe(true);
    expect(isTeachingLevel('student')).toBe(false);
    expect(isTeachingLevel('unverified')).toBe(false);
  });

  it('is not granted by being a platform administrator', () => {
    // Running the service is an operational capability, not an academic one.
    // Collapsing the two would rebuild the defect this phase exists to remove.
    expect(isTeachingEligible(platformAdmin())).toBe(false);
    expect(canTeachAcademically(platformAdmin()).allowed).toBe(false);
  });

  it('is not granted by an inactive account holding the credential', () => {
    expect(canTeachAcademically(actor({ verificationLevel: 'instructor', status: 'restricted' })).allowed).toBe(false);
    expect(canTeachAcademically(actor({ verificationLevel: 'instructor', status: 'suspended' })).allowed).toBe(false);
  });

  it('is nobody at all for an unauthenticated caller', () => {
    expect(isTeachingEligible(null)).toBe(false);
    expect(canTeachAcademically(null).allowed).toBe(false);
  });
});

describe('who may change eligibility', () => {
  it('is platform administrators only', () => {
    expect(canSetVerificationLevel(platformAdmin()).allowed).toBe(true);
    expect(canSetVerificationLevel(student()).allowed).toBe(false);
    expect(canSetVerificationLevel(instructor()).allowed).toBe(false);
    expect(canSetVerificationLevel(null).allowed).toBe(false);
  });

  it('refuses an administrator who is not in good standing', () => {
    expect(canSetVerificationLevel(actor({ role: 'admin', status: 'suspended' })).allowed).toBe(false);
  });

  it('gives a non-administrator a reason that names the missing authority', () => {
    expect(canSetVerificationLevel(student()).reason).toBe('not_platform_admin');
  });
});

describe('opening a classroom', () => {
  it('refuses an ordinary enrolled student', () => {
    // Matrix 1. The Phase 5b defect, stated as a test.
    const decision = canCreateClassroom(student(), COURSE);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not_verified_instructor');
  });

  it('allows a verified instructor enrolled in the course', () => {
    // Matrix 2.
    expect(canCreateClassroom(instructor(), COURSE).allowed).toBe(true);
    expect(canCreateClassroom(official(), COURSE).allowed).toBe(true);
  });

  it('refuses a verified instructor outside the course', () => {
    const decision = canCreateClassroom(instructor(), 'course-someone-elses');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not_in_course');
  });

  it('refuses a platform administrator who holds no academic credential', () => {
    expect(canCreateClassroom(platformAdmin(), COURSE).allowed).toBe(false);
  });
});

describe('teaching inside a classroom', () => {
  it('refuses a member with no teaching role, however well verified', () => {
    // Matrix 6. Eligibility is not authority: being an instructor somewhere
    // does not make you staff of every room you have joined.
    const decision = canTeachInClassroom(instructor(), membership({ role: 'member' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not_teaching_staff');
  });

  it('refuses an owner who is not a verified instructor', () => {
    // Matrix 5. Ownership is not eligibility.
    const decision = canTeachInClassroom(student(), membership({ role: 'owner' }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not_verified_instructor');
  });

  it('allows staff who are also verified', () => {
    // Matrix 7, for each role that counts as staff.
    for (const role of ['owner', 'admin', 'moderator'] as const) {
      expect(canTeachInClassroom(instructor(), membership({ role })).allowed).toBe(true);
    }
  });

  it('refuses a non-member without revealing which requirement failed', () => {
    // The reason a non-member gets must stay the membership one: callers turn
    // it into 404, and `not_verified_instructor` would confirm the room exists.
    const decision = canTeachInClassroom(instructor(), null);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('not_classroom_member');
  });

  it('refuses a banned or pending membership even for a verified instructor', () => {
    expect(canTeachInClassroom(instructor(), membership({ role: 'owner', status: 'banned' })).allowed).toBe(false);
    expect(canTeachInClassroom(instructor(), membership({ role: 'owner', status: 'pending' })).allowed).toBe(false);
  });
});

describe('revocation leaves the room standing', () => {
  /*
   * Matrix 9, and the reason the capabilities were split apart at all. A
   * revoked owner loses exactly one thing.
   */
  const revokedOwner = student();
  const asOwner = membership({ role: 'owner' });

  it('stops them publishing', () => {
    expect(canTeachInClassroom(revokedOwner, asOwner).allowed).toBe(false);
  });

  it('leaves them running the room', () => {
    expect(canManageClassroom(revokedOwner, asOwner).allowed).toBe(true);
    expect(canManageClassroomMembership(revokedOwner, asOwner).allowed).toBe(true);
  });

  it('leaves them reading and taking part in it', () => {
    expect(canReadClassroom(revokedOwner, asOwner).allowed).toBe(true);
    expect(canParticipateInClassroom(revokedOwner, asOwner).allowed).toBe(true);
  });

  it('projects exactly that shape to the client', () => {
    const caps = classroomCapabilities(revokedOwner, classroom(), asOwner);
    expect(caps).toMatchObject({
      isMember: true,
      role: 'owner',
      canRead: true,
      canParticipate: true,
      canManageMembership: true,
      canManage: true,
      canTeach: false,
    });
  });
});

describe('capabilities projected for the client', () => {
  it('gives a verified instructor owner the full set', () => {
    const caps = classroomCapabilities(instructor(), classroom(), membership({ role: 'owner' }));
    expect(caps).toMatchObject({
      canRead: true,
      canParticipate: true,
      canManageMembership: true,
      canManage: true,
      canTeach: true,
      // An owner may not walk out; they transfer or archive instead.
      canLeave: false,
    });
  });

  it('gives an ordinary student member participation and nothing more', () => {
    const caps = classroomCapabilities(student(), classroom(), membership({ role: 'member' }));
    expect(caps).toMatchObject({
      canRead: true,
      canParticipate: true,
      canManageMembership: false,
      canManage: false,
      canTeach: false,
      canLeave: true,
    });
  });

  it('gives a non-member none of it', () => {
    const caps = classroomCapabilities(instructor(), classroom(), null);
    expect(caps).toMatchObject({
      isMember: false,
      role: null,
      canRead: false,
      canParticipate: false,
      canManageMembership: false,
      canManage: false,
      canTeach: false,
    });
  });

  it('lets a verified TA teach without letting them run the room', () => {
    const caps = classroomCapabilities(instructor(), classroom(), membership({ role: 'moderator' }));
    expect(caps).toMatchObject({
      canTeach: true,
      canManageMembership: true,
      // Renaming and archiving stay with the owner and admins.
      canManage: false,
    });
  });
});
