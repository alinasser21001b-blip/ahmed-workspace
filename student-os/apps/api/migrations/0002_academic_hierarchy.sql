-- 0002_academic_hierarchy.sql
-- The academic hierarchy is DATA, never code (§8). Nothing about Medicine,
-- Baghdad, or "5th year" is hardcoded anywhere in the application; a new
-- cohort, faculty or discipline is a set of row inserts.
--
-- Two distinct concepts that the Constitution lists side by side and that are
-- easy to conflate, so they are separated explicitly here:
--   * stages         — level of study within a program ("Stage 5", "Year 2")
--   * academic_years — the calendar term ("2025/2026") a course runs in
--
-- Hierarchy:
--   university → college → program → stage
--                            ↘ course (program + stage + academic_year)
--                                ↘ subject → topic (self-nesting)

-- ---------------------------------------------------------------------------
-- Institutions
-- ---------------------------------------------------------------------------

CREATE TABLE universities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  country     text,
  city        text,
  logo_url    text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER universities_set_updated_at BEFORE UPDATE ON universities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE colleges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id  uuid NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  slug           text NOT NULL,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, slug)
);
CREATE INDEX colleges_university_idx ON colleges (university_id);
CREATE TRIGGER colleges_set_updated_at BEFORE UPDATE ON colleges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE programs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id   uuid NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
  slug         text NOT NULL,
  name_ar      text NOT NULL,
  name_en      text NOT NULL,
  degree_type  text,                       -- e.g. bachelor, master
  duration_years smallint,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, slug)
);
CREATE INDEX programs_college_idx ON programs (college_id);
CREATE TRIGGER programs_set_updated_at BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Level of study within a program. ordinal drives sorting and progression.
CREATE TABLE stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  ordinal     smallint NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, ordinal)
);
CREATE INDEX stages_program_idx ON stages (program_id);
CREATE TRIGGER stages_set_updated_at BEFORE UPDATE ON stages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Calendar term, scoped to a university.
CREATE TABLE academic_years (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id  uuid NOT NULL REFERENCES universities(id) ON DELETE CASCADE,
  label          text NOT NULL,             -- "2025/2026"
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  is_current     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, label),
  CONSTRAINT academic_years_range CHECK (ends_on > starts_on)
);
-- At most one current academic year per university.
CREATE UNIQUE INDEX academic_years_one_current
  ON academic_years (university_id) WHERE is_current;

-- ---------------------------------------------------------------------------
-- Courses → subjects → topics
-- ---------------------------------------------------------------------------

CREATE TABLE courses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  stage_id          uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  academic_year_id  uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  code              text,                   -- "PED-501"
  slug              text NOT NULL,
  name_ar           text NOT NULL,
  name_en           text NOT NULL,
  description       text,
  cover_url         text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, stage_id, slug)
);
CREATE INDEX courses_stage_idx ON courses (stage_id) WHERE is_active;
CREATE INDEX courses_program_idx ON courses (program_id);
CREATE TRIGGER courses_set_updated_at BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  ordinal     smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, slug)
);
CREATE INDEX subjects_course_idx ON subjects (course_id, ordinal);
CREATE TRIGGER subjects_set_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Topics are the atom of the Learning Graph: quizzes, weakness, recommendations
-- and semantic search all resolve to a topic.
CREATE TABLE topics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id       uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  parent_topic_id  uuid REFERENCES topics(id) ON DELETE CASCADE,
  slug             text NOT NULL,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  ordinal          smallint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, slug)
);
CREATE INDEX topics_subject_idx ON topics (subject_id, ordinal);
CREATE INDEX topics_parent_idx ON topics (parent_topic_id) WHERE parent_topic_id IS NOT NULL;
CREATE TRIGGER topics_set_updated_at BEFORE UPDATE ON topics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Profiles
--
-- Split from `users` deliberately: `users` holds credentials and account state
-- (read on every request, must stay narrow), `profiles` holds the public-facing
-- academic identity (read when rendering people and content).
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle             text NOT NULL,
  display_name       text NOT NULL,
  avatar_url         text,
  bio                text,
  university_id      uuid REFERENCES universities(id) ON DELETE SET NULL,
  college_id         uuid REFERENCES colleges(id) ON DELETE SET NULL,
  program_id         uuid REFERENCES programs(id) ON DELETE SET NULL,
  stage_id           uuid REFERENCES stages(id) ON DELETE SET NULL,
  academic_year_id   uuid REFERENCES academic_years(id) ON DELETE SET NULL,
  -- Contribution-based reputation (§37). Follower count is deliberately NOT a
  -- component of this score; it is stored separately for display only.
  contribution_score integer NOT NULL DEFAULT 0,
  follower_count     integer NOT NULL DEFAULT 0,
  following_count    integer NOT NULL DEFAULT 0,
  onboarding_completed_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT profiles_handle_format CHECK (handle ~ '^[a-z0-9_]{3,30}$'),
  CONSTRAINT profiles_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 80),
  CONSTRAINT profiles_bio_len CHECK (bio IS NULL OR char_length(bio) <= 500),
  CONSTRAINT profiles_score_nonneg CHECK (contribution_score >= 0)
);

CREATE UNIQUE INDEX profiles_handle_key ON profiles (lower(handle));
-- The cohort index: "everyone in my college + stage" is the single hottest
-- audience query in the product (feed scope, member lists, suggestions).
CREATE INDEX profiles_cohort_idx ON profiles (college_id, stage_id);
CREATE INDEX profiles_university_idx ON profiles (university_id);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Declared academic interests, used for feed relevance and recommendations.
CREATE TABLE profile_interests (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id    uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);
CREATE INDEX profile_interests_topic_idx ON profile_interests (topic_id);

-- ---------------------------------------------------------------------------
-- Privacy settings (§41)
--
-- One row per user, created with the profile. Defaults are cohort-scoped
-- rather than public: privacy-first means the safe value is the default.
-- ---------------------------------------------------------------------------

CREATE TABLE privacy_settings (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_visibility     visibility NOT NULL DEFAULT 'stage',
  default_post_visibility visibility NOT NULL DEFAULT 'stage',
  who_can_message        visibility NOT NULL DEFAULT 'stage',
  show_online_status     boolean NOT NULL DEFAULT true,
  show_last_seen         boolean NOT NULL DEFAULT true,
  show_activity          boolean NOT NULL DEFAULT true,
  searchable             boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER privacy_settings_set_updated_at BEFORE UPDATE ON privacy_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Enrollment — the edge that grants course-scoped read access
-- ---------------------------------------------------------------------------

CREATE TABLE course_enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  role        membership_role NOT NULL DEFAULT 'member',
  status      membership_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX course_enrollments_course_idx ON course_enrollments (course_id) WHERE status = 'active';
CREATE INDEX course_enrollments_user_idx ON course_enrollments (user_id) WHERE status = 'active';
