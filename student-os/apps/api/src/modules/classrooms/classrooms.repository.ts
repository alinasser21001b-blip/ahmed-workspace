import { queryOne, queryRows, type Sql } from '../../platform/db.js';

/**
 * Classroom persistence. SQL only — every authorization decision belongs to the
 * service, which asks `@sos/core`.
 *
 * One rule shapes the queries below: **membership is the filter, not a
 * post-hoc check.** `listMyClassrooms` joins `classroom_members`, so a room you
 * are not in cannot appear no matter what the visibility column says. Filtering
 * after the fetch is how a leak gets written, and pushing the predicate into
 * the WHERE clause is the same discipline the feed has followed since Phase 2
 * (ADR-0003).
 */

export interface ClassroomRow {
  id: string;
  course_id: string;
  course_name_ar: string | null;
  course_name_en: string | null;
  title: string;
  description: string | null;
  instructor_id: string | null;
  instructor_handle: string | null;
  instructor_display_name: string | null;
  instructor_avatar_url: string | null;
  instructor_verification_level: string | null;
  visibility: string;
  join_code: string | null;
  is_archived: boolean;
  member_count: number;
  lecture_count: number;
  created_at: Date;
  viewer_role: string | null;
  viewer_status: string | null;
}

/*
 * Counts and the viewer's own membership come back with the row rather than in
 * follow-up queries: a list of twenty rooms would otherwise be forty-one round
 * trips, and the counts are what the list is for.
 */
const CLASSROOM_SELECT = `
  SELECT k.id, k.course_id, c.name_ar AS course_name_ar, c.name_en AS course_name_en,
         k.title, k.description, k.instructor_id,
         ip.handle AS instructor_handle, ip.display_name AS instructor_display_name,
         ip.avatar_url AS instructor_avatar_url,
         iu.verification_level AS instructor_verification_level,
         k.visibility, k.join_code, k.is_archived, k.created_at,
         (SELECT count(*)::int FROM classroom_members m
            WHERE m.classroom_id = k.id AND m.status = 'active')            AS member_count,
         (SELECT count(*)::int FROM lectures l
            WHERE l.classroom_id = k.id AND l.deleted_at IS NULL
              AND l.published_at IS NOT NULL)                               AS lecture_count,
         me.role   AS viewer_role,
         me.status AS viewer_status
  FROM classrooms k
  JOIN courses c ON c.id = k.course_id
  LEFT JOIN profiles ip ON ip.user_id = k.instructor_id
  LEFT JOIN users iu ON iu.id = k.instructor_id AND iu.deleted_at IS NULL
  LEFT JOIN classroom_members me ON me.classroom_id = k.id AND me.user_id = $1
`;

export async function findClassroom(
  viewerId: string,
  classroomId: string,
  client?: Sql,
): Promise<ClassroomRow | null> {
  return queryOne<ClassroomRow>(`${CLASSROOM_SELECT} WHERE k.id = $2`, [viewerId, classroomId], client);
}

/** Rooms the viewer is an active member of. Membership IS the predicate. */
export async function listMyClassrooms(
  viewerId: string,
  limit: number,
  client?: Sql,
): Promise<ClassroomRow[]> {
  return queryRows<ClassroomRow>(
    `${CLASSROOM_SELECT}
     WHERE me.status = 'active'
     ORDER BY k.is_archived, k.created_at DESC
     LIMIT $2`,
    [viewerId, limit],
    client,
  );
}

/**
 * Rooms the viewer could join but has not.
 *
 * Only `course`-visible rooms in courses they are enrolled in. An unlisted
 * (`classroom`-visible) room is absent by construction — it is reachable only
 * with its join code, and appearing in a discovery list would defeat that.
 */
export async function listDiscoverableClassrooms(
  viewerId: string,
  courseIds: readonly string[],
  limit: number,
  client?: Sql,
): Promise<ClassroomRow[]> {
  if (courseIds.length === 0) return [];
  return queryRows<ClassroomRow>(
    `${CLASSROOM_SELECT}
     WHERE k.visibility = 'course'
       AND k.course_id = ANY($2::uuid[])
       AND NOT k.is_archived
       AND (me.status IS NULL OR me.status <> 'active')
     ORDER BY k.created_at DESC
     LIMIT $3`,
    [viewerId, courseIds, limit],
    client,
  );
}

/** Resolves a join code to a room. Archived rooms are not reachable by code. */
export async function findClassroomByJoinCode(
  viewerId: string,
  joinCode: string,
  client?: Sql,
): Promise<ClassroomRow | null> {
  return queryOne<ClassroomRow>(
    `${CLASSROOM_SELECT} WHERE k.join_code = $2 AND NOT k.is_archived`,
    [viewerId, joinCode],
    client,
  );
}

