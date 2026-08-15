-- ---------------------------------------------------------------------------
-- 0015 — The moderation gate, and a deletion receipt
--
-- Two App Store requirements land in the schema, and neither of them is a new
-- architecture: both hang off tables that have existed since 0003 and 0006.
--
--   * Guideline 1.2 requires "a method for filtering objectionable material
--     from being posted". The filter itself is code (packages/core/src/
--     moderation/moderation.ts); what belongs in the database is the LEXICON it
--     matches against and the DECISIONS it makes.
--
--   * Guideline 5.1.1(v) requires in-app account deletion. Deletion needs no
--     new columns — the 64 foreign keys to users(id) already say what happens —
--     but it does need to leave behind proof that it happened, and that proof
--     must not itself be personal data.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The lexicon, as ROWS.
--
-- Same decision `learning_event_kinds` made in 0005, for the same reason:
-- changing what the product refuses should be an INSERT with an audit trail,
-- not a deploy. A moderation list that requires an engineer is a moderation
-- list that stays wrong.
--
-- WHAT IS DELIBERATELY NOT IN HERE, and this is the important part:
--
-- No anatomical, pathological, psychiatric, pharmacological or sexual-health
-- vocabulary. Student OS is written by medical students; "rape" is a forensic
-- medicine topic, "suicide" is a psychiatry topic, "anal" is a
-- gastroenterology topic, "overdose" is a toxicology topic. A filter that
-- refuses those words does not make the product safe, it makes it useless — and
-- it would refuse the exact content the product exists to carry.
--
-- So the seed below contains only terms with NO clinical, academic or ordinary
-- use: slurs. Everything else — threats, sexual harassment, spam — is matched
-- structurally in @sos/core by the shape of the sentence (a violent verb aimed
-- at a second person), never by its subject matter.
--
-- `pattern` is stored pre-normalised, in the exact form
-- `normaliseForMatching()` produces, because a term that does not survive
-- normalisation never matches anything and nobody finds out.
-- ---------------------------------------------------------------------------

CREATE TABLE moderation_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern     text NOT NULL UNIQUE,
  category    text NOT NULL,
  severity    text NOT NULL,
  -- `word` matches a whole token; `substring` matches anywhere. Prefer `word`:
  -- a substring rule is how a filter ends up refusing "Scunthorpe".
  match_kind  text NOT NULL DEFAULT 'word',
  language    text NOT NULL DEFAULT 'und',
  -- Why this term is here, so a future reviewer can judge whether to remove it.
  note        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_terms_category CHECK (
    category IN ('slur', 'threat', 'sexual_harassment', 'spam', 'self_harm_encouragement')
  ),
  CONSTRAINT moderation_terms_severity CHECK (severity IN ('block', 'review')),
  CONSTRAINT moderation_terms_match CHECK (match_kind IN ('word', 'substring')),
  CONSTRAINT moderation_terms_pattern_normalised CHECK (pattern = lower(pattern))
);
CREATE INDEX moderation_terms_active_idx ON moderation_terms (is_active) WHERE is_active;

INSERT INTO moderation_terms (pattern, category, severity, match_kind, language, note) VALUES
  ('nigger',  'slur', 'block', 'word', 'en', 'Racial epithet. No clinical or academic use.'),
  ('nigga',   'slur', 'block', 'word', 'en', 'Racial epithet.'),
  ('faggot',  'slur', 'block', 'word', 'en', 'Anti-gay epithet. Note: NOT "faggot sign" — that is not a medical term; no collision.'),
  ('tranny',  'slur', 'block', 'word', 'en', 'Anti-trans epithet.'),
  ('retard',  'slur', 'review', 'word', 'en', 'Ableist epithet. `review` rather than `block`: historical clinical literature used "mental retardation", and a student quoting an old source should reach a human, not a wall.'),
  ('kike',    'slur', 'block', 'word', 'en', 'Antisemitic epithet.'),
  ('chink',   'slur', 'block', 'word', 'en', 'Racial epithet.'),
  ('towelhead','slur', 'block', 'word', 'en', 'Racial/religious epithet.'),
  ('كلب ابن كلب', 'slur', 'review', 'substring', 'ar', 'Arabic insult phrase. `review`: the individual words are ordinary.'),
  ('يا حيوان', 'slur', 'review', 'substring', 'ar', 'Dehumanising address. Reviewed, not blocked — "حيوان" alone is a biology word.'),
  ('منيك',    'slur', 'block', 'word', 'ar', 'Arabic sexual epithet. No academic use.'),
  ('شرموطة',  'slur', 'block', 'word', 'ar', 'Arabic sexual epithet aimed at women.'),
  ('عرص',     'slur', 'block', 'word', 'ar', 'Arabic epithet.');

