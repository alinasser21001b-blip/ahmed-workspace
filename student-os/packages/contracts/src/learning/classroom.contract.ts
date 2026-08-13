import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema, visibilitySchema } from '../common/primitives.js';
import { profileSummarySchema } from '../users/users.contract.js';
import { fileRefSchema } from '../social/files.contract.js';

/**
 * Classrooms, lectures and materials (Phase 5b).
 *
 * A classroom is a **taught** container, which is what separates it from a
 * group: a group is students organising themselves and everyone in it is a
 * peer, while a classroom has an instructor who publishes and students who
 * read. That asymmetry is the whole reason it is a separate concept rather
 * than a group with a flag.
 *
 * A lecture is deliberately not "a PDF with a title". The schema has carried
 * `learning_objectives`, `key_concepts` and an `ai_summary` since Phase 0
 * precisely so that a lecture is a hub other things hang off — and so that
 * when Phase 6 generates a summary it has a column to write to that is
 * separate from anything a human wrote.
 */

// --- membership -------------------------------------------------------------

/**
 * Roles inside a classroom.
 *
 * Reuses the platform-wide `membership_role` enum rather than inventing a
 * parallel vocabulary. `owner` is the instructor who created the room;
 * `moderator` is a teaching assistant; `member` is a student.
 */
export const classroomRoleSchema = z.enum(['owner', 'admin', 'moderator', 'member']);
export type ClassroomRole = z.infer<typeof classroomRoleSchema>;

export const classroomMemberSchema = z.object({
  user: profileSummarySchema,
  role: classroomRoleSchema,
  joinedAt: isoDateTimeSchema,
});
export type ClassroomMember = z.infer<typeof classroomMemberSchema>;

/**
 * What the viewer may do in this classroom.
 *
 * Projected by the server, never re-derived by the client — the same rule the
 * group surfaces have followed since Phase 3. A client that decides for itself
 * whether to draw "Add lecture" will eventually draw one that 403s.
 */
export const classroomViewerStateSchema = z.object({
  isMember: z.boolean(),
  role: classroomRoleSchema.nullable(),
  canRead: z.boolean(),
  canJoin: z.boolean(),
  canLeave: z.boolean(),
  /** Ask and answer in a lecture's discussion. Any member, students included. */
  canParticipate: z.boolean(),
  /** Run the roster, and see the join code and drafts. Teaching staff of this room. */
  canManageMembership: z.boolean(),
  /**
   * Publish lectures and attach official materials.
   *
   * The only capability that depends on something outside this classroom: it
   * requires teaching staffhood here AND global instructor verification. An
   * owner who loses verification keeps `canManage` and `canManageMembership`
   * and loses this one — which is why the client must render from these flags
   * rather than inferring authoring rights from `role === 'owner'`.
   */
  canTeach: z.boolean(),
  /** Rename, archive, change the join code, transfer ownership. Owner and admins. */
  canManage: z.boolean(),
});

export const classroomSummarySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  courseId: uuidSchema,
  courseName: z.string().nullable(),
  instructor: profileSummarySchema.nullable(),
  visibility: visibilitySchema,
  isArchived: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  lectureCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  viewer: classroomViewerStateSchema,
});
export type ClassroomSummary = z.infer<typeof classroomSummarySchema>;

export const classroomDetailSchema = classroomSummarySchema.extend({
  /**
   * Present only for members who can teach. A join code is a bearer
   * credential: anyone holding it can enter the room, so it is not part of the
   * payload a student receives.
   */
  joinCode: z.string().nullable(),
});
export type ClassroomDetail = z.infer<typeof classroomDetailSchema>;

export const listClassroomsQuerySchema = z.object({
  /** `mine` — rooms you are in. `discover` — rooms in your courses you are not. */
  scope: z.enum(['mine', 'discover']).default('mine'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListClassroomsQuery = z.infer<typeof listClassroomsQuerySchema>;

export const createClassroomRequestSchema = z.object({
  courseId: uuidSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).nullable().default(null),
  /**
   * `course` — anyone enrolled in the course can find and join it.
   * `classroom` — unlisted; only the join code gets you in.
   */
  visibility: z.enum(['course', 'classroom']).default('course'),
});
export type CreateClassroomRequest = z.infer<typeof createClassroomRequestSchema>;

export const joinClassroomRequestSchema = z.object({
  /** Required for an unlisted room, ignored for a discoverable one. */
  joinCode: z.string().trim().min(4).max(32).nullable().default(null),
});
export type JoinClassroomRequest = z.infer<typeof joinClassroomRequestSchema>;

// --- lectures ---------------------------------------------------------------

export const lectureSummarySchema = z.object({
  id: uuidSchema,
  classroomId: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  ordinal: z.number().int(),
  durationMinutes: z.number().int().nullable(),
  materialCount: z.number().int().nonnegative(),
  publishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type LectureSummary = z.infer<typeof lectureSummarySchema>;

export const lectureDetailSchema = lectureSummarySchema.extend({
  author: profileSummarySchema.nullable(),
  /** What a student should be able to do after this lecture. Instructor's words. */
  learningObjectives: z.array(z.string()),
  keyConcepts: z.array(z.string()),
  /**
   * Written by a model, never by the instructor, and kept in its own field so
   * the two can never be confused. Null until Phase 6 ships — the column
   * exists so that day is a code change, not a migration.
   */
  aiSummary: z.string().nullable(),
  topics: z.array(z.object({ id: uuidSchema, name: z.string() })),
  materials: z.array(
    z.object({
      id: uuidSchema,
      title: z.string(),
      description: z.string().nullable(),
      ordinal: z.number().int(),
      /** Signed and short-lived. Absent when the material is an external link. */
      file: fileRefSchema.nullable(),
      externalUrl: z.string().nullable(),
      createdAt: isoDateTimeSchema,
    }),
  ),
  viewer: z.object({
    canTeach: z.boolean(),
    completedAt: isoDateTimeSchema.nullable(),
  }),
});
export type LectureDetail = z.infer<typeof lectureDetailSchema>;

export const createLectureRequestSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().default(null),
  ordinal: z.number().int().min(0).max(9999).default(0),
  durationMinutes: z.number().int().min(1).max(600).nullable().default(null),
  learningObjectives: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  keyConcepts: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  topicIds: z.array(uuidSchema).max(10).default([]),
  /** Publish immediately, or keep it a draft only the teaching staff can see. */
  publish: z.boolean().default(true),
});
export type CreateLectureRequest = z.infer<typeof createLectureRequestSchema>;

export const addMaterialRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(1000).nullable().default(null),
    ordinal: z.number().int().min(0).max(9999).default(0),
    fileId: uuidSchema.nullable().default(null),
    externalUrl: z.string().url().max(2000).nullable().default(null),
  })
  // Mirrors the `materials_has_target` CHECK, so a bad payload is a 400 with a
  // readable message rather than a constraint violation surfacing as a 500.
  .refine((body) => body.fileId !== null || body.externalUrl !== null, {
    message: 'A material must reference either an uploaded file or an external URL.',
    path: ['fileId'],
  });
export type AddMaterialRequest = z.infer<typeof addMaterialRequestSchema>;

/** Marks how far a student has got. The honest name for it is a signal, not a grade. */
export const lectureProgressRequestSchema = z.object({
  percent: z.number().int().min(0).max(100),
});
export type LectureProgressRequest = z.infer<typeof lectureProgressRequestSchema>;
