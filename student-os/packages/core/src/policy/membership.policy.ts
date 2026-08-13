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

/**
 * Reading the content *inside* a group.
 *
 * Distinct from `canViewGroup`, and the distinction is the whole point: seeing
 * that a study group exists is not seeing what was said in it. Only active
 * membership opens the container. An invitee sees the shell and a way in; they
 * do not see the conversation they have not accepted yet.
 *
 * `canViewContent`'s container check is the enforcement point for individual
 * items; this is the same rule stated at the container level, for surfaces that
 * decide before they query.
 */
export function canReadInGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (membership?.status === 'banned') return deny('banned_from_group');
  if (!isActiveMember(membership)) return deny('not_group_member');
  return allow('member');
}

/**
 * The base write gate for a container: may this actor produce anything inside
 * it at all?
 *
 * `canPostInGroup` and `canCommentInGroup` are defined in terms of this rather
 * than being aliases of it, because they are different product questions and
 * will diverge: an announcements group admits comments from members while
 * restricting posts to moderators. Collapsing them into one boolean today is
 * what makes that change a rewrite instead of an edit.
 *
 * Until a per-group posting policy exists in the schema, all three agree. That
 * is a fact about the current product, not about the shape of the policy.
 */
export function canWriteInGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (membership?.status === 'banned') return deny('banned_from_group');
  if (!isActiveMember(membership)) return deny('not_group_member');
  return allow('member');
}

/** Creating top-level content in a group. */
export function canPostInGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  return canWriteInGroup(actor, membership);
}

/** Replying to content already inside a group. */
export function canCommentInGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  return canWriteInGroup(actor, membership);
}

/**
 * Inviting someone in.
 *
 * A management action, not a moderation one. A moderator approves the people
 * who asked; they do not get to choose the membership. Without that split,
 * promoting a moderator hands them the ability to populate the group with an
 * audience of their own.
 */
export function canInviteToGroup(actor: MaybeActor, membership: MaybeMembership): Decision {
  return canManageGroup(actor, membership);
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
 * Leaving under one's own steam.
 *
 * The owner of a populated group may not simply walk out: the group would be
 * left with nobody able to approve a request, promote a replacement, or archive
 * it — a permanently unmanageable state that no in-product action can undo.
 * They transfer ownership first, or archive.
 *
 * A sole owner leaving is fine; there is nothing left to strand, and the
 * service archives the empty group behind them.
 *
 * This lives in the policy rather than in one service method because there are
 * two routes out of a group — `DELETE /membership` and
 * `DELETE /members/:ownHandle` — and a guard written on only one of them is a
 * guard that does not exist.
 */
export function canLeaveGroup(
  actor: MaybeActor,
  membership: MaybeMembership,
  group: Pick<GroupRef, 'memberCount'>,
): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (!membership) return deny('not_group_member');
  if (membership.status !== 'active') return deny('not_group_member');
  if (membership.role === 'owner' && group.memberCount > 1) {
    return deny('owner_must_transfer_first');
  }
  return allow('self_leave');
}

/**
 * Removing a member — someone else, or oneself.
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
  group: Pick<GroupRef, 'memberCount'>,
): Decision {
  if (!isActive(actor)) return deny('unauthenticated');

  // Removing yourself IS leaving, and is held to the same rule whichever
  // endpoint it arrives through.
  if (targetUserId === actor.userId) return canLeaveGroup(actor, actorMembership, group);

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

/**
 * Every named gate for one container, resolved once.
 *
 * The gates stay **separate Decisions**, each with its own reason code. They are
 * deliberately not reduced to a single `hasAccess` boolean: "may see it exists",
 * "may read inside it", "may write in it" and "may administer it" are four
 * different questions, and every product that has collapsed them has shipped
 * the bug where being able to find something implied being able to open it.
 *
 * This is the object every surface consumes — REST, feed, search, group detail,
 * the member list, and (Phase 4) conversations. Surfaces project it; they do not
 * re-derive it.
 */
export interface GroupCapabilities {
  canDiscover: Decision;
  canView: Decision;
  canRead: Decision;
  canWrite: Decision;
  canPost: Decision;
  canComment: Decision;
  canJoin: JoinDecision;
  canLeave: Decision;
  canInvite: Decision;
  canManage: Decision;
  canModerate: Decision;
}

export function groupCapabilities(
  actor: MaybeActor,
  group: GroupRef,
  membership: MaybeMembership,
): GroupCapabilities {
  return {
    canDiscover: canDiscoverGroup(actor, group, membership),
    canView: canViewGroup(actor, group, membership),
    canRead: canReadInGroup(actor, membership),
    canWrite: canWriteInGroup(actor, membership),
    canPost: canPostInGroup(actor, membership),
    canComment: canCommentInGroup(actor, membership),
    canJoin: canJoinGroup(actor, group, membership),
    canLeave: canLeaveGroup(actor, membership, group),
    canInvite: canInviteToGroup(actor, membership),
    canManage: canManageGroup(actor, membership),
    canModerate: canModerateGroup(actor, membership),
  };
}

/**
 * The membership an Actor implies for a container it belongs to.
 *
 * `loadActor` populates the membership sets from `status = 'active'` rows only,
 * so presence in the set is an exact answer for *status* and a lower bound for
 * *role*. That is sufficient for every read and write gate, and insufficient for
 * every management gate — which is why those load the real row.
 *
 * It exists so that a caller holding only an Actor can still ask the policy
 * rather than reaching into `actor.groupIds` and re-deciding for itself.
 */
export function impliedMembership(
  actor: MaybeActor,
  containerId: string,
  kind: 'group' | 'community' | 'classroom' | 'course',
): MaybeMembership {
  if (!canRead(actor)) return null;
  const set =
    kind === 'group'
      ? actor.groupIds
      : kind === 'community'
        ? actor.communityIds
        : kind === 'classroom'
          ? actor.classroomIds
          : actor.courseIds;
  return set.has(containerId) ? { role: 'member', status: 'active' } : null;
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

/**
 * Only members write into a community, even one they can see.
 *
 * Reading is not gated here on purpose: a community is a discovery surface, so
 * an in-scope student reads its non-`community`-visibility content without
 * joining. That asymmetry with groups is the product decision, stated once.
 */
export function canWriteInCommunity(actor: MaybeActor, membership: MaybeMembership): Decision {
  if (!canRead(actor)) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (membership?.status === 'banned') return deny('banned_from_community');
  if (!isActiveMember(membership)) return deny('not_community_member');
  return allow('member');
}

export function canPostInCommunity(actor: MaybeActor, membership: MaybeMembership): Decision {
  return canWriteInCommunity(actor, membership);
}

export function canCommentInCommunity(actor: MaybeActor, membership: MaybeMembership): Decision {
  return canWriteInCommunity(actor, membership);
}
