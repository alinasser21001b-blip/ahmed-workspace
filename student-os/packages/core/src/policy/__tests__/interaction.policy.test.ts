import { describe, expect, it } from 'vitest';
import type { Actor } from '../actor.js';
import {
  canAccessFile,
  canDiscoverProfile,
  canMessage,
  canModerate,
  canSeeLastSeen,
  canViewProfile,
  type FileRef,
  type TargetUserRef,
} from '../interaction.policy.js';

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'alice',
    role: 'student',
    status: 'active',
    verificationLevel: 'student',
    universityId: 'u1',
    collegeId: 'c1',
    programId: 'p1',
    stageId: 's5',
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

function target(overrides: Partial<TargetUserRef> = {}): TargetUserRef {
  return {
    userId: 'bob',
    universityId: 'u1',
    collegeId: 'c1',
    stageId: 's5',
    profileVisibility: 'stage',
    whoCanMessage: 'stage',
    searchable: true,
    showOnlineStatus: true,
    showLastSeen: true,
    status: 'active',
    followsActor: false,
    ...overrides,
  };
}

describe('canViewProfile', () => {
  it('allows cohort-mates by default', () => {
    expect(canViewProfile(actor(), target()).allowed).toBe(true);
  });

  it('respects a tightened profile visibility', () => {
    expect(canViewProfile(actor(), target({ profileVisibility: 'private' })).allowed).toBe(false);
  });

  it('hides profiles across blocks in both directions', () => {
    expect(canViewProfile(actor({ blockedUserIds: new Set(['bob']) }), target()).allowed).toBe(false);
    expect(canViewProfile(actor({ blockedByUserIds: new Set(['bob']) }), target()).allowed).toBe(false);
  });

  it('always lets a user see their own profile', () => {
    expect(canViewProfile(actor({ userId: 'bob' }), target({ profileVisibility: 'private' }))).toMatchObject(
      { allowed: true, reason: 'self' },
    );
  });

  it('hides deleted accounts from everyone, admins included', () => {
    expect(canViewProfile(actor({ role: 'admin' }), target({ status: 'deleted' })).allowed).toBe(false);
  });
});

describe('canMessage', () => {
  it('allows a cohort-mate under the default setting', () => {
    expect(canMessage(actor(), target()).allowed).toBe(true);
  });

  it('denies when the target restricts messages to people they follow', () => {
    const strict = target({ whoCanMessage: 'followers', followsActor: false });
    expect(canMessage(actor(), strict)).toMatchObject({
      allowed: false,
      reason: 'not_followed_by_target',
    });
    expect(canMessage(actor(), { ...strict, followsActor: true }).allowed).toBe(true);
  });

  it('denies messaging a suspended account', () => {
    expect(canMessage(actor(), target({ status: 'suspended' })).allowed).toBe(false);
  });

  it('denies messaging yourself', () => {
    expect(canMessage(actor({ userId: 'bob' }), target()).allowed).toBe(false);
  });

  it('denies across a block', () => {
    expect(canMessage(actor({ blockedByUserIds: new Set(['bob']) }), target()).allowed).toBe(false);
  });
});

describe('discovery and presence privacy', () => {
  it('removes non-searchable users from discovery without hiding the profile itself', () => {
    const hidden = target({ searchable: false });
    expect(canDiscoverProfile(actor(), hidden).allowed).toBe(false);
    expect(canViewProfile(actor(), hidden).allowed).toBe(true);
  });

  it('honours last-seen opt-out', () => {
    expect(canSeeLastSeen(actor(), target({ showLastSeen: false })).allowed).toBe(false);
  });
});

describe('canModerate', () => {
  it('grants platform admins moderation anywhere', () => {
    expect(canModerate(actor({ role: 'admin' }), 'g1').allowed).toBe(true);
  });

  it('grants container moderators only their own container', () => {
    expect(canModerate(actor(), 'g1', new Set(['g1'])).allowed).toBe(true);
    expect(canModerate(actor(), 'g2', new Set(['g1'])).allowed).toBe(false);
  });

  it('grants a global instructor role nothing by itself', () => {
    // Being an instructor somewhere is not authority everywhere.
    expect(canModerate(actor({ role: 'instructor' }), 'g1').allowed).toBe(false);
  });
});

describe('canAccessFile', () => {
  function file(overrides: Partial<FileRef> = {}): FileRef {
    return {
      id: 'f1',
      ownerId: 'bob',
      visibility: 'private',
      courseId: null,
      communityId: null,
      groupId: null,
      classroomId: null,
      collegeId: 'c1',
      stageId: 's5',
      universityId: 'u1',
      deletedAt: null,
      ...overrides,
    };
  }

  it('lets the owner access their private file', () => {
    expect(canAccessFile(actor({ userId: 'bob' }), file()).allowed).toBe(true);
  });

  it('denies everyone else a private file', () => {
    expect(canAccessFile(actor(), file()).allowed).toBe(false);
  });

  it('gates a group file on group membership', () => {
    const f = file({ visibility: 'group', groupId: 'g1' });
    expect(canAccessFile(actor(), f).allowed).toBe(false);
    expect(canAccessFile(actor({ groupIds: new Set(['g1']) }), f).allowed).toBe(true);
  });

  it('gates a classroom file on classroom membership', () => {
    const f = file({ visibility: 'classroom', classroomId: 'r1' });
    expect(canAccessFile(actor(), f).allowed).toBe(false);
    expect(canAccessFile(actor({ classroomIds: new Set(['r1']) }), f).allowed).toBe(true);
  });

  it('denies a deleted file even to its owner', () => {
    expect(canAccessFile(actor({ userId: 'bob' }), file({ deletedAt: new Date() })).allowed).toBe(false);
  });
});
