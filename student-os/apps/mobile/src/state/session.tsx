import type { AuthSession, AuthUser } from '@sos/contracts';
import Constants from 'expo-constants';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiClient } from '../api/client';
import { resolveApiBaseUrl } from '../config/api-base-url';

/**
 * Session state.
 *
 * Tokens live in the platform keystore on device (SecureStore) and in
 * localStorage on web, never in plain AsyncStorage. The refresh token is a
 * bearer credential with a 30-day life; treating it like ordinary app state is
 * how a stolen device backup becomes a stolen account.
 */

const ACCESS_KEY = 'sos.access';
const REFRESH_KEY = 'sos.refresh';

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage unavailable (private mode) — the session simply will not persist */
    }
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value);
}

/**
 * The API address, resolved once at module load.
 *
 * `extra.apiBaseUrl` is now *computed* from `EXPO_PUBLIC_API_URL` at build time
 * (see `app.config.ts`) rather than hardcoded, so reading it first no longer
 * shadows the environment — it is the environment, frozen. The variable is still
 * read as a second source because the dev server injects `EXPO_PUBLIC_*` into
 * the bundle directly.
 *
 * There is deliberately no `?? 'http://localhost:4000'` on the end. `__DEV__` is
 * a Metro compile-time literal and is `false` in anything `expo export`
 * produces, so a production bundle with no address throws here instead of
 * quietly addressing the machine that built it. That is a hard failure at
 * startup, which is the point: it is loud, it is immediate, and the build that
 * caused it should already have been refused by `pnpm --filter @sos/mobile
 * build:web`. This is the gate that cannot be skipped by calling the Expo CLI
 * directly, which is why it is the guarantee and that one is the convenience.
 */
export const API_BASE_URL: string = resolveApiBaseUrl({
  // Not cast: `resolveApiBaseUrl` takes `unknown` and checks, because this value
  // crosses Expo's config serialisation and does not always arrive as declared.
  configured: Constants.expoConfig?.extra?.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_URL,
  isDevelopmentBuild: __DEV__,
  // Read here rather than inside the resolver so the rule stays testable without
  // a browser, and so native — which has no page — passes null rather than
  // whatever a polyfill decided `location` should be.
  origin: Platform.OS === 'web' ? (globalThis.location?.origin ?? null) : null,
});

interface SessionValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: AuthUser | null;
  api: ApiClient;
  /**
   * Reads the current access token.
   *
   * A getter, not a value: the token rotates on refresh without any state
   * change, so a captured copy goes stale and the realtime handshake that used
   * it would 401 into a reconnect loop.
   *
   * Exposed for exactly one caller — the realtime handshake, where a browser's
   * WebSocket constructor cannot set an `Authorization` header. Everything else
   * goes through `api`, which attaches and refreshes the token itself.
   */
  getAccessToken: () => string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<SessionValue['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  // Tokens are held in refs, not state: the API client reads them on every
  // request and must never see a stale closure value.
  const accessToken = useRef<string | null>(null);
  const refreshToken = useRef<string | null>(null);

  /*
   * The readiness gate.
   *
   * Created before the first render so that a screen's mount effect — which
   * runs before this provider's restore effect resolves — has something to
   * await rather than a null token to send.
   */
  const ready = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  if (ready.current === null) {
    let resolve = (): void => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    ready.current = { promise, resolve };
  }
  const whenReady = useCallback(() => ready.current!.promise, []);

  const clearSession = useCallback(async () => {
    accessToken.current = null;
    refreshToken.current = null;
    await Promise.all([secureSet(ACCESS_KEY, null), secureSet(REFRESH_KEY, null)]);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_BASE_URL,
        tokens: {
          getAccessToken: () => accessToken.current,
          getRefreshToken: () => refreshToken.current,
          onTokensRefreshed: (tokens) => {
            accessToken.current = tokens.accessToken;
            refreshToken.current = tokens.refreshToken;
            void secureSet(ACCESS_KEY, tokens.accessToken);
            void secureSet(REFRESH_KEY, tokens.refreshToken);
          },
          onSessionExpired: () => {
            void clearSession();
          },
          whenReady,
        },
      }),
    [clearSession, whenReady],
  );

  const adopt = useCallback(async (session: AuthSession) => {
    accessToken.current = session.tokens.accessToken;
    refreshToken.current = session.tokens.refreshToken;
    await Promise.all([
      secureSet(ACCESS_KEY, session.tokens.accessToken),
      secureSet(REFRESH_KEY, session.tokens.refreshToken),
    ]);
    setUser(session.user);
    setStatus('signedIn');
  }, []);

  // Restore a stored session on launch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, storedRefresh] = await Promise.all([
        secureGet(ACCESS_KEY),
        secureGet(REFRESH_KEY),
      ]);
      if (cancelled) return;

      accessToken.current = stored;
      refreshToken.current = storedRefresh;

      // Opened as soon as the tokens are in place, and before `/auth/me`:
      // queued requests carry the restored token, and the gate cannot deadlock
      // on the very call that is meant to open it.
      ready.current?.resolve();

      if (!storedRefresh) {
        setStatus('signedOut');
        return;
      }

      try {
        // The client transparently refreshes if the access token has expired.
        const me = await api.get<AuthUser>('/v1/auth/me');
        if (cancelled) return;
        setUser(me);
        setStatus('signedIn');
      } catch {
        if (!cancelled) await clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, clearSession]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      user,
      api,
      getAccessToken: () => accessToken.current,
      signIn: async (email, password) => {
        const session = await api.post<AuthSession>(
          '/v1/auth/login',
          { email, password },
          { auth: false },
        );
        await adopt(session);
      },
      signUp: async (email, password) => {
        const session = await api.post<AuthSession>(
          '/v1/auth/signup',
          { email, password, locale: 'ar' },
          { auth: false },
        );
        await adopt(session);
      },
      signOut: async () => {
        try {
          await api.post('/v1/auth/logout', {
            refreshToken: refreshToken.current ?? undefined,
            allDevices: false,
          });
        } catch {
          // Sign-out must succeed locally even if the network call fails;
          // otherwise a user on a bad connection cannot leave their account.
        }
        await clearSession();
      },
      refreshUser: async () => {
        const me = await api.get<AuthUser>('/v1/auth/me');
        setUser(me);
      },
    }),
    [status, user, api, adopt, clearSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}
