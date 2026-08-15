import type { ErrorCode, ErrorEnvelope } from '@sos/contracts';

/**
 * API client.
 *
 * One place that knows how to talk to the server, so that error handling,
 * token refresh and request ids are implemented once. Screens call typed
 * helpers; nothing in the UI layer calls `fetch` directly.
 */

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    override readonly message: string,
    readonly status: number,
    readonly requestId: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True for failures a retry could plausibly fix. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'RATE_LIMITED';
  }
}

/** Network failure — distinct from an API error, and always worth a retry. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('network_unavailable', { cause });
    this.name = 'NetworkError';
  }
}

export interface TokenStore {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokensRefreshed: (tokens: { accessToken: string; refreshToken: string }) => void;
  onSessionExpired: () => void;
  /**
   * Resolves once the stored session has been read from the keystore.
   *
   * Authenticated requests await it. Without this, every data screen's mount
   * effect races the session restore and loses: on a cold start the app fired
   * a burst of requests with no `Authorization` header, each 401'd, and each
   * screen's `catch` painted an error state over a perfectly good session. The
   * layout audit counted six of them on every single load.
   *
   * The gate lives here rather than in the screens because "wait for the
   * session" is not a thing nine screens should each remember — and the tenth
   * screen, written later, would be the one that forgot.
   */
  whenReady?: () => Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens?: TokenStore;
  /**
   * Transport. Defaults to the global `fetch`.
   *
   * Injectable so the preview build can serve fixtures without the rest of the
   * app knowing: every screen keeps calling the same typed helpers, and the
   * substitution happens once, here. Production passes nothing and gets
   * `fetch`, so the real path is unchanged rather than conditionally bypassed.
   */
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  private get transport(): typeof fetch {
    const injected = this.options.fetchImpl;
    if (injected) return injected;
    /*
     * Wrapped, not returned bare.
     *
     * `this.transport(url, init)` calls whatever the getter returns with the
     * ApiClient as its receiver. The browser's `fetch` refuses that — it must
     * be invoked with the global object — and throws "Illegal invocation",
     * which surfaces here as a NetworkError on every single request.
     *
     * Node's fetch does not care, so this passed the unit and API suites and
     * failed only in the browser journey, where signup never reached
     * onboarding. The arrow function has no `this` of its own, so the inner
     * call is an ordinary global one.
     */
    return (input, init) => fetch(input, init);
  }

  async request<T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { method = 'GET', body, auth = true, signal } = init;

    // Unauthenticated calls (login, signup, the academic hierarchy) must NOT
    // wait: the sign-in screen is reachable precisely when there is no session.
    if (auth && this.options.tokens?.whenReady) await this.options.tokens.whenReady();

    const send = async (): Promise<Response> => {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (body !== undefined) headers['content-type'] = 'application/json';

      const token = auth ? this.options.tokens?.getAccessToken() : null;
      if (token) headers.authorization = `Bearer ${token}`;

      try {
        return await this.transport(`${this.options.baseUrl}${path}`, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(signal ? { signal } : {}),
        });
      } catch (cause) {
        throw new NetworkError(cause);
      }
    };

    let response = await send();

    /*
     * A 401 on an authenticated call means the short-lived access token has
     * expired. Refresh once and replay. `refreshInFlight` collapses concurrent
     * refreshes — without it, a screen that fires five requests at once would
     * rotate the refresh token five times and trip the server's theft
     * detection, logging the user out for doing nothing wrong.
     */
    if (response.status === 401 && auth && this.options.tokens?.getRefreshToken()) {
      const refreshed = await this.refreshTokens();
      if (refreshed) response = await send();
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const payload: unknown = text ? safeParse(text) : null;

    if (!response.ok) {
      const envelope = payload as ErrorEnvelope | null;
      const error = envelope?.error;
      throw new ApiError(
        error?.code ?? 'INTERNAL',
        error?.message ?? 'Request failed',
        response.status,
        error?.requestId ?? 'unknown',
        error?.details,
      );
    }

    return payload as T;
  }

  private async refreshTokens(): Promise<boolean> {
    this.refreshInFlight ??= this.doRefresh().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<boolean> {
    const refreshToken = this.options.tokens?.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await this.transport(`${this.options.baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        this.options.tokens?.onSessionExpired();
        return false;
      }
      const session = (await response.json()) as {
        tokens: { accessToken: string; refreshToken: string };
      };
      this.options.tokens?.onTokensRefreshed(session.tokens);
      return true;
    } catch {
      // A network failure is not an expired session; leave the tokens alone so
      // the user is not signed out for walking into a lift.
      return false;
    }
  }

  /**
   * Multipart upload.
   *
   * Deliberately does NOT set `content-type`: the platform has to generate the
   * multipart boundary itself, and setting the header manually produces a body
   * the server cannot parse.
   *
   * It also does not go through `request`, because a `FormData` body must not
   * be JSON-stringified. The 401-refresh-and-replay is repeated here rather
   * than shared, since replaying an upload means re-reading a stream.
   */
  async upload<T>(path: string, form: FormData): Promise<T> {
    if (this.options.tokens?.whenReady) await this.options.tokens.whenReady();

    const send = async (): Promise<Response> => {
      const token = this.options.tokens?.getAccessToken();
      try {
        return await this.transport(`${this.options.baseUrl}${path}`, {
          method: 'POST',
          headers: token ? { authorization: `Bearer ${token}` } : {},
          body: form,
        });
      } catch (cause) {
        throw new NetworkError(cause);
      }
    };

    let response = await send();
    if (response.status === 401 && this.options.tokens?.getRefreshToken()) {
      if (await this.refreshTokens()) response = await send();
    }

    const text = await response.text();
    const payload: unknown = text ? safeParse(text) : null;

    if (!response.ok) {
      const error = (payload as ErrorEnvelope | null)?.error;
      throw new ApiError(
        error?.code ?? 'INTERNAL',
        error?.message ?? 'Upload failed',
        response.status,
        error?.requestId ?? 'unknown',
        error?.details,
      );
    }
    return payload as T;
  }

  get<T>(path: string, init: { auth?: boolean } = {}): Promise<T> {
    return this.request<T>(path, { method: 'GET', ...init });
  }
  post<T>(path: string, body?: unknown, init: { auth?: boolean } = {}): Promise<T> {
    return this.request<T>(path, { method: 'POST', body, ...init });
  }
  patch<T>(path: string, body?: unknown, init: { auth?: boolean } = {}): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body, ...init });
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
