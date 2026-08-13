import { allow, canRead, deny, isActive, type Decision, type MaybeActor } from './actor.js';
import { canTeachAcademically } from './academic.policy.js';
import type { MaybeMembership } from './membership.policy.js';
import type { MembershipRole, Visibility } from '@sos/contracts';

/**
 * Classroom authorization.
 *
 * A classroom is a taught container, and that asymmetry is the reason it needs
 * its own gates rather than reusing the group ones wholesale. In a group every
 * active member may post; in a classroom publishing a lecture is a teaching
 * act and reading it is a student act, and the policy has to be able to tell
 * them apart.
 *
 * What is NOT re-derived here: whether the actor is a member at all. That
 * lives in `actor.classroomIds`, hydrated once per request from
 * `classroom_members` where `status = 'active'`, and is the same set
 * `canViewContent` and `canAccessFile` have consulted since Phase 0. A second
 * membership notion would be a second answer to the same question
 * (ADR-0003).
 *
 * Every gate is a separate named decision rather than one boolean, for the
 * reason the Phase 3 audit recorded: "access is not one boolean", and a UI
 * that projects five distinct capabilities cannot be built from one.
 *
 * Phase 5c added the axis that was missing. Every capability below is
 * CONTEXTUAL — it reads a role inside one room — with exactly one exception:
 * `canTeachInClassroom` also requires GLOBAL academic eligibility, because
 * publishing a lecture is the one act that makes a claim about the world
 * outside this room. The two axes are kept apart on purpose, so that losing a
 * credential and losing a room are different events:
 *
 *   capability             contextual role        academic eligibility
 *   ─────────────────────────────────────────────────────────────────
 *   canRead                any active member      not required
 *   canParticipate         any active member      not required
 *   canManageMembership    staff                  not required
 *   canManageClassroom     owner | admin          not required
 *   canTeach               staff                  REQUIRED
 *
 * The consequence is deliberate and is the revocation semantics in one line:
 * an owner who loses instructor verification stops being able to publish, and
 * carries on being able to run the room — transfer it, archive it, manage its
 * roster — so the room does not become orphaned by a credential decision.
 */

export interface ClassroomRef {
  id: string;
  courseId: string;
  instructorId: string | null;
  /** `course` — discoverable by anyone enrolled. `classroom` — unlisted. */
  visibility: Visibility;
  isArchived: boolean;
}

/**
 * Teaching staff of one room: the instructor and their assistants.
 *
 * Being staff is necessary for teaching and never sufficient — see
 * `canTeachInClassroom`. It is, on its own, enough to run the roster and to
 * see the room's drafts and join code, because those are facts about this
 * room rather than academic claims about the world.
 */
const STAFF_ROLES: MembershipRole[] = ['owner', 'admin', 'moderator'];
const MANAGE_ROLES: MembershipRole[] = ['owner', 'admin'];

function activeRole(membership: MaybeMembership): MembershipRole | null {
  return membership?.status === 'active' ? membership.role : null;
}

/**
 * Whether the actor may see that this classroom exists.
 *
 * A member always may. A non-member may only when the room is scoped to a
 * course they are enrolled in — an unlisted room is invisible without the
 * join code, which is what `classroom` visibility means.
 *
 * Callers turn a denial into **404, never 403**: telling someone they lack
 * access to classroom X confirms X exists.
 */
export function canViewClassroom(
  actor: MaybeActor,
  classroom: ClassroomRef,
  membership: MaybeMembership,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (activeRole(membership)) return allow('classroom_member');
  if (classroom.visibility === 'course') {
    return actor.courseIds.has(classroom.courseId)
      ? allow('enrolled_in_course')
      : deny('not_enrolled');
  }
  return deny('unlisted');
}

/**
 * Whether the actor may read the room's contents — lectures, materials, roster.
 *
 * Stricter than `canViewClassroom` on purpose. Discovering that a course has a
 * "Pediatrics — Group B" classroom is harmless; reading its lecture materials
 * before joining is not. Enrolment gets you the door, membership gets you the
 * room.
 */
export function canReadClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  return activeRole(membership) ? allow('classroom_member') : deny('not_classroom_member');
}

export interface JoinClassroomInput {
  classroom: ClassroomRef;
  membership: MaybeMembership;
  /** Whether the caller presented the room's join code. */
  hasValidJoinCode: boolean;
}

/**
 * Whether the actor may join.
 *
 * Two routes in, and they are different claims: enrolment in the course is a
 * standing fact the platform already knows, while a join code is a credential
 * the instructor handed out. An unlisted room accepts only the second.
 */
export function canJoinClassroom(actor: MaybeActor, input: JoinClassroomInput): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  if (input.membership?.status === 'active') return deny('already_member');
  // A ban survives leaving and rejoining; it is not a soft state.
  if (input.membership?.status === 'banned') return deny('banned');
  if (input.classroom.isArchived) return deny('archived');

  if (input.hasValidJoinCode) return allow('join_code');
  if (input.classroom.visibility === 'course') {
    return actor.courseIds.has(input.classroom.courseId)
      ? allow('enrolled_in_course')
      : deny('not_enrolled');
  }
  return deny('join_code_required');
}

