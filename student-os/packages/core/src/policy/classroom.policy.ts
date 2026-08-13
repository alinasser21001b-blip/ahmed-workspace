import { allow, canRead, deny, isActive, type Decision, type MaybeActor } from './actor.js';
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
 */

export interface ClassroomRef {
  id: string;
  courseId: string;
  instructorId: string | null;
  /** `course` — discoverable by anyone enrolled. `classroom` — unlisted. */
  visibility: Visibility;
  isArchived: boolean;
}

const TEACH_ROLES: MembershipRole[] = ['owner', 'admin', 'moderator'];
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
 * Whether the actor may publish lectures and attach materials.
 *
 * The instructor and their teaching assistants. A student who could add a
 * lecture would make "the instructor published this" meaningless, and that
 * claim is the only reason a classroom is more trustworthy than a group.
 */
export function canTeachInClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  const role = activeRole(membership);
  if (!role) return deny('not_classroom_member');
  return TEACH_ROLES.includes(role) ? allow(`role_${role}`) : deny('not_teaching_staff');
}

/** Rename, archive, rotate the join code, change membership. Owner and admins. */
export function canManageClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  const role = activeRole(membership);
  if (!role) return deny('not_classroom_member');
  return MANAGE_ROLES.includes(role) ? allow(`role_${role}`) : deny('insufficient_role');
}

/**
 * Whether the actor may post a discussion message in the room.
 *
 * Any active member, including students — a classroom where only staff may
 * speak is a broadcast channel, and the product is a learning network.
 */
export function canPostInClassroom(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  return activeRole(membership) ? allow('classroom_member') : deny('not_classroom_member');
}

export interface ClassroomCapabilities {
  isMember: boolean;
  role: MembershipRole | null;
  canRead: boolean;
  canJoin: boolean;
  canLeave: boolean;
  canTeach: boolean;
  canManage: boolean;
}

/**
 * Every gate, resolved once, for projection to the client.
 *
 * The client renders from this and never recomputes it. That is what stops a
 * button existing that the server will refuse.
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
    canTeach: canTeachInClassroom(actor, membership).allowed,
    canManage: canManageClassroom(actor, membership).allowed,
  };
}
