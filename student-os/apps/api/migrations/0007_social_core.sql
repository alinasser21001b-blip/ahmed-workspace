-- 0007_social_core.sql
-- Phase 2. Three changes, each forced by something the phase actually needs.

-- ---------------------------------------------------------------------------
-- 1. Files gain an academic context.
--
-- `canAccessFile` in @sos/core decides access from the file's placement, but
-- 0003 gave `files` only an owner and a visibility. Without these columns a
-- 'stage'-visible attachment has no stage to compare against, so the policy
-- could only ever answer "owner or nobody".
--
-- Denormalised at upload time for the same reason content is (§10): a file
-- keeps the context it was uploaded into, even if its owner later moves cohort.
-- ---------------------------------------------------------------------------

ALTER TABLE files
  ADD COLUMN university_id uuid REFERENCES universities(id) ON DELETE SET NULL,
  ADD COLUMN college_id    uuid REFERENCES colleges(id)     ON DELETE SET NULL,
  ADD COLUMN stage_id      uuid REFERENCES stages(id)       ON DELETE SET NULL,
  ADD COLUMN course_id     uuid REFERENCES courses(id)      ON DELETE SET NULL,
  ADD COLUMN community_id  uuid REFERENCES communities(id)  ON DELETE CASCADE,
  ADD COLUMN group_id      uuid REFERENCES groups(id)       ON DELETE CASCADE,
  ADD COLUMN classroom_id  uuid REFERENCES classrooms(id)   ON DELETE CASCADE;

-- An upload becomes reachable only once it is attached to something. Until
-- then it is owner-only, which is why `attached_at` exists rather than being
-- inferred from a join: an orphaned upload must be cheap to find and sweep.
ALTER TABLE files ADD COLUMN attached_at timestamptz;

CREATE INDEX files_orphaned_idx
  ON files (created_at) WHERE attached_at IS NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Per-viewer view records.
--
-- `content_items.view_count` is an aggregate and cannot answer "has THIS
-- student already seen this?", which the feed's seen-penalty needs (§34), and
-- which `post_viewed` (§83) is about.
--
-- One row per (user, content) rather than one per impression: the feed needs a
-- boolean, and an append-only impression log would be the single fastest-growing
-- table in the product for no V1 benefit. `view_count` on this row keeps the
-- repeat-view signal without the row explosion.
-- ---------------------------------------------------------------------------

CREATE TABLE content_views (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id      uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  view_count      integer NOT NULL DEFAULT 1,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at  timestamptz NOT NULL DEFAULT now(),
  /** Fraction of a reel actually watched, 0..1. Null for non-video content. */
  completion      real,
  PRIMARY KEY (user_id, content_id),
  CONSTRAINT content_views_count_positive CHECK (view_count > 0),
  CONSTRAINT content_views_completion_range
    CHECK (completion IS NULL OR (completion >= 0 AND completion <= 1))
);

-- The feed joins this per candidate row, so the (user, content) primary key is
-- the index that matters. This second one serves "what has this student seen
-- recently", used by learning analytics.
CREATE INDEX content_views_user_recent_idx ON content_views (user_id, last_viewed_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Feed-supporting indexes.
--
-- The feed is a permission-filtered scan over recent content. 0003 indexed the
-- cohort path; these cover the other visibility branches the same query has to
-- satisfy, so that a student enrolled in courses or following authors does not
-- fall back to a sequential scan.
-- ---------------------------------------------------------------------------

CREATE INDEX content_items_visibility_recent_idx
  ON content_items (visibility, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX content_items_university_idx
  ON content_items (university_id, created_at DESC)
  WHERE deleted_at IS NULL AND university_id IS NOT NULL;

-- Comment threads are read newest-parent-first with replies inline; the 0003
-- index covers the parent listing, this one covers reply expansion by author
-- for the "your replies" surface and for moderation.
CREATE INDEX comments_content_parent_idx
  ON comments (content_id, parent_id, created_at)
  WHERE deleted_at IS NULL;

-- Bookmarks are listed per user filtered by collection.
CREATE INDEX bookmarks_collection_idx
  ON bookmarks (user_id, collection, created_at DESC) WHERE collection IS NOT NULL;
