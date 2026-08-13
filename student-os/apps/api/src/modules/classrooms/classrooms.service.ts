import type {
  AddMaterialRequest,
  ClassroomDetail,
  ClassroomMember,
  ClassroomSummary,
  CreateClassroomRequest,
  CreateLectureRequest,
  LectureDetail,
  LectureSummary,
  ContentItem,
  CreatePostRequest,
  FeedPage,
  Locale,
  MembershipRole,
  MembershipStatus,
  VerificationLevel,
} from '@sos/contracts';
import {
  canJoinClassroom,
  canLeaveClassroom,
  canManageClassroom,
  canPostInClassroom,
  canReadClassroom,
  canTeachInClassroom,
  canViewClassroom,
  classroomCapabilities,
  type Actor,
  type ClassroomRef,
  type MaybeMembership,
} from '@sos/core';
import { randomBytes } from 'node:crypto';
import { withTransaction } from '../../platform/db.js';
import { errors } from '../../platform/errors.js';
import * as content from '../content/content.service.js';
import { signMediaUrl } from '../files/signed-url.js';
import * as repo from './classrooms.repository.js';

/**
 * Classrooms, lectures and materials.
 *
 * Every read here follows the same two-step the rest of the product uses:
 * load the row, then ask `@sos/core` — never trust that a route reached this
 * function for the right reason. A denial becomes **404, not 403**, because
 * "you may not see classroom X" tells the caller that X exists.
 *
 * The gate that matters most is the one between *seeing* a room and *reading*
 * it. `canViewClassroom` admits anyone enrolled in the course; every lecture,
 * material and roster call goes through `canReadClassroom`, which admits only
 * members. Enrolment gets you the door; membership gets you the room.
 */

function localised(ar: string | null, en: string | null, locale: Locale): string | null {
  return (locale === 'ar' ? ar : en) ?? en ?? ar;
}

function toRef(row: repo.ClassroomRow): ClassroomRef {
  return {
    id: row.id,
    courseId: row.course_id,
    instructorId: row.instructor_id,
    visibility: row.visibility as ClassroomRef['visibility'],
    isArchived: row.is_archived,
  };
}

/**
 * The viewer's membership, read from the row the query already joined.
 *
 * Deliberately NOT `actor.classroomIds`: that set holds active memberships
 * only, so it cannot tell "never joined" from "banned", and the join gate has
 * to distinguish them.
 */
function toMembership(row: repo.ClassroomRow): MaybeMembership {
  if (!row.viewer_status || !row.viewer_role) return null;
  return {
    role: row.viewer_role as MembershipRole,
    status: row.viewer_status as MembershipStatus,
  };
}

function toSummary(row: repo.ClassroomRow, actor: Actor, locale: Locale): ClassroomSummary {
  const membership = toMembership(row);
  const caps = classroomCapabilities(actor, toRef(row), membership);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    courseId: row.course_id,
    courseName: localised(row.course_name_ar, row.course_name_en, locale),
    instructor: row.instructor_id
      ? {
          userId: row.instructor_id,
          handle: row.instructor_handle ?? '',
          displayName: row.instructor_display_name ?? '',
          avatarUrl: row.instructor_avatar_url,
          verificationLevel: (row.instructor_verification_level ?? 'none') as VerificationLevel,
          stageName: null,
          collegeName: null,
        }
      : null,
    visibility: row.visibility as ClassroomSummary['visibility'],
    isArchived: row.is_archived,
    memberCount: row.member_count,
    lectureCount: row.lecture_count,
    createdAt: row.created_at.toISOString(),
    viewer: {
      isMember: caps.isMember,
      role: caps.role,
      canRead: caps.canRead,
      canJoin: caps.canJoin,
      canLeave: caps.canLeave,
      canTeach: caps.canTeach,
      canManage: caps.canManage,
    },
  };
}

// --- listing and reading ----------------------------------------------------

export async function listClassrooms(
  actor: Actor,
  query: { scope: 'mine' | 'discover'; limit: number },
  locale: Locale,
): Promise<{ items: ClassroomSummary[] }> {
  const rows =
    query.scope === 'mine'
      ? await repo.listMyClassrooms(actor.userId, query.limit)
      : await repo.listDiscoverableClassrooms(actor.userId, [...actor.courseIds], query.limit);
  return { items: rows.map((row) => toSummary(row, actor, locale)) };
}

/**
 * Loads a room the actor may at least see, or throws 404.
 *
 * Shared by every classroom route so the visibility rule is applied once. The
 * returned row carries the viewer's membership, which the caller then tests
 * against the specific gate it needs.
 */