export async function insertClassroom(
  input: {
    courseId: string;
    title: string;
    description: string | null;
    instructorId: string;
    visibility: string;
    joinCode: string;
  },
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO classrooms (course_id, title, description, instructor_id, visibility, join_code)
     VALUES ($1, $2, $3, $4, $5::visibility, $6)
     RETURNING id`,
    [input.courseId, input.title, input.description, input.instructorId, input.visibility, input.joinCode],
    client,
  );
  return row!;
}

/**
 * Adds or reinstates a membership.
 *
 * `ON CONFLICT` rather than a check-then-insert: two taps on Join are one row,
 * decided by the primary key rather than by a race. A `banned` row is
 * deliberately left alone — reinstating it here would let a banned student
 * rejoin by pressing the button again.
 */
export async function upsertMembership(
  input: { classroomId: string; userId: string; role: string },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO classroom_members (classroom_id, user_id, role, status)
     VALUES ($1, $2, $3::membership_role, 'active')
     ON CONFLICT (classroom_id, user_id) DO UPDATE SET
       status    = 'active',
       joined_at = now()
     WHERE classroom_members.status <> 'banned'`,
    [input.classroomId, input.userId, input.role],
    client,
  );
}

export async function removeMembership(
  classroomId: string,
  userId: string,
  client?: Sql,
): Promise<void> {
  await queryOne(
    `DELETE FROM classroom_members WHERE classroom_id = $1 AND user_id = $2`,
    [classroomId, userId],
    client,
  );
}

export interface MemberRow {
  user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_level: string;
  stage_name_ar: string | null;
  stage_name_en: string | null;
  college_name_ar: string | null;
  college_name_en: string | null;
  role: string;
  joined_at: Date;
}

export async function listMembers(
  classroomId: string,
  limit: number,
  client?: Sql,
): Promise<MemberRow[]> {
  return queryRows<MemberRow>(
    `SELECT m.user_id, p.handle, p.display_name, p.avatar_url, u.verification_level,
            st.name_ar AS stage_name_ar, st.name_en AS stage_name_en,
            co.name_ar AS college_name_ar, co.name_en AS college_name_en,
            m.role, m.joined_at
     FROM classroom_members m
     JOIN profiles p ON p.user_id = m.user_id
     JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
     LEFT JOIN stages st ON st.id = p.stage_id
     LEFT JOIN colleges co ON co.id = p.college_id
     WHERE m.classroom_id = $1 AND m.status = 'active'
     ORDER BY
       CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,
       m.joined_at
     LIMIT $2`,
    [classroomId, limit],
    client,
  );
}

// --- lectures ---------------------------------------------------------------

export interface LectureRow {
  id: string;
  classroom_id: string;
  course_id: string;
  title: string;
  description: string | null;
  ordinal: number;
  duration_minutes: number | null;
  ai_summary: string | null;
  learning_objectives: unknown;
  key_concepts: unknown;
  author_id: string | null;
  author_handle: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  author_verification_level: string | null;
  published_at: Date | null;
  created_at: Date;
  material_count: number;
  viewer_completed_at: Date | null;
}

const LECTURE_SELECT = `
  SELECT l.id, l.classroom_id, l.course_id, l.title, l.description, l.ordinal,
         l.duration_minutes, l.ai_summary, l.learning_objectives, l.key_concepts,
         l.author_id, ap.handle AS author_handle, ap.display_name AS author_display_name,
         ap.avatar_url AS author_avatar_url,
         au.verification_level AS author_verification_level,
         l.published_at, l.created_at,
         (SELECT count(*)::int FROM materials mt
            WHERE mt.lecture_id = l.id AND mt.deleted_at IS NULL)  AS material_count,
         lp.completed_at AS viewer_completed_at
  FROM lectures l
  LEFT JOIN profiles ap ON ap.user_id = l.author_id
  LEFT JOIN users au ON au.id = l.author_id AND au.deleted_at IS NULL
  LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.user_id = $1
`;

/**
 * Lectures in a room.
 *
 * `includeDrafts` is the teaching staff's view. A student sees only published
 * lectures, enforced here in SQL rather than by trimming the array afterwards.
 */
export async function listLectures(
  viewerId: string,
  classroomId: string,
  includeDrafts: boolean,
  client?: Sql,
): Promise<LectureRow[]> {
  return queryRows<LectureRow>(
    `${LECTURE_SELECT}
     WHERE l.classroom_id = $2
       AND l.deleted_at IS NULL
       AND ($3::boolean OR l.published_at IS NOT NULL)
     ORDER BY l.ordinal, l.created_at`,
    [viewerId, classroomId, includeDrafts],
    client,
  );
}

export async function findLecture(
  viewerId: string,
  lectureId: string,
  client?: Sql,
): Promise<LectureRow | null> {
  return queryOne<LectureRow>(
    `${LECTURE_SELECT} WHERE l.id = $2 AND l.deleted_at IS NULL`,
    [viewerId, lectureId],
    client,
  );
}

