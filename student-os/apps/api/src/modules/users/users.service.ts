import type {
  CompleteOnboardingRequest,
  Locale,
  Profile,
  UpdateProfileRequest,
} from '@sos/contracts';
import { canMessage, canViewProfile, type Actor } from '@sos/core';
import { withTransaction } from '../../platform/db.js';
import { errors, PG_UNIQUE_VIOLATION, pgErrorCode } from '../../platform/errors.js';
import * as academic from '../academic/academic.repository.js';
import * as repo from './users.repository.js';

/**
 * Profile business logic.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

async function toProfile(
  row: repo.ProfileRow,
  viewer: Actor | null,
  locale: Locale,
): Promise<Profile> {
  const interests = await repo.listInterests(row.user_id);
  const isSelf = viewer?.userId === row.user_id;

  let viewerBlock: Profile['viewer'] = null;
  if (viewer) {
    const target = await repo.loadTargetUserRef(row.user_id, viewer.userId);
    viewerBlock = {
      isSelf,
      isFollowing: viewer.followingIds.has(row.user_id),
      isBlocked: viewer.blockedUserIds.has(row.user_id),
      canMessage: !isSelf && target !== null && canMessage(viewer, target).allowed,
    };
  }

  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    verificationLevel: row.verification_level,
    academic: {
      universityId: row.university_id,
      universityName: localised(row.university_name_ar, row.university_name_en, locale),
      collegeId: row.college_id,
      collegeName: localised(row.college_name_ar, row.college_name_en, locale),
      programId: row.program_id,
      programName: localised(row.program_name_ar, row.program_name_en, locale),
      stageId: row.stage_id,
      stageName: localised(row.stage_name_ar, row.stage_name_en, locale),
      academicYearId: row.academic_year_id,
      academicYearLabel: row.academic_year_label,
    },
    interests,
    contributionScore: row.contribution_score,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    onboardingCompleted: row.onboarding_completed,
    createdAt: row.created_at.toISOString(),
    viewer: viewerBlock,
  };
}

/**
 * Reads a profile, enforcing profile visibility.
 *
 * A profile the viewer may not see returns NOT_FOUND rather than FORBIDDEN:
 * 403 confirms the account exists, which defeats the point of a private
 * profile.
 */
export async function getProfileByHandle(
  handle: string,
  viewer: Actor | null,
  locale: Locale,
): Promise<Profile> {
  const row = await repo.findProfileByHandle(handle);
  if (!row) throw errors.notFound('profile');

  const target = await repo.loadTargetUserRef(row.user_id, viewer?.userId ?? null);
  if (!target || !canViewProfile(viewer, target).allowed) throw errors.notFound('profile');

  return toProfile(row, viewer, locale);
}

export async function getOwnProfile(actor: Actor, locale: Locale): Promise<Profile> {
  const row = await repo.findProfileByUserId(actor.userId);
  if (!row) throw errors.notFound('profile');
  return toProfile(row, actor, locale);
}

export async function checkHandleAvailable(handle: string): Promise<boolean> {
  return repo.isHandleAvailable(handle);
}

/**
 * Completes onboarding: handle, display name, academic placement, interests.
 *
 * The placement is validated against the hierarchy rather than trusted. A
 * client that posts four unrelated ids would otherwise land the user in a
 * cohort that does not exist, and every feed scope downstream would silently
 * return nothing.
 */
export async function completeOnboarding(
  actor: Actor,
  input: CompleteOnboardingRequest,
  locale: Locale,
): Promise<Profile> {
  const placement = {
    universityId: input.universityId,
    collegeId: input.collegeId,
    programId: input.programId,
    stageId: input.stageId,
    academicYearId: input.academicYearId,
  };

  if (!(await academic.isValidPlacement(placement))) {
    throw errors.preconditionFailed(
      'The selected university, college, program and stage do not form a valid combination.',
      { field: 'placement' },
    );
  }

  const topicIds = await academic.filterExistingTopicIds(input.interestTopicIds);

  await withTransaction(async (client) => {
    try {
      await repo.upsertProfile(
        {
          userId: actor.userId,
          handle: input.handle,
          displayName: input.displayName,
          bio: input.bio ?? null,
          universityId: input.universityId,
          collegeId: input.collegeId,
          programId: input.programId,
          stageId: input.stageId,
          academicYearId: input.academicYearId ?? null,
        },
        client,
      );
    } catch (error) {
      if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw errors.conflict('That handle is already taken.', { field: 'handle' });
      }
      throw error;
    }

    await repo.replaceInterests(actor.userId, topicIds, client);
    await repo.getPrivacySettings(actor.userId, client);
  });

  const row = await repo.findProfileByUserId(actor.userId);
  if (!row) throw errors.internal();
  return toProfile(row, actor, locale);
}

export async function updateProfile(
  actor: Actor,
  input: UpdateProfileRequest,
  locale: Locale,
): Promise<Profile> {
  await withTransaction(async (client) => {
    await repo.updateProfileFields(
      actor.userId,
      {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
      },
      client,
    );

    if (input.interestTopicIds) {
      const topicIds = await academic.filterExistingTopicIds(input.interestTopicIds, client);
      await repo.replaceInterests(actor.userId, topicIds, client);
    }
  });

  const row = await repo.findProfileByUserId(actor.userId);
  if (!row) throw errors.notFound('profile');
  return toProfile(row, actor, locale);
}

export const getPrivacySettings = repo.getPrivacySettings;
export const updatePrivacySettings = repo.updatePrivacySettings;
