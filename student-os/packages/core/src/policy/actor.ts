import type {
  AccountStatus,
  UserRole,
  VerificationLevel,
  Visibility,
} from '@sos/contracts';

/**
 * The authorization subject.
 *
 * An Actor is a fully-resolved snapshot: every membership set needed to make a
 * permission decision is already loaded. Policy functions are therefore pure
 * and synchronous, which is what allows the entire security surface to be
 * covered by fast unit tests instead of slow integration tests.
 *
 * The cost of this design is that the caller must build the Actor once per
 * request. That is deliberate: it makes "how much does this user have access
 * to?" a single, auditable query rather than a scatter of lazy lookups.
 */
export interface Actor {
  userId: string;
  role: UserRole;
  status: AccountStatus;
  verificationLevel: VerificationLevel;

  /** Academic placement, from the profile. */
  universityId: string | null;
  collegeId: string | null;
  programId: string | null;
  stageId: string | null;

  /** Active memberships. */
  courseIds: ReadonlySet<string>;
  communityIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  classroomIds: ReadonlySet<string>;

  /** Users this actor follows. Needed for `followers` visibility. */
  followingIds: ReadonlySet<string>;

  /**
   * Blocking is evaluated in BOTH directions (§40). Two sets, not one, because
   * "I blocked them" and "they blocked me" have identical visibility effects
   * but different UI affordances.
   */
  blockedUserIds: ReadonlySet<string>;
  blockedByUserIds: ReadonlySet<string>;
}

/** An unauthenticated request. */
export type MaybeActor = Actor | null;

export interface Decision {
  allowed: boolean;
  /** Stable reason code. Logged, and used by tests to assert *why*. */
  reason: string;
}

export const allow = (reason = 'allowed'): Decision => ({ allowed: true, reason });
export const deny = (reason: string): Decision => ({ allowed: false, reason });

/**
 * Full standing: may read and may write.
 *
 * Deliberately excludes `restricted`, which is the moderation action that
 * removes the ability to create while leaving the account usable (§39). Write
 * policies gate on this.
 */
export function isActive(actor: MaybeActor): actor is Actor {
  return actor !== null && actor.status === 'active';
}

/**
 * May read.
 *
 * Restricted accounts belong here and not in `isActive`: a restriction that
 * also blanked the feed would be indistinguishable from a suspension, which
 * defeats the point of having two moderation actions. Suspended, banned and
 * deleted accounts read nothing.
 *
 * Every read path gates on this; every write path gates on `isActive`.
 */
export function canRead(actor: MaybeActor): actor is Actor {
  return actor !== null && (actor.status === 'active' || actor.status === 'restricted');
}

export function isBlockedEitherWay(actor: Actor, otherUserId: string): boolean {
  if (otherUserId === actor.userId) return false;
  return actor.blockedUserIds.has(otherUserId) || actor.blockedByUserIds.has(otherUserId);
}

/** Global admins. Contextual roles (group admin, classroom owner) are separate. */
export function isPlatformAdmin(actor: MaybeActor): boolean {
  return actor?.role === 'admin' && actor.status === 'active';
}

/**
 * The set of visibility levels an actor could possibly satisfy, used to
 * short-circuit query building. Membership-scoped levels are included only
 * when the actor actually holds at least one membership of that type.
 */
export function candidateVisibilities(actor: MaybeActor): Visibility[] {
  if (!canRead(actor)) return ['public'];
  const levels: Visibility[] = ['public', 'private', 'followers'];
  if (actor.universityId) levels.push('university');
  if (actor.collegeId) levels.push('college');
  if (actor.collegeId && actor.stageId) levels.push('stage');
  if (actor.courseIds.size > 0) levels.push('course');
  if (actor.communityIds.size > 0) levels.push('community');
  if (actor.groupIds.size > 0) levels.push('group');
  if (actor.classroomIds.size > 0) levels.push('classroom');
  return levels;
}
