-- ---------------------------------------------------------------------------
-- 0016 — Password reset
--
-- The same shape `sessions` (0001) already uses for refresh tokens, and for
-- the same reason: the secret a client holds is a high-entropy random value,
-- never user-chosen, so hashing it is sufficient and SHA-256 (not scrypt) is
-- correct — see `auth/tokens.ts`.
--
-- Single-use and time-boxed: `used_at` is set exactly once, at redemption, and
-- a request for a fresh token supersedes every prior outstanding one for that
-- account (`auth.service.ts`'s `requestPasswordReset`). There is no column for
-- "why" a token stopped being valid — expiry and single-use both resolve to
-- the same predicate at read time, `used_at IS NULL AND expires_at > now()`,
-- and the request path never needs to explain itself to the caller anyway
-- (§ non-enumeration).
-- ---------------------------------------------------------------------------

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The redemption read: "is this hash a live, unused token". Partial, because
-- a used or expired row is never looked up by hash again — only ever by user,
-- to supersede it.
CREATE INDEX password_resets_active_idx ON password_resets (token_hash) WHERE used_at IS NULL;

-- The supersede write: "every outstanding token for this user".
CREATE INDEX password_resets_user_idx ON password_resets (user_id) WHERE used_at IS NULL;
