import { describe, expect, it } from 'vitest';
import type { Actor } from '../actor.js';
import {
  canDiscoverGroup,
  canCommentInGroup,
  canInviteToGroup,
  canJoinCommunity,
  canJoinGroup,
  canLeaveGroup,
  canManageGroup,
  canModerateGroup,
  canPostInCommunity,
  canPostInGroup,
  canRemoveMember,
  canTransferOwnership,
  canReadInGroup,
  canViewCommunity,
  canViewGroup,
  canWriteInGroup,
  groupCapabilities,
  impliedMembership,
  type CommunityRef,
  type GroupRef,
  type Membership,
} from '../membership.policy.js';

/**
 * Phase 3 permissions, written before the implementation (§87 step 5).
 *
 * The rule under test throughout: **visibility governs who can find a
 * container; membership governs who can see inside it.**
 */

const COHORT = { universityId: 'u1', collegeId: 'c1', stageId: 's5' };

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'alice',
    role: 'student',
    status: 'active',
    verificationLevel: 'student',
    universityId: COHORT.universityId,
    collegeId: COHORT.collegeId,
    programId: 'p1',
    stageId: COHORT.stageId,
    courseIds: new Set(),
    communityIds: new Set(),
    groupIds: new Set(),
    classroomIds: new Set(),
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

function group(overrides: Partial<GroupRef> = {}): GroupRef {
  return {
    id: 'g1',
    communityId: null,
    courseId: null,
    visibility: 'stage',
    joinPolicy: 'request',
    memberCount: 3,
    maxMembers: 50,
    universityId: COHORT.universityId,
    collegeId: COHORT.collegeId,
    stageId: COHORT.stageId,
    archivedAt: null,
    ...overrides,
  };
}

const member = (overrides: Partial<Membership> = {}): Membership => ({
  role: 'member',
  status: 'active',
  ...overrides,
});

describe('canViewGroup', () => {
  it('lets a cohort-mate see a stage-scoped group', () => {
    expect(canViewGroup(actor(), group(), null)).toMatchObject({ allowed: true });
  });

  it('hides a stage-scoped group from another stage', () => {
    expect(canViewGroup(actor({ stageId: 's4' }), group(), null).allowed).toBe(false);
  });

  it('keeps an unlisted group invisible to non-members, whatever their cohort', () => {
    // `visibility: 'group'` is the secret setting. Being a cohort-mate,
    // enrolled, or in the parent community must not reveal it.
    const secret = group({ visibility: 'group', communityId: 'comm1', courseId: 'course1' });
    const wellConnected = actor({
      communityIds: new Set(['comm1']),
      courseIds: new Set(['course1']),
    });
    expect(canViewGroup(wellConnected, secret, null)).toMatchObject({
      allowed: false,
      reason: 'unlisted',
    });
  });

  it('reveals an unlisted group to its members and to invitees', () => {
    const secret = group({ visibility: 'group' });
    expect(canViewGroup(actor(), secret, member()).allowed).toBe(true);
    expect(canViewGroup(actor(), secret, member({ status: 'invited' })).allowed).toBe(true);
  });

  it('keeps a banned member out even when the group is discoverable', () => {
    expect(canViewGroup(actor(), group(), member({ status: 'banned' }))).toMatchObject({
      allowed: false,
      reason: 'banned_from_group',
    });
  });

  it('gates a course-scoped group on enrolment', () => {
    const g = group({ visibility: 'course', courseId: 'course1' });
    expect(canViewGroup(actor(), g, null).allowed).toBe(false);
    expect(canViewGroup(actor({ courseIds: new Set(['course1']) }), g, null).allowed).toBe(true);
  });
});

describe('canDiscoverGroup', () => {
  it('excludes unlisted and archived groups from discovery', () => {
    expect(canDiscoverGroup(actor(), group({ visibility: 'group' }), null).allowed).toBe(false);
    expect(canDiscoverGroup(actor(), group({ archivedAt: new Date() }), null).allowed).toBe(false);
  });

  it('still lists a joinable in-scope group', () => {
    expect(canDiscoverGroup(actor(), group(), null).allowed).toBe(true);
  });
});