-- ---------------------------------------------------------------------------
-- 2. What the gate decided.
--
-- A separate table from `moderation_actions` (0006), and the reason is
-- structural rather than stylistic: `moderation_actions` records what a HUMAN
-- MODERATOR did about a report on something that exists. These rows record what
-- the GATE did to a submission — usually one that was refused and therefore
-- never became a row anything could point at. Forcing them into the same table
-- would mean `target_id` values that reference nothing.
--
-- Blocked submissions are recorded with their matched rule ids and a
-- FINGERPRINT of the text, never the text. Storing the refused body would mean
-- the product retains exactly the material it just refused to accept, which is
-- the opposite of what a moderation decision is for.
-- ---------------------------------------------------------------------------

CREATE TABLE moderation_decisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  surface      text NOT NULL,
  verdict      text NOT NULL,
  -- The rule ids that fired, e.g. ["threat.violence.second_person"]. Enough to
  -- answer "why was my post refused" and to tune a rule that is too eager.
  rule_ids     text[] NOT NULL DEFAULT '{}',
  -- sha256 of the normalised text. Lets a moderator recognise a repeated
  -- submission without the system holding the submission.
  content_hash text,
  -- Set when the verdict was `review` and the content WAS created, so a
  -- moderator can reach it. Null for `block`, where nothing was created.
  target_kind  text,
  target_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderation_decisions_verdict CHECK (verdict IN ('block', 'review')),
  CONSTRAINT moderation_decisions_surface CHECK (
    surface IN ('post', 'comment', 'message', 'profile')
  )
);
CREATE INDEX moderation_decisions_queue_idx ON moderation_decisions (created_at DESC);
CREATE INDEX moderation_decisions_user_idx ON moderation_decisions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. The deletion receipt.
--
-- Guideline 5.1.1(v) requires deletion. Operating a service requires being able
-- to answer "did account X get deleted, and when" — for the person who asked,
-- for a regulator, and for the support inbox.
--
-- Those two pull in opposite directions, and the resolution is a one-way
-- digest. `user_ref` is sha256(user_id || salt-from-the-row-id), which:
--
--   * cannot be reversed into a user id;
--   * cannot be scanned for a known user id, because the salt differs per row;
--   * CAN confirm a specific claim, because someone holding the user id and the
--     row can recompute it.
--
-- `audit_log` is not sufficient on its own here: its `actor_id` is SET NULL on
-- delete by design, so after the deletion it can no longer say WHO was deleted
-- even to the person asking. This table can, and holds nothing else.
-- ---------------------------------------------------------------------------

CREATE TABLE account_deletions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref     text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  -- Counts only. What was removed, never what it said.
  removed      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Objects the storage driver could not remove, so a sweep can retry them.
  -- Keys, not contents; a key is meaningless without the bucket credentials.
  orphaned_object_keys text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX account_deletions_completed_idx ON account_deletions (completed_at);
CREATE INDEX account_deletions_orphans_idx ON account_deletions (requested_at)
  WHERE array_length(orphaned_object_keys, 1) > 0;

-- ---------------------------------------------------------------------------
-- 4. Report triage needs an index the queue can actually use.
--
-- `reports` (0006) has no index on `status`, so the moderator queue — "every
-- open report, oldest first", the read Guideline 1.2 calls "timely responses to
-- concerns" — is a sequential scan of every report ever filed.
-- ---------------------------------------------------------------------------

CREATE INDEX reports_open_queue_idx ON reports (status, created_at)
  WHERE status IN ('open', 'reviewing');

-- Duplicate-report suppression reads (reporter, target) pairs. Without this the
-- check that stops one student filing the same report fifty times is itself a
-- scan, which makes the abuse cheaper than the defence.
CREATE INDEX reports_reporter_recent_idx ON reports (reporter_id, created_at DESC);
