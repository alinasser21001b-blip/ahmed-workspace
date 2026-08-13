import { z } from 'zod';
import {
  displayNameSchema,
  handleSchema,
  uuidSchema,
  verificationLevelSchema,
  visibilitySchema,
} from '../common/primitives.js';

/**
 * Profile contract.
 *
 * A student profile is an ACADEMIC identity, not a social vanity page (§7).
 * The academic context is a first-class object rather than a free-text bio
 * line, because the feed, communities, permissions and search all read it.
 */

export const academicContextSchema = z.object({
  universityId: uuidSchema.nullable(),
  universityName: z.string().nullable(),
  collegeId: uuidSchema.nullable(),
  collegeName: z.string().nullable(),
  programId: uuidSchema.nullable(),
  programName: z.string().nullable(),
  stageId: uuidSchema.nullable(),
  stageName: z.string().nullable(),
  academicYearId: uuidSchema.nullable(),
  academicYearLabel: z.string().nullable(),
});
export type AcademicContext = z.infer<typeof academicContextSchema>;

export const profileSchema = z.object({
  userId: uuidSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  verificationLevel: verificationLevelSchema,
  academic: academicContextSchema,
  interests: z.array(z.object({ id: uuidSchema, nameAr: z.string(), nameEn: z.string() })),
  /** Contribution-based, never follower-derived (§37). */
  contributionScore: z.number().int(),
  followerCount: z.number().int(),
  followingCount: z.number().int(),
  onboardingCompleted: z.boolean(),
  createdAt: z.string(),
  /** Relationship of the requesting actor to this profile. Null when self. */
  viewer: z
    .object({
      isSelf: z.boolean(),
      isFollowing: z.boolean(),
      isBlocked: z.boolean(),
      canMessage: z.boolean(),
    })
    .nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Compact shape embedded in feed items, comments, members lists. */
export const profileSummarySchema = z.object({
  userId: uuidSchema,
  handle: handleSchema,
  displayName: displayNameSchema,
  avatarUrl: z.string().nullable(),
  verificationLevel: verificationLevelSchema,
  stageName: z.string().nullable(),
  collegeName: z.string().nullable(),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

/**
 * Onboarding completion. This single call is what turns a bare account into a
 * cohort member, so it is validated as a unit: a half-filled academic context
 * would put the user in a feed scope that does not exist.
 */
export const completeOnboardingRequestSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema,
  bio: z.string().max(500).optional(),
  universityId: uuidSchema,
  collegeId: uuidSchema,
  programId: uuidSchema,
  stageId: uuidSchema,
  academicYearId: uuidSchema.optional(),
  interestTopicIds: z.array(uuidSchema).max(20).default([]),
});
export type CompleteOnboardingRequest = z.infer<typeof completeOnboardingRequestSchema>;

export const updateProfileRequestSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: z.string().max(500).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  interestTopicIds: z.array(uuidSchema).max(20).optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const privacySettingsSchema = z.object({
  profileVisibility: visibilitySchema,
  defaultPostVisibility: visibilitySchema,
  whoCanMessage: visibilitySchema,
  showOnlineStatus: z.boolean(),
  showLastSeen: z.boolean(),
  showActivity: z.boolean(),
  searchable: z.boolean(),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const updatePrivacySettingsRequestSchema = privacySettingsSchema.partial();
export type UpdatePrivacySettingsRequest = z.infer<typeof updatePrivacySettingsRequestSchema>;

export const handleAvailabilityQuerySchema = z.object({ handle: handleSchema });
export const handleAvailabilitySchema = z.object({
  handle: handleSchema,
  available: z.boolean(),
});
