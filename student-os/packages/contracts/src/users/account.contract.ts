import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';
import { reportReasonSchema, reportTargetSchema } from '../social/interactions.contract.js';
import { profileSummarySchema } from './users.contract.js';

/**
 * Account self-service, and the App Store obligations that live on it.
 *
 * Everything here exists because App Review requires the capability to be
 * reachable BY THE USER, INSIDE THE APP — not because the data model needed it.
 * Guideline 5.1.1(v) for deletion, Guideline 1.2 for the block list and the
 * report path, Guideline 1.5 and 5.1.1(i) for the support and privacy links.
 */

// --- deletion (Guideline 5.1.1(v)) ------------------------------------------

export const deleteAccountRequestSchema = z.object({
  /**
   * Re-authentication, not a formality.
   *
   * A stolen access token must not be enough to destroy an account that cannot
   * be restored. The guideline requires deletion to be available in the app; it
   * does not require it to be available without proving who you are.
   */
  password: z.string().min(1),
  /**
   * Typed confirmation, checked on the client and again here.
   *
   * The literal is locale-independent on purpose: a translated confirmation
   * word would mean the API's meaning changed with the Accept-Language header.
   */
  confirmation: z.literal('DELETE'),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

/**
 * What was removed. Counts only — never contents.
 *
 * Returned so the client can show the person what actually happened rather than
 * a spinner followed by a sign-out, and so that App Review can see the
 * deletion is real without needing database access.
 */
export const deleteAccountResponseSchema = z.object({
  messagesTombstoned: z.number().int().nonnegative(),
  filesRemoved: z.number().int().nonnegative(),
  objectsOrphaned: z.number().int().nonnegative(),
  sessionsRevoked: z.number().int().nonnegative(),
  pushTokensRemoved: z.number().int().nonnegative(),
  groupsTransferred: z.number().int().nonnegative(),
  groupsArchived: z.number().int().nonnegative(),
  communitiesTransferred: z.number().int().nonnegative(),
  communitiesArchived: z.number().int().nonnegative(),
  classroomsTransferred: z.number().int().nonnegative(),
  classroomsArchived: z.number().int().nonnegative(),
});
export type DeleteAccountResponse = z.infer<typeof deleteAccountResponseSchema>;

// --- blocking (Guideline 1.2) -----------------------------------------------

/**
 * The accounts this user has blocked.
 *
 * Required for the guideline to be satisfiable in practice rather than on
 * paper: an app where blocking is possible but the block list is invisible
 * gives a person no way to undo a mistake, and no way to know whether the block
 * they thought they applied took effect.
 */
export const blockedAccountSchema = z.object({
  profile: profileSummarySchema,
  blockedAt: isoDateTimeSchema,
});
export type BlockedAccount = z.infer<typeof blockedAccountSchema>;

// --- reporting (Guideline 1.2) ----------------------------------------------
//
// The report REQUEST already exists — `createReportRequestSchema` in
// `social/interactions.contract.ts`, backing `POST /v1/reports` since Phase 3.
// It is not redefined here. What was missing was never the contract; it was a
// way for a person holding a phone to reach it, and a way for a moderator to
// read what arrived. Those are the two things below.

// --- moderator queue (Guideline 1.2 — "timely responses to concerns") --------

export const moderationReportSchema = z.object({
  id: uuidSchema,
  reason: reportReasonSchema,
  details: z.string().nullable(),
  status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']),
  targetType: reportTargetSchema,
  targetId: uuidSchema,
  reporterHandle: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type ModerationReport = z.infer<typeof moderationReportSchema>;

export const resolveReportRequestSchema = z.object({
  /** What was done. Mirrors the `moderation_action_kind` enum from 0006. */
  action: z.enum(['dismiss', 'warn', 'remove_content', 'restrict', 'suspend', 'ban']),
  reason: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
});
export type ResolveReportRequest = z.infer<typeof resolveReportRequestSchema>;

// --- support and legal (Guidelines 1.5, 5.1.1(i)) ---------------------------

/**
 * Where the app sends a person who needs help or the privacy policy.
 *
 * Served by the API rather than compiled into the bundle, for a reason that is
 * operational rather than architectural: a privacy policy URL that changes
 * would otherwise require an App Store release, and Guideline 2.1 forbids
 * shipping a placeholder. The API can be corrected in a deploy; a binary cannot.
 *
 * Every field is nullable, and the client renders only what it is given. A
 * missing support URL therefore shows nothing rather than a dead link — but the
 * release gate (`pnpm appstore:check`) fails when they are unset, so "nothing"
 * cannot reach the App Store.
 */
export const supportLinksSchema = z.object({
  supportUrl: z.string().url().nullable(),
  privacyPolicyUrl: z.string().url().nullable(),
  termsUrl: z.string().url().nullable(),
  supportEmail: z.string().email().nullable(),
});
export type SupportLinks = z.infer<typeof supportLinksSchema>;
