-- 0008_community.sql
-- Phase 3. Group placement, join requests, and search.

-- ---------------------------------------------------------------------------
-- 1. Groups gain an academic placement.
--
-- `canViewGroup` resolves a group's audience with the same scope vocabulary
-- content uses, so a `stage`-scoped group needs a stage to compare against.
-- 0003 gave groups a visibility but nothing to resolve it against, which left
-- the policy unable to answer anything except "member or not".
--
-- Copied from the creator's profile at creation time, like content's — a group
-- keeps the cohort it was founded in even after its founder moves up a stage.
-- ---------------------------------------------------------------------------

ALTER TABLE groups
  ADD COLUMN university_id uuid REFERENCES universities(id) ON DELETE SET NULL,
  ADD COLUMN college_id    uuid REFERENCES colleges(id)     ON DELETE SET NULL,
  ADD COLUMN stage_id      uuid REFERENCES stages(id)       ON DELETE SET NULL;

-- The discovery query: joinable groups for my cohort, newest first.
CREATE INDEX groups_discovery_idx
  ON groups (college_id, stage_id, created_at DESC)
  WHERE archived_at IS NULL AND visibility <> 'group';

-- ---------------------------------------------------------------------------
-- 2. Join requests need provenance.
--
-- `group_members.status` already models pending/invited, but not *who* invited
-- someone or when they asked. A moderator approving a queue of requests needs
-- to see the order they arrived in, and an invitation with no inviter cannot be
-- audited if it turns out to be harassment.
-- ---------------------------------------------------------------------------

ALTER TABLE group_members
  ADD COLUMN invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN message text;

-- The moderator's queue.
CREATE INDEX group_members_pending_idx
  ON group_members (group_id, requested_at)
  WHERE status = 'pending';

-- "Which groups am I in?" — the hottest membership read, used to build the
-- Actor on every request.
CREATE INDEX group_members_active_user_idx
  ON group_members (user_id, joined_at DESC)
  WHERE status = 'active';

CREATE INDEX community_members_active_user_idx
  ON community_members (user_id, joined_at DESC)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Search.
--
-- Trigram indexes rather than `tsvector`. The reason is the cohort: content is
-- Arabic and English, often mixed inside one post, and Postgres has no Arabic
-- stemming configuration. A `to_tsvector('simple', …)` would tokenise Arabic
-- without stemming — no better than trigrams — while adding a dictionary
-- choice that is wrong for half the corpus.
--
-- Trigrams also give prefix and typo tolerance for free, which matters more
-- than stemming when students search for a handle or a half-remembered topic.
-- The upgrade path is documented in the search module: when the corpus is
-- large enough for this to hurt, it moves to a dedicated search service, not
-- to a different Postgres index.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX content_items_body_trgm_idx
  ON content_items USING gin (body gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX profiles_display_name_trgm_idx
  ON profiles USING gin (display_name gin_trgm_ops);

CREATE INDEX profiles_handle_trgm_idx
  ON profiles USING gin (handle gin_trgm_ops);

CREATE INDEX groups_name_trgm_idx
  ON groups USING gin (name gin_trgm_ops)
  WHERE archived_at IS NULL;

CREATE INDEX communities_name_ar_trgm_idx
  ON communities USING gin (name_ar gin_trgm_ops)
  WHERE archived_at IS NULL;

CREATE INDEX communities_name_en_trgm_idx
  ON communities USING gin (name_en gin_trgm_ops)
  WHERE archived_at IS NULL;
