-- 0006_ai_moderation_platform.sql
-- AI auditability, notifications, moderation, analytics, audit log.
--
-- The AI tables exist in Phase 0 — before a single LLM call ships — because
-- retrofitting auditability is how systems end up unable to answer "why did the
-- model say that?". Every AI answer must be reconstructible: which model, which
-- prompt, which retrieved sources, how long it took, what it cost (§31).

-- ---------------------------------------------------------------------------
-- AI
-- ---------------------------------------------------------------------------

CREATE TYPE ai_message_role AS ENUM ('system', 'user', 'assistant');

CREATE TABLE ai_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the session is grounded in. All nullable: a free-form "ask AI" has
  -- none, a lecture tutor has all three.
  course_id    uuid REFERENCES courses(id) ON DELETE SET NULL,
  lecture_id   uuid REFERENCES lectures(id) ON DELETE SET NULL,
  group_id     uuid REFERENCES groups(id) ON DELETE SET NULL,
  mode         text NOT NULL DEFAULT 'ask',
  title        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_sessions_mode CHECK (
    mode IN ('ask', 'explain', 'teach', 'quiz_me', 'hint', 'compare',
             'case', 'review', 'summary', 'generate_mcq', 'group_summary')
  )
);
CREATE INDEX ai_sessions_user_idx ON ai_sessions (user_id, updated_at DESC);
CREATE TRIGGER ai_sessions_set_updated_at BEFORE UPDATE ON ai_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE quizzes
  ADD CONSTRAINT quizzes_ai_session_fk
  FOREIGN KEY (ai_session_id) REFERENCES ai_sessions(id) ON DELETE SET NULL;

CREATE TABLE ai_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
  role          ai_message_role NOT NULL,
  content       text NOT NULL,
  -- Observability + cost accounting, recorded per exchange (§31, §82).
  model         text,
  provider      text,
  latency_ms    integer,
  prompt_tokens integer,
  completion_tokens integer,
  -- Set when the model's answer was not fully grounded, so the UI can render
  -- an honest uncertainty affordance instead of a confident-looking answer.
  grounded      boolean,
  error_code    text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_session_idx ON ai_messages (session_id, created_at);
CREATE INDEX ai_messages_errors_idx ON ai_messages (created_at DESC) WHERE error_code IS NOT NULL;

-- Citations. A row here is PROOF that a source was actually retrieved and
-- passed to the model. The citation validator rejects any reference in the
-- model output that has no corresponding row — this is the mechanism that
-- makes "never fabricate citations" (§28) enforceable rather than hopeful.
CREATE TABLE ai_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  source_kind   text NOT NULL,
  source_id     uuid,
  -- Human-facing citation label, e.g. "Lecture 07 · slide 14".
  label         text NOT NULL,
  excerpt       text,
  locator       text,
  relevance     real,
  CONSTRAINT ai_sources_kind CHECK (
    source_kind IN ('lecture', 'material', 'resource', 'content', 'quiz',
                    'message', 'transcript', 'general_knowledge')
  )
);
CREATE INDEX ai_sources_message_idx ON ai_sources (message_id);

-- Rate/cost guardrail, checked before dispatching to a provider.
CREATE TABLE ai_usage_daily (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day           date NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  prompt_tokens bigint NOT NULL DEFAULT 0,
  completion_tokens bigint NOT NULL DEFAULT 0,
  error_count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ---------------------------------------------------------------------------
-- Notifications (§33)
-- ---------------------------------------------------------------------------

CREATE TYPE notification_category AS ENUM
  ('social', 'communication', 'academic', 'live', 'learning', 'moderation');

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    notification_category NOT NULL,
  kind        text NOT NULL,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  target_kind text,
  target_id   uuid,
  title       text NOT NULL,
  body        text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- The unread badge query.
CREATE INDEX notifications_unread_idx
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_preferences (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    notification_category NOT NULL,
  in_app      boolean NOT NULL DEFAULT true,
  push        boolean NOT NULL DEFAULT true,
  email       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, category)
);

CREATE TABLE push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  platform    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT push_tokens_platform CHECK (platform IN ('ios', 'android', 'web'))
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Moderation (§39) — built on day one, not bolted on after the first incident.
-- ---------------------------------------------------------------------------

CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');
CREATE TYPE moderation_action_kind AS ENUM
  ('dismiss', 'warn', 'remove_content', 'restrict', 'suspend', 'ban', 'unban', 'restore_content');

CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  reason        text NOT NULL,
  details       text,
  status        report_status NOT NULL DEFAULT 'open',

  -- Exactly one target. Nullable FKs preserve referential integrity, which a
  -- (target_type, target_id) pair cannot.
  content_id    uuid REFERENCES content_items(id) ON DELETE CASCADE,
  comment_id    uuid REFERENCES comments(id) ON DELETE CASCADE,
  message_id    uuid REFERENCES messages(id) ON DELETE CASCADE,
  group_id      uuid REFERENCES groups(id) ON DELETE CASCADE,
  community_id  uuid REFERENCES communities(id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  file_id       uuid REFERENCES files(id) ON DELETE CASCADE,

  resolved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reports_exactly_one_target CHECK (
    (content_id IS NOT NULL)::int + (comment_id IS NOT NULL)::int
    + (message_id IS NOT NULL)::int + (group_id IS NOT NULL)::int
    + (community_id IS NOT NULL)::int + (profile_id IS NOT NULL)::int
    + (file_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT reports_reason CHECK (
    reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence',
               'misinformation', 'academic_dishonesty', 'copyright', 'other')
  )
);
CREATE INDEX reports_open_idx ON reports (created_at DESC) WHERE status IN ('open', 'reviewing');
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at DESC);

CREATE TABLE moderation_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     uuid REFERENCES reports(id) ON DELETE SET NULL,
  moderator_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action        moderation_action_kind NOT NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  target_kind   text,
  target_id     uuid,
  reason        text NOT NULL,
  notes         text,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_user_idx ON moderation_actions (target_user_id, created_at DESC);
CREATE INDEX moderation_actions_moderator_idx ON moderation_actions (moderator_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Platform: audit log and analytics events
-- ---------------------------------------------------------------------------

-- Append-only record of privileged actions (§50). Distinct from
-- moderation_actions: this covers every admin mutation, moderation included.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_kind text,
  target_id   uuid,
  before      jsonb,
  after       jsonb,
  request_id  text,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_kind, target_id, created_at DESC);

-- Product analytics (§83). Deliberately separate from learning_events: these
-- are behavioural, those are the learning record. No PII beyond user_id.
CREATE TABLE analytics_events (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  name        text NOT NULL,
  properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_id  text,
  platform    text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_name_time_idx ON analytics_events (name, occurred_at DESC);
CREATE INDEX analytics_events_user_time_idx ON analytics_events (user_id, occurred_at DESC);
