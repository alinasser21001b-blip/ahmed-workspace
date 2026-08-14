-- ---------------------------------------------------------------------------
-- 0014 — The attempt records what it is an attempt AT.
--
-- A practice session is one quiz's questions on ONE topic, but `quiz_attempts`
-- (0005) carries only the quiz — and a quiz may hold questions tagged with
-- several topics. Without this column the session's topic exists only in the
-- service's memory of why it picked the quiz, and a submission naming a valid
-- question from a DIFFERENT topic of the same quiz would grade it and roll it
-- into that other topic's progress: an attempt started for Topic A mutating
-- Topic B.
--
-- The topic therefore moves into the attempt row, where the submission path
-- can put it in the WHERE clause that resolves the question — the same
-- filter-in-the-query rule every permission predicate follows (ADR-0003). A
-- question outside the attempt's topic is not found, so it cannot be graded,
-- cannot roll up, and cannot close the attempt.
--
-- Nullable, because rows predating this migration cannot say what they were
-- for. The service treats a null as "no topic restriction", which is exactly
-- the behaviour those rows had when they were written; every attempt created
-- from now on carries its topic.
-- ---------------------------------------------------------------------------

ALTER TABLE quiz_attempts
  ADD COLUMN topic_id uuid REFERENCES topics(id) ON DELETE SET NULL;
