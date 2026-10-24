// The only way the interface talks to the server. Nothing is cached locally:
// every screen reads from the API, and a write is "saved" only when the
// server says so.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const NETWORK_MESSAGE = "تعذّر الاتصال بالخادم، ولم يُحفظ أي شيء. تحقق من الشبكة ثم أعد المحاولة.";

type Listener = () => void;
const unauthListeners = new Set<Listener>();
export function onUnauthenticated(fn: Listener) {
  unauthListeners.add(fn);
  return () => {
    unauthListeners.delete(fn);
  };
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
      headers: { accept: "application/json", ...(method !== "GET" ? { "content-type": "application/json" } : {}), ...opts.headers },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", NETWORK_MESSAGE);
  }
  let data: any = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/") && !path.startsWith("/api/setup/")) unauthListeners.forEach((f) => f());
    const message = data?.message ?? (res.status >= 500 ? "حدث خطأ في الخادم ولم يُحفظ شيء. أعد المحاولة." : "تعذّر تنفيذ الطلب.");
    throw new ApiError(res.status, data?.error ?? "error", message, data ?? {});
  }
  if (data === null && !ct.includes("application/json")) throw new ApiError(res.status, "bad_response", "وصل رد غير متوقع من الخادم. لم يُحفظ شيء.");
  return data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}
