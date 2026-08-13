import { z } from 'zod';

/**
 * Shared primitives. Every schema in the product composes from these so that
 * a rule (e.g. "handles are lowercase alphanumeric, 3-30 chars") is written
 * exactly once and enforced identically on client and server.
 */

export const uuidSchema = z.uuid();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Mirrors the `visibility` Postgres enum. */
export const visibilitySchema = z.enum([
  'public',
  'university',
  'college',
  'stage',
  'course',
  'community',
  'group',
  'classroom',
  'followers',
  'private',
]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const userRoleSchema = z.enum(['student', 'instructor', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const verificationLevelSchema = z.enum([
  'unverified',
  'student',
  'instructor',
  'official',
]);
export type VerificationLevel = z.infer<typeof verificationLevelSchema>;

export const accountStatusSchema = z.enum([
  'active',
  'restricted',
  'suspended',
  'banned',
  'deleted',
]);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const membershipRoleSchema = z.enum(['member', 'moderator', 'admin', 'owner']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const membershipStatusSchema = z.enum([
  'invited',
  'pending',
  'active',
  'left',
  'banned',
]);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const contentKindSchema = z.enum([
  'post',
  'reel',
  'question',
  'poll',
  'resource',
  'announcement',
  'live',
]);
export type ContentKind = z.infer<typeof contentKindSchema>;

/**
 * What a piece of content IS, academically — a second axis beside
 * `contentKindSchema`, which says how it renders (ADR-0012).
 *
 * A clinical case and a summary are both `kind: 'post'` and are not the same
 * knowledge. One enum cannot express the cross product without becoming a list
 * of pairs, so there are two.
 */
export const knowledgeTypeSchema = z.enum([
  'question',
  'explanation',
  'summary',
  'note',
  'case',
  'resource',
  'reference',
  'correction',
  'discussion',
]);
export type KnowledgeType = z.infer<typeof knowledgeTypeSchema>;

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof difficultySchema>;

/**
 * The script a body is written in, derived deterministically from its letters.
 *
 * `mixed` is a real answer for a cohort that writes Arabic prose with English
 * drug names in it; `und` is the honest answer for a body too short to judge.
 */
export const contentLanguageSchema = z.enum(['ar', 'en', 'mixed', 'und']);
export type ContentLanguage = z.infer<typeof contentLanguageSchema>;

export const localeSchema = z.enum(['ar', 'en']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Handles are the one user-chosen identifier that appears in URLs and
 * mentions. Constrained to a conservative charset to keep them unambiguous in
 * both LTR and RTL rendering contexts.
 */
export const handleSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, 'handle_invalid_characters');

export const displayNameSchema = z.string().trim().min(1).max(80);

/**
 * Password policy. Length is the dominant factor in real-world resistance, so
 * a 10-character minimum is preferred over composition rules that push users
 * toward predictable substitutions.
 */
export const passwordSchema = z.string().min(10).max(200);

export const emailSchema = z.email().max(254);
