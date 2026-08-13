import { deny, allow, isActive, isPlatformAdmin, type Decision, type MaybeActor } from './actor.js';
import type { VerificationLevel } from '@sos/contracts';

/**
 * Global academic eligibility.
 *
 * This file answers one question — *is this person academically entitled to
 * teach at all?* — and deliberately answers nothing about any particular
 * classroom. That separation is the entire point of Phase 5c.
 *
 * Before it, opening a classroom made you its owner and owning it made you its
 * instructor, so any enrolled student could mint a room and thereby acquire the
 * one claim the product sells: "the instructor published this". Teaching
 * authority was reachable by anyone who could press a button, which made the
 * claim worthless.
 *
 * The fix is two independent facts that must BOTH hold:
 *
 *   global eligibility    — `users.verification_level`, set only by a platform
 *                           administrator, audited, and never derived from
 *                           anything the subject controls;
 *   contextual authority  — `classroom_members.role`, which says what you are
 *                           inside one particular room.
 *
 * Neither implies the other. A verified instructor who wanders into someone
 * else's classroom as an ordinary member does not get to publish there, and a
 * classroom owner who is not a verified instructor does not get to publish
 * anywhere — including in the room they own.
 *
 * `verification_level` is the right column for this and no new one was added:
 * it has carried exactly this vocabulary since migration 0001, and it was
 * already hydrated onto the Actor. What was missing was a policy that consulted
 * it.
 */

/**
 * The levels that constitute teaching eligibility.
 *
 * `official` is included because it is the stronger claim — a faculty or
 * departmental account — not a different kind of one. `student` and
 * `unverified` are not teaching claims at all: `student` means the academic
 * placement was confirmed, which is about belonging to the cohort, not about
 * instructing it.
 */
export const TEACHING_VERIFICATION_LEVELS: readonly VerificationLevel[] = ['instructor', 'official'];

/**
 * The rule itself, over a bare level.
 *
 * Split out from `isTeachingEligible` so that surfaces holding a level without
 * a full Actor — the admin console projecting somebody *else's* standing — ask
 * the same question rather than re-listing the levels or casting a row into an
 * Actor shape it does not have.
 */
export function isTeachingLevel(level: VerificationLevel): boolean {
  return TEACHING_VERIFICATION_LEVELS.includes(level);
}

export function isTeachingEligible(actor: MaybeActor): boolean {
  return actor !== null && isTeachingLevel(actor.verificationLevel);
}

/**
 * Whether the actor may perform academic authoring anywhere at all.
 *
 * Deliberately NOT satisfied by `role === 'admin'`. A platform administrator
 * runs the service; that is an operational capability, not an academic
 * credential, and letting it double as one would recreate the very collapse
 * this phase exists to undo. An administrator who genuinely teaches grants
 * themselves `instructor` through the same audited endpoint as everyone else,
 * and the audit log then says so.
 */
export function canTeachAcademically(actor: MaybeActor): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  return isTeachingEligible(actor)
    ? allow(`verified_${actor.verificationLevel}`)
    : deny('not_verified_instructor');
}

/**
 * Whether the actor may change someone's global academic eligibility.
 *
 * Platform administrators only, and there is no self-service path: a user
 * cannot verify themselves, cannot request verification into existence, and
 * cannot reach this by owning anything. Granting teaching eligibility is the
 * act that makes "the instructor published this" mean something, so the set of
 * people who can perform it is the smallest one the system has.
 */
export function canSetVerificationLevel(actor: MaybeActor): Decision {
  if (!isActive(actor)) return deny('inactive_account');
  return isPlatformAdmin(actor) ? allow('platform_admin') : deny('not_platform_admin');
}