describe('canJoinGroup', () => {
  it('joins an open group immediately', () => {
    expect(canJoinGroup(actor(), group({ joinPolicy: 'open' }), null)).toMatchObject({
      allowed: true,
      outcome: 'joined',
    });
  });

  it('files a request for a request-policy group', () => {
    // "Join" and "Ask to join" are different outcomes and the UI must be able
    // to say which one the button does.
    expect(canJoinGroup(actor(), group({ joinPolicy: 'request' }), null)).toMatchObject({
      allowed: true,
      outcome: 'requested',
    });
  });

  it('refuses an invite-only group without an invitation', () => {
    expect(canJoinGroup(actor(), group({ joinPolicy: 'invite' }), null)).toMatchObject({
      allowed: false,
      reason: 'invite_only',
    });
  });

  it('lets an invitation override both the policy and the audience scope', () => {
    const outOfScope = group({ joinPolicy: 'invite', visibility: 'group', stageId: 's4' });
    expect(canJoinGroup(actor(), outOfScope, member({ status: 'invited' }))).toMatchObject({
      allowed: true,
      outcome: 'joined',
    });
  });

  it('refuses when the group is full, archived, or the actor is banned', () => {
    expect(canJoinGroup(actor(), group({ memberCount: 50, maxMembers: 50 }), null).reason).toBe(
      'group_full',
    );
    expect(canJoinGroup(actor(), group({ archivedAt: new Date() }), null).reason).toBe(
      'group_archived',
    );
    expect(canJoinGroup(actor(), group(), member({ status: 'banned' })).reason).toBe(
      'banned_from_group',
    );
  });

  it('refuses a duplicate join or a duplicate request', () => {
    expect(canJoinGroup(actor(), group(), member()).reason).toBe('already_a_member');
    expect(canJoinGroup(actor(), group(), member({ status: 'pending' })).reason).toBe(
      'request_already_pending',
    );
  });

  it('refuses a restricted account', () => {
    expect(canJoinGroup(actor({ status: 'restricted' }), group(), null).reason).toBe(
      'account_restricted',
    );
  });

  it('refuses a full group even to an invitee', () => {
    const full = group({ memberCount: 50, maxMembers: 50 });
    expect(canJoinGroup(actor(), full, member({ status: 'invited' })).reason).toBe('group_full');
  });
});

describe('posting', () => {
  it('requires active membership, not mere visibility', () => {
    expect(canPostInGroup(actor(), null).allowed).toBe(false);
    expect(canPostInGroup(actor(), member({ status: 'invited' })).allowed).toBe(false);
    expect(canPostInGroup(actor(), member({ status: 'pending' })).allowed).toBe(false);
    expect(canPostInGroup(actor(), member()).allowed).toBe(true);
  });

  it('blocks a restricted account from posting while it can still read', () => {
    expect(canPostInGroup(actor({ status: 'restricted' }), member())).toMatchObject({
      allowed: false,
      reason: 'account_restricted',
    });
  });
});

describe('group management', () => {
  it('limits settings changes to owner and admin', () => {
    expect(canManageGroup(actor(), member({ role: 'owner' })).allowed).toBe(true);
    expect(canManageGroup(actor(), member({ role: 'admin' })).allowed).toBe(true);
    expect(canManageGroup(actor(), member({ role: 'moderator' })).allowed).toBe(false);
    expect(canManageGroup(actor(), member()).allowed).toBe(false);
  });

  it('extends moderation to moderators', () => {
    expect(canModerateGroup(actor(), member({ role: 'moderator' })).allowed).toBe(true);
    expect(canModerateGroup(actor(), member()).allowed).toBe(false);
  });

  it('grants a platform admin both', () => {
    const admin = actor({ role: 'admin' });
    expect(canManageGroup(admin, null).allowed).toBe(true);
    expect(canModerateGroup(admin, null).allowed).toBe(true);
  });
});

