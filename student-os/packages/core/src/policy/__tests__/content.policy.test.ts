import { describe, expect, it } from 'vitest';
import {
  canCreateContent,
  canDeleteContent,
  canEditContent,
  canViewContent,
  visibilityScopesFor,
  type ContentRef,
} from '../content.policy.js';
import type { Actor } from '../actor.js';

/**
 * These are the security tests demanded by §81. They are deliberately unit
 * tests over pure functions: a permission rule that can only be checked by
 * standing up a server and a database is a rule that will not be checked
 * often enough.
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

function content(overrides: Partial<ContentRef> = {}): ContentRef {
  return {
    id: 'k1',
    authorId: 'bob',
    visibility: 'stage',
    universityId: COHORT.universityId,
    collegeId: COHORT.collegeId,
    stageId: COHORT.stageId,
    courseId: null,
    communityId: null,
    groupId: null,
    classroomId: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('canViewContent — cohort scoping', () => {
  it('allows a cohort-mate to see stage-scoped content', () => {
    expect(canViewContent(actor(), content())).toMatchObject({ allowed: true, reason: 'same_cohort' });
  });

  it('denies a student in another stage of the same college', () => {
    const outsider = actor({ userId: 'carol', stageId: 's4' });
    expect(canViewContent(outsider, content())).toMatchObject({
      allowed: false,
      reason: 'different_cohort',
    });
  });

  it('denies a student in another college entirely', () => {
    const outsider = actor({ userId: 'dan', collegeId: 'c2' });
    expect(canViewContent(outsider, content()).allowed).toBe(false);
  });

  it('allows anyone in the university for university-scoped content', () => {
    const other = actor({ userId: 'erin', collegeId: 'c9', stageId: 's1' });
    expect(canViewContent(other, content({ visibility: 'university' })).allowed).toBe(true);
  });
});

describe('canViewContent — containers are hard boundaries', () => {
  it('hides group content from non-members even when visibility is broader', () => {
    // The regression this test exists for: a post inside a private group that
    // carries visibility 'stage' must NOT leak to the cohort feed.
    const nonMember = actor();
    const leaky = content({ groupId: 'g1', visibility: 'stage' });
    expect(canViewContent(nonMember, leaky)).toMatchObject({
      allowed: false,
      reason: 'not_group_member',
    });
  });

  it('shows group content to members', () => {
    const member = actor({ groupIds: new Set(['g1']) });
    expect(canViewContent(member, content({ groupId: 'g1', visibility: 'group' })).allowed).toBe(true);
  });

  it('hides classroom content from non-members regardless of visibility', () => {
    const nonMember = actor();
    expect(
      canViewContent(nonMember, content({ classroomId: 'r1', visibility: 'public' })).allowed,
    ).toBe(false);
  });
});

describe('canViewContent — course scope', () => {
  it('allows enrolled students', () => {
    const enrolled = actor({ courseIds: new Set(['course-ped']) });
    expect(
      canViewContent(enrolled, content({ visibility: 'course', courseId: 'course-ped' })).allowed,
    ).toBe(true);
  });

  it('denies students not enrolled, even in the same cohort', () => {
    expect(
      canViewContent(actor(), content({ visibility: 'course', courseId: 'course-ped' })),
    ).toMatchObject({ allowed: false, reason: 'not_enrolled' });
  });
});

describe('canViewContent — blocking is bidirectional', () => {
  it('hides content from a user the actor blocked', () => {
    const a = actor({ blockedUserIds: new Set(['bob']) });
    expect(canViewContent(a, content({ authorId: 'bob' }))).toMatchObject({
      allowed: false,
      reason: 'blocked',
    });
  });

  it('hides content from a user who blocked the actor', () => {
    const a = actor({ blockedByUserIds: new Set(['bob']) });
    expect(canViewContent(a, content({ authorId: 'bob' })).allowed).toBe(false);
  });

  it('blocking outranks platform admin, except on the admin’s own content', () => {
    const admin = actor({ role: 'admin', blockedByUserIds: new Set(['bob']) });
    expect(canViewContent(admin, content({ authorId: 'bob' })).allowed).toBe(false);
  });
});

describe('canViewContent — account state', () => {
  it('gives anonymous requests only public content', () => {
    expect(canViewContent(null, content({ visibility: 'public' })).allowed).toBe(true);
    expect(canViewContent(null, content({ visibility: 'stage' })).allowed).toBe(false);
  });

  it('denies suspended accounts everything', () => {
    const suspended = actor({ status: 'suspended' });
    expect(canViewContent(suspended, content()).allowed).toBe(false);
  });

  it('lets a restricted account keep reading while losing the ability to post', () => {
    // The two moderation actions must be distinguishable: a restriction that
    // also blanked the feed would be indistinguishable from a suspension.
    const restricted = actor({ status: 'restricted' });
    expect(canViewContent(restricted, content()).allowed).toBe(true);
    expect(canCreateContent(restricted)).toMatchObject({
      allowed: false,
      reason: 'account_restricted',
    });
  });

  it('keeps a restricted account’s feed scopes intact', () => {
    const scopes = visibilityScopesFor(actor({ status: 'restricted', courseIds: new Set(['c-a']) }));
    expect(scopes.courseIds).toEqual(['c-a']);
  });

  it('denies deleted content to its own author', () => {
    const author = actor({ userId: 'bob' });
    expect(canViewContent(author, content({ deletedAt: new Date() }))).toMatchObject({
      allowed: false,
      reason: 'content_deleted',
    });
  });

  it('lets an author see their own private content', () => {
    const author = actor({ userId: 'bob' });
    expect(canViewContent(author, content({ visibility: 'private' }))).toMatchObject({
      allowed: true,
      reason: 'author',
    });
  });

  it('hides private content from other students, but not from platform admins', () => {
    expect(canViewContent(actor(), content({ visibility: 'private' })).allowed).toBe(false);
    // Platform admins retain access for moderation; the access is audited.
    expect(canViewContent(actor({ role: 'admin' }), content({ visibility: 'private' })).allowed).toBe(
      true,
    );
  });
});

describe('canViewContent — followers scope', () => {
  it('allows followers only', () => {
    const follower = actor({ followingIds: new Set(['bob']) });
    expect(canViewContent(follower, content({ visibility: 'followers' })).allowed).toBe(true);
    expect(canViewContent(actor(), content({ visibility: 'followers' })).allowed).toBe(false);
  });
});

describe('write policies', () => {
  it('permits only the author to edit', () => {
    expect(canEditContent(actor({ userId: 'bob' }), content()).allowed).toBe(true);
    expect(canEditContent(actor(), content()).allowed).toBe(false);
    // Admins remove content; they do not rewrite it.
    expect(canEditContent(actor({ role: 'admin' }), content()).allowed).toBe(false);
  });

  it('permits author, platform admin, and container moderator to delete', () => {
    expect(canDeleteContent(actor({ userId: 'bob' }), content()).allowed).toBe(true);
    expect(canDeleteContent(actor({ role: 'admin' }), content()).allowed).toBe(true);
    expect(
      canDeleteContent(actor(), content({ groupId: 'g1' }), new Set(['g1'])).allowed,
    ).toBe(true);
    expect(canDeleteContent(actor(), content()).allowed).toBe(false);
  });

  it('blocks restricted accounts from creating content but not from reading', () => {
    const restricted = actor({ status: 'restricted' });
    expect(canCreateContent(restricted)).toMatchObject({
      allowed: false,
      reason: 'account_restricted',
    });
  });
});

describe('visibilityScopesFor', () => {
  it('returns an empty scope set for anonymous actors', () => {
    const scopes = visibilityScopesFor(null);
    expect(scopes.userId).toBeNull();
    expect(scopes.courseIds).toEqual([]);
    expect(scopes.isAdmin).toBe(false);
  });

  it('merges both block directions into a single exclusion list', () => {
    const scopes = visibilityScopesFor(
      actor({
        blockedUserIds: new Set(['x', 'y']),
        blockedByUserIds: new Set(['y', 'z']),
      }),
    );
    expect([...scopes.excludedUserIds].sort()).toEqual(['x', 'y', 'z']);
  });

  it('projects memberships that the SQL filter needs', () => {
    const scopes = visibilityScopesFor(
      actor({ courseIds: new Set(['c-a']), groupIds: new Set(['g-a', 'g-b']) }),
    );
    expect(scopes.courseIds).toEqual(['c-a']);
    expect(scopes.groupIds.sort()).toEqual(['g-a', 'g-b']);
  });

  it('degrades a suspended actor to the anonymous scope set', () => {
    const scopes = visibilityScopesFor(actor({ status: 'suspended', courseIds: new Set(['c-a']) }));
    expect(scopes.courseIds).toEqual([]);
  });
});
