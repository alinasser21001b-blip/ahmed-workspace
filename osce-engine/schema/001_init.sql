-- OSCE Knowledge-to-Station Engine - canonical schema
-- Target: Cloudflare D1 (SQLite). Portable to any SQLite 3.35+.
--
-- Design notes that matter for correctness, not style:
--
--   * Every FK is declared. D1 enforces them when `PRAGMA foreign_keys = ON`,
--     which the migration sets. Undeclared FKs on an append-heavy schema like
--     this one are how orphaned occurrences appear.
--
--   * Observation counts are DERIVED. They live in link tables as a cached
--     column recomputed by the publisher from `question_occurrence`, and the
--     views below expose the authoritative recount. Never UPDATE ... SET
--     count = count + 1.
--
--   * Idempotency is enforced by UNIQUE (fingerprint) on question_occurrence,
--     not by application-side checking. Application checks race; the index
--     does not.
--
--   * Indexes follow Section 10.1 exactly, plus the covering indexes the exam
--     path needs. Each carries the query it exists for.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Knowledge path
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS specialty (
  id             TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  active         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (canonical_name)
);

CREATE TABLE IF NOT EXISTS knowledge_document (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  format        TEXT NOT NULL CHECK (format IN ('txt','md','docx','pdf')),
  byte_size     INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,
  object_key    TEXT NOT NULL,
  academic_year INTEGER,
  specialty_id  TEXT REFERENCES specialty(id),
  status        TEXT NOT NULL CHECK (status IN
                  ('RECEIVED','EXTRACTING','REVIEW_REQUIRED','PUBLISHED','FAILED','OCR_REQUIRED')),
  uploaded_at   INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL
);

-- Upload idempotency (Section 4.1). Partial: only completed uploads block a
-- re-upload, so a failed attempt can be retried with the same bytes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_document_content_hash
  ON knowledge_document (content_hash)
  WHERE status <> 'FAILED';

