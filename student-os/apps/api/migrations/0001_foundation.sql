-- 0001_foundation.sql
-- Identity, sessions, enums shared across the whole schema, and the
-- updated_at trigger used everywhere.
--
-- Design notes:
--   * UUID v4 primary keys (gen_random_uuid is built into PG13+).
--   * timestamptz everywhere. Never naive timestamps.
--   * Emails are stored as given but uniqueness is case-insensitive.
--   * Account deletion is soft (status='deleted' + deleted_at) so that
--     authored content and moderation history survive, per §81 ("deleted
--     account access" must be testable).

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------

CREATE TYPE user_role           AS ENUM ('student', 'instructor', 'admin');
CREATE TYPE verification_level  AS ENUM ('unverified', 'student', 'instructor', 'official');
CREATE TYPE account_status      AS ENUM ('active', 'restricted', 'suspended', 'banned', 'deleted');

-- Visibility is the single vocabulary used by content, groups, classrooms and
-- the AI retrieval filter alike. Adding a value here means updating exactly one
-- policy function in @sos/core.
CREATE TYPE visibility          AS ENUM (
  'public',      -- everyone in the platform
  'university',  -- same university
  'college',     -- same college
  'stage',       -- same college + stage (the default cohort scope)
  'course',      -- enrolled in the course
  'community',   -- members of the owning community
  'group',       -- members of the owning group
  'classroom',   -- members of the owning classroom
  'followers',   -- author's followers
  'private'      -- author only
);

CREATE TYPE membership_role     AS ENUM ('member', 'moderator', 'admin', 'owner');
CREATE TYPE membership_status   AS ENUM ('invited', 'pending', 'active', 'left', 'banned');

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text NOT NULL,
  role                user_role NOT NULL DEFAULT 'student',
  verification_level  verification_level NOT NULL DEFAULT 'unverified',
  status              account_status NOT NULL DEFAULT 'active',
  email_verified_at   timestamptz,
  last_active_at      timestamptz,
  locale              text NOT NULL DEFAULT 'ar',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  CONSTRAINT users_email_format CHECK (position('@' IN email) > 1),
  CONSTRAINT users_locale_supported CHECK (locale IN ('ar', 'en'))
);

-- Case-insensitive uniqueness without depending on the citext extension.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
CREATE INDEX users_status_idx ON users (status) WHERE status <> 'active';
CREATE INDEX users_last_active_idx ON users (last_active_at DESC NULLS LAST);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sessions (refresh tokens)
--
-- Access tokens are short-lived JWTs and are NOT stored. Refresh tokens are
-- opaque random strings; only their SHA-256 hash is persisted so a database
-- leak does not yield usable credentials. Rotation is enforced by
-- rotated_to_id: reuse of a rotated token is a theft signal and revokes the
-- whole chain.
-- ---------------------------------------------------------------------------

CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash     text NOT NULL UNIQUE,
  user_agent     text,
  ip             inet,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  rotated_to_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;
