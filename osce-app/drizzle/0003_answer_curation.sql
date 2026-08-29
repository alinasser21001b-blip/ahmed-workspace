CREATE TABLE IF NOT EXISTS question_answer_curations (
  question_id TEXT PRIMARY KEY,
  explanation TEXT,
  curator_source_type TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
