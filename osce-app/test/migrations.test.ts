import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

/**
 * Applies every migration in order to an in-memory SQLite database, then
 * exercises the statements the application actually issues against it.
 *
 * This exists because of a real defect. Migration 0005 originally created the
 * occurrence fingerprint index as a PARTIAL unique index
 * (... WHERE fingerprint IS NOT NULL). SQLite will not accept a partial index
 * as an ON CONFLICT target with a bare column list, so the publish route's
 * `ON CONFLICT(fingerprint) DO NOTHING` raised
 *   "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
 * at runtime - on every publish. Type checking cannot see that, the build
 * cannot see it, and it only appears when the statement runs against a real
 * schema. So the schema and the statements are tested together here.
 */

async function migratedDatabase(): Promise<DatabaseSync> {
  const dir = new URL('../drizzle/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const db = new DatabaseSync(':memory:');
  for (const file of files) {
    db.exec(await readFile(new URL(file, dir), 'utf8'));
  }
  return db;
}

test('every migration applies in order', async () => {
  const db = await migratedDatabase();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name as string);
  for (const expected of [
    'knowledge_documents', 'extraction_runs', 'extraction_candidates',
    'published_examiners', 'published_cases', 'published_questions',
    'question_occurrences', 'examiner_cases', 'examiner_questions',
    'exam_sessions', 'exam_session_questions', 'exam_session_answers',
  ]) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
  db.close();
});

test('occurrence fingerprint is usable as an ON CONFLICT target', async () => {
  const db = await migratedDatabase();
  const insert = (id: string, fp: string | null) =>
    db
      .prepare(
        `INSERT INTO question_occurrences
           (id, document_id, examiner_id, case_id, question_id, observed_text,
            source_reference_id, year, extraction_confidence, review_status, fingerprint)
         VALUES (?, 'd', 'e', 'c', 'q', 'text', 's', 2025, 0.9, 'APPROVED', ?)
         ON CONFLICT(fingerprint) DO NOTHING`,
      )
      .run(id, fp);

  // The statement itself must be accepted - this is what a partial index breaks.
  assert.equal(insert('a', 'fp-1').changes, 1);
  // A replay of the same evidence must be a no-op, not a second row.
  assert.equal(insert('b', 'fp-1').changes, 0);
  assert.equal(insert('c', 'fp-2').changes, 1);

  const count = db.prepare('SELECT COUNT(*) AS n FROM question_occurrences').get();
  assert.equal(count?.n, 2, 'a replayed fingerprint must not create a second occurrence');
  db.close();
});

test('legacy occurrences with no fingerprint remain insertable', async () => {
  const db = await migratedDatabase();
  const insert = (id: string) =>
    db
      .prepare(
        `INSERT INTO question_occurrences
           (id, document_id, observed_text, source_reference_id, extraction_confidence, review_status, fingerprint)
         VALUES (?, 'd', 'legacy', 's', 0.5, 'APPROVED', NULL)`,
      )
      .run(id);
  // SQLite treats NULLs as distinct in a unique index; rows predating the
  // migration must not collide with each other.
  assert.equal(insert('n1').changes, 1);
  assert.equal(insert('n2').changes, 1);
  db.close();
});

test('an answer cannot be overwritten once recorded', async () => {
  const db = await migratedDatabase();
  const insert = (id: string, answer: string) =>
    db
      .prepare(
        `INSERT INTO exam_session_answers
           (id, session_id, session_question_id, student_answer, scoring_mode, correctness, score, created_at)
         VALUES (?, 's', 'sq', ?, 'AUTOMATIC', 'CORRECT', 1.0, '2026-01-01')
         ON CONFLICT(session_id, session_question_id) DO NOTHING`,
      )
      .run(id, answer);

  assert.equal(insert('a1', 'first answer').changes, 1);
  // The student has now seen the score and the covered/missing points.
  assert.equal(insert('a2', 'improved answer').changes, 0, 'resubmission must be rejected');

  const stored = db.prepare('SELECT student_answer FROM exam_session_answers').get();
  assert.equal(stored?.student_answer, 'first answer', 'the first answer is the one that stands');
  db.close();
});

test('observation counts recompute from approved occurrences', async () => {
  const db = await migratedDatabase();
  db.exec(`
    INSERT INTO examiner_questions (examiner_id, question_id, case_id, confidence) VALUES ('e','q','c',0.9);
    INSERT INTO question_occurrences (id, document_id, examiner_id, case_id, question_id, observed_text, source_reference_id, year, extraction_confidence, review_status, fingerprint)
      VALUES ('o1','d','e','c','q','t','s',2023,0.9,'APPROVED','f1'),
             ('o2','d','e','c','q','t','s',2025,0.9,'APPROVED','f2'),
             ('o3','d','e','c','q','t','s',2024,0.9,'PENDING','f3');
  `);
  // The same recomputation the publish route runs.
  db.prepare(
    `UPDATE examiner_questions SET
       observation_count = (SELECT COUNT(*) FROM question_occurrences o WHERE o.examiner_id = ? AND o.question_id = ? AND o.case_id IS ? AND o.review_status = 'APPROVED'),
       first_observed_year = (SELECT MIN(o.year) FROM question_occurrences o WHERE o.examiner_id = ? AND o.question_id = ? AND o.case_id IS ? AND o.review_status = 'APPROVED'),
       last_observed_year = (SELECT MAX(o.year) FROM question_occurrences o WHERE o.examiner_id = ? AND o.question_id = ? AND o.case_id IS ? AND o.review_status = 'APPROVED')
     WHERE examiner_id = ? AND question_id = ? AND case_id IS ?`,
  ).run('e', 'q', 'c', 'e', 'q', 'c', 'e', 'q', 'c', 'e', 'q', 'c');

  const row = db.prepare('SELECT observation_count, first_observed_year, last_observed_year FROM examiner_questions').get();
  assert.equal(row?.observation_count, 2, 'only APPROVED occurrences count');
  assert.equal(row?.first_observed_year, 2023);
  assert.equal(row?.last_observed_year, 2025);
  db.close();
});
