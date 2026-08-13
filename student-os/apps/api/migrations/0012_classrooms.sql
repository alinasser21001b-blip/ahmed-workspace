-- ---------------------------------------------------------------------------
-- 0012 — Classrooms (Phase 5b)
--
-- Almost nothing to do, and that is the point. `classrooms`, `classroom_members`,
-- `lectures`, `lecture_topics`, `materials` and `lecture_progress` have existed
-- since 0005 with their foreign keys, indexes and CHECK constraints. Phase 5b
-- is service, route and client work on a schema that was already shaped for it.
--
-- Two genuine gaps are closed here, both additive. No table is dropped, no
-- column is removed, no data is rewritten.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Discussion attached to a lecture.
--
-- `content_items` could already be scoped to a classroom (0003 + 0005), but a
-- post could not say WHICH lecture it was about. Without that, "discussion
-- attached to a lecture" is a classroom-wide feed the reader has to sift.
--
-- `lecture_id` is deliberately NOT part of `content_items_single_container`.
-- A lecture is not a container: the post still lives in the classroom, and the
-- classroom is still what decides who may read it. This column is a pointer of
-- the same kind as `subject_id` or `topic_id` — it narrows a view, it never
-- grants access. Adding it to the container CHECK would have created a second
-- thing that answers "who can see this", which is exactly what ADR-0003
-- forbids.
-- ---------------------------------------------------------------------------
ALTER TABLE content_items
  ADD COLUMN lecture_id uuid REFERENCES lectures(id) ON DELETE SET NULL;

CREATE INDEX content_items_lecture_idx
  ON content_items (lecture_id, created_at DESC)
  WHERE lecture_id IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. One active membership row per person per room, and fast roster reads.
--
-- The primary key (classroom_id, user_id) already makes a duplicate row
-- impossible. What was missing is the roster-side index: `classroom_members`
-- had an index by user (for hydrating `actor.classroomIds`) but none by
-- classroom, so listing a room's members was a scan.
-- ---------------------------------------------------------------------------
CREATE INDEX classroom_members_roster_idx
  ON classroom_members (classroom_id, role, joined_at)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 3. Join codes are looked up on every join-by-code.
--
-- `join_code` is already UNIQUE, which gives an index — but the uniqueness
-- index covers NULLs too, and most rooms have no code. A partial index keeps
-- the hot lookup small.
-- ---------------------------------------------------------------------------
CREATE INDEX classrooms_join_code_idx
  ON classrooms (join_code)
  WHERE join_code IS NOT NULL AND NOT is_archived;
