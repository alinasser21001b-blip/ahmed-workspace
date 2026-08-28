export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  });
  const data = (await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    throw new Error(data.error ?? 'Request failed');
  }
  return data;
}

export const SESSION_KEY = 'osce.activeSessionId';

export function rememberSession(id: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_KEY, id);
}

export function forgetSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SESSION_KEY);
}

export function readRememberedSession(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(SESSION_KEY);
}
