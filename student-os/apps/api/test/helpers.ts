import type { AuthSession, ContentItem } from '@sos/contracts';
import { buildApp, type App } from '../src/http/app.js';
import { queryOne, queryRows } from '../src/platform/db.js';

/**
 * Test helpers. `app.inject()` exercises the full HTTP stack — plugins,
 * validation, auth, error handling — without binding a socket.
 */

let app: App | null = null;

export async function getApp(): Promise<App> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  await app?.close();
  app = null;
}

export interface Cohort {
  universityId: string;
  collegeId: string;
  programId: string;
  stage5Id: string;
  stage4Id: string;
  academicYearId: string;
  courseIds: string[];
  topicIds: string[];
}

let cohort: Cohort | null = null;

/** Builds the seed hierarchy once and caches the ids the tests need. */
export async function ensureCohort(): Promise<Cohort> {
  if (cohort) return cohort;

  const university = await queryOne<{ id: string }>(
    `INSERT INTO universities (slug, name_ar, name_en)
     VALUES ('uob', 'جامعة بغداد', 'University of Baghdad')
     ON CONFLICT (slug) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
  );
  const college = await queryOne<{ id: string }>(
    `INSERT INTO colleges (university_id, slug, name_ar, name_en)
     VALUES ($1, 'medicine', 'كلية الطب', 'College of Medicine')
     ON CONFLICT (university_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
    [university!.id],
  );
  const program = await queryOne<{ id: string }>(
    `INSERT INTO programs (college_id, slug, name_ar, name_en)
     VALUES ($1, 'mbchb', 'طب وجراحة', 'MBChB')
     ON CONFLICT (college_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
    [college!.id],
  );
  const stage5 = await queryOne<{ id: string }>(
    `INSERT INTO stages (program_id, ordinal, name_ar, name_en)
     VALUES ($1, 5, 'الخامسة', 'Stage 5')
     ON CONFLICT (program_id, ordinal) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
    [program!.id],
  );
  const stage4 = await queryOne<{ id: string }>(
    `INSERT INTO stages (program_id, ordinal, name_ar, name_en)
     VALUES ($1, 4, 'الرابعة', 'Stage 4')
     ON CONFLICT (program_id, ordinal) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
    [program!.id],
  );
  const year = await queryOne<{ id: string }>(
    `INSERT INTO academic_years (university_id, label, starts_on, ends_on, is_current)
     VALUES ($1, '2025/2026', '2025-10-01', '2026-07-01', true)
     ON CONFLICT (university_id, label) DO UPDATE SET is_current = true RETURNING id`,
    [university!.id],
  );
  const course = await queryOne<{ id: string }>(
    `INSERT INTO courses (program_id, stage_id, academic_year_id, slug, name_ar, name_en)
     VALUES ($1, $2, $3, 'pediatrics', 'طب الأطفال', 'Pediatrics')
     ON CONFLICT (program_id, stage_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
    [program!.id, stage5!.id, year!.id],
  );
  const subject = await queryOne<{ id: string }>(
    `INSERT INTO subjects (course_id, slug, name_ar, name_en)
     VALUES ($1, 'nephrology', 'الكلى', 'Nephrology')
     ON CONFLICT (course_id, slug) DO UPDATE SET name_en = EXCLUDED.name_en RETURNING id`,
    [course!.id],
  );
  await queryOne(
    `INSERT INTO topics (subject_id, slug, name_ar, name_en)
     VALUES ($1, 'nephrotic-syndrome', 'المتلازمة الكلوية', 'Nephrotic Syndrome')
     ON CONFLICT (subject_id, slug) DO NOTHING`,
    [subject!.id],
  );
  const topics = await queryRows<{ id: string }>(`SELECT id FROM topics`);

  cohort = {
    universityId: university!.id,
    collegeId: college!.id,
    programId: program!.id,
    stage5Id: stage5!.id,
    stage4Id: stage4!.id,
    academicYearId: year!.id,
    courseIds: [course!.id],
    topicIds: topics.map((t) => t.id),
  };
  return cohort;
}

let counter = 0;
export function uniqueEmail(prefix = 'student'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@uob.edu.iq`;
}

export function uniqueHandle(prefix = 'std'): string {
  counter += 1;
  return `${prefix}_${counter}_${Math.floor(Math.random() * 100000)}`.slice(0, 30);
}

export async function signupUser(password = 'correct-horse-battery'): Promise<AuthSession> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { email: uniqueEmail(), password, locale: 'ar' },
  });
  if (response.statusCode !== 201) {
    throw new Error(`signup failed (${response.statusCode}): ${response.body}`);
  }
  return response.json<AuthSession>();
}

/** Signs up a user and completes onboarding into the given stage. */
export async function onboardedUser(
  options: { stageId?: string } = {},
): Promise<{ session: AuthSession; handle: string }> {
  const app = await getApp();
  const c = await ensureCohort();
  const session = await signupUser();
  const handle = uniqueHandle();

  const response = await app.inject({
    method: 'POST',
    url: '/v1/me/onboarding',
    headers: { authorization: `Bearer ${session.tokens.accessToken}` },
    payload: {
      handle,
      displayName: 'Test Student',
      universityId: c.universityId,
      collegeId: c.collegeId,
      programId: c.programId,
      stageId: options.stageId ?? c.stage5Id,
      academicYearId: c.academicYearId,
      interestTopicIds: c.topicIds.slice(0, 1),
    },
  });
  if (response.statusCode !== 200) {
    throw new Error(`onboarding failed (${response.statusCode}): ${response.body}`);
  }
  return { session, handle };
}

export function auth(session: AuthSession): { authorization: string } {
  return { authorization: `Bearer ${session.tokens.accessToken}` };
}

// --- Phase 2 helpers --------------------------------------------------------

/**
 * A valid 1×1 PNG.
 *
 * Real bytes, not a stub: the upload path sniffs magic bytes and reads
 * dimensions from the IHDR chunk, so a placeholder would be rejected — which
 * is exactly what the tests are there to verify.
 */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Bytes that are not any image format, used to prove MIME sniffing works. */
export const NOT_AN_IMAGE = Buffer.from('#!/bin/sh\necho definitely not a png\n', 'utf8');

/** Builds a multipart body by hand — `inject` has no form-data helper. */
export function multipartBody(
  bytes: Buffer,
  filename: string,
  declaredMime: string,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----sosTest${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${declaredMime}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export async function uploadImage(
  session: AuthSession,
  bytes: Buffer = TINY_PNG,
  filename = 'photo.png',
  declaredMime = 'image/png',
): Promise<{ statusCode: number; body: { id: string; url: string; width: number | null } }> {
  const app = await getApp();
  const { payload, headers } = multipartBody(bytes, filename, declaredMime);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: { ...headers, ...auth(session) },
    payload,
  });
  return {
    statusCode: response.statusCode,
    body: response.statusCode === 201 ? response.json() : { id: '', url: '', width: null },
  };
}

export async function createPost(
  session: AuthSession,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: ContentItem }> {
  const app = await getApp();
  const response = await app.inject({
    method: 'POST',
    url: '/v1/content',
    headers: auth(session),
    payload,
  });
  return { statusCode: response.statusCode, body: response.json() };
}

export async function readFeed(
  session: AuthSession,
  query = '',
): Promise<{ items: ContentItem[]; nextCursor: string | null }> {
  const app = await getApp();
  const response = await app.inject({
    method: 'GET',
    url: `/v1/feed${query}`,
    headers: auth(session),
  });
  if (response.statusCode !== 200) {
    throw new Error(`feed failed (${response.statusCode}): ${response.body}`);
  }
  return response.json();
}
