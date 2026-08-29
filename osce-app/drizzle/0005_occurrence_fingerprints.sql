-- Occurrence idempotency and derived observation counts.
--
-- Two problems this addresses, both in question_occurrences.
--
-- 1. IDEMPOTENCY. Occurrences were inserted with a plain INSERT and no natural
--    key, so re-processing a document and re-approving its candidates created a
--    second row for the same evidence in the same source file at the same
--    offset. The engineering framework's acceptance test - "duplicate
--    re-publish: observation count does not inflate" - had nothing enforcing it.
--
-- 2. DERIVED COUNTS. observation_count, first_observed_year and
--    last_observed_year on examiner_cases and examiner_questions were declared
--    but never written by any code path, so every row held the DEFAULT 0 and
--    NULL. The historical-frequency signal the product is built on - "this
--    examiner asked this question five times" - did not exist. The station
--    selection score weights it at 0.45, against a value that was always zero.
--
-- The fingerprint column is nullable so this migration is purely additive and
-- existing rows remain valid. SQLite treats NULLs as distinct in a UNIQUE
-- index, so any number of legacy rows may carry NULL while the constraint
-- still binds every row written after this migration. Verified against the
-- production database: two NULL rows insert cleanly, a repeated fingerprint
-- does not.
--
-- The index is deliberately NOT partial. A partial unique index
-- (... WHERE fingerprint IS NOT NULL) cannot be named as an ON CONFLICT target
-- with a bare column list - SQLite rejects it with
--   "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
-- which would make every publish throw at runtime. Since NULLs are already
-- distinct in a plain unique index, the partial predicate bought nothing and
-- cost correctness.
--
-- Counts are RECOMPUTED from occurrences at publish time, never incremented.
-- An increment is a cached aggregate that drifts the first time anything is
-- deleted or replayed; a recount converges from any starting state.

ALTER TABLE question_occurrences ADD COLUMN fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_question_occurrences_fingerprint
  ON question_occurrences(fingerprint);

-- Supports the recount queries below.
CREATE INDEX IF NOT EXISTS idx_occurrences_examiner_case_question
  ON question_occurrences(examiner_id, case_id, question_id);

-- Backfill the counts that were never populated, from the evidence already
-- present. Safe to re-run: both statements are full recomputations.
UPDATE examiner_cases SET
  observation_count = (
    SELECT COUNT(*) FROM question_occurrences o
    WHERE o.examiner_id = examiner_cases.examiner_id
      AND o.case_id = examiner_cases.case_id
      AND o.review_status = 'APPROVED'),
  first_observed_year = (
    SELECT MIN(o.year) FROM question_occurrences o
    WHERE o.examiner_id = examiner_cases.examiner_id
      AND o.case_id = examiner_cases.case_id
      AND o.review_status = 'APPROVED'),
  last_observed_year = (
    SELECT MAX(o.year) FROM question_occurrences o
    WHERE o.examiner_id = examiner_cases.examiner_id
      AND o.case_id = examiner_cases.case_id
      AND o.review_status = 'APPROVED');

UPDATE examiner_questions SET
  observation_count = (
    SELECT COUNT(*) FROM question_occurrences o
    WHERE o.examiner_id = examiner_questions.examiner_id
      AND o.question_id = examiner_questions.question_id
      AND (o.case_id IS examiner_questions.case_id)
      AND o.review_status = 'APPROVED'),
  first_observed_year = (
    SELECT MIN(o.year) FROM question_occurrences o
    WHERE o.examiner_id = examiner_questions.examiner_id
      AND o.question_id = examiner_questions.question_id
      AND (o.case_id IS examiner_questions.case_id)
      AND o.review_status = 'APPROVED'),
  last_observed_year = (
    SELECT MAX(o.year) FROM question_occurrences o
    WHERE o.examiner_id = examiner_questions.examiner_id
      AND o.question_id = examiner_questions.question_id
      AND (o.case_id IS examiner_questions.case_id)
      AND o.review_status = 'APPROVED');
