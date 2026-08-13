import type { MembershipRole, MembershipStatus, Visibility } from '@sos/contracts';
import {
  allow,
  canRead,
  deny,
  isActive,
  isPlatformAdmin,
  type Actor,
  type Decision,
  type MaybeActor,
} from './actor.js';

/**
 * Group and community authorization.
 *
 * The distinction that shapes this file: **visibility governs who can find a
 * container; membership governs who can see inside it.** They are two separate
 * questions and conflating them is how a "private group" ends up listed in a
 * discovery surface with its post count visible.
 *
 * `visibility: 'group'` is the secret setting: the group is unlisted, and its
 * existence is only knowable to members and invitees.
 */

export type JoinPolicy = 'open' | 'request' | 'invite';

export interface GroupRef {
  id: string;
  communityId: string | null;
  courseId: string | null;
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  memberCount: number;
  maxMembers: number;
  /** Academic placement, copied at creation like content's. */
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
  archivedAt: Date | string | null;
}

export interface Membership {
  role: MembershipRole;
  status: MembershipStatus;
}

/** No row at all — never a member, never invited. */
export type MaybeMembership = Membership | null;

const MANAGE_ROLES: MembershipRole[] = ['owner', 'admin'];
const MODERATE_ROLES: MembershipRole[] = ['owner', 'admin', 'moderator'];

function isActiveMember(membership: MaybeMembership): boolean {
  return membership?.status === 'active';
}

/**
 * Whether the container's audience scope admits this actor.
 *
 * Shared by groups and communities because the scope vocabulary is the same
 * one content uses — one definition of "my cohort", not three.
 */
function scopeAdmits(actor: Actor, container: GroupRef, scope: Visibility): Decision {
  switch (scope) {
    case 'public':
      return allow('public');
    case 'university':
      return actor.universityId && actor.universityId === container.universityId
        ? allow('same_university')
        : deny('different_university');
    case 'college':
      return actor.collegeId && actor.collegeId === container.collegeId
        ? allow('same_college')
        : deny('different_college');
    case 'stage':
      return actor.collegeId === container.collegeId && actor.stageId === container.stageId
        ? allow('same_cohort')
        : deny('different_cohort');
    case 'course':
      return container.courseId && actor.courseIds.has(container.courseId)
        ? allow('enrolled_in_course')
        : deny('not_enrolled');
    case 'community':
      return container.communityId && actor.communityIds.has(container.communityId)
        ? allow('community_member')
        : deny('not_community_member');
    // A group scoped to itself is unlisted: only membership reveals it.
    case 'group':
    case 'classroom':
    case 'followers':
    case 'private':
      return deny('unlisted');
    default: {
      const never: never = scope;
      return deny(`unhandled_scope_${String(never)}`);
    }
  }
}

/**
 * Can the actor see that this group exists, and read its profile (name,
 * description, member count)?
 *
 * Seeing the group is NOT seeing its content — content inside a container is
 * gated on membership by `canViewContent`, which treats containers as hard
 * boundaries.
 */
export function canViewGroup(
  actor: MaybeActor,
  group: GroupRef,
  membership: MaybeMembership,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');

  // A banned member must not regain visibility by the group being discoverable.
  if (membership?.status === 'banned') return deny('banned_from_group');

  if (isActiveMember(membership)) return allow('member');
  if (membership?.status === 'invited') return allow('invited');
  if (isPlatformAdmin(actor)) return allow('platform_admin');

  return scopeAdmits(actor, group, group.visibility);
}

/** Discovery listings are narrower: an archived group is not something to join. */
export function canDiscoverGroup(
  actor: MaybeActor,
  group: GroupRef,
  membership: MaybeMembership,
): Decision {
  if (group.archivedAt !== null) return deny('group_archived');
  if (group.visibility === 'group') return deny('unlisted');
  return canViewGroup(actor, group, membership);
}

/**
 * Join eligibility.
 *
 * Returns the *outcome* as well as the decision, because "you may join" and
 * "you may ask to join" are different results that the UI must distinguish —
 * a button labelled "Join" that silently files a request is a small lie.
 */
export interface JoinDecision extends Decision {
  outcome: 'joined' | 'requested' | 'blocked';
}

