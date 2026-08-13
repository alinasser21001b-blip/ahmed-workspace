import type { PrivacySettings } from '@sos/contracts';
import type { TargetUserRef } from '@sos/core';
import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Profile persistence.
 */

export interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  verification_level: 'unverified' | 'student' | 'instructor' | 'official';
  university_id: string | null;
  university_name_ar: string | null;
  university_name_en: string | null;
  college_id: string | null;
  college_name_ar: string | null;
  college_name_en: string | null;
  program_id: string | null;
  program_name_ar: string | null;
  program_name_en: string | null;
  stage_id: string | null;
  stage_name_ar: string | null;
  stage_name_en: string | null;
  academic_year_id: string | null;
  academic_year_label: string | null;
  contribution_score: number;
  follower_count: number;
  following_count: number;
  onboarding_completed: boolean;
  created_at: Date;
}

const PROFILE_SELECT = `
  SELECT p.user_id, p.handle, p.display_name, p.avatar_url, p.bio,
         u.verification_level,
         p.university_id, un.name_ar AS university_name_ar, un.name_en AS university_name_en,
         p.college_id,    co.name_ar AS college_name_ar,    co.name_en AS college_name_en,
         p.program_id,    pr.name_ar AS program_name_ar,    pr.name_en AS program_name_en,
         p.stage_id,      st.name_ar AS stage_name_ar,      st.name_en AS stage_name_en,
         p.academic_year_id, ay.label AS academic_year_label,
         p.contribution_score, p.follower_count, p.following_count,
         (p.onboarding_completed_at IS NOT NULL) AS onboarding_completed,
         p.created_at
  FROM profiles p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN universities   un ON un.id = p.university_id
  LEFT JOIN colleges       co ON co.id = p.college_id
  LEFT JOIN programs       pr ON pr.id = p.program_id
  LEFT JOIN stages         st ON st.id = p.stage_id
  LEFT JOIN academic_years ay ON ay.id = p.academic_year_id
`;

export async function findProfileByUserId(userId: string, client?: Sql): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>(
    `${PROFILE_SELECT} WHERE p.user_id = $1 AND u.deleted_at IS NULL`,
    [userId],
    client,
  );
}

export async function findProfileByHandle(handle: string, client?: Sql): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>(
    `${PROFILE_SELECT} WHERE lower(p.handle) = lower($1) AND u.deleted_at IS NULL`,
    [handle],
    client,
  );
}

