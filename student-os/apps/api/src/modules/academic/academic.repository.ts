import type {
  AcademicYear,
  College,
  Course,
  Program,
  Stage,
  Subject,
  Topic,
  University,
} from '@sos/contracts';
import { queryRows, type Sql } from '../../platform/db.js';

/**
 * Academic hierarchy reads.
 *
 * The hierarchy is public reference data — it describes institutions, not
 * people — so these queries carry no per-actor filter. That is a deliberate,
 * stated exception to the "every list is permission-filtered" rule, not an
 * oversight: onboarding needs to read it before the user has any placement.
 */

export async function listUniversities(client?: Sql): Promise<University[]> {
  return queryRows<University>(
    `SELECT id, slug, name_ar AS "nameAr", name_en AS "nameEn",
            country, city, logo_url AS "logoUrl"
     FROM universities WHERE is_active ORDER BY name_en`,
    [],
    client,
  );
}

export async function listColleges(universityId: string, client?: Sql): Promise<College[]> {
  return queryRows<College>(
    `SELECT id, university_id AS "universityId", slug,
            name_ar AS "nameAr", name_en AS "nameEn"
     FROM colleges WHERE university_id = $1 AND is_active ORDER BY name_en`,
    [universityId],
    client,
  );
}

export async function listPrograms(collegeId: string, client?: Sql): Promise<Program[]> {
  return queryRows<Program>(
    `SELECT id, college_id AS "collegeId", slug, name_ar AS "nameAr", name_en AS "nameEn",
            degree_type AS "degreeType", duration_years AS "durationYears"
     FROM programs WHERE college_id = $1 AND is_active ORDER BY name_en`,
    [collegeId],
    client,
  );
}

export async function listStages(programId: string, client?: Sql): Promise<Stage[]> {
  return queryRows<Stage>(
    `SELECT id, program_id AS "programId", ordinal, name_ar AS "nameAr", name_en AS "nameEn"
     FROM stages WHERE program_id = $1 ORDER BY ordinal`,
    [programId],
    client,
  );
}

export async function listAcademicYears(
  universityId: string,
  client?: Sql,
): Promise<AcademicYear[]> {
  return queryRows<AcademicYear>(
    `SELECT id, university_id AS "universityId", label,
            starts_on::text AS "startsOn", ends_on::text AS "endsOn",
            is_current AS "isCurrent"
     FROM academic_years WHERE university_id = $1 ORDER BY starts_on DESC`,
    [universityId],
    client,
  );
}

export async function listCourses(
  filter: { stageId?: string; programId?: string },
  client?: Sql,
): Promise<Course[]> {
  return queryRows<Course>(
    `SELECT id, program_id AS "programId", stage_id AS "stageId",
            academic_year_id AS "academicYearId", code, slug,
            name_ar AS "nameAr", name_en AS "nameEn", description,
            cover_url AS "coverUrl"
     FROM courses
     WHERE is_active
       AND ($1::uuid IS NULL OR stage_id = $1)
       AND ($2::uuid IS NULL OR program_id = $2)
     ORDER BY name_en`,
    [filter.stageId ?? null, filter.programId ?? null],
    client,
  );
}

export async function listSubjects(courseId: string, client?: Sql): Promise<Subject[]> {
  return queryRows<Subject>(
    `SELECT id, course_id AS "courseId", slug, name_ar AS "nameAr",
            name_en AS "nameEn", ordinal
     FROM subjects WHERE course_id = $1 ORDER BY ordinal, name_en`,
    [courseId],
    client,
  );
}

export async function listTopics(
  filter: { subjectId?: string; courseId?: string },
  client?: Sql,
): Promise<Topic[]> {
  return queryRows<Topic>(
    `SELECT t.id, t.subject_id AS "subjectId", t.parent_topic_id AS "parentTopicId",
            t.slug, t.name_ar AS "nameAr", t.name_en AS "nameEn", t.ordinal
     FROM topics t
     JOIN subjects s ON s.id = t.subject_id
     WHERE ($1::uuid IS NULL OR t.subject_id = $1)
       AND ($2::uuid IS NULL OR s.course_id = $2)
     ORDER BY t.ordinal, t.name_en`,
    [filter.subjectId ?? null, filter.courseId ?? null],
    client,
  );
}

/**
 * Validates that a proposed academic placement is internally consistent — that
 * the college really is in the university, the program in the college, and the
 * stage in the program.
 *
 * Without this, a client could post any four ids and land a user in a cohort
 * that does not exist, which silently breaks every feed scope that follows.
 */
export async function isValidPlacement(
  placement: {
    universityId: string;
    collegeId: string;
    programId: string;
    stageId: string;
    academicYearId?: string | undefined;
  },
  client?: Sql,
): Promise<boolean> {
  const rows = await queryRows<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM stages st
       JOIN programs pr ON pr.id = st.program_id
       JOIN colleges co ON co.id = pr.college_id
       WHERE st.id = $4 AND pr.id = $3 AND co.id = $2 AND co.university_id = $1
     ) AND (
       $5::uuid IS NULL OR EXISTS (
         SELECT 1 FROM academic_years ay WHERE ay.id = $5 AND ay.university_id = $1
       )
     ) AS ok`,
    [
      placement.universityId,
      placement.collegeId,
      placement.programId,
      placement.stageId,
      placement.academicYearId ?? null,
    ],
    client,
  );
  return rows[0]?.ok === true;
}

/** Rejects interest topics that do not exist, so the profile cannot hold dangling ids. */
export async function filterExistingTopicIds(
  topicIds: readonly string[],
  client?: Sql,
): Promise<string[]> {
  if (topicIds.length === 0) return [];
  const rows = await queryRows<{ id: string }>(
    `SELECT id FROM topics WHERE id = ANY($1::uuid[])`,
    [topicIds],
    client,
  );
  return rows.map((r) => r.id);
}
