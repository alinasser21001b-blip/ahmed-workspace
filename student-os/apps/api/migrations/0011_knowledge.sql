-- 0011_knowledge.sql
-- Phase 5. Classification, provenance, corrections, and topic relationships.
--
-- The audit that preceded this (docs/07-PHASE-5-AUDIT.md) found the schema
-- already knowledge-shaped: `content_items` carries the full academic context,
-- `content_topics` already records WHO classified something, `content_links`
-- already models typed edges, and `topics` already has a parent. So this
-- migration is deliberately small — three tables and three columns — and adds
-- only what could not be expressed at all.

-- ---------------------------------------------------------------------------
-- 1. Classification: what a piece of content IS, academically.
--
-- A second axis beside `kind`, not an extension of it (ADR-0012):
--
--   kind            how does this render?       post, question, resource, poll
--   knowledge_type  what is this academically?  explanation, summary, case…
--
-- A clinical case and a summary are both `kind = 'post'` and are not the same
-- knowledge. They cross: a case can be a post or a resource. One enum cannot
-- express a cross product without becoming a list of pairs.
--
-- Columns on `content_items` rather than a 1:1 side table, because the feed,
-- search and the topic page all FILTER on these — a join per candidate row on
-- the hottest table in the product, to read three small closed vocabularies, is
-- a cost with no benefit.
-- ---------------------------------------------------------------------------

CREATE TYPE knowledge_type AS ENUM (
  'question',
  'explanation',
  'summary',
  'note',
  'case',
  'resource',
  'reference',
  'correction',
  'discussion'
);

ALTER TABLE content_items
  -- Nullable on purpose. Phase 2 content predates this, and backfilling a guess
  -- would manufacture classification data that looks authored. Unclassified
  -- content still works everywhere; it just cannot be filtered by type.
  ADD COLUMN knowledge_type knowledge_type,
  -- Reuses the enum quizzes already defined in 0005 rather than minting a
  -- second three-value vocabulary meaning the same thing.
  ADD COLUMN difficulty difficulty_level;

-- `content_items.language` already existed and was never written. Phase 5
-- populates it from `detectLanguage()` in @sos/core — a deterministic count of
-- Arabic vs Latin letters, not a detection library and not a model, so that
-- "why is this tagged English?" has a one-sentence answer.
--
-- The constraint documents the vocabulary the application writes; `und` is the
-- honest answer for a body too short to judge, and `mixed` is a real answer for
-- a cohort that writes Arabic prose full of English drug names.
ALTER TABLE content_items
  ADD CONSTRAINT content_items_language_values
  CHECK (language IS NULL OR language IN ('ar', 'en', 'mixed', 'und'));

-- The topic page's query: knowledge of a given type about a given topic,
-- newest first. `content_topics` supplies the topic join; this covers the rest.
CREATE INDEX content_items_knowledge_idx
  ON content_items (knowledge_type, created_at DESC)
  WHERE deleted_at IS NULL AND knowledge_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Provenance: where a claim came from.
--
-- This is the entire AUTHOR CLAIM → SOURCE-BACKED distinction (ADR-0013).
-- Without it every statement in the product is an author claim with no way to
-- say otherwise, and any later trust computation would have to invent a number
-- instead of citing a fact.
--
-- A table rather than a text column because a source is looked UP: by content
-- (what backs this?), by url or file (what else cites this?), and later by
-- topic (what is this topic's canonical reading?). A free-text field answers
-- only the first.
-- ---------------------------------------------------------------------------

CREATE TYPE source_kind AS ENUM (
  'textbook',
  'lecture',
  'guideline',
  'paper',
  'website',
  'other'
);

CREATE TABLE content_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  kind        source_kind NOT NULL,
  -- What a reader would actually look up. Not a URL — most of the sources this
  -- cohort cites are printed textbooks and lecture slides.
  citation    text NOT NULL,
  url         text,
  file_id     uuid REFERENCES files(id) ON DELETE SET NULL,
  -- "p. 412", "§3.2", "slide 14".
  page_ref    text,
  -- Deliberately separate from the content's author: a classmate adding the
  -- reference for someone else's explanation is a community contribution, and
  -- the record should say who made the claim about the source.
  added_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT content_sources_citation_len CHECK (char_length(citation) BETWEEN 3 AND 500)
);
CREATE INDEX content_sources_content_idx ON content_sources (content_id, created_at);
-- "What else cites this?" — the reverse lookup that makes a source a shared
-- object rather than a per-post string.
CREATE INDEX content_sources_url_idx ON content_sources (url) WHERE url IS NOT NULL;
CREATE INDEX content_sources_file_idx ON content_sources (file_id) WHERE file_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Corrections: community correction as a first-class relationship.
--
-- Not a comment, for three reasons any one of which would be enough:
--
--   1. A comment is a conversation turn. A correction is a claim about the
--      content's ACCURACY that a later reader must see whether or not they read
--      the thread.
--   2. A correction has a lifecycle — proposed, then accepted or rejected by
--      the author. Comments have no such state, and `comments.is_accepted`
--      already means something else (this answer resolved this question).
--   3. An accepted correction changes how the content should be presented and
--      ranked. Deriving that from comment prose is not possible without reading
--      the prose.
-- ---------------------------------------------------------------------------

CREATE TYPE correction_status AS ENUM ('proposed', 'accepted', 'rejected', 'withdrawn');