describe('canLeaveGroup', () => {
  it('lets an ordinary member leave', () => {
    expect(canLeaveGroup(actor(), member(), { memberCount: 5 })).toMatchObject({
      allowed: true,
      reason: 'self_leave',
    });
  });

  it('refuses to let an owner strand a populated group', () => {
    expect(canLeaveGroup(actor(), member({ role: 'owner' }), { memberCount: 2 })).toMatchObject({
      allowed: false,
      reason: 'owner_must_transfer_first',
    });
  });

  it('lets a sole owner leave, because there is nothing left to strand', () => {
    expect(canLeaveGroup(actor(), member({ role: 'owner' }), { memberCount: 1 }).allowed).toBe(true);
  });

  it('refuses someone who is not an active member', () => {
    expect(canLeaveGroup(actor(), null, { memberCount: 5 }).allowed).toBe(false);
    expect(canLeaveGroup(actor(), member({ status: 'pending' }), { memberCount: 5 }).allowed).toBe(
      false,
    );
  });
});

describe('canRemoveMember', () => {
  const group = { memberCount: 5 };

  it('lets a member remove themselves — which is leaving', () => {
    expect(canRemoveMember(actor(), member(), member(), 'alice', group)).toMatchObject({
      allowed: true,
      reason: 'self_leave',
    });
  });

  /*
   * The bug this pins down: the strand rule used to live only in the service
   * method behind `DELETE /membership`, so removing yourself through
   * `DELETE /members/<own handle>` walked past it and left the group with zero
   * owners — unmanageable, and unrecoverable through any product action.
   */
  it('holds an owner removing themselves to the same rule as leaving', () => {
    expect(
      canRemoveMember(actor(), member({ role: 'owner' }), member({ role: 'owner' }), 'alice', {
        memberCount: 2,
      }),
    ).toMatchObject({ allowed: false, reason: 'owner_must_transfer_first' });
  });

  it('refuses to let a moderator remove an admin', () => {
    // Otherwise promoting someone to moderator hands them the power to remove
    // the people who promoted them.
    expect(
      canRemoveMember(
        actor(),
        member({ role: 'moderator' }),
        member({ role: 'admin' }),
        'bob',
        group,
      ),
    ).toMatchObject({ allowed: false, reason: 'target_outranks_actor' });
  });

  it('refuses to let an admin remove the owner', () => {
    expect(
      canRemoveMember(actor(), member({ role: 'admin' }), member({ role: 'owner' }), 'bob', group)
        .allowed,
    ).toBe(false);
  });

  it('refuses to let peers remove each other', () => {
    expect(
      canRemoveMember(actor(), member({ role: 'admin' }), member({ role: 'admin' }), 'bob', group)
        .allowed,
    ).toBe(false);
  });

  it('lets an admin remove a plain member', () => {
    expect(
      canRemoveMember(actor(), member({ role: 'admin' }), member(), 'bob', group).allowed,
    ).toBe(true);
  });

  it('refuses a plain member removing anyone else', () => {
    expect(canRemoveMember(actor(), member(), member(), 'bob', group).allowed).toBe(false);
  });
});

describe('canTransferOwnership', () => {
  it('permits only the owner, and only to an active member', () => {
    expect(canTransferOwnership(actor(), member({ role: 'owner' }), member()).allowed).toBe(true);
    expect(canTransferOwnership(actor(), member({ role: 'admin' }), member()).allowed).toBe(false);
    expect(
      canTransferOwnership(actor(), member({ role: 'owner' }), member({ status: 'invited' })).allowed,
    ).toBe(false);
    expect(canTransferOwnership(actor(), member({ role: 'owner' }), null).allowed).toBe(false);
  });
});

describe('communities', () => {
  function community(overrides: Partial<CommunityRef> = {}): CommunityRef {
    return {
      id: 'comm1',
      universityId: COHORT.universityId,
      collegeId: COHORT.collegeId,
      stageId: COHORT.stageId,
      courseId: null,
      visibility: 'stage',
      isOfficial: true,
      archivedAt: null,
      ...overrides,
    };
  }

  it('lets an in-scope student see a community without joining', () => {
    // Communities are discovery surfaces; groups are not.
    expect(canViewCommunity(actor(), community()).allowed).toBe(true);
  });

  it('hides a community from another cohort', () => {
    expect(canViewCommunity(actor({ stageId: 's4' }), community()).allowed).toBe(false);
  });

  it('refuses to join an archived community or one already joined', () => {
    expect(canJoinCommunity(actor(), community({ archivedAt: new Date() }), null).reason).toBe(
      'community_archived',
    );
    expect(canJoinCommunity(actor(), community(), member()).reason).toBe('already_a_member');
  });

  it('requires membership to post, even in a visible community', () => {
    expect(canPostInCommunity(actor(), null).allowed).toBe(false);
    expect(canPostInCommunity(actor(), member()).allowed).toBe(true);
  });
});

