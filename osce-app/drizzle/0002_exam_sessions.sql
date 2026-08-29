CREATE TABLE IF NOT EXISTS exam_sessions (
  id TEXT PRIMARY KEY,
  specialty_id TEXT NOT NULL,
  examiner_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  preparation_ends_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS exam_session_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_order INTEGER NOT NULL,
  UNIQUE(session_id, question_id),
  UNIQUE(session_id, question_order)
);
CREATE TABLE IF NOT EXISTS exam_session_answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  session_question_id TEXT NOT NULL,
  student_answer TEXT NOT NULL,
  scoring_mode TEXT NOT NULL,
  correctness TEXT,
  score REAL,
  covered_points_json TEXT,
  missing_points_json TEXT,
  confidence TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, session_question_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_session_questions_session ON exam_session_questions(session_id, question_order);
CREATE INDEX IF NOT EXISTS idx_exam_session_answers_session ON exam_session_answers(session_id);
