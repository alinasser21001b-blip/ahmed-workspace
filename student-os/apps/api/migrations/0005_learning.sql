-- 0005_learning.sql
-- Classrooms, lectures, materials, quizzes, flashcards, study sessions, live
-- sessions, and the Learning Graph.
--
-- The rule that shapes this whole file: quiz results are stored at
-- QUESTION level, never as a bare final score (§20). A score of 6/10 tells you
-- nothing actionable; six correct answers tagged to topics tells you exactly
-- which topic to review. Weakness detection, recommendations and the
-- personalised feed all depend on that granularity existing from day one.

-- ---------------------------------------------------------------------------
-- Classrooms
-- ---------------------------------------------------------------------------

CREATE TABLE classrooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  cover_url    text,
  instructor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  visibility   visibility NOT NULL DEFAULT 'course',
  join_code    text UNIQUE,
  is_archived  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classrooms_course_idx ON classrooms (course_id) WHERE NOT is_archived;
CREATE TRIGGER classrooms_set_updated_at BEFORE UPDATE ON classrooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Deferred FK from the content spine (classrooms did not exist in 0003).
ALTER TABLE content_items
  ADD CONSTRAINT content_items_classroom_fk
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE;

CREATE TABLE classroom_members (
  classroom_id  uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          membership_role NOT NULL DEFAULT 'member',
  status        membership_status NOT NULL DEFAULT 'active',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, user_id)
);
CREATE INDEX classroom_members_user_idx ON classroom_members (user_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Lectures (§18)
--
-- A lecture is NOT a PDF viewer. It is a hub: original material, summary,
-- objectives, key concepts, quiz, flashcards, discussion, related reels, AI
-- tutor. The columns below are the hub's own data; the spokes are separate
-- tables/edges pointing back at lecture_id.
-- ---------------------------------------------------------------------------

CREATE TABLE lectures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id  uuid REFERENCES classrooms(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  subject_id    uuid REFERENCES subjects(id) ON DELETE SET NULL,
  title         text NOT NULL,
  description   text,
  ordinal       smallint NOT NULL DEFAULT 0,
  -- AI-generated, regenerable, always attributable. Never overwrites the
  -- instructor's own text: those are separate columns for a reason.
  ai_summary    text,
  ai_summary_generated_at timestamptz,
  learning_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_concepts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_minutes integer,
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  visibility    visibility NOT NULL DEFAULT 'course',
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX lectures_classroom_idx ON lectures (classroom_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX lectures_course_idx ON lectures (course_id, ordinal) WHERE deleted_at IS NULL;
CREATE TRIGGER lectures_set_updated_at BEFORE UPDATE ON lectures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lecture_topics (
  lecture_id  uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  topic_id    uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (lecture_id, topic_id)
);
CREATE INDEX lecture_topics_topic_idx ON lecture_topics (topic_id);

-- Materials attached to a lecture or standalone in a classroom.
CREATE TABLE materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id  uuid REFERENCES classrooms(id) ON DELETE CASCADE,
  lecture_id    uuid REFERENCES lectures(id) ON DELETE CASCADE,
  file_id       uuid REFERENCES files(id) ON DELETE SET NULL,
  external_url  text,
  title         text NOT NULL,
  description   text,
  ordinal       smallint NOT NULL DEFAULT 0,
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT materials_has_target CHECK (file_id IS NOT NULL OR external_url IS NOT NULL),
  CONSTRAINT materials_has_parent CHECK (classroom_id IS NOT NULL OR lecture_id IS NOT NULL)
);
CREATE INDEX materials_lecture_idx ON materials (lecture_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX materials_classroom_idx ON materials (classroom_id, ordinal) WHERE deleted_at IS NULL;

CREATE TABLE assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  lecture_id   uuid REFERENCES lectures(id) ON DELETE SET NULL,
  title        text NOT NULL,
  instructions text,
  due_at       timestamptz,
  points       integer,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX assignments_classroom_idx ON assignments (classroom_id, due_at) WHERE deleted_at IS NULL;
CREATE TRIGGER assignments_set_updated_at BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE assignment_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          text,
  file_id       uuid REFERENCES files(id) ON DELETE SET NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  score         numeric(6,2),
  feedback      text,
  graded_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  graded_at     timestamptz,
  UNIQUE (assignment_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Quizzes (§20)
-- ---------------------------------------------------------------------------

CREATE TYPE quiz_question_kind AS ENUM ('mcq_single', 'mcq_multi', 'true_false', 'short_answer');
CREATE TYPE difficulty_level   AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE attempt_status     AS ENUM ('in_progress', 'submitted', 'graded', 'abandoned');

CREATE TABLE quizzes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid REFERENCES courses(id) ON DELETE CASCADE,
  classroom_id  uuid REFERENCES classrooms(id) ON DELETE CASCADE,
  lecture_id    uuid REFERENCES lectures(id) ON DELETE CASCADE,
  group_id      uuid REFERENCES groups(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  difficulty    difficulty_level NOT NULL DEFAULT 'medium',
  time_limit_seconds integer,
  -- Provenance: a quiz the AI generated is labelled as such forever, so that
  -- students and instructors can judge it accordingly (§30 auditability).
  origin        text NOT NULL DEFAULT 'human',
  ai_session_id uuid,          -- FK added in 0006
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  visibility    visibility NOT NULL DEFAULT 'course',
  question_count integer NOT NULL DEFAULT 0,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT quizzes_origin CHECK (origin IN ('human', 'ai_generated', 'ai_assisted')),
  CONSTRAINT quizzes_time_limit CHECK (time_limit_seconds IS NULL OR time_limit_seconds > 0)
);
CREATE INDEX quizzes_lecture_idx ON quizzes (lecture_id) WHERE deleted_at IS NULL AND lecture_id IS NOT NULL;
CREATE INDEX quizzes_course_idx ON quizzes (course_id) WHERE deleted_at IS NULL;
CREATE TRIGGER quizzes_set_updated_at BEFORE UPDATE ON quizzes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quiz_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  -- The topic edge. Without it, question-level performance cannot roll up into
  -- the Learning Graph, and "weak topics" is impossible.
  topic_id    uuid REFERENCES topics(id) ON DELETE SET NULL,
  kind        quiz_question_kind NOT NULL DEFAULT 'mcq_single',
  prompt      text NOT NULL,
  explanation text,
  difficulty  difficulty_level NOT NULL DEFAULT 'medium',
  points      integer NOT NULL DEFAULT 1,
  ordinal     smallint NOT NULL DEFAULT 0,
  -- For short_answer, the accepted answers; unused for MCQ.
  accepted_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_questions_points CHECK (points > 0)
);
CREATE INDEX quiz_questions_quiz_idx ON quiz_questions (quiz_id, ordinal);
CREATE INDEX quiz_questions_topic_idx ON quiz_questions (topic_id) WHERE topic_id IS NOT NULL;

CREATE TABLE quiz_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  label        text NOT NULL,
  is_correct   boolean NOT NULL DEFAULT false,
  ordinal      smallint NOT NULL DEFAULT 0
);
CREATE INDEX quiz_options_question_idx ON quiz_options (question_id, ordinal);

CREATE TABLE quiz_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id      uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       attempt_status NOT NULL DEFAULT 'in_progress',
  started_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  score        numeric(6,2),
  max_score    numeric(6,2),
  duration_seconds integer,
  CONSTRAINT quiz_attempts_score_range CHECK (
    score IS NULL OR max_score IS NULL OR (score >= 0 AND score <= max_score)
  )
);
CREATE INDEX quiz_attempts_user_idx ON quiz_attempts (user_id, started_at DESC);
CREATE INDEX quiz_attempts_quiz_idx ON quiz_attempts (quiz_id, started_at DESC);
-- A user may hold only one in-progress attempt per quiz.
CREATE UNIQUE INDEX quiz_attempts_one_active
  ON quiz_attempts (quiz_id, user_id) WHERE status = 'in_progress';

-- Question-level performance. THIS is the Learning Graph's raw input.
CREATE TABLE quiz_answers (
  attempt_id     uuid NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  selected_option_ids uuid[] NOT NULL DEFAULT '{}',
  text_answer    text,
  is_correct     boolean,
  points_awarded numeric(6,2) NOT NULL DEFAULT 0,
  answered_at    timestamptz NOT NULL DEFAULT now(),
  time_spent_seconds integer,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX quiz_answers_question_idx ON quiz_answers (question_id);

-- ---------------------------------------------------------------------------
-- Flashcards (§21)
-- Schema is spaced-repetition ready (SM-2 style fields) even though V1 ships
-- only seen/correct/incorrect. Adding the algorithm later must not require a
-- migration.
-- ---------------------------------------------------------------------------

CREATE TABLE flashcard_decks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  course_id   uuid REFERENCES courses(id) ON DELETE CASCADE,
  topic_id    uuid REFERENCES topics(id) ON DELETE SET NULL,
  lecture_id  uuid REFERENCES lectures(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  origin      text NOT NULL DEFAULT 'human',
  visibility  visibility NOT NULL DEFAULT 'private',
  card_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT flashcard_decks_origin CHECK (origin IN ('human', 'ai_generated', 'ai_assisted'))
);
CREATE INDEX flashcard_decks_owner_idx ON flashcard_decks (owner_id) WHERE deleted_at IS NULL;
CREATE TRIGGER flashcard_decks_set_updated_at BEFORE UPDATE ON flashcard_decks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE flashcards (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id   uuid NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  topic_id  uuid REFERENCES topics(id) ON DELETE SET NULL,
  front     text NOT NULL,
  back      text NOT NULL,
  hint      text,
  ordinal   smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX flashcards_deck_idx ON flashcards (deck_id, ordinal);

CREATE TABLE flashcard_progress (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flashcard_id   uuid NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  seen_count     integer NOT NULL DEFAULT 0,
  correct_count  integer NOT NULL DEFAULT 0,
  incorrect_count integer NOT NULL DEFAULT 0,
  confidence     smallint,                    -- 0..5, learner self-report
  -- Spaced repetition fields, unused in V1, present so V2 is a code change only.
  ease_factor    real NOT NULL DEFAULT 2.5,
  interval_days  integer NOT NULL DEFAULT 0,
  repetitions    integer NOT NULL DEFAULT 0,
  due_at         timestamptz,
  last_reviewed_at timestamptz,
  PRIMARY KEY (user_id, flashcard_id),
  CONSTRAINT flashcard_confidence_range CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 5)
);
CREATE INDEX flashcard_progress_due_idx ON flashcard_progress (user_id, due_at) WHERE due_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Study sessions (§22) and live sessions (§23)
-- ---------------------------------------------------------------------------

CREATE TYPE session_status AS ENUM ('scheduled', 'active', 'completed', 'cancelled');

CREATE TABLE study_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid REFERENCES groups(id) ON DELETE CASCADE,
  course_id   uuid REFERENCES courses(id) ON DELETE SET NULL,
  topic_id    uuid REFERENCES topics(id) ON DELETE SET NULL,
  title       text NOT NULL,
  goal        text,
  status      session_status NOT NULL DEFAULT 'scheduled',
  starts_at   timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 50,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_sessions_duration CHECK (duration_minutes BETWEEN 5 AND 600)
);
CREATE INDEX study_sessions_group_idx ON study_sessions (group_id, starts_at DESC);
CREATE INDEX study_sessions_upcoming_idx ON study_sessions (starts_at) WHERE status = 'scheduled';
CREATE TRIGGER study_sessions_set_updated_at BEFORE UPDATE ON study_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE study_session_participants (
  session_id   uuid NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at    timestamptz,
  left_at      timestamptz,
  focus_minutes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, user_id)
);