/*
 * The gate vocabulary, named and kept apart.
 *
 * These exist as separate functions rather than as one `hasAccess` boolean
 * because they answer different questions, and the tests below are what stop
 * someone helpfully collapsing them later.
 */
describe('the named gates', () => {
  it('separates seeing a group from reading inside it', () => {
    const g = group({ visibility: 'stage' });

    // An in-scope non-member sees the group and not its contents.
    expect(canViewGroup(actor(), g, null).allowed).toBe(true);
    expect(canReadInGroup(actor(), null).allowed).toBe(false);

    // An invitee sees it and a way in — not the conversation they have not
    // accepted yet.
    expect(canViewGroup(actor(), g, member({ status: 'invited' })).allowed).toBe(true);
    expect(canReadInGroup(actor(), member({ status: 'invited' })).allowed).toBe(false);

    expect(canReadInGroup(actor(), member()).allowed).toBe(true);
  });

  it('separates reading from writing for a restricted account', () => {
    // The distinction restriction exists to make: they keep reading, they stop
    // producing. Collapsing read and write into one gate erases it.
    const restricted = actor({ status: 'restricted' });
    expect(canReadInGroup(restricted, member()).allowed).toBe(true);
    expect(canWriteInGroup(restricted, member()).allowed).toBe(false);
    expect(canPostInGroup(restricted, member()).allowed).toBe(false);
    expect(canCommentInGroup(restricted, member()).allowed).toBe(false);
  });

  it('separates inviting from moderating', () => {
    // A moderator approves the people who asked; they do not get to choose the
    // membership. Otherwise promoting a moderator hands them an audience.
    const moderator = member({ role: 'moderator' });
    expect(canModerateGroup(actor(), moderator).allowed).toBe(true);
    expect(canInviteToGroup(actor(), moderator).allowed).toBe(false);
    expect(canInviteToGroup(actor(), member({ role: 'admin' })).allowed).toBe(true);
  });

  it('closes every gate for a banned member, including the ones membership implies', () => {
    const banned = member({ status: 'banned' });
    const caps = groupCapabilities(actor(), group({ visibility: 'public' }), banned);
    for (const [name, decision] of Object.entries(caps)) {
      expect(decision.allowed, name).toBe(false);
    }
  });

  it('reports each gate separately rather than as one verdict', () => {
    const caps = groupCapabilities(actor(), group({ visibility: 'stage' }), null);
    expect(caps.canView.allowed).toBe(true);
    expect(caps.canJoin.allowed).toBe(true);
    expect(caps.canRead.allowed).toBe(false);
    expect(caps.canWrite.allowed).toBe(false);
    expect(caps.canManage.allowed).toBe(false);
  });
});

describe('impliedMembership', () => {
  /*
   * The Actor carries only active memberships, so presence in the set is an
   * exact answer for status and a lower bound for role. It exists so a caller
   * holding an Actor asks the policy instead of reaching into `actor.groupIds`
   * and deciding for itself — the duplication ADR-0003 forbids.
   */
  it('derives an active membership from the actor\'s sets', () => {
    const a = actor({ groupIds: new Set(['g1']) });
    expect(impliedMembership(a, 'g1', 'group')).toEqual({ role: 'member', status: 'active' });
    expect(impliedMembership(a, 'g2', 'group')).toBeNull();
  });

  it('is enough for the write gates', () => {
    const a = actor({ groupIds: new Set(['g1']) });
    expect(canPostInGroup(a, impliedMembership(a, 'g1', 'group')).allowed).toBe(true);
    expect(canPostInGroup(a, impliedMembership(a, 'g2', 'group')).allowed).toBe(false);
  });

  it('never implies a management role, which must load the real row', () => {
    const a = actor({ groupIds: new Set(['g1']) });
    expect(canManageGroup(a, impliedMembership(a, 'g1', 'group')).allowed).toBe(false);
  });

  it('gives an unauthenticated actor nothing', () => {
    expect(impliedMembership(null, 'g1', 'group')).toBeNull();
  });
});
