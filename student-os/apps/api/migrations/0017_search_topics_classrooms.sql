-- ---------------------------------------------------------------------------
-- 0017 — Topic and classroom search
--
-- Search could find people, posts, groups and communities. It could not find
-- the two objects a student actually navigates by: a topic (the graph Learn,
-- Topic and Practice are built on) and a classroom (the taught room they join
-- by course or join code). Both absences were recorded as blocked capabilities
-- in the design handoff. This migration is the index those endpoints need.
--
-- The fold is the same `sos_normalize_arabic()` that content, profiles, groups
-- and communities have used since 0009, so a student who types without
-- diacritics finds a topic written with them — the same rule, the same
-- function, not a third copy.
-- ---------------------------------------------------------------------------

ALTER TABLE topics
  ADD COLUMN name_ar_norm text GENERATED ALWAYS AS (sos_normalize_arabic(name_ar)) STORED,
  ADD COLUMN name_en_norm text GENERATED ALWAYS AS (sos_normalize_arabic(name_en)) STORED;

CREATE INDEX topics_name_ar_norm_trgm_idx
  ON topics USING gin (name_ar_norm gin_trgm_ops);

CREATE INDEX topics_name_en_norm_trgm_idx
  ON topics USING gin (name_en_norm gin_trgm_ops);

ALTER TABLE classrooms
  ADD COLUMN title_norm text GENERATED ALWAYS AS (sos_normalize_arabic(title)) STORED;

CREATE INDEX classrooms_title_norm_trgm_idx
  ON classrooms USING gin (title_norm gin_trgm_ops)
  WHERE NOT is_archived;