-- Live classes: the app owns the session record; the VIDEO is external (§23).
CREATE TABLE live_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id  uuid REFERENCES classrooms(id) ON DELETE CASCADE,
  course_id     uuid REFERENCES courses(id) ON DELETE SET NULL,
  group_id      uuid REFERENCES groups(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  host_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  status        session_status NOT NULL DEFAULT 'scheduled',
  scheduled_at  timestamptz NOT NULL,
  started_at    timestamptz,
  ended_at      timestamptz,
  -- Opaque references into whichever realtime video provider is configured.
  provider      text,
  provider_room_id text,
  recording_ref text,
  transcript_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  participant_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_sessions_classroom_idx ON live_sessions (classroom_id, scheduled_at DESC);
CREATE INDEX live_sessions_upcoming_idx ON live_sessions (scheduled_at) WHERE status IN ('scheduled', 'active');
CREATE TRIGGER live_sessions_set_updated_at BEFORE UPDATE ON live_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE live_session_participants (
  session_id  uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz,
  role        membership_role NOT NULL DEFAULT 'member',
  PRIMARY KEY (session_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Learning Graph
-- ---------------------------------------------------------------------------

-- Event kinds are DATA, not an enum, so the north-star definition can change
-- without a migration. `is_meaningful` is the flag that defines a "meaningful
-- learning action" (§84).
CREATE TABLE learning_event_kinds (
  kind          text PRIMARY KEY,
  description   text NOT NULL,
  is_meaningful boolean NOT NULL DEFAULT false
);

INSERT INTO learning_event_kinds (kind, description, is_meaningful) VALUES
  ('lecture_opened',                   'Opened a lecture',                          false),
  ('lecture_section_completed',        'Completed a section of a lecture',          true),
  ('resource_opened',                  'Opened a resource',                         false),
  ('reel_viewed',                      'Watched an educational reel',               false),
  ('reel_completed',                   'Watched an educational reel to the end',    false),
  ('quiz_started',                     'Started a quiz attempt',                    false),
  ('quiz_completed',                   'Completed and submitted a quiz',            true),
  ('flashcards_reviewed',              'Reviewed a flashcard set',                  true),
  ('academic_discussion_participated', 'Posted a substantive academic reply',       true),
  ('study_session_completed',          'Completed a study session',                 true),
  ('ai_learning_interaction',          'Completed a grounded AI learning exchange', true),
  ('live_session_attended',            'Attended a live class',                     true);

CREATE TABLE learning_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL REFERENCES learning_event_kinds(kind),
  course_id   uuid REFERENCES courses(id) ON DELETE SET NULL,
  topic_id    uuid REFERENCES topics(id) ON DELETE SET NULL,
  subject_ref_kind text,
  subject_ref_id   uuid,
  value       numeric(10,2),
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
-- The north-star query: distinct users with a meaningful event in a window.
CREATE INDEX learning_events_user_time_idx ON learning_events (user_id, occurred_at DESC);
CREATE INDEX learning_events_kind_time_idx ON learning_events (kind, occurred_at DESC);
CREATE INDEX learning_events_topic_idx ON learning_events (topic_id, occurred_at DESC) WHERE topic_id IS NOT NULL;

-- Per-topic mastery signal. Deliberately named a SIGNAL, not "mastery" or
-- "knowledge": these numbers measure activity and accuracy, not learning (§35).
CREATE TABLE learning_progress (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id         uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  questions_seen   integer NOT NULL DEFAULT 0,
  questions_correct integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  -- 0..1, higher = weaker. Computed in @sos/core from accuracy + recency +
  -- volume, with an explicit low-confidence band when the sample is tiny.
  weakness_score   real,
  confidence       real,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id),
  CONSTRAINT learning_progress_counts CHECK (
    questions_seen >= 0 AND questions_correct >= 0 AND questions_correct <= questions_seen
  ),
  CONSTRAINT learning_progress_weakness_range CHECK (
    weakness_score IS NULL OR (weakness_score >= 0 AND weakness_score <= 1)
  )
);
CREATE INDEX learning_progress_weak_idx
  ON learning_progress (user_id, weakness_score DESC NULLS LAST);

-- "Continue learning" state.
CREATE TABLE lecture_progress (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lecture_id   uuid NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  position     integer NOT NULL DEFAULT 0,
  percent      smallint NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lecture_id),
  CONSTRAINT lecture_progress_percent CHECK (percent BETWEEN 0 AND 100)
);
CREATE INDEX lecture_progress_recent_idx ON lecture_progress (user_id, last_seen_at DESC);
