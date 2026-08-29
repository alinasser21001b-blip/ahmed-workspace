CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  specialty_id TEXT,
  source_year INTEGER,
  source_label TEXT,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL,
  processing_error TEXT,
  raw_text TEXT,
  extraction_version TEXT,
  processed_at TEXT,
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, status TEXT NOT NULL,
  extractor_version TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, error TEXT,
  UNIQUE(document_id, extractor_version)
);
CREATE TABLE IF NOT EXISTS extraction_candidates (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL,
  payload_json TEXT NOT NULL, source_excerpt TEXT NOT NULL, line_start INTEGER,
  line_end INTEGER, confidence REAL NOT NULL, review_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS published_examiners (
  id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL, specialty_id TEXT NOT NULL,
  aliases_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, is_fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS published_cases (
  id TEXT PRIMARY KEY, specialty_id TEXT NOT NULL, canonical_title TEXT NOT NULL,
  aliases_json TEXT NOT NULL, clinical_scenario TEXT, tags_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS published_questions (
  id TEXT PRIMARY KEY, canonical_text TEXT NOT NULL, normalized_text TEXT NOT NULL,
  category TEXT NOT NULL, expected_answer TEXT, key_points_json TEXT NOT NULL,
  answer_source_type TEXT, answer_approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_references (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, candidate_id TEXT, line_start INTEGER, line_end INTEGER,
  text_excerpt TEXT NOT NULL, extraction_confidence REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS question_occurrences (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, examiner_id TEXT, case_id TEXT, question_id TEXT,
  observed_text TEXT NOT NULL, source_reference_id TEXT NOT NULL, year INTEGER,
  extraction_confidence REAL NOT NULL, review_status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS examiner_cases (
  examiner_id TEXT NOT NULL, case_id TEXT NOT NULL, observation_count INTEGER NOT NULL DEFAULT 0,
  first_observed_year INTEGER, last_observed_year INTEGER, confidence REAL NOT NULL,
  PRIMARY KEY (examiner_id, case_id)
);
CREATE TABLE IF NOT EXISTS examiner_questions (
  examiner_id TEXT NOT NULL, question_id TEXT NOT NULL, case_id TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0, first_observed_year INTEGER, last_observed_year INTEGER,
  confidence REAL NOT NULL, PRIMARY KEY (examiner_id, question_id, case_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_document_status ON extraction_candidates(document_id, review_status);
CREATE INDEX IF NOT EXISTS idx_documents_status ON knowledge_documents(status);
CREATE INDEX IF NOT EXISTS idx_occurrences_question_review ON question_occurrences(question_id, review_status);