/**
 * Whether the actor may leave.
 *
 * The instructor cannot walk out of their own classroom: a room whose only
 * owner has left has nobody who can publish, rename or archive it, and Phase
 * 3's audit found exactly that failure with groups (finding F1). The rule
 * lives here so both exits go through it.
 */
export function canLeaveClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  const role = activeRole(membership);
  if (!role) return deny('not_classroom_member');
  if (role === 'owner') return deny('owner_must_transfer_or_archive');
  return allow('may_leave');
}

/**
 * Whether the actor may open a classroom for a course.
 *
 * Two independent requirements, and the first one is what Phase 5c added:
 *
 *   1. global teaching eligibility — otherwise creating a room would be a way
 *      to *acquire* teaching authority rather than to exercise it, which is
 *      precisely the defect this phase closes. Ownership must follow from
 *      eligibility; eligibility must never follow from ownership.
 *   2. academic scope — the course must be one the actor is actually in.
 *      Without it a verified instructor could mint a room against any course
 *      id they could guess, in a college they have nothing to do with.
 *
 * The scope check reads `courseIds`, the same enrolment set every other course
 * decision uses, rather than introducing a second notion of "which courses is
 * this person attached to".
 */
export function canCreateClassroom(actor: MaybeActor, courseId: string): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  const academic = canTeachAcademically(actor);
  if (!academic.allowed) return academic;
  return actor.courseIds.has(courseId) ? allow('verified_and_in_course') : deny('not_in_course');
}

/**
 * Whether the actor may publish lectures and attach official materials.
 *
 * The one capability on both axes. A student who could add a lecture would make
 * "the instructor published this" meaningless, and that claim is the only
 * reason a classroom is more trustworthy than a group — but so would an
 * unverified owner, which is why contextual staffhood alone no longer suffices.
 *
 * Order of checks matters and is not cosmetic. Membership is tested first so
 * that a non-member gets `not_classroom_member`, which callers turn into 404;
 * revealing `not_verified_instructor` to someone outside the room would confirm
 * the room exists.
 */
export function canTeachInClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  const role = activeRole(membership);
  if (!role) return deny('not_classroom_member');
  if (!STAFF_ROLES.includes(role)) return deny('not_teaching_staff');

  // The global axis. Reached only once the contextual one has passed, so the
  // denial reason never leaks the existence of a room to an outsider.
  const academic = canTeachAcademically(actor);
  if (!academic.allowed) return academic;
  return allow(`role_${role}_${academic.reason}`);
}

/**
 * Whether the actor may run the room's roster, and see the facts that come
 * with running it — the join code, and lectures still in draft.
 *
 * Contextual only, and that is the deliberate half of the revocation
 * semantics: an owner stripped of instructor verification must still be able to
 * hand the room over, otherwise revoking a credential would strand every
 * student in it. Admitting and removing students is not an academic claim.
 */
export function canManageClassroomMembership(
  actor: MaybeActor,
  membership: MaybeMembership,
): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  const role = activeRole(membership);
  if (!role) return deny('not_classroom_member');
  return STAFF_ROLES.includes(role) ? allow(`role_${role}`) : deny('not_teaching_staff');
}

/** Rename, archive, rotate the join code, transfer ownership. Owner and admins. */
export function canManageClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  const role = activeRole(membership);
  if (!role) return deny('not_classroom_member');
  return MANAGE_ROLES.includes(role) ? allow(`role_${role}`) : deny('insufficient_role');
}

/**
 * Whether the actor may take part in the room — ask, answer, discuss.
 *
 * Any active member, including students, and no academic eligibility: a
 * classroom where only staff may speak is a broadcast channel, and the product
 * is a learning network. This is the capability that a de-verified instructor
 * still has, and that an ordinary student has always had.
 */
export function canParticipateInClassroom(
  actor: MaybeActor,
  membership: MaybeMembership,
): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  return activeRole(membership) ? allow('classroom_member') : deny('not_classroom_member');
}

export interface ClassroomCapabilities {
  isMember: boolean;
  role: MembershipRole | null;
  canRead: boolean;
  canJoin: boolean;
  canLeave: boolean;
  canParticipate: boolean;
  canManageMembership: boolean;
  canTeach: boolean;
  canManage: boolean;
}

/**
 * Every gate, resolved once, for projection to the client.
 *
 * The client renders from this and never recomputes it. That is what stops a
 * button existing that the server will refuse — and, since Phase 5c, what lets
 * a de-verified owner's screen show the archive control while hiding the
 * publish one, without the client knowing anything about verification levels.
 */
export function classroomCapabilities(
  actor: MaybeActor,
  classroom: ClassroomRef,
  membership: MaybeMembership,
  hasValidJoinCode = false,
): ClassroomCapabilities {
  const role = activeRole(membership);
  return {
    isMember: role !== null,
    role,
    canRead: canReadClassroom(actor, membership).allowed,
    canJoin: canJoinClassroom(actor, { classroom, membership, hasValidJoinCode }).allowed,
    canLeave: canLeaveClassroom(actor, membership).allowed,
    canParticipate: canParticipateInClassroom(actor, membership).allowed,
    canManageMembership: canManageClassroomMembership(actor, membership).allowed,
    canTeach: canTeachInClassroom(actor, membership).allowed,
    canManage: canManageClassroom(actor, membership).allowed,
  };
}
