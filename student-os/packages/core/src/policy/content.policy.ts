import type { AccountStatus, Visibility } from '@sos/contracts';
import {
  allow,
  canRead,
  deny,
  isActive,
  isBlockedEitherWay,
  isPlatformAdmin,
  type Actor,
  type Decision,
  type MaybeActor,
} from './actor.js';

/**
 * Content authorization — the single implementation used by the REST API,
 * search, file access and the AI retrieval pipeline alike (§29, §5.1 of the
 * product architecture). There is no privileged AI path.
 */

/** The minimum a caller must load to make a content decision. */
export interface ContentRef {
  id: string;
  authorId: string;
  visibility: Visibility;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
  courseId: string | null;
  communityId: string | null;
  groupId: string | null;
  classroomId: string | null;
  deletedAt: Date | string | null;
  /**
   * The author's account standing.
   *
   * Optional only so that callers written before this existed keep compiling;
   * omitting it means "not withheld", which is the same answer the policy gave
   * before. Every caller in this repository supplies it.
   */
  authorStatus?: AccountStatus | undefined;
}

/**
 * Account states that withdraw an author's existing content from circulation.
 *
 * `restricted` is deliberately absent: restriction removes the ability to
 * write, it does not retract what was already written. `suspended` is
 * deliberately present — a suspension that left the account's posts in every
 * cohort feed would be a suspension in name only.
 */
const WITHHOLDING_AUTHOR_STATUSES: readonly AccountStatus[] = ['suspended', 'banned', 'deleted'];

export function authorIsWithheld(status: AccountStatus | null | undefined): boolean {
  return status !== null && status !== undefined && WITHHOLDING_AUTHOR_STATUSES.includes(status);
}

/**
 * Containers are HARD boundaries.
 *
 * A post inside a private group is unreachable by non-members even if its own
 * visibility says `stage`. Treating the container as advisory is the classic
 * way private group content leaks into a public feed, so the container check
 * runs first and cannot be satisfied by a broader visibility value.
 *
 * Communities are deliberately softer: they are discovery surfaces, so content
 * in a community follows its own visibility unless that visibility is
 * `community`, which requires membership.
 */
function containerAllows(actor: Actor, content: ContentRef): Decision {
  if (content.groupId && !actor.groupIds.has(content.groupId)) {
    return deny('not_group_member');
  }
  if (content.classroomId && !actor.classroomIds.has(content.classroomId)) {
    return deny('not_classroom_member');
  }
  if (
    content.communityId &&
    content.visibility === 'community' &&
    !actor.communityIds.has(content.communityId)
  ) {
    return deny('not_community_member');
  }
  return allow();
}

function visibilityAllows(actor: Actor, content: ContentRef): Decision {
  switch (content.visibility) {
    case 'public':
      return allow('public');

    case 'university':
      return actor.universityId && actor.universityId === content.universityId
        ? allow('same_university')
        : deny('different_university');

    case 'college':
      return actor.collegeId && actor.collegeId === content.collegeId
        ? allow('same_college')
        : deny('different_college');

    case 'stage':
      return actor.collegeId &&
        actor.collegeId === content.collegeId &&
        actor.stageId &&
        actor.stageId === content.stageId
        ? allow('same_cohort')
        : deny('different_cohort');

    case 'course':
      return content.courseId && actor.courseIds.has(content.courseId)
        ? allow('enrolled_in_course')
        : deny('not_enrolled');

    case 'community':
      return content.communityId && actor.communityIds.has(content.communityId)
        ? allow('community_member')
        : deny('not_community_member');

    case 'group':
      return content.groupId && actor.groupIds.has(content.groupId)
        ? allow('group_member')
        : deny('not_group_member');

    case 'classroom':
      return content.classroomId && actor.classroomIds.has(content.classroomId)
        ? allow('classroom_member')
        : deny('not_classroom_member');

    case 'followers':
      return actor.followingIds.has(content.authorId)
        ? allow('follows_author')
        : deny('not_following_author');

    case 'private':
      return deny('private_to_author');

    default: {
      // Exhaustiveness guard: adding a visibility value without handling it
      // here is a compile error, not a silent allow.
      const never: never = content.visibility;
      return deny(`unhandled_visibility_${String(never)}`);
    }
  }
}