CREATE TABLE content_corrections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id   uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  proposed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- What is wrong, and what is right instead.
  body         text NOT NULL,
  -- Optional citation backing the correction. Attached to the content as a
  -- source when the correction is accepted, which is how a correction upgrades
  -- the content's provenance rather than merely annotating it.
  source_id    uuid REFERENCES content_sources(id) ON DELETE SET NULL,
  status       correction_status NOT NULL DEFAULT 'proposed',
  -- The original author, or a moderator of the container. Recorded because an
  -- accepted correction is an accountable decision, not an automatic state.
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT content_corrections_body_len CHECK (char_length(body) BETWEEN 10 AND 4000),
  -- A resolution has a resolver and a time, or it has neither. Half a
  -- resolution is a state nothing can interpret.
  CONSTRAINT content_corrections_resolution CHECK (
    (status IN ('proposed', 'withdrawn') AND resolved_at IS NULL)
    OR (status IN ('accepted', 'rejected') AND resolved_at IS NOT NULL)
  )
);
-- The content page's read: every correction on this content, newest first.
CREATE INDEX content_corrections_content_idx
  ON content_corrections (content_id, created_at DESC);
-- The author's queue: corrections awaiting my decision.
CREATE INDEX content_corrections_open_idx
  ON content_corrections (content_id) WHERE status = 'proposed';
-- One open proposal per person per content: a second is an edit of the first,
-- not a new claim, and without this a disagreement becomes a flood.
CREATE UNIQUE INDEX content_corrections_one_open
  ON content_corrections (content_id, proposed_by) WHERE status = 'proposed';

-- ---------------------------------------------------------------------------
-- 4. Topic relationships: the first genuinely graph-shaped structure.
--
-- `topics.parent_topic_id` gives a tree. Knowledge is not a tree — neonatal
-- jaundice relates to haemolysis, which sits under a different subject
-- entirely.
--
-- `source` is on the row because a curated edge (an instructor says X is a
-- prerequisite of Y) and a derived edge (X and Y are tagged together on forty
-- posts) are different claims with different trust. A graph that merges them
-- can never be un-merged (ADR-0013).
--
-- Derived edges are produced by ARITHMETIC over data the community already
-- created — co-tag counts from `content_topics`. No model, no embedding, and
-- explainable to a student in one sentence: these appear together in your
-- cohort's notes.
-- ---------------------------------------------------------------------------

CREATE TYPE topic_relation AS ENUM ('related', 'prerequisite_of', 'part_of');

CREATE TABLE topic_relations (
  from_topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  to_topic_id   uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relation      topic_relation NOT NULL,
  source        text NOT NULL,
  -- Derived edges only: how many pieces of content carry both topics. Null for
  -- curated edges, where a count would imply a measurement nobody made.
  strength      real,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (from_topic_id, to_topic_id, relation),
  CONSTRAINT topic_relations_no_self CHECK (from_topic_id <> to_topic_id),
  CONSTRAINT topic_relations_source CHECK (source IN ('curated', 'derived')),
  CONSTRAINT topic_relations_strength CHECK (
    (source = 'derived' AND strength IS NOT NULL) OR (source = 'curated' AND strength IS NULL)
  )
);
-- The topic page's read: related topics, strongest first.
CREATE INDEX topic_relations_from_idx
  ON topic_relations (from_topic_id, strength DESC NULLS LAST);
CREATE INDEX topic_relations_to_idx ON topic_relations (to_topic_id);

-- ---------------------------------------------------------------------------
-- 5. Two more learning-event kinds — as ROWS, not schema.
--
-- The taxonomy has been a reference table since 0005 precisely so that changing
-- what counts as a meaningful learning action is an UPDATE rather than a
-- deploy, and so the north-star metric's definition is auditable.
--
-- `knowledge_saved` is meaningful: choosing to keep something is a deliberate
-- act about its usefulness. `correction_accepted` is meaningful for the person
-- who proposed it — they identified an error and the author agreed, which is
-- among the strongest learning signals this product can observe.
--
-- `knowledge_opened` is NOT meaningful. Opening something is channel B
-- (content interaction), and calling it learning would inflate the north-star
-- with scrolling (ADR-0014).
-- ---------------------------------------------------------------------------

INSERT INTO learning_event_kinds (kind, description, is_meaningful) VALUES
  ('knowledge_opened',    'Opened a piece of classified knowledge',        false),
  ('knowledge_saved',     'Saved a piece of knowledge for later',          true),
  ('question_answered',   'Answered another student''s question',          true),
  ('answer_accepted',     'Had an answer accepted by the asker',           true),
  ('correction_proposed', 'Proposed a correction to a piece of knowledge', false),
  ('correction_accepted', 'Had a proposed correction accepted',            true),
  ('source_added',        'Attached a source to a piece of knowledge',     true)
ON CONFLICT (kind) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Reel event kinds are demoted, not deleted.
--
-- 0005 seeded `reel_viewed` and `reel_completed`. The product direction is
-- explicit that short-form video is not a core primitive and must not shape the
-- architecture. They stay as rows so no historical event loses its foreign key,
-- and they remain non-meaningful — which they already were.
-- ---------------------------------------------------------------------------

UPDATE learning_event_kinds
SET description = description || ' (deprecated: not a core primitive)'
WHERE kind IN ('reel_viewed', 'reel_completed')
  AND description NOT LIKE '%deprecated%';