export async function isHandleAvailable(handle: string, client?: Sql): Promise<boolean> {
  const row = await queryOne<{ taken: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM profiles WHERE lower(handle) = lower($1)) AS taken`,
    [handle],
    client,
  );
  return row?.taken === false;
}

export interface UpsertProfileInput {
  userId: string;
  handle: string;
  displayName: string;
  bio: string | null;
  universityId: string;
  collegeId: string;
  programId: string;
  stageId: string;
  academicYearId: string | null;
}

/**
 * Creates or replaces the academic placement. Idempotent so that a client
 * retrying onboarding after a dropped response does not fail on a duplicate.
 */
export async function upsertProfile(input: UpsertProfileInput, client?: Sql): Promise<void> {
  await queryOne(
    `INSERT INTO profiles (
       user_id, handle, display_name, bio, university_id, college_id,
       program_id, stage_id, academic_year_id, onboarding_completed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (user_id) DO UPDATE SET
       handle           = EXCLUDED.handle,
       display_name     = EXCLUDED.display_name,
       bio              = EXCLUDED.bio,
       university_id    = EXCLUDED.university_id,
       college_id       = EXCLUDED.college_id,
       program_id       = EXCLUDED.program_id,
       stage_id         = EXCLUDED.stage_id,
       academic_year_id = EXCLUDED.academic_year_id,
       onboarding_completed_at = COALESCE(profiles.onboarding_completed_at, now())`,
    [
      input.userId,
      input.handle,
      input.displayName,
      input.bio,
      input.universityId,
      input.collegeId,
      input.programId,
      input.stageId,
      input.academicYearId,
    ],
    client,
  );
}

export async function updateProfileFields(
  userId: string,
  fields: { displayName?: string; bio?: string | null; avatarUrl?: string | null },
  client?: Sql,
): Promise<void> {
  // COALESCE with a sentinel would misfire on legitimate nulls, so each field
  // is passed alongside an explicit "was it provided?" flag.
  await queryOne(
    `UPDATE profiles SET
       display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
       bio          = CASE WHEN $4 THEN $5 ELSE bio END,
       avatar_url   = CASE WHEN $6 THEN $7 ELSE avatar_url END
     WHERE user_id = $1`,
    [
      userId,
      fields.displayName !== undefined,
      fields.displayName ?? null,
      fields.bio !== undefined,
      fields.bio ?? null,
      fields.avatarUrl !== undefined,
      fields.avatarUrl ?? null,
    ],
    client,
  );
}

export async function replaceInterests(
  userId: string,
  topicIds: readonly string[],
  client?: Sql,
): Promise<void> {
  await queryOne(`DELETE FROM profile_interests WHERE user_id = $1`, [userId], client);
  if (topicIds.length === 0) return;
  await queryOne(
    `INSERT INTO profile_interests (user_id, topic_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [userId, topicIds],
    client,
  );
}

export interface InterestRow {
  id: string;
  nameAr: string;
  nameEn: string;
}

export async function listInterests(userId: string, client?: Sql): Promise<InterestRow[]> {
  return queryRows<InterestRow>(
    `SELECT t.id, t.name_ar AS "nameAr", t.name_en AS "nameEn"
     FROM profile_interests pi
     JOIN topics t ON t.id = pi.topic_id
     WHERE pi.user_id = $1
     ORDER BY t.name_en`,
    [userId],
    client,
  );
}

// --- privacy ----------------------------------------------------------------

interface PrivacyRow {
  profile_visibility: PrivacySettings['profileVisibility'];
  default_post_visibility: PrivacySettings['defaultPostVisibility'];
  who_can_message: PrivacySettings['whoCanMessage'];
  show_online_status: boolean;
  show_last_seen: boolean;
  show_activity: boolean;
  searchable: boolean;
}

/**
 * Reads privacy settings, creating the default row if it is missing.
 *
 * Defaults are cohort-scoped rather than public: with privacy-first as a
 * product principle, the safe value has to be what a user gets by doing
 * nothing.
 */
export async function getPrivacySettings(userId: string, client?: Sql): Promise<PrivacySettings> {
  const row = await queryOne<PrivacyRow>(
    `INSERT INTO privacy_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING profile_visibility, default_post_visibility, who_can_message,
               show_online_status, show_last_seen, show_activity, searchable`,
    [userId],
    client,
  );
  if (!row) throw new Error('getPrivacySettings returned no row');
  return {
    profileVisibility: row.profile_visibility,
    defaultPostVisibility: row.default_post_visibility,
    whoCanMessage: row.who_can_message,
    showOnlineStatus: row.show_online_status,
    showLastSeen: row.show_last_seen,
    showActivity: row.show_activity,
    searchable: row.searchable,
  };
}

export async function updatePrivacySettings(
  userId: string,
  patch: Partial<PrivacySettings>,
  client?: Sql,
): Promise<PrivacySettings> {
  await getPrivacySettings(userId, client);
  const row = await queryOne<PrivacyRow>(
    `UPDATE privacy_settings SET
       profile_visibility      = COALESCE($2, profile_visibility),
       default_post_visibility = COALESCE($3, default_post_visibility),
       who_can_message         = COALESCE($4, who_can_message),
       show_online_status      = COALESCE($5, show_online_status),
       show_last_seen          = COALESCE($6, show_last_seen),
       show_activity           = COALESCE($7, show_activity),
       searchable              = COALESCE($8, searchable)
     WHERE user_id = $1
     RETURNING profile_visibility, default_post_visibility, who_can_message,
               show_online_status, show_last_seen, show_activity, searchable`,
    [
      userId,
      patch.profileVisibility ?? null,
      patch.defaultPostVisibility ?? null,
      patch.whoCanMessage ?? null,
      patch.showOnlineStatus ?? null,
      patch.showLastSeen ?? null,
      patch.showActivity ?? null,
      patch.searchable ?? null,
    ],
    client,
  );
  if (!row) throw new Error('updatePrivacySettings returned no row');
  return {
    profileVisibility: row.profile_visibility,
    defaultPostVisibility: row.default_post_visibility,
    whoCanMessage: row.who_can_message,
    showOnlineStatus: row.show_online_status,
    showLastSeen: row.show_last_seen,
    showActivity: row.show_activity,
    searchable: row.searchable,
  };
}

/**
 * Loads the policy-layer view of a user: placement plus the privacy fields the
 * interaction policies need. Separate from the display profile because the
 * policy must be decidable before we know whether the profile may be shown.
 */
export async function loadTargetUserRef(
  targetUserId: string,
  viewerId: string | null,
  client?: Sql,
): Promise<TargetUserRef | null> {
  const row = await queryOne<{
    user_id: string;
    university_id: string | null;
    college_id: string | null;
    stage_id: string | null;
    profile_visibility: TargetUserRef['profileVisibility'];
    who_can_message: TargetUserRef['whoCanMessage'];
    searchable: boolean;
    show_online_status: boolean;
    show_last_seen: boolean;
    status: TargetUserRef['status'];
    follows_actor: boolean;
  }>(
    `SELECT u.id AS user_id,
            p.university_id, p.college_id, p.stage_id,
            COALESCE(ps.profile_visibility, 'stage')  AS profile_visibility,
            COALESCE(ps.who_can_message, 'stage')     AS who_can_message,
            COALESCE(ps.searchable, true)             AS searchable,
            COALESCE(ps.show_online_status, true)     AS show_online_status,
            COALESCE(ps.show_last_seen, true)         AS show_last_seen,
            CASE WHEN u.deleted_at IS NOT NULL THEN 'deleted' ELSE u.status::text END AS status,
            EXISTS (
              SELECT 1 FROM follows f
              WHERE f.follower_id = u.id AND f.followee_id = $2::uuid
            ) AS follows_actor
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN privacy_settings ps ON ps.user_id = u.id
     WHERE u.id = $1`,
    [targetUserId, viewerId],
    client,
  );

  if (!row) return null;
  return {
    userId: row.user_id,
    universityId: row.university_id,
    collegeId: row.college_id,
    stageId: row.stage_id,
    profileVisibility: row.profile_visibility,
    whoCanMessage: row.who_can_message,
    searchable: row.searchable,
    showOnlineStatus: row.show_online_status,
    showLastSeen: row.show_last_seen,
    status: row.status,
    followsActor: row.follows_actor,
  };
}

/**
 * Enrols a student in every active course of their stage.
 *
 * `course_enrollments` has existed since 0002 and, until now, had no producer
 * at all: `actor.courseIds` was hydrated from a table nothing ever wrote to, so
 * it was empty for every user who ever signed in. Everything gated on course
 * membership — course-scoped content, course-scoped groups, and from Phase 5b
 * the ability to open or discover a classroom — was therefore unreachable in
 * practice while looking correct in code.
 *
 * The rule is the one the hierarchy already encodes: `courses.stage_id` says
 * which stage a course belongs to, and a student in that stage takes it. This
 * derives the rows rather than asking the student to pick, because a student
 * does not choose whether Stage 5 Pediatrics applies to them.
 *
 * Idempotent, and safe to re-run when a student's placement changes: the
 * `UNIQUE (user_id, course_id)` constraint absorbs the repeat, and a row that
 * already exists is reactivated rather than duplicated. Enrolments from a
 * previous stage are left alone — history, not an error.
 */
export async function enrolInStageCourses(
  userId: string,
  stageId: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO course_enrollments (user_id, course_id, role, status)
     SELECT $1, c.id, 'member', 'active'
     FROM courses c
     WHERE c.stage_id = $2 AND c.is_active
     ON CONFLICT (user_id, course_id) DO UPDATE SET status = 'active'`,
    [userId, stageId],
    client,
  );
}