async function loadVisible(
  actor: Actor,
  classroomId: string,
): Promise<{ row: repo.ClassroomRow; membership: MaybeMembership }> {
  const row = await repo.findClassroom(actor.userId, classroomId);
  if (!row) throw errors.notFound('classroom');
  const membership = toMembership(row);
  if (!canViewClassroom(actor, toRef(row), membership).allowed) {
    throw errors.notFound('classroom');
  }
  return { row, membership };
}

/** Same, but the caller must also be a member — the gate for room contents. */
async function loadReadable(
  actor: Actor,
  classroomId: string,
): Promise<{ row: repo.ClassroomRow; membership: MaybeMembership }> {
  const loaded = await loadVisible(actor, classroomId);
  if (!canReadClassroom(actor, loaded.membership).allowed) {
    throw errors.notFound('classroom');
  }
  return loaded;
}

export async function getClassroom(
  actor: Actor,
  classroomId: string,
  locale: Locale,
): Promise<ClassroomDetail> {
  const { row, membership } = await loadVisible(actor, classroomId);
  const summary = toSummary(row, actor, locale);
  return {
    ...summary,
    // A join code is a bearer credential: whoever holds it can enter. Students
    // receive null, so a screenshot of a student's screen cannot leak the room.
    joinCode: canTeachInClassroom(actor, membership).allowed ? row.join_code : null,
  };
}

export async function listMembers(
  actor: Actor,
  classroomId: string,
  locale: Locale,
): Promise<{ items: ClassroomMember[] }> {
  await loadReadable(actor, classroomId);
  const rows = await repo.listMembers(classroomId, 200);
  return {
    items: rows.map((member) => ({
      user: {
        userId: member.user_id,
        handle: member.handle,
        displayName: member.display_name,
        avatarUrl: member.avatar_url,
        verificationLevel: member.verification_level as VerificationLevel,
        stageName: localised(member.stage_name_ar, member.stage_name_en, locale),
        collegeName: localised(member.college_name_ar, member.college_name_en, locale),
      },
      role: member.role as ClassroomMember['role'],
      joinedAt: member.joined_at.toISOString(),
    })),
  };
}

// --- creating and joining ---------------------------------------------------

/**
 * A join code short enough to read aloud and long enough not to be guessed.
 *
 * Crockford-ish alphabet: no O/0, no I/1/L. An instructor reads this to a
 * lecture theatre, and a code that is ambiguous out loud is a support request.
 */
