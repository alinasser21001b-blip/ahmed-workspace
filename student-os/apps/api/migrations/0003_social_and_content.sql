-- 0003_social_and_content.sql
-- Files, the social graph, communities, and the content spine.
--
-- KEY ARCHITECTURAL DECISION — the content spine (see ADR-0002):
-- `content_items` is a single polymorphic spine carrying everything shared by
-- every feed object: author, academic context, visibility, container, counters,
-- timestamps. Per-kind payload lives in a `*_details` table.
--
-- This is what makes the product one system rather than six:
--   * the feed is ONE indexed query, not a UNION of six differently-shaped tables
--   * reactions / comments / bookmarks / reports / topics point at ONE table
--     with real foreign keys instead of a (target_type, target_id) pair with no
--     referential integrity
--   * academic context and visibility are defined exactly once, so the
--     authorization filter cannot drift between post and reel

-- ---------------------------------------------------------------------------
-- Files — object storage references (§49). Bytes never live in Postgres.
-- ---------------------------------------------------------------------------

CREATE TYPE file_scan_status AS ENUM ('pending', 'clean', 'infected', 'skipped', 'failed');

CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key   text NOT NULL UNIQUE,       -- path within the bucket
  bucket        text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL,
  original_name text,
  checksum      text,
  -- width/height/duration/pages, transcoding outputs, thumbnail keys
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility    visibility NOT NULL DEFAULT 'private',
  -- Malware scanning is not implemented in V1 but the pipeline state is
  -- modelled now so enabling it later is a worker, not a migration (§19).
  scan_status   file_scan_status NOT NULL DEFAULT 'skipped',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT files_size_positive CHECK (size_bytes > 0)
);
CREATE INDEX files_owner_idx ON files (owner_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Social graph: follow / block / mute
-- ---------------------------------------------------------------------------

CREATE TABLE follows (
  follower_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);

-- Blocking is bidirectional in effect (§40): the policy layer checks for a row
-- in EITHER direction before revealing a profile, content, mention or message.
CREATE TABLE blocks (
  blocker_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- Mute is one-directional and non-destructive: the muted party is unaware.
CREATE TYPE mute_target AS ENUM ('user', 'conversation', 'group', 'community', 'topic');

CREATE TABLE mutes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type mute_target NOT NULL,
  target_id   uuid NOT NULL,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target_type, target_id)
);

-- ---------------------------------------------------------------------------
-- Communities
--   university → college → stage → course → community (§13)
-- The scope columns are nullable so a community can sit at any level of the
-- hierarchy; at least one must be set.
-- ---------------------------------------------------------------------------

