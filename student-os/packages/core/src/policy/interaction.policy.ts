import type { Visibility } from '@sos/contracts';
import {
  allow,
  deny,
  isActive,
  isBlockedEitherWay,
  isPlatformAdmin,
  type Actor,
  type Decision,
  type MaybeActor,
} from './actor.js';

/**
 * Person-to-person authorization: profiles, messaging, mentions, and the
 * moderation gate.
 */

/** The subject's placement plus the parts of their privacy settings we need. */
export interface TargetUserRef {
  userId: string;
  universityId: string | null;
  collegeId: string | null;
  stageId: string | null;
  profileVisibility: Visibility;
  whoCanMessage: Visibility;
  searchable: boolean;
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  status: 'active' | 'restricted' | 'suspended' | 'banned' | 'deleted';
  /** Whether the target follows the actor — needed for `followers` scope. */
  followsActor: boolean;
}

/**
 * Resolves an audience scope between two people. Container-based scopes
 * (course/community/group/classroom) are not meaningful person-to-person, so
 * they degrade to "same cohort" — the closest honest equivalent — rather than
 * silently allowing.
 */
function scopeAllowsPerson(actor: Actor, target: TargetUserRef, scope: Visibility): Decision {
  switch (scope) {
    case 'public':
      return allow('public');
    case 'university':
      return actor.universityId && actor.universityId === target.universityId
        ? allow('same_university')
        : deny('different_university');
    case 'college':
      return actor.collegeId && actor.collegeId === target.collegeId
        ? allow('same_college')
        : deny('different_college');
    case 'course':
    case 'community':
    case 'group':
    case 'classroom':
    case 'stage':
      return actor.collegeId &&
        actor.collegeId === target.collegeId &&
        actor.stageId &&
        actor.stageId === target.stageId
        ? allow('same_cohort')
        : deny('different_cohort');
    case 'followers':
      // "People I allow" = people the target follows back.
      return target.followsActor ? allow('followed_by_target') : deny('not_followed_by_target');
    case 'private':
      return deny('private');
    default: {
      const never: never = scope;
      return deny(`unhandled_scope_${String(never)}`);
    }
  }
}

export function canViewProfile(actor: MaybeActor, target: TargetUserRef): Decision {
  if (target.status === 'deleted') return deny('account_deleted');
  if (target.status === 'banned') {
    return isPlatformAdmin(actor) ? allow('platform_admin') : deny('account_banned');
  }

  if (!isActive(actor)) {
    return target.profileVisibility === 'public' ? allow('public_anonymous') : deny('unauthenticated');
  }
  if (actor.userId === target.userId) return allow('self');
  if (isBlockedEitherWay(actor, target.userId)) return deny('blocked');
  if (isPlatformAdmin(actor)) return allow('platform_admin');

  return scopeAllowsPerson(actor, target, target.profileVisibility);
}

/**
 * Message initiation. Note this gates STARTING a conversation; once a
 * conversation exists, membership governs, so that tightening a privacy
 * setting does not strand an in-flight thread.
 */
export function canMessage(actor: MaybeActor, target: TargetUserRef): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (actor.userId === target.userId) return deny('cannot_message_self');
  if (target.status !== 'active') return deny(`target_${target.status}`);
  if (isBlockedEitherWay(actor, target.userId)) return deny('blocked');
  return scopeAllowsPerson(actor, target, target.whoCanMessage);
}

/** Search and mention suggestion visibility. */
export function canDiscoverProfile(actor: MaybeActor, target: TargetUserRef): Decision {
  if (!target.searchable) {
    // Opting out of search does not hide an already-known profile, only its
    // appearance in discovery surfaces.
    if (!isActive(actor) || actor.userId !== target.userId) return deny('not_searchable');
  }
  return canViewProfile(actor, target);
}

export function canSeePresence(actor: MaybeActor, target: TargetUserRef): Decision {
  if (!target.showOnlineStatus) return deny('presence_hidden');
  return canViewProfile(actor, target);
}

export function canSeeLastSeen(actor: MaybeActor, target: TargetUserRef): Decision {
  if (!target.showLastSeen) return deny('last_seen_hidden');
  return canViewProfile(actor, target);
}

/**
 * Moderation gate. Platform admins moderate anywhere; container moderators
 * moderate only their own container. A global `instructor` role grants nothing
 * here — being an instructor somewhere is not authority everywhere.
 */
export function canModerate(
  actor: MaybeActor,
  containerId: string | null,
  moderatorOf: ReadonlySet<string> = new Set(),
): Decision {
  if (!isActive(actor)) return deny('unauthenticated');
  if (isPlatformAdmin(actor)) return allow('platform_admin');
  if (containerId && moderatorOf.has(containerId)) return allow('container_moderator');
  return deny('not_moderator');
}

/**
 * Private file access, used before minting a signed URL. A signed URL is a
 * bearer capability, so this check is the only thing standing between a
 * private resource and anyone who can guess its id (§19, §49).
 */
export interface FileRef {
  id: string;
  ownerId: string;
  visibility: Visibility;
  /** Where the file is attached, if anywhere. Nulls mean "unattached upload". */
  courseId: string | null;
  communityId: string | null;
  groupId: string | null;
  classroomId: string | null;
  collegeId: string | null;
  stageId: string | null;
  universityId: string | null;
  deletedAt: Date | string | null;
}

export function canAccessFile(actor: MaybeActor, file: FileRef): Decision {
  if (file.deletedAt !== null) return deny('file_deleted');
  if (!isActive(actor)) {
    return file.visibility === 'public' ? allow('public_anonymous') : deny('unauthenticated');
  }
  if (file.ownerId === actor.userId) return allow('owner');
  if (isPlatformAdmin(actor)) return allow('platform_admin');

  switch (file.visibility) {
    case 'public':
      return allow('public');
    case 'private':
      return deny('private_to_owner');
    case 'group':
      return file.groupId && actor.groupIds.has(file.groupId)
        ? allow('group_member')
        : deny('not_group_member');
    case 'classroom':
      return file.classroomId && actor.classroomIds.has(file.classroomId)
        ? allow('classroom_member')
        : deny('not_classroom_member');
    case 'community':
      return file.communityId && actor.communityIds.has(file.communityId)
        ? allow('community_member')
        : deny('not_community_member');
    case 'course':
      return file.courseId && actor.courseIds.has(file.courseId)
        ? allow('enrolled_in_course')
        : deny('not_enrolled');
    case 'university':
      return actor.universityId && actor.universityId === file.universityId
        ? allow('same_university')
        : deny('different_university');
    case 'college':
      return actor.collegeId && actor.collegeId === file.collegeId
        ? allow('same_college')
        : deny('different_college');
    case 'stage':
      return actor.collegeId === file.collegeId && actor.stageId === file.stageId
        ? allow('same_cohort')
        : deny('different_cohort');
    case 'followers':
      return deny('followers_scope_not_supported_for_files');
    default: {
      const never: never = file.visibility;
      return deny(`unhandled_visibility_${String(never)}`);
    }
  }
}
