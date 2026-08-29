CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at
  ON knowledge_documents(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_published_examiners_specialty_active
  ON published_examiners(specialty_id, active);
CREATE INDEX IF NOT EXISTS idx_examiner_cases_examiner
  ON examiner_cases(examiner_id);
CREATE INDEX IF NOT EXISTS idx_examiner_questions_examiner_case
  ON examiner_questions(examiner_id, case_id);
CREATE INDEX IF NOT EXISTS idx_published_questions_normalized
  ON published_questions(normalized_text);