export function canJoinGroup(
  actor: MaybeActor,
  group: GroupRef,
  membership: MaybeMembership,
): JoinDecision {
  const refuse = (reason: string): JoinDecision => ({
    allowed: false,
    reason,
    outcome: 'blocked',
  });

  if (!canRead(actor)) return refuse('unauthenticated');
  if (actor.status === 'restricted') return refuse('account_restricted');
  if (group.archivedAt !== null) return refuse('group_archived');
  if (membership?.status === 'banned') return refuse('banned_from_group');
  if (isActiveMember(membership)) return refuse('already_a_member');
  if (membership?.status === 'pending') return refuse('request_already_pending');

  // An invitation overrides both the join policy and the audience scope: being
  // invited IS the permission.
  if (membership?.status === 'invited') {
    if (group.memberCount >= group.maxMembers) return refuse('group_full');
    return { allowed: true, reason: 'invited', outcome: 'joined' };
  }

  const visible = canViewGroup(actor, group, membership);
  if (!visible.allowed) return refuse(visible.reason);

  if (group.joinPolicy === 'invite') return refuse('invite_only');
  if (group.memberCount >= group.maxMembers) return refuse('group_full');

  return group.joinPolicy === 'open'
    ? { allowed: true, reason: 'open_group', outcome: 'joined' }
    : { allowed: true, reason: 'request_required', outcome: 'requested' };
}

/** Posting requires active membership — not visibility, not an invitation. */
export function canPostInGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (!isActiveMember(membership)) return deny('not_group_member');
  return allow('member');
}

/** Settings, invites, promotion, archival. */
export function canManageGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (isPlatformAdmin(actor)) return allow('platform_admin');
  if (isActiveMember(membership) && MANAGE_ROLES.includes(membership!.role)) {
    return allow(`group_${membership!.role}`);
  }
  return deny('not_group_admin');
}

/** Approving join requests, removing members, removing content. */
export function canModerateGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (isPlatformAdmin(actor)) return allow('platform_admin');
  if (isActiveMember(membership) && MODERATE_ROLES.includes(membership!.role)) {
    return allow(`group_${membership!.role}`);
  }
  return deny('not_group_moderator');
}

/**
 * Removing another member.
 *
 * Rank matters: an admin cannot remove the owner, and a moderator cannot
 * remove an admin. Without this, promoting someone to moderator hands them the
 * power to remove the people who promoted them.
 */
export function canRemoveMember(
  actor: MaybeActor,
  actorMembership: MaybeMembership,
  targetMembership: Membership,
  targetUserId: string,
): Decision {
  if (!isActive(actor)) return deny('unauthenticated');

  // Leaving is always permitted, including for the owner — who must transfer
  // ownership first, enforced by the service.
  if (targetUserId === actor.userId) return allow('self_leave');

  const moderate = canModerateGroup(actor, actorMembership);
  if (!moderate.allowed) return moderate;
  if (isPlatformAdmin(actor)) return allow('platform_admin');

  if (rank(targetMembership.role) >= rank(actorMembership!.role)) {
    return deny('target_outranks_actor');
  }
  return allow('outranks_target');
}

/** Only the owner may hand ownership on, and only to an active member. */
export function canTransferOwnership(
  actor: MaybeActor,
  actorMembership: MaybeMembership,
  targetMembership: MaybeMembership,
): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (actorMembership?.role !== 'owner' || actorMembership.status !== 'active') {
    return deny('not_group_owner');
  }
  if (!isActiveMember(targetMembership)) return deny('target_not_a_member');
  return allow('owner');
}

function rank(role: MembershipRole): number {
  return { member: 0, moderator: 1, admin: 2, owner: 3 }[role];
}

// --- communities ------------------------------------------------------------

export interface CommunityRef {
  id: string;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
  courseId: string | null;
  visibility: Visibility;
  isOfficial: boolean;
  archivedAt: Date | string | null;
}

/**
 * Communities are discovery surfaces, so they are deliberately softer than
 * groups: an in-scope student can see a community and its public content
 * without joining. Joining is what puts it in their feed and lets them post.
 */
export function canViewCommunity(actor: MaybeActor, community: CommunityRef): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (isPlatformAdmin(actor)) return allow('platform_admin');

  return scopeAdmits(
    actor,
    {
      id: community.id,
      communityId: community.id,
      courseId: community.courseId,
      visibility: community.visibility,
      joinPolicy: 'open',
      memberCount: 0,
      maxMembers: 0,
      universityId: community.universityId,
      collegeId: community.collegeId,
      stageId: community.stageId,
      archivedAt: community.archivedAt,
    },
    community.visibility,
  );
}

export function canJoinCommunity(
  actor: MaybeActor,
  community: CommunityRef,
  membership: MaybeMembership,
): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (community.archivedAt !== null) return deny('community_archived');
  if (membership?.status === 'banned') return deny('banned_from_community');
  if (isActiveMember(membership)) return deny('already_a_member');
  return canViewCommunity(actor, community);
}

/** Only members post into a community, even one they can see. */
export function canPostInCommunity(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (!isActiveMember(membership)) return deny('not_community_member');
  return allow('member');
}