function generateJoinCode(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export async function createClassroom(
  actor: Actor,
  body: CreateClassroomRequest,
  locale: Locale,
): Promise<ClassroomDetail> {
  /*
   * You may only open a classroom for a course you are in. Without this an
   * actor could mint a room against any course id they could guess and then
   * invite people into it.
   */
  if (!actor.courseIds.has(body.courseId)) {
    throw errors.forbidden('not_enrolled_in_course');
  }

  const created = await withTransaction(async (tx) => {
    const classroom = await repo.insertClassroom(
      {
        courseId: body.courseId,
        title: body.title,
        description: body.description,
        instructorId: actor.userId,
        visibility: body.visibility,
        joinCode: generateJoinCode(),
      },
      tx,
    );
    // The creator is the owner, in the same transaction: a room that exists
    // without an owner has nobody who can publish or archive it.
    await repo.upsertMembership(
      { classroomId: classroom.id, userId: actor.userId, role: 'owner' },
      tx,
    );
    return classroom;
  });

  const row = await repo.findClassroom(actor.userId, created.id);
  const summary = toSummary(row!, actor, locale);
  return { ...summary, joinCode: row!.join_code };
}

/**
 * Joins by enrolment or by code.
 *
 * The code is resolved to a room BEFORE the policy runs, so a wrong code is a
 * 404 on a room that may not exist rather than a distinguishable "bad code"
 * for a room that does.
 */
export async function joinClassroom(
  actor: Actor,
  classroomId: string,
  joinCode: string | null,
  locale: Locale,
): Promise<ClassroomSummary> {
  const row = await repo.findClassroom(actor.userId, classroomId);
  if (!row) throw errors.notFound('classroom');

  const membership = toMembership(row);
  const hasValidJoinCode =
    joinCode !== null && row.join_code !== null && row.join_code === joinCode.toUpperCase();

  const decision = canJoinClassroom(actor, {
    classroom: toRef(row),
    membership,
    hasValidJoinCode,
  });
  if (!decision.allowed) {
    // An unlisted room the caller cannot reach must not be confirmed to exist.
    if (decision.reason === 'join_code_required' || decision.reason === 'not_enrolled') {
      throw errors.notFound('classroom');
    }
    throw errors.forbidden(decision.reason);
  }

  await repo.upsertMembership({ classroomId: row.id, userId: actor.userId, role: 'member' });
  const updated = await repo.findClassroom(actor.userId, row.id);
  return toSummary(updated!, actor, locale);
}

/** Resolves a code to the room it opens, for the "join by code" entry point. */
export async function findByJoinCode(
  actor: Actor,
  joinCode: string,
  locale: Locale,
): Promise<ClassroomSummary> {
  const row = await repo.findClassroomByJoinCode(actor.userId, joinCode.toUpperCase());
  if (!row) throw errors.notFound('classroom');
  return toSummary(row, actor, locale);
}

export async function leaveClassroom(actor: Actor, classroomId: string): Promise<void> {
  const { membership } = await loadVisible(actor, classroomId);
  const decision = canLeaveClassroom(actor, membership);
  if (!decision.allowed) throw errors.forbidden(decision.reason);
  await repo.removeMembership(classroomId, actor.userId);
}

// --- lectures ---------------------------------------------------------------

function toLectureSummary(row: repo.LectureRow): LectureSummary {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    title: row.title,
    description: row.description,
    ordinal: row.ordinal,
    durationMinutes: row.duration_minutes,
    materialCount: row.material_count,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** jsonb columns arrive as parsed values; anything unexpected becomes empty. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export async function listLectures(
  actor: Actor,
  classroomId: string,
): Promise<{ items: LectureSummary[] }> {
  const { membership } = await loadReadable(actor, classroomId);
  const includeDrafts = canTeachInClassroom(actor, membership).allowed;
  const rows = await repo.listLectures(actor.userId, classroomId, includeDrafts);
  return { items: rows.map(toLectureSummary) };
}

export async function getLecture(
  actor: Actor,
  lectureId: string,
  locale: Locale,
): Promise<LectureDetail> {
  const row = await repo.findLecture(actor.userId, lectureId);
  if (!row || !row.classroom_id) throw errors.notFound('lecture');

  // The lecture's permission is its classroom's permission. Reading it here
  // rather than trusting the lecture row is what stops a direct lecture id
  // from bypassing the room.
  const { membership } = await loadReadable(actor, row.classroom_id);
  const canTeach = canTeachInClassroom(actor, membership).allowed;
  if (!row.published_at && !canTeach) throw errors.notFound('lecture');

  const [topics, materials] = await Promise.all([
    repo.listLectureTopics(lectureId),
    repo.listMaterials(lectureId),
  ]);

  return {
    ...toLectureSummary(row),
    author: row.author_id
      ? {
          userId: row.author_id,
          handle: row.author_handle ?? '',
          displayName: row.author_display_name ?? '',
          avatarUrl: row.author_avatar_url,
          verificationLevel: (row.author_verification_level ?? 'none') as VerificationLevel,
          stageName: null,
          collegeName: null,
        }
      : null,
    learningObjectives: toStringArray(row.learning_objectives),
    keyConcepts: toStringArray(row.key_concepts),
    aiSummary: row.ai_summary,
    topics: topics.map((topic) => ({
      id: topic.id,
      name: localised(topic.name_ar, topic.name_en, locale) ?? topic.name_en,
    })),
    materials: materials.map((material) => ({
      id: material.id,
      title: material.title,
      description: material.description,
      ordinal: material.ordinal,
      /*
       * Signed at read time, for a caller who has already passed the classroom
       * gate above. The signature bounds the URL's lifetime; the gate is what
       * decides who gets one at all.
       */
      file: material.file_id
        ? {
            id: material.file_id,
            mimeType: material.file_mime_type ?? 'application/octet-stream',
            sizeBytes: Number(material.file_size_bytes ?? 0),
            width: null,
            height: null,
            ...signMediaUrl(material.file_id),
          }
        : null,
      externalUrl: material.external_url,
      createdAt: material.created_at.toISOString(),
    })),
    viewer: {
      canTeach,
      completedAt: row.viewer_completed_at?.toISOString() ?? null,
    },
  };
}

export async function createLecture(
  actor: Actor,
  classroomId: string,
  body: CreateLectureRequest,
): Promise<LectureSummary> {
  const { row, membership } = await loadReadable(actor, classroomId);
  const decision = canTeachInClassroom(actor, membership);
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  const created = await withTransaction(async (tx) => {
    const lecture = await repo.insertLecture(
      {
        classroomId,
        courseId: row.course_id,
        title: body.title,
        description: body.description,
        ordinal: body.ordinal,
        durationMinutes: body.durationMinutes,
        learningObjectives: body.learningObjectives,
        keyConcepts: body.keyConcepts,
        authorId: actor.userId,
        publish: body.publish,
      },
      tx,
    );
    await repo.attachLectureTopics(lecture.id, body.topicIds, tx);
    return lecture;
  });

  const stored = await repo.findLecture(actor.userId, created.id);
  return toLectureSummary(stored!);
}

export async function addMaterial(
  actor: Actor,
  lectureId: string,
  body: AddMaterialRequest,
): Promise<{ id: string }> {
  const lecture = await repo.findLecture(actor.userId, lectureId);
  if (!lecture || !lecture.classroom_id) throw errors.notFound('lecture');

  const { membership } = await loadReadable(actor, lecture.classroom_id);
  const decision = canTeachInClassroom(actor, membership);
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  const classroomId = lecture.classroom_id;
  return withTransaction(async (tx) => {
    if (body.fileId) {
      /*
       * Placing the file is what makes it classroom-private. Until this runs,
       * `canAccessFile` sees a `private` file owned by the uploader and a
       * signed URL is the only thing standing between it and anyone who has
       * the link.
       */
      const claimed = await repo.attachFileToClassroom(body.fileId, classroomId, actor.userId, tx);
      if (!claimed) throw errors.conflict('That file is not available to attach.');
    }
    return repo.insertMaterial(
      {
        lectureId,
        classroomId,
        title: body.title,
        description: body.description,
        ordinal: body.ordinal,
        fileId: body.fileId,
        externalUrl: body.externalUrl,
        uploadedBy: actor.userId,
      },
      tx,
    );
  });
}

/** Records reading progress. A signal about activity, never a grade (ADR-0014). */
export async function recordLectureProgress(
  actor: Actor,
  lectureId: string,
  percent: number,
): Promise<void> {
  const lecture = await repo.findLecture(actor.userId, lectureId);
  if (!lecture || !lecture.classroom_id) throw errors.notFound('lecture');
  await loadReadable(actor, lecture.classroom_id);
  await repo.upsertLectureProgress({ userId: actor.userId, lectureId, percent });
}

/** Exported for the routes' archive/manage surface, kept for symmetry of gates. */
export async function assertCanManage(actor: Actor, classroomId: string): Promise<void> {
  const { membership } = await loadVisible(actor, classroomId);
  const decision = canManageClassroom(actor, membership);
  if (!decision.allowed) throw errors.forbidden(decision.reason);
}

// --- lecture discussion -----------------------------------------------------

/**
 * Loads a lecture the actor may read, together with its classroom.
 *
 * Every discussion call goes through this, so the chain is verified once and
 * in one order: the actor is authenticated, the lecture exists, the lecture
 * belongs to a classroom, the actor is a member of that classroom, and an
 * unpublished lecture is invisible to anyone who is not teaching staff.
 */
async function loadReadableLecture(
  actor: Actor,
  lectureId: string,
): Promise<{ classroomId: string; membership: MaybeMembership }> {
  const lecture = await repo.findLecture(actor.userId, lectureId);
  if (!lecture || !lecture.classroom_id) throw errors.notFound('lecture');
  const classroomId = lecture.classroom_id;
  const { membership } = await loadReadable(actor, classroomId);
  if (!lecture.published_at && !canTeachInClassroom(actor, membership).allowed) {
    throw errors.notFound('lecture');
  }
  return { classroomId, membership };
}

/**
 * The discussion attached to one lecture.
 *
 * Deliberately not a new system. These are `content_items` in the classroom
 * container, pointed at a lecture — so they inherit the feed's permission
 * predicate, the knowledge classification, the reactions and the comment
 * threads that already exist, rather than growing a parallel social graph
 * that would need all of it re-implemented and re-secured.
 *
 * The read delegates to `content.listFeed`, which is where the permission SQL
 * lives. `lectureId` is a filter on top of that predicate and never a
 * substitute for it: a lecture id from another classroom narrows to rows the
 * reader still cannot see, which is nothing.
 */
export async function listLectureDiscussion(
  actor: Actor,
  lectureId: string,
  query: { cursor?: string | undefined; limit: number },
  locale: Locale,
): Promise<FeedPage> {
  const { classroomId } = await loadReadableLecture(actor, lectureId);
  return content.listFeed(
    actor,
    { scope: 'recent', classroomId, lectureId, cursor: query.cursor, limit: query.limit },
    locale,
  );
}

/**
 * Posts into a lecture's discussion.
 *
 * Any active member may speak, students included — a classroom where only
 * staff may post is a broadcast channel, and this is a learning network.
 *
 * The placement is resolved here and passed down, so `content.createPost`
 * never has to know a classroom rule. Visibility is forced to `classroom`
 * rather than taken from the request: a post made inside a room must not be
 * publishable to the whole stage by a client that sends its own value.
 */
export async function createLectureDiscussionPost(
  actor: Actor,
  lectureId: string,
  input: CreatePostRequest,
  locale: Locale,
): Promise<ContentItem> {
  const { classroomId, membership } = await loadReadableLecture(actor, lectureId);
  const decision = canPostInClassroom(actor, membership);
  if (!decision.allowed) throw errors.forbidden(decision.reason);

  return content.createPost(
    actor,
    {
      ...input,
      visibility: 'classroom',
      // A container is decided by the placement below, never by the payload.
      communityId: undefined,
      groupId: undefined,
    },
    locale,
    { classroomId, lectureId },
  );
}
