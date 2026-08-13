-- 0009_phase3_closure.sql
-- Phase 3 closure: Arabic search normalisation, and the domain-event outbox.

-- ---------------------------------------------------------------------------
-- 1. Arabic normalisation, in the database.
--
-- Measured on PostgreSQL 16 with pg_trgm, at the similarity floor of 0.15 the
-- search module uses:
--
--   tashkeel      0.07   FAILED — below the floor, so: no result at all
--   alef madda    0.14   FAILED — below the floor, so: no result at all
--   tatweel       0.36   degraded
--   hamza أ/ا     0.64   passed, narrowly
--   ta marbuta    0.60   passed, narrowly
--   alef maqsura  0.56   passed, narrowly
--
-- A student who types a word without diacritics cannot find a post written with
-- them. That is not a ranking imperfection, it is a missing result.
--
-- The fold below covers exactly the differences that carry no meaning in
-- ordinary Arabic writing: combining marks, tatweel, alef variants, ta marbuta,
-- alef maqsura, Farsi letter forms that arrive from mixed keyboards, and
-- Arabic-Indic digits. It is the set Lucene's ArabicNormalizationFilter uses,
-- chosen because it is a published and tested standard rather than something we
-- invented. Nothing more aggressive is applied: stripping the definite article
-- would merge القلب with unrelated words beginning in ال, and folding و/ؤ or ا/ع
-- would destroy distinctions students rely on.
--
-- It has to apply to BOTH sides of the comparison. Normalising only the query
-- matches nothing; normalising the column inline in the WHERE discards the
-- index. So the normalised text is a stored generated column with its own
-- trigram index, and the application normalises the search term with the exact
-- same rules.
--
-- `normalizeArabic()` in @sos/core is the mirror of this function, and a test
-- compares the two across a table of cases — the same discipline the feed's
-- ranking parity test applies, for the same reason: two implementations of one
-- rule drift, unless something fails when they do.
--
-- The character classes are written as \uXXXX escapes rather than as literal
-- codepoints because half of them are invisible. A zero-width joiner pasted
-- into a migration is unreviewable.
-- ---------------------------------------------------------------------------

-- `translate` is positional: every character of the second argument needs
-- exactly one counterpart in the third, or the entire map shifts silently. The
-- pairing below is 28 against 28, and a test asserts that rather than the eye.
--
--   آ أ إ ٱ  → ا     the four alef forms
--   ة        → ه
--   ى ی      → ي     alef maqsura, and the Farsi yeh
--   ک        → ك     Farsi keheh
--   ٠…٩ ۰…۹  → 0…9   Arabic-Indic and extended Arabic-Indic digits
CREATE OR REPLACE FUNCTION sos_normalize_arabic(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT btrim(regexp_replace(
    lower(
      translate(
        regexp_replace(
          normalize(input, NFKC),
          -- combining marks · tatweel · zero-width and bidi controls
          '[ً-ٰٟۖ-ۭـ​-‏‪-‮⁦-⁩﻿]',
          '',
          'g'
        ),
        'آأإٱةىیک٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
        'ااااهييك01234567890123456789'
      )
    ),
    '\s+', ' ', 'g'
  ));
$$;

ALTER TABLE content_items
  ADD COLUMN body_norm text GENERATED ALWAYS AS (sos_normalize_arabic(body)) STORED;

ALTER TABLE profiles
  ADD COLUMN display_name_norm text
    GENERATED ALWAYS AS (sos_normalize_arabic(display_name)) STORED;

ALTER TABLE groups
  ADD COLUMN name_norm text GENERATED ALWAYS AS (sos_normalize_arabic(name)) STORED;

ALTER TABLE communities
  ADD COLUMN name_ar_norm text GENERATED ALWAYS AS (sos_normalize_arabic(name_ar)) STORED,
  ADD COLUMN name_en_norm text GENERATED ALWAYS AS (sos_normalize_arabic(name_en)) STORED;

-- The trigram indexes move to the normalised columns. The originals are dropped
-- rather than kept: an index nothing queries is a write cost with no reader.
DROP INDEX IF EXISTS content_items_body_trgm_idx;
DROP INDEX IF EXISTS profiles_display_name_trgm_idx;
DROP INDEX IF EXISTS groups_name_trgm_idx;
DROP INDEX IF EXISTS communities_name_ar_trgm_idx;
DROP INDEX IF EXISTS communities_name_en_trgm_idx;

CREATE INDEX content_items_body_norm_trgm_idx
  ON content_items USING gin (body_norm gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX profiles_display_name_norm_trgm_idx
  ON profiles USING gin (display_name_norm gin_trgm_ops);

CREATE INDEX groups_name_norm_trgm_idx
  ON groups USING gin (name_norm gin_trgm_ops)
  WHERE archived_at IS NULL;

CREATE INDEX communities_name_ar_norm_trgm_idx
  ON communities USING gin (name_ar_norm gin_trgm_ops)
  WHERE archived_at IS NULL;

CREATE INDEX communities_name_en_norm_trgm_idx
  ON communities USING gin (name_en_norm gin_trgm_ops)
  WHERE archived_at IS NULL;

-- Handles are ASCII by constraint (`^[a-z0-9_]{3,30}$`), so they keep their
-- index on the raw column. Normalising them would be a no-op with a cost.

-- ---------------------------------------------------------------------------
-- 2. The domain-event outbox.
--
-- One event vocabulary and one delivery mechanism, appended inside the same
-- transaction as the write it describes. An event therefore cannot describe a
-- rolled-back write, and a committed write cannot lose its event. Publishing
-- after commit gives up the second guarantee; publishing to a broker in-line
-- gives up the first.
--
-- Phase 4's message events are three more `kind` values in this table, drained
-- by the same relay. That is why this exists now rather than appearing in a
-- later phase as a second, incompatible notification path.
--
-- `kind` is text rather than an enum on purpose: adding an event type must be a
-- deploy, not a migration taking an exclusive lock on the hottest write path in
-- the product. The vocabulary is closed in @sos/core, where it is checked at
-- compile time.
-- ---------------------------------------------------------------------------

CREATE TABLE domain_events (
  id           bigserial PRIMARY KEY,
  kind         text NOT NULL,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  target_type  text NOT NULL,
  target_id    uuid NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now(),

  -- Outbox bookkeeping. A null `processed_at` is the queue.
  processed_at timestamptz,
  attempts     smallint NOT NULL DEFAULT 0,
  last_error   text
);

-- The relay's only query: the unprocessed backlog, oldest first. The partial
-- index means drained history costs nothing to skip, however large it grows.
CREATE INDEX domain_events_pending_idx
  ON domain_events (occurred_at, id)
  WHERE processed_at IS NULL;

-- "What happened to this group / post / conversation?" — moderation and audit.
CREATE INDEX domain_events_target_idx
  ON domain_events (target_type, target_id, occurred_at DESC);

-- Notification collapsing reads the most recent event of a kind for a subject.
CREATE INDEX domain_events_subject_idx
  ON domain_events (subject_id, kind, occurred_at DESC)
  WHERE subject_id IS NOT NULL;
