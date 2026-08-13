import { z } from 'zod';
import {
  handleSchema,
  isoDateTimeSchema,
  userRoleSchema,
  uuidSchema,
  verificationLevelSchema,
} from '../common/primitives.js';

/**
 * Admin V0 — academic verification.
 *
 * The smallest surface that makes instructor verification an operable thing
 * rather than a column nobody can write. It is deliberately not a dashboard:
 * three endpoints, one subject (who may teach), and an audit trail.
 *
 * The scope is narrow on purpose. Every capability the product gates on
 * teaching eligibility is worthless until somebody can actually grant it, and
 * worthless in a different way if granting it is untraceable. Those two facts
 * are the whole requirement; anything else here would be speculation about a
 * moderation console that has not been designed.
 */

/**
 * A user as an administrator sees them.
 *
 * Carries identity and standing, and nothing else — no email history, no
 * device list, no content. An administrator deciding whether someone may teach
 * needs to know who they are and what they are now, not to browse their life.
 */
export const adminUserSummarySchema = z.object({
  userId: uuidSchema,
  email: z.string(),
  handle: handleSchema.nullable(),
  displayName: z.string().nullable(),
  role: userRoleSchema,
  verificationLevel: verificationLevelSchema,
  /** Projected by the policy layer, so the console never re-derives the rule. */
  teachingEligible: z.boolean(),
  status: z.string(),
  createdAt: isoDateTimeSchema,
});
export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const adminUserSearchQuerySchema = z.object({
  /** Matched against handle, display name and email. */
  query: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AdminUserSearchQuery = z.infer<typeof adminUserSearchQuerySchema>;

/**
 * A verification change.
 *
 * `reason` is required rather than optional. Granting the authority to publish
 * as an instructor is a decision somebody should have to state, and an audit
 * row whose justification is blank records that a thing happened without
 * recording why — which is the half that matters when it is read back.
 */
export const setVerificationRequestSchema = z.object({
  verificationLevel: verificationLevelSchema,
  reason: z.string().trim().min(3).max(500),
});
export type SetVerificationRequest = z.infer<typeof setVerificationRequestSchema>;

/**
 * One entry of the immutable record.
 *
 * Read back from `audit_log`, which has been the append-only home of
 * privileged actions since migration 0006. Verification changes were given no
 * table of their own precisely so that "what have administrators done" stays a
 * single query rather than a union over parallel logs.
 */
export const verificationAuditEntrySchema = z.object({
  id: z.string(),
  actor: z
    .object({ userId: uuidSchema, handle: handleSchema.nullable(), displayName: z.string().nullable() })
    .nullable(),
  targetUserId: uuidSchema,
  before: verificationLevelSchema.nullable(),
  after: verificationLevelSchema.nullable(),
  reason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type VerificationAuditEntry = z.infer<typeof verificationAuditEntrySchema>;