export function canViewContent(actor: MaybeActor, content: ContentRef): Decision {
  if (content.deletedAt !== null) {
    // Deleted content is invisible to everyone including its author. Admins
    // reach it through the moderation surface, which reads with an explicit
    // includeDeleted flag rather than through this policy.
    return deny('content_deleted');
  }

  if (!canRead(actor)) {
    // Anonymous, suspended and banned accounts see only genuinely public
    // content. A restricted account still reads normally.
    return content.visibility === 'public' ? allow('public_anonymous') : deny('unauthenticated');
  }

  // Blocking outranks everything except the actor's own content.
  if (isBlockedEitherWay(actor, content.authorId)) {
    return deny('blocked');
  }

  if (content.authorId === actor.userId) {
    return allow('author');
  }

  if (isPlatformAdmin(actor)) {
    return allow('platform_admin');
  }

  // Checked here rather than only in the feed's SQL. Having the rule in the
  // query and not in the policy meant the two disagreed, and the single-item
  // read — the one path a moderator follows from a report — served content the
  // feed had already withdrawn.
  if (authorIsWithheld(content.authorStatus)) {
    return deny(`author_${content.authorStatus}`);
  }

  const container = containerAllows(actor, content);
  if (!container.allowed) return container;

  return visibilityAllows(actor, content);
}

/** Only the author may edit. Admins remove content; they never rewrite it. */
export function canEditContent(actor: MaybeActor, content: ContentRef): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (content.deletedAt !== null) return deny('content_deleted');
  if (content.authorId !== actor.userId) return deny('not_author');
  return allow('author');
}

/**
 * Deletion is broader than editing: the author, a platform admin, or a
 * moderator of the containing group/community may remove content.
 */
export function canDeleteContent(
  actor: MaybeActor,
  content: ContentRef,
  containerModeratorOf: ReadonlySet<string> = new Set(),
): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (content.authorId === actor.userId) return allow('author');
  if (isPlatformAdmin(actor)) return allow('platform_admin');
  const container = content.groupId ?? content.communityId ?? content.classroomId;
  if (container && containerModeratorOf.has(container)) return allow('container_moderator');
  return deny('not_permitted');
}

/**
 * Write gate. Separate from `canViewContent` because restricted accounts keep
 * read access while losing the ability to create (§39 `restrict` action).
 */
export function canCreateContent(actor: MaybeActor): Decision {
  if (actor === null) return deny('unauthenticated');
  if (actor.status === 'restricted') return deny('account_restricted');
  if (actor.status !== 'active') return deny(`account_${actor.status}`);
  return allow();
}

/**
 * Turns an actor into the parameter set a repository pushes directly into SQL.
 *
 * List endpoints MUST filter in the query rather than fetching and discarding:
 * fetch-then-filter leaks row counts through pagination and silently returns
 * short pages. The AI retrieval pipeline calls this same function to build its
 * retrieval filter.
 */
export interface VisibilityScopes {
  userId: string | null;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
  courseIds: string[];
  communityIds: string[];
  groupIds: string[];
  classroomIds: string[];
  followingIds: string[];
  /** Blocked either way. A permission input: these rows must not be reachable. */
  excludedUserIds: string[];
  /**
   * Muted. A *preference* input, not a permission one — which is why it is a
   * separate field rather than being folded into `excludedUserIds`. Surfaces
   * that represent an explicit request (a profile page, a group's own feed)
   * ignore it; ambient surfaces (home feed, search) honour it.
   */
  mutedUserIds: string[];
  mutedGroupIds: string[];
  mutedCommunityIds: string[];
  mutedTopicIds: string[];
  isAdmin: boolean;
}

export function visibilityScopesFor(actor: MaybeActor): VisibilityScopes {
  if (!canRead(actor)) {
    return {
      userId: null,
      universityId: null,
      collegeId: null,
      stageId: null,
      courseIds: [],
      communityIds: [],
      groupIds: [],
      classroomIds: [],
      followingIds: [],
      excludedUserIds: [],
      mutedUserIds: [],
      mutedGroupIds: [],
      mutedCommunityIds: [],
      mutedTopicIds: [],
      isAdmin: false,
    };
  }
  return {
    userId: actor.userId,
    universityId: actor.universityId,
    collegeId: actor.collegeId,
    stageId: actor.stageId,
    courseIds: [...actor.courseIds],
    communityIds: [...actor.communityIds],
    groupIds: [...actor.groupIds],
    classroomIds: [...actor.classroomIds],
    followingIds: [...actor.followingIds],
    excludedUserIds: [...new Set([...actor.blockedUserIds, ...actor.blockedByUserIds])],
    mutedUserIds: [...actor.mutedUserIds],
    mutedGroupIds: [...actor.mutedGroupIds],
    mutedCommunityIds: [...actor.mutedCommunityIds],
    mutedTopicIds: [...actor.mutedTopicIds],
    isAdmin: isPlatformAdmin(actor),
  };
}
