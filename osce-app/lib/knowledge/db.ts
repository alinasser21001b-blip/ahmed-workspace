import { env } from 'cloudflare:workers';

const bindings = env as unknown as CloudflareEnv;
export const DB = bindings.DB;
export const documents = bindings.DOCUMENTS;

const schema = [
  'CREATE TABLE IF NOT EXISTS knowledge_documents (id TEXT PRIMARY KEY, original_filename TEXT NOT NULL, stored_filename TEXT NOT NULL, mime_type TEXT NOT NULL, file_size INTEGER NOT NULL, specialty_id TEXT, source_year INTEGER, source_label TEXT, uploaded_at TEXT NOT NULL, status TEXT NOT NULL, processing_error TEXT, raw_text TEXT, extraction_version TEXT, processed_at TEXT, published_at TEXT)',
  'CREATE TABLE IF NOT EXISTS extraction_runs (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, status TEXT NOT NULL, extractor_version TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, error TEXT, UNIQUE(document_id, extractor_version))',
  'CREATE TABLE IF NOT EXISTS extraction_candidates (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, source_excerpt TEXT NOT NULL, line_start INTEGER, line_end INTEGER, confidence REAL NOT NULL, review_status TEXT NOT NULL DEFAULT \'PENDING\', created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS published_examiners (id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, specialty_id TEXT NOT NULL, aliases_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, is_fixture INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS published_cases (id TEXT PRIMARY KEY, specialty_id TEXT NOT NULL, canonical_title TEXT NOT NULL, aliases_json TEXT NOT NULL, clinical_scenario TEXT, tags_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS published_questions (id TEXT PRIMARY KEY, canonical_text TEXT NOT NULL, normalized_text TEXT NOT NULL, category TEXT NOT NULL, expected_answer TEXT, key_points_json TEXT NOT NULL, answer_source_type TEXT, answer_approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS question_answer_curations (question_id TEXT PRIMARY KEY, explanation TEXT, curator_source_type TEXT NOT NULL, updated_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS source_references (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, candidate_id TEXT, line_start INTEGER, line_end INTEGER, text_excerpt TEXT NOT NULL, extraction_confidence REAL NOT NULL)',
  'CREATE TABLE IF NOT EXISTS question_occurrences (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, examiner_id TEXT, case_id TEXT, question_id TEXT, observed_text TEXT NOT NULL, source_reference_id TEXT NOT NULL, year INTEGER, extraction_confidence REAL NOT NULL, review_status TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS examiner_cases (examiner_id TEXT NOT NULL, case_id TEXT NOT NULL, observation_count INTEGER NOT NULL DEFAULT 0, first_observed_year INTEGER, last_observed_year INTEGER, confidence REAL NOT NULL, PRIMARY KEY (examiner_id, case_id))',
  'CREATE TABLE IF NOT EXISTS examiner_questions (examiner_id TEXT NOT NULL, question_id TEXT NOT NULL, case_id TEXT, observation_count INTEGER NOT NULL DEFAULT 0, first_observed_year INTEGER, last_observed_year INTEGER, confidence REAL NOT NULL, PRIMARY KEY (examiner_id, question_id, case_id))',
  'CREATE TABLE IF NOT EXISTS exam_sessions (id TEXT PRIMARY KEY, specialty_id TEXT NOT NULL, examiner_id TEXT NOT NULL, case_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'ACTIVE\', preparation_ends_at TEXT, created_at TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS exam_session_questions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question_id TEXT NOT NULL, question_order INTEGER NOT NULL, UNIQUE(session_id, question_id), UNIQUE(session_id, question_order))',
  'CREATE TABLE IF NOT EXISTS exam_session_answers (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, session_question_id TEXT NOT NULL, student_answer TEXT NOT NULL, scoring_mode TEXT NOT NULL, correctness TEXT, score REAL, covered_points_json TEXT, missing_points_json TEXT, confidence REAL, created_at TEXT NOT NULL, UNIQUE(session_id, session_question_id))',
  'CREATE INDEX IF NOT EXISTS idx_exam_session_questions_session ON exam_session_questions(session_id, question_order)',
  'CREATE INDEX IF NOT EXISTS idx_exam_session_answers_session ON exam_session_answers(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_candidates_document_status ON extraction_candidates(document_id, review_status)',
  'CREATE INDEX IF NOT EXISTS idx_documents_status ON knowledge_documents(status)',
  'CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at ON knowledge_documents(uploaded_at)',
  'CREATE INDEX IF NOT EXISTS idx_occurrences_question_review ON question_occurrences(question_id, review_status)',
  'CREATE INDEX IF NOT EXISTS idx_published_examiners_specialty_active ON published_examiners(specialty_id, active)',
  'CREATE INDEX IF NOT EXISTS idx_examiner_cases_examiner ON examiner_cases(examiner_id)',
  'CREATE INDEX IF NOT EXISTS idx_examiner_questions_examiner_case ON examiner_questions(examiner_id, case_id)',
  'CREATE INDEX IF NOT EXISTS idx_published_questions_normalized ON published_questions(normalized_text)',
];
let initialized: Promise<void> | undefined;
export function ensureKnowledgeSchema() { initialized ??= DB.batch(schema.map((statement) => DB.prepare(statement))).then(() => undefined); return initialized; }
export const id = () => crypto.randomUUID();
/**
 * Constant-time string equality.
 *
 * `!==` on a secret short-circuits at the first differing byte, so response
 * timing correlates with how much of the token an attacker has guessed. The
 * length is compared first and separately - that leaks only the length, which
 * is not secret - and every byte of the compared region is then examined
 * regardless of where a mismatch occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a); const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}
export function requireAdmin(request: Request) { const configured = bindings.ADMIN_KNOWLEDGE_TOKEN; const supplied = request.headers.get('x-admin-token'); if (!configured || !supplied || !timingSafeEqual(supplied, configured)) throw new Response(JSON.stringify({ error: 'ADMIN_AUTH_REQUIRED' }), { status: configured ? 401 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }
