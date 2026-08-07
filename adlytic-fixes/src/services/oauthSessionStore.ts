import type { MetaAdAccountInfo } from './metaOAuth';
import { withRedis } from '../lib/redis';
import { encryptToken, decryptToken, isEncryptedToken } from './tokenEncryption';

const SESSION_KEY_PREFIX = 'oauth:session:';
const SESSION_TTL_SECONDS = 1800;
const SESSION_MAX_AGE_MS = 30 * 60_000;

export interface OAuthSession {
  workspaceId:  string;
  userId:       string;
  accessToken:  string;
  expiresAt:    Date;
  accounts:     MetaAdAccountInfo[];
  createdAt:    number; // ms epoch
  // ── Phase 2 (System User / FB Login for Business) ──────────────────────
  // Present ONLY when the META_SYSTEM_USER_ENABLED flag drove this flow.
  // Legacy sessions omit these and behave exactly as before.
  kind?:        'legacy' | 'system_user';
  /** Id of the MetaConnection row created at callback time (system_user only). */
  connectionId?: string;
}

/** In-process fallback when REDIS_URL is unset or Redis is down. */
const oauthSessionsFallback = new Map<string, OAuthSession>();

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

type SerializedOAuthSession = Omit<OAuthSession, 'expiresAt'> & { expiresAt: string };

function serializeSession(s: OAuthSession): string {
  // Encrypt the Meta access token before it hits Redis / memory dumps.
  // encryptToken is a no-op (returns plaintext) when the key is unset in dev.
  const payload: SerializedOAuthSession = {
    ...s,
    accessToken: encryptToken(s.accessToken),
    expiresAt: s.expiresAt.toISOString(),
  };
  return JSON.stringify(payload);
}

function deserializeSession(raw: string): OAuthSession {
  const parsed = JSON.parse(raw) as SerializedOAuthSession;
  let accessToken = parsed.accessToken;
  // Back-compat: sessions written before encryption landed may still be plaintext.
  if (isEncryptedToken(accessToken)) {
    accessToken = decryptToken(accessToken);
  }
  return {
    ...parsed,
    accessToken,
    expiresAt: new Date(parsed.expiresAt),
  };
}

export async function saveOAuthSession(sessionId: string, s: OAuthSession): Promise<void> {
  const saved = await withRedis(
    (r) => r.set(sessionKey(sessionId), serializeSession(s), 'EX', SESSION_TTL_SECONDS),
    null as 'OK' | null,
  );
  if (saved === null) {
    // Fallback map keeps the in-memory session with plaintext for local use;
    // the process memory is already trusted. Redis path is encrypted above.
    oauthSessionsFallback.set(sessionId, s);
  }
}

export async function getOAuthSession(sessionId: string): Promise<OAuthSession | null> {
  type Outcome = { source: 'redis'; session: OAuthSession | null } | 'fallback';
  const outcome = await withRedis<Outcome>(
    async (r) => {
      const raw = await r.get(sessionKey(sessionId));
      if (raw === null) return { source: 'redis', session: null };
      return { source: 'redis', session: deserializeSession(raw) };
    },
    'fallback',
  );
  if (outcome === 'fallback') {
    return oauthSessionsFallback.get(sessionId) ?? null;
  }
  return outcome.session;
}

export async function deleteOAuthSession(sessionId: string): Promise<void> {
  const deleted = await withRedis(
    async (r) => {
      await r.del(sessionKey(sessionId));
      return true as const;
    },
    false as const,
  );
  if (!deleted) {
    oauthSessionsFallback.delete(sessionId);
  }
}

/** Redis TTL handles expiry; fallback Map is pruned by createdAt age. */
export async function pruneOAuthSessions(): Promise<void> {
  const outcome = await withRedis<'ok' | 'fallback'>(
    async () => 'ok',
    'fallback',
  );
  if (outcome === 'fallback') {
    const now = Date.now();
    for (const [k, v] of oauthSessionsFallback) {
      if (v.createdAt + SESSION_MAX_AGE_MS < now) oauthSessionsFallback.delete(k);
    }
  }
}
