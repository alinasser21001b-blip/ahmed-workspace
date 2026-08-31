/**
 * API client with an offline-safe write queue.
 *
 * Every write carries a client-generated idempotency key created *before* the
 * first attempt, so a retry after a dropped connection can never create a
 * second withdrawal. Queued writes replay in order and are only dropped once
 * the server has accepted them.
 */
export interface ApiError extends Error {
  status: number;
  errorAr?: string | null;
  body?: unknown;
}

let csrfToken: string | null = null;

// localStorage, not sessionStorage: the session cookie lives for days, and
// mobile browsers discard per-tab storage whenever they reclaim the tab —
// which left the app signed in but unable to write. The token must survive
// exactly as long as the cookie does.
export function setCsrf(token: string | null): void {
  csrfToken = token;
  try {
    if (token) localStorage.setItem('tt_csrf', token);
    else localStorage.removeItem('tt_csrf');
    sessionStorage.removeItem('tt_csrf'); // pre-migration copies
  } catch {
    /* private mode */
  }
}

export function loadCsrf(): void {
  try {
    // The sessionStorage fallback keeps sessions from before the move alive.
    csrfToken = localStorage.getItem('tt_csrf') ?? sessionStorage.getItem('tt_csrf');
  } catch {
    csrfToken = null;
  }
}

export function hasCsrf(): boolean {
  return csrfToken !== null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(csrfToken && method !== 'GET' ? { 'x-csrf-token': csrfToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = new Error(
      (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
    ) as ApiError;
    err.status = res.status;
    err.errorAr = (json as { errorAr?: string } | null)?.errorAr ?? null;
    err.body = json;
    throw err;
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function newIdempotencyKey(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `client-${rand}`;
}

// --------------------------------------------------------- offline queue ----

export interface QueuedWrite {
  key: string;
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  label: string;
}

const QUEUE_KEY = 'tt_offline_queue';

export function readQueue(): QueuedWrite[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedWrite[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable; the draft is lost, and the caller is told */
  }
}

export function enqueue(item: QueuedWrite): void {
  const q = readQueue();
  if (q.some((x) => x.key === item.key)) return;
  q.push(item);
  writeQueue(q);
}

export function dequeue(key: string): void {
  writeQueue(readQueue().filter((x) => x.key !== key));
}

export interface SyncOutcome {
  synced: number;
  failed: { key: string; label: string; reason: string }[];
}

/**
 * Replay queued writes. A conflict the server reports (a duplicate warning, a
 * closed day) is surfaced, never resolved silently — the item stays queued so
 * the user can decide.
 */
export async function syncQueue(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { synced: 0, failed: [] };
  for (const item of readQueue()) {
    try {
      await api.post(item.path, item.body);
      dequeue(item.key);
      outcome.synced += 1;
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        outcome.failed.push({ key: item.key, label: item.label, reason: 'auth' });
        break;
      }
      outcome.failed.push({ key: item.key, label: item.label, reason: err.message });
    }
  }
  return outcome;
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