export async function insertLecture(
  input: {
    classroomId: string;
    courseId: string;
    title: string;
    description: string | null;
    ordinal: number;
    durationMinutes: number | null;
    learningObjectives: string[];
    keyConcepts: string[];
    authorId: string;
    publish: boolean;
  },
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO lectures
       (classroom_id, course_id, title, description, ordinal, duration_minutes,
        learning_objectives, key_concepts, author_id, visibility, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, 'classroom',
             CASE WHEN $10::boolean THEN now() ELSE NULL END)
     RETURNING id`,
    [
      input.classroomId,
      input.courseId,
      input.title,
      input.description,
      input.ordinal,
      input.durationMinutes,
      JSON.stringify(input.learningObjectives),
      JSON.stringify(input.keyConcepts),
      input.authorId,
      input.publish,
    ],
    client,
  );
  return row!;
}

export async function attachLectureTopics(
  lectureId: string,
  topicIds: readonly string[],
  client?: Sql,
): Promise<void> {
  if (topicIds.length === 0) return;
  await queryOne(
    `INSERT INTO lecture_topics (lecture_id, topic_id)
     SELECT $1, t.id FROM topics t WHERE t.id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [lectureId, topicIds],
    client,
  );
}

export async function listLectureTopics(
  lectureId: string,
  client?: Sql,
): Promise<{ id: string; name_ar: string; name_en: string }[]> {
  return queryRows<{ id: string; name_ar: string; name_en: string }>(
    `SELECT t.id, t.name_ar, t.name_en
     FROM lecture_topics lt JOIN topics t ON t.id = lt.topic_id
     WHERE lt.lecture_id = $1
     ORDER BY t.name_en`,
    [lectureId],
    client,
  );
}

/** Records how far a student got. Upsert: re-reading a lecture is not a new row. */
export async function upsertLectureProgress(
  input: { userId: string; lectureId: string; percent: number },
  client?: Sql,
): Promise<void> {
  await queryOne(
    `INSERT INTO lecture_progress (user_id, lecture_id, percent, completed_at, last_seen_at)
     VALUES ($1, $2, $3::int, CASE WHEN $3::int >= 100 THEN now() ELSE NULL END, now())
     ON CONFLICT (user_id, lecture_id) DO UPDATE SET
       percent      = GREATEST(lecture_progress.percent, EXCLUDED.percent),
       completed_at = COALESCE(lecture_progress.completed_at, EXCLUDED.completed_at),
       last_seen_at = now()`,
    [input.userId, input.lectureId, input.percent],
    client,
  );
}

// --- materials --------------------------------------------------------------

export interface MaterialRow {
  id: string;
  title: string;
  description: string | null;
  ordinal: number;
  external_url: string | null;
  created_at: Date;
  file_id: string | null;
  file_mime_type: string | null;
  file_size_bytes: string | null;
  file_original_name: string | null;
}

export async function listMaterials(
  lectureId: string,
  client?: Sql,
): Promise<MaterialRow[]> {
  return queryRows<MaterialRow>(
    `SELECT mt.id, mt.title, mt.description, mt.ordinal, mt.external_url, mt.created_at,
            f.id AS file_id, f.mime_type AS file_mime_type,
            f.size_bytes::text AS file_size_bytes, f.original_name AS file_original_name
     FROM materials mt
     LEFT JOIN files f ON f.id = mt.file_id AND f.deleted_at IS NULL
     WHERE mt.lecture_id = $1 AND mt.deleted_at IS NULL
     ORDER BY mt.ordinal, mt.created_at`,
    [lectureId],
    client,
  );
}

export async function insertMaterial(
  input: {
    lectureId: string;
    classroomId: string;
    title: string;
    description: string | null;
    ordinal: number;
    fileId: string | null;
    externalUrl: string | null;
    uploadedBy: string;
  },
  client?: Sql,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO materials
       (lecture_id, classroom_id, title, description, ordinal, file_id, external_url, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.lectureId,
      input.classroomId,
      input.title,
      input.description,
      input.ordinal,
      input.fileId,
      input.externalUrl,
      input.uploadedBy,
    ],
    client,
  );
  return row!;
}

/**
 * Places an uploaded file inside the classroom.
 *
 * This is the line that makes the Phase 5b exit criterion true. `canAccessFile`
 * has resolved `visibility = 'classroom'` against `actor.classroomIds` since
 * Phase 0; what was missing was anything that ever set a file's visibility to
 * `classroom` and stamped its `classroom_id`. Until a file is placed, a signed
 * URL is only as private as the signature.
 *
 * Claiming is atomic on `attached_at IS NULL`, like every other attach path, so
 * one upload cannot be used as two materials.
 */
export async function attachFileToClassroom(
  fileId: string,
  classroomId: string,
  ownerId: string,
  client?: Sql,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE files
     SET attached_at  = now(),
         visibility   = 'classroom',
         classroom_id = $2
     WHERE id = $1
       AND owner_id = $3
       AND deleted_at IS NULL
       AND attached_at IS NULL
     RETURNING id`,
    [fileId, classroomId, ownerId],
    client,
  );
  return row !== null;
}