CREATE INDEX IF NOT EXISTS ix_document_status_uploaded
  ON knowledge_document (status, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS extraction_run (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  extractor_version TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','OCR_REQUIRED')),
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  candidate_count   INTEGER NOT NULL DEFAULT 0,
  failure_code      TEXT,
  supersedes_run_id TEXT REFERENCES extraction_run(id)
);

CREATE INDEX IF NOT EXISTS ix_run_document_started
  ON extraction_run (document_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_reference (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  extraction_run_id TEXT NOT NULL REFERENCES extraction_run(id) ON DELETE CASCADE,
  page              INTEGER,
  line_start        INTEGER NOT NULL,
  line_end          INTEGER NOT NULL,
  char_start        INTEGER NOT NULL,
  char_end          INTEGER NOT NULL,
  excerpt           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_source_ref_document
  ON source_reference (document_id, char_start);

CREATE TABLE IF NOT EXISTS examiner (
  id             TEXT PRIMARY KEY,
  specialty_id   TEXT NOT NULL REFERENCES specialty(id),
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases        TEXT NOT NULL DEFAULT '[]',
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  -- Two examiners in one specialty cannot share a normalized name. This is the
  -- database-level half of the "never silently merge" rule: the resolver
  -- refuses to auto-merge, and this refuses to auto-split.
  UNIQUE (specialty_id, normalized_name)
);

-- Section 10.1: Examiner(specialtyId, active)
-- Serves: "list published examiners for a specialty" on the exam path.
CREATE INDEX IF NOT EXISTS ix_examiner_specialty_active
  ON examiner (specialty_id, active);

CREATE TABLE IF NOT EXISTS clinical_case (
  id           TEXT PRIMARY KEY,
  specialty_id TEXT NOT NULL REFERENCES specialty(id),
  title        TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  aliases      TEXT NOT NULL DEFAULT '[]',
  tags         TEXT NOT NULL DEFAULT '[]',
  active       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (specialty_id, normalized_title)
);

CREATE TABLE IF NOT EXISTS question (
  id              TEXT PRIMARY KEY,
  canonical_text  TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  created_at      INTEGER NOT NULL,
  -- Exact-duplicate questions collapse at the database level too.
  UNIQUE (normalized_text)
);

CREATE INDEX IF NOT EXISTS ix_question_category ON question (category);

CREATE TABLE IF NOT EXISTS question_variant (
  id                  TEXT PRIMARY KEY,
  question_id         TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  observed_text       TEXT NOT NULL,
  source_reference_id TEXT NOT NULL REFERENCES source_reference(id) ON DELETE CASCADE,
  language            TEXT NOT NULL CHECK (language IN ('ar','en','mixed'))
);

CREATE INDEX IF NOT EXISTS ix_variant_question ON question_variant (question_id);

-- Near-duplicate blocking index. One row per LSH band per question; the dedup
-- query is an indexed IN over band keys rather than a full scan.
CREATE TABLE IF NOT EXISTS question_lsh_band (
  question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  band_key    TEXT NOT NULL,
  PRIMARY KEY (band_key, question_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS question_occurrence (
  id                  TEXT PRIMARY KEY,
  examiner_id         TEXT NOT NULL REFERENCES examiner(id) ON DELETE CASCADE,
  case_id             TEXT NOT NULL REFERENCES clinical_case(id) ON DELETE CASCADE,
  question_id         TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  academic_year       INTEGER,
  source_reference_id TEXT NOT NULL REFERENCES source_reference(id) ON DELETE CASCADE,
  fingerprint         TEXT NOT NULL,
  published_at        INTEGER NOT NULL,
  -- THE idempotency guarantee. Republishing a document recomputes identical
  -- fingerprints; this index turns the second insert into a no-op rather than
  -- an inflated count.
  UNIQUE (fingerprint)
);

-- Section 10.1: QuestionOccurrence(questionId, examinerId, caseId, reviewStatus)
-- Occurrences are only ever created from approved candidates, so review status
-- is implicit and the index is on the three identity columns plus year, which
-- is what the count recomputation groups by.
CREATE INDEX IF NOT EXISTS ix_occurrence_identity
  ON question_occurrence (examiner_id, case_id, question_id, academic_year);

CREATE INDEX IF NOT EXISTS ix_occurrence_question
  ON question_occurrence (question_id);

CREATE TABLE IF NOT EXISTS expected_answer (
  id                  TEXT PRIMARY KEY,
  question_id         TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  canonical_answer    TEXT NOT NULL,
  key_points          TEXT NOT NULL DEFAULT '[]',   -- JSON array of KeyPoint
  source_type         TEXT NOT NULL CHECK (source_type IN
                        ('SOURCE_RECALL','REVIEWER_CURATED','TEXTBOOK_REFERENCED')),
  approved            INTEGER NOT NULL DEFAULT 0,
  approved_by         TEXT,
  approved_at         INTEGER,
  source_reference_id TEXT REFERENCES source_reference(id)
);

-- One approved answer key per question. Multiple drafts may exist; only one is
-- approved, and the evaluator reads only approved rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_answer_question_approved
  ON expected_answer (question_id)
  WHERE approved = 1;

-- ---------------------------------------------------------------------------
-- Validated associations. `observation_count` is a cache of the view below.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS examiner_case (
  examiner_id       TEXT NOT NULL REFERENCES examiner(id) ON DELETE CASCADE,
  case_id           TEXT NOT NULL REFERENCES clinical_case(id) ON DELETE CASCADE,
  observation_count INTEGER NOT NULL DEFAULT 0,
  first_seen_year   INTEGER,
  last_seen_year    INTEGER,
  published         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (examiner_id, case_id)
) WITHOUT ROWID;

-- Section 10.1: ExaminerCase(examinerId, published)
CREATE INDEX IF NOT EXISTS ix_examiner_case_published
  ON examiner_case (examiner_id, published);

CREATE TABLE IF NOT EXISTS examiner_question (
  examiner_id       TEXT NOT NULL REFERENCES examiner(id) ON DELETE CASCADE,
  case_id           TEXT NOT NULL REFERENCES clinical_case(id) ON DELETE CASCADE,
  question_id       TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  observation_count INTEGER NOT NULL DEFAULT 0,
  last_seen_year    INTEGER,
  published         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (examiner_id, case_id, question_id)
) WITHOUT ROWID;

-- Section 10.1: ExaminerQuestion(examinerId, caseId, published)
-- Covering: includes the columns the compiler reads, so the station query is
-- an index-only scan and never touches the table heap.
CREATE INDEX IF NOT EXISTS ix_examiner_question_pool
  ON examiner_question (examiner_id, case_id, published, question_id, observation_count, last_seen_year);

-- ---------------------------------------------------------------------------
-- Review
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS extraction_candidate (
  id                       TEXT PRIMARY KEY,
  document_id              TEXT NOT NULL REFERENCES knowledge_document(id) ON DELETE CASCADE,
  extraction_run_id        TEXT NOT NULL REFERENCES extraction_run(id) ON DELETE CASCADE,
  type                     TEXT NOT NULL CHECK (type IN ('EXAMINER','CASE','QUESTION','ANSWER')),
  state                    TEXT NOT NULL CHECK (state IN
                             ('PENDING','APPROVED','EDITED','REJECTED','MERGED','PUBLISHED')),
  raw_text                 TEXT NOT NULL,
  proposed_text            TEXT NOT NULL,
  edited_text              TEXT,
  source_reference_id      TEXT NOT NULL REFERENCES source_reference(id) ON DELETE CASCADE,
  confidence               REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  segment_key              TEXT NOT NULL,
  specialty_id             TEXT REFERENCES specialty(id),
  academic_year            INTEGER,
  category                 TEXT,
  merged_into_candidate_id TEXT REFERENCES extraction_candidate(id),
  reviewed_by              TEXT,
  reviewed_at              INTEGER,
  review_note              TEXT
);

-- Section 10.1: ExtractionCandidate(documentId, state, type)
-- Serves the paginated admin review queue. `id` trails the key so that
-- keyset pagination (WHERE id > ?) stays index-ordered - offset pagination on
-- a large document is what makes the admin list slow.
CREATE INDEX IF NOT EXISTS ix_candidate_review_queue
  ON extraction_candidate (document_id, state, type, id);

CREATE INDEX IF NOT EXISTS ix_candidate_segment
  ON extraction_candidate (document_id, segment_key);

-- Cross-document review queue ordered by confidence: lowest-confidence
-- candidates first, because those are where reviewer attention pays off.
CREATE INDEX IF NOT EXISTS ix_candidate_pending_confidence
  ON extraction_candidate (state, confidence)
  WHERE state = 'PENDING';

-- ---------------------------------------------------------------------------
-- Exam path
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS exam_session (
  id                      TEXT PRIMARY KEY,
  student_id              TEXT NOT NULL,
  specialty_id            TEXT NOT NULL REFERENCES specialty(id),
  examiner_id             TEXT NOT NULL REFERENCES examiner(id),
  case_id                 TEXT NOT NULL REFERENCES clinical_case(id),
  phase                   TEXT NOT NULL CHECK (phase IN
                            ('CREATED','PREPARATION','QUESTIONING','COMPLETED','ABANDONED')),
  created_at              INTEGER NOT NULL,
  preparation_ends_at     INTEGER NOT NULL,
  started_at              INTEGER,
  completed_at            INTEGER,
  compiler_seed           TEXT NOT NULL,
  compiler_policy_version TEXT NOT NULL,
  knowledge_version       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_session_student
  ON exam_session (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_session_phase
  ON exam_session (phase, created_at DESC);

CREATE TABLE IF NOT EXISTS session_question (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES exam_session(id) ON DELETE CASCADE,
  question_id      TEXT NOT NULL REFERENCES question(id),
  ord              INTEGER NOT NULL,
  evaluation_ready INTEGER NOT NULL DEFAULT 0,
  selection_reason TEXT NOT NULL DEFAULT '{}',   -- JSON SelectionReason
  UNIQUE (session_id, ord)
);

-- Section 10.1: SessionQuestion(sessionId, order)
CREATE INDEX IF NOT EXISTS ix_session_question_order
  ON session_question (session_id, ord);

CREATE TABLE IF NOT EXISTS student_answer (
  session_question_id  TEXT PRIMARY KEY REFERENCES session_question(id) ON DELETE CASCADE,
  answer_text          TEXT NOT NULL,
  scoring_mode         TEXT NOT NULL CHECK (scoring_mode IN ('AUTOMATIC','SELF')),
  correctness          TEXT CHECK (correctness IN ('CORRECT','PARTIAL','INCORRECT')),
  score                REAL CHECK (score IS NULL OR score BETWEEN 0 AND 1),
  covered_point_ids    TEXT NOT NULL DEFAULT '[]',
  missing_point_ids    TEXT NOT NULL DEFAULT '[]',
  triggered_pitfall_ids TEXT NOT NULL DEFAULT '[]',
  evaluator_version    TEXT,
  submitted_at         INTEGER NOT NULL,
  latency_ms           INTEGER
);

-- Section 10.1: StudentAnswer(sessionQuestionId) - satisfied by the PK.
-- Additional: item statistics group by question, which needs a join path from
-- answer to question that does not scan.
CREATE INDEX IF NOT EXISTS ix_answer_submitted ON student_answer (submitted_at);

-- ---------------------------------------------------------------------------
-- Psychometrics
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS question_stats (
  question_id     TEXT PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
  attempts        INTEGER NOT NULL DEFAULT 0,
  correct         INTEGER NOT NULL DEFAULT 0,
  partial         INTEGER NOT NULL DEFAULT 0,
  -- Elo difficulty rating, updated online per attempt.
  difficulty      REAL NOT NULL DEFAULT 0,
  -- Shrinks with attempts; controls the Elo K factor.
  uncertainty     REAL NOT NULL DEFAULT 1,
  updated_at      INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Authoritative recount views.
--
-- The link tables cache observation_count for read speed on the exam path.
-- These views are the truth, and the publisher recomputes the caches from them.
-- A scheduled job comparing the two is the drift alarm.
-- ---------------------------------------------------------------------------

CREATE VIEW IF NOT EXISTS v_examiner_case_counts AS
SELECT examiner_id,
       case_id,
       COUNT(*)             AS observation_count,
       MIN(academic_year)   AS first_seen_year,
       MAX(academic_year)   AS last_seen_year
FROM question_occurrence
GROUP BY examiner_id, case_id;

CREATE VIEW IF NOT EXISTS v_examiner_question_counts AS
SELECT examiner_id,
       case_id,
       question_id,
       COUNT(*)           AS observation_count,
       MAX(academic_year) AS last_seen_year
FROM question_occurrence
GROUP BY examiner_id, case_id, question_id;

-- The exam-path pool query, as a view so the plan can be inspected with
-- EXPLAIN QUERY PLAN in CI rather than discovered in production.
CREATE VIEW IF NOT EXISTS v_published_question_pool AS
SELECT eq.examiner_id,
       eq.case_id,
       eq.question_id,
       q.canonical_text,
       q.category,
       eq.observation_count,
       eq.last_seen_year,
       CASE WHEN ea.id IS NOT NULL THEN 1 ELSE 0 END AS evaluation_ready
FROM examiner_question eq
JOIN question q ON q.id = eq.question_id
LEFT JOIN expected_answer ea
       ON ea.question_id = eq.question_id AND ea.approved = 1
WHERE eq.published = 1;
