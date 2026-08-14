-- ---------------------------------------------------------------------------
-- 0013 — Practice (Phase 5d): closing the learning loop
--
-- The loop this product is built on runs publish → consume → act, and then
-- stops. `learning_progress` has had three readers since Phase 5 — the Learn
-- tab's focus topics, the topic page's progress block, and the feed's
-- `matches_weak_topic` term — and no writer any route could reach. Every one of
-- them therefore returned zero, forever, and `computeWeakness` in `@sos/core`
-- was a tested formula over an empty set.
--
-- The missing half was never schema. `quizzes`, `quiz_questions`,
-- `quiz_options`, `quiz_attempts` and `quiz_answers` have existed since 0005,
-- with the topic edge on the question that makes a roll-up possible at all.
-- What did not exist was anything that ever asked a student a question and
-- wrote down what happened.
--
-- So this migration is small on purpose. Two taxonomy rows and two indexes; no
-- new table, no altered column, no rewritten data. The work is in the service
-- layer, against a schema that was shaped for it five migrations ago.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One more learning-event kind — as a ROW, not schema.
--
-- `learning_event_kinds` has been a reference table since 0005 exactly so that
-- what counts as a meaningful learning action is an INSERT rather than a
-- deploy, and so the north-star metric's definition is auditable in the
-- database rather than inferred from code.
--
-- `practice_question_answered` is deliberately NOT meaningful. One answer is an
-- observation, not an achievement, and counting each of them toward the
-- north-star would let a student inflate the product's headline metric by
-- tapping through a quiz — the precise failure mode the reel kinds were
-- demoted for in 0011. The meaningful unit is `quiz_completed`, which 0005
-- already seeded as `true` and which the practice service emits when the last
-- question of an attempt is answered.
--
-- `question_answered` (0011) is a different event and is not reused here: it
-- means answering another STUDENT'S question, which is a social act with a
-- social signal. Overloading it would make the north-star uninterpretable.
-- ---------------------------------------------------------------------------

INSERT INTO learning_event_kinds (kind, description, is_meaningful) VALUES
  ('practice_question_answered', 'Answered a practice question about a topic', false)
ON CONFLICT (kind) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The two reads practice actually makes.
--
-- Both are on the hot path of every session start, and neither is served by an
-- existing index.
--
-- `quizzes_practicable_idx` supports "which published quiz in one of my courses
-- covers this topic". `quizzes_course_idx` (0005) is close but does not carry
-- `published_at`, so an unpublished draft is fetched and discarded.
--
-- `quiz_questions_topic_quiz_idx` supports the other half — the questions for
-- that topic within that quiz, in author order. `quiz_questions_topic_idx`
-- (0005) covers the topic alone and leaves the quiz filter and the sort to a
-- heap fetch.
-- ---------------------------------------------------------------------------

CREATE INDEX quizzes_practicable_idx
  ON quizzes (course_id, published_at DESC)
  WHERE deleted_at IS NULL AND published_at IS NOT NULL;

CREATE INDEX quiz_questions_topic_quiz_idx
  ON quiz_questions (topic_id, quiz_id, ordinal)
  WHERE topic_id IS NOT NULL;