CREATE TABLE communities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  description    text,
  cover_url      text,
  university_id  uuid REFERENCES universities(id) ON DELETE CASCADE,
  college_id     uuid REFERENCES colleges(id) ON DELETE CASCADE,
  stage_id       uuid REFERENCES stages(id) ON DELETE CASCADE,
  course_id      uuid REFERENCES courses(id) ON DELETE CASCADE,
  visibility     visibility NOT NULL DEFAULT 'stage',
  is_official    boolean NOT NULL DEFAULT false,
  member_count   integer NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,

  CONSTRAINT communities_has_scope CHECK (
    university_id IS NOT NULL OR college_id IS NOT NULL
    OR stage_id IS NOT NULL OR course_id IS NOT NULL
  )
);
CREATE INDEX communities_college_stage_idx ON communities (college_id, stage_id);
CREATE INDEX communities_course_idx ON communities (course_id) WHERE course_id IS NOT NULL;
CREATE TRIGGER communities_set_updated_at BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE community_members (
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          membership_role NOT NULL DEFAULT 'member',
  status        membership_status NOT NULL DEFAULT 'active',
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON community_members (user_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Groups (study groups) — §14
-- A group is not a chat room. It owns a conversation, resources, posts,
-- sessions and quizzes, and it knows which course it studies.
-- ---------------------------------------------------------------------------

CREATE TABLE groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid REFERENCES communities(id) ON DELETE SET NULL,
  course_id     uuid REFERENCES courses(id) ON DELETE SET NULL,
  name          text NOT NULL,
  description   text,
  avatar_url    text,
  visibility    visibility NOT NULL DEFAULT 'stage',
  join_policy   text NOT NULL DEFAULT 'request',
  member_count  integer NOT NULL DEFAULT 0,
  max_members   integer NOT NULL DEFAULT 50,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,

  CONSTRAINT groups_join_policy CHECK (join_policy IN ('open', 'request', 'invite')),
  CONSTRAINT groups_name_len CHECK (char_length(name) BETWEEN 2 AND 80),
  CONSTRAINT groups_max_members CHECK (max_members BETWEEN 2 AND 500)
);
CREATE INDEX groups_community_idx ON groups (community_id);
CREATE INDEX groups_course_idx ON groups (course_id) WHERE course_id IS NOT NULL;
CREATE TRIGGER groups_set_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE group_members (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       membership_role NOT NULL DEFAULT 'member',
  status     membership_status NOT NULL DEFAULT 'active',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- Content spine
-- ---------------------------------------------------------------------------

CREATE TYPE content_kind AS ENUM (
  'post', 'reel', 'question', 'poll', 'resource', 'announcement', 'live'
);

CREATE TABLE content_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           content_kind NOT NULL,
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Academic context (§10). Denormalised from the author's profile at creation
  -- time on purpose: content must keep the context it was published into even
  -- if the author later moves to another stage.
  university_id  uuid REFERENCES universities(id) ON DELETE SET NULL,
  college_id     uuid REFERENCES colleges(id) ON DELETE SET NULL,
  program_id     uuid REFERENCES programs(id) ON DELETE SET NULL,
  stage_id       uuid REFERENCES stages(id) ON DELETE SET NULL,
  course_id      uuid REFERENCES courses(id) ON DELETE SET NULL,
  subject_id     uuid REFERENCES subjects(id) ON DELETE SET NULL,

  -- Container. At most one may be set; enforced below.
  community_id   uuid REFERENCES communities(id) ON DELETE CASCADE,
  group_id       uuid REFERENCES groups(id) ON DELETE CASCADE,
  classroom_id   uuid,  -- FK added in 0004 once classrooms exists

  visibility     visibility NOT NULL DEFAULT 'stage',
  body           text,
  language       text,

  -- Denormalised counters. Kept correct by the service layer inside the same
  -- transaction as the mutation; cheap to read, and the feed cannot afford
  -- six correlated subqueries per row.
  like_count     integer NOT NULL DEFAULT 0,
  comment_count  integer NOT NULL DEFAULT 0,
  bookmark_count integer NOT NULL DEFAULT 0,
  view_count     integer NOT NULL DEFAULT 0,
  share_count    integer NOT NULL DEFAULT 0,

  is_pinned      boolean NOT NULL DEFAULT false,
  edited_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT content_items_single_container CHECK (
    (community_id IS NOT NULL)::int
    + (group_id IS NOT NULL)::int
    + (classroom_id IS NOT NULL)::int <= 1
  ),
  CONSTRAINT content_items_counters_nonneg CHECK (
    like_count >= 0 AND comment_count >= 0 AND bookmark_count >= 0
    AND view_count >= 0 AND share_count >= 0
  ),
  CONSTRAINT content_items_body_len CHECK (body IS NULL OR char_length(body) <= 10000)
);

-- The cohort feed query: college+stage, newest first, excluding deleted.
CREATE INDEX content_items_cohort_feed_idx
  ON content_items (college_id, stage_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX content_items_author_idx
  ON content_items (author_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX content_items_course_idx
  ON content_items (course_id, created_at DESC) WHERE deleted_at IS NULL AND course_id IS NOT NULL;
CREATE INDEX content_items_group_idx
  ON content_items (group_id, created_at DESC) WHERE deleted_at IS NULL AND group_id IS NOT NULL;
CREATE INDEX content_items_community_idx
  ON content_items (community_id, created_at DESC) WHERE deleted_at IS NULL AND community_id IS NOT NULL;
CREATE INDEX content_items_kind_idx
  ON content_items (kind, created_at DESC) WHERE deleted_at IS NULL;
CREATE TRIGGER content_items_set_updated_at BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ordered media attached to a content item.
CREATE TABLE content_media (
  content_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  ordinal     smallint NOT NULL DEFAULT 0,
  caption     text,
  PRIMARY KEY (content_id, file_id)
);
CREATE INDEX content_media_content_idx ON content_media (content_id, ordinal);

-- Topic tagging: the join that powers academic search and the Learning Graph.
CREATE TABLE content_topics (
  content_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  topic_id    uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  -- 'author' | 'ai' | 'moderator' — provenance matters for trust in ranking.
  source      text NOT NULL DEFAULT 'author',
  confidence  real,
  PRIMARY KEY (content_id, topic_id),
  CONSTRAINT content_topics_source CHECK (source IN ('author', 'ai', 'moderator'))
);
CREATE INDEX content_topics_topic_idx ON content_topics (topic_id);

-- ---------------------------------------------------------------------------
-- Per-kind detail tables
-- ---------------------------------------------------------------------------

CREATE TABLE reel_details (
  content_id     uuid PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  video_file_id  uuid REFERENCES files(id) ON DELETE SET NULL,
  thumbnail_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  duration_seconds integer,
  -- Transcoding is a pipeline the app owns the state of, even though the work
  -- happens elsewhere (§12).
  processing_status text NOT NULL DEFAULT 'pending',
  processing_error  text,
  CONSTRAINT reel_processing_status CHECK (
    processing_status IN ('pending', 'processing', 'ready', 'failed')
  ),
  CONSTRAINT reel_duration CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 600)
);

CREATE TABLE question_details (
  content_id    uuid PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  title         text NOT NULL,
  accepted_comment_id uuid,   -- FK added after comments exists
  answer_count  integer NOT NULL DEFAULT 0,
  is_resolved   boolean NOT NULL DEFAULT false
);

CREATE TABLE poll_details (
  content_id   uuid PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  question     text NOT NULL,
  multi_choice boolean NOT NULL DEFAULT false,
  closes_at    timestamptz,
  vote_count   integer NOT NULL DEFAULT 0
);

CREATE TABLE poll_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES poll_details(content_id) ON DELETE CASCADE,
  label       text NOT NULL,
  ordinal     smallint NOT NULL DEFAULT 0,
  vote_count  integer NOT NULL DEFAULT 0
);
CREATE INDEX poll_options_content_idx ON poll_options (content_id, ordinal);

CREATE TABLE poll_votes (
  option_id   uuid NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id  uuid NOT NULL REFERENCES poll_details(content_id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);
-- Single-choice polls are enforced by a partial unique index created by the
-- service when multi_choice = false; see poll service.
CREATE INDEX poll_votes_content_user_idx ON poll_votes (content_id, user_id);

CREATE TABLE resource_details (
  content_id   uuid PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  title        text NOT NULL,
  file_id      uuid REFERENCES files(id) ON DELETE SET NULL,
  external_url text,
  resource_type text NOT NULL DEFAULT 'file',
  download_count integer NOT NULL DEFAULT 0,
  CONSTRAINT resource_type_values CHECK (resource_type IN ('file', 'link')),
  CONSTRAINT resource_has_target CHECK (file_id IS NOT NULL OR external_url IS NOT NULL)
);

CREATE TABLE announcement_details (
  content_id  uuid PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  title       text NOT NULL,
  severity    text NOT NULL DEFAULT 'info',
  CONSTRAINT announcement_severity CHECK (severity IN ('info', 'important', 'urgent'))
);

-- Cross-object links: the "what can the student do next?" edge (§92).
-- Reel → Lecture → Quiz → Discussion → Group are all rows here.
CREATE TABLE content_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  to_kind        text NOT NULL,
  to_id          uuid NOT NULL,
  relation       text NOT NULL DEFAULT 'related',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_content_id, to_kind, to_id, relation),
  CONSTRAINT content_links_to_kind CHECK (
    to_kind IN ('content', 'lecture', 'quiz', 'group', 'classroom', 'topic', 'study_session')
  )
);
CREATE INDEX content_links_from_idx ON content_links (from_content_id);
CREATE INDEX content_links_to_idx ON content_links (to_kind, to_id);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES comments(id) ON DELETE CASCADE,
  body        text NOT NULL,
  like_count  integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  is_accepted boolean NOT NULL DEFAULT false,
  edited_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  CONSTRAINT comments_body_len CHECK (char_length(body) BETWEEN 1 AND 5000)
);
CREATE INDEX comments_content_idx ON comments (content_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at) WHERE parent_id IS NOT NULL;
CREATE INDEX comments_author_idx ON comments (author_id, created_at DESC);
CREATE TRIGGER comments_set_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE question_details
  ADD CONSTRAINT question_details_accepted_fk
  FOREIGN KEY (accepted_comment_id) REFERENCES comments(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Reactions and bookmarks
--
-- One table, three nullable targets, exactly-one enforced by CHECK. This keeps
-- real foreign keys (a (target_type, target_id) pair could not have them) while
-- avoiding three near-identical tables.
-- ---------------------------------------------------------------------------

CREATE TYPE reaction_kind AS ENUM ('like', 'helpful', 'insightful', 'celebrate', 'curious');

CREATE TABLE reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        reaction_kind NOT NULL DEFAULT 'like',
  content_id  uuid REFERENCES content_items(id) ON DELETE CASCADE,
  comment_id  uuid REFERENCES comments(id) ON DELETE CASCADE,
  message_id  uuid,   -- FK added in 0004 once messages exists
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reactions_exactly_one_target CHECK (
    (content_id IS NOT NULL)::int
    + (comment_id IS NOT NULL)::int
    + (message_id IS NOT NULL)::int = 1
  )
);
-- One reaction per user per target (changing reaction kind is an UPDATE).
CREATE UNIQUE INDEX reactions_content_uniq ON reactions (user_id, content_id) WHERE content_id IS NOT NULL;
CREATE UNIQUE INDEX reactions_comment_uniq ON reactions (user_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE UNIQUE INDEX reactions_message_uniq ON reactions (user_id, message_id, kind) WHERE message_id IS NOT NULL;
CREATE INDEX reactions_content_idx ON reactions (content_id) WHERE content_id IS NOT NULL;

CREATE TABLE bookmarks (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  collection  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, content_id)
);
CREATE INDEX bookmarks_user_idx ON bookmarks (user_id, created_at DESC);
