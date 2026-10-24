import { env, SELF } from "cloudflare:test";
import { hashPassword } from "../worker/lib/crypto";

export const ORIGIN = "https://agency.test";
export const PASSWORDS: Record<string, string> = {
  mohammed: "Test-Owner-Pass-91",
  ammar: "Test-Exec-Pass-72",
  sama: "Test-Manager-Pass-53",
  hussein: "Test-Photo-Pass-34",
};
export const IDS = { mohammed: "u_mohammed", ammar: "u_ammar", sama: "u_sama", hussein: "u_hussein" } as const;
export type Who = keyof typeof IDS;

let passwordsReady: Promise<void> | null = null;

/** Give every seeded member a known password (tests only; production uses one-time setup links). */
export function ensurePasswords(): Promise<void> {
  passwordsReady ??= (async () => {
    const now = new Date().toISOString();
    for (const [u, pw] of Object.entries(PASSWORDS)) {
      const uid = IDS[u as Who];
      const hash = await hashPassword(pw, 100_000);
      await env.DB.prepare(`delete from "account" where "userId" = ?`).bind(uid).run();
      await env.DB.prepare(`insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") values (?, ?, 'credential', ?, ?, ?, ?)`)
        .bind(`a_${u}`, uid, uid, hash, now, now)
        .run();
    }
  })();
  return passwordsReady;
}

/** One browser: its own cookie jar, same-origin headers, JSON in and out. */
export class Browser {
  cookies = new Map<string, string>();
  constructor(public ip = "10.0.0." + Math.floor(Math.random() * 200 + 1)) {}

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const h: Record<string, string> = { "cf-connecting-ip": this.ip, ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (method !== "GET") {
      h.origin ??= ORIGIN;
      h["content-type"] ??= "application/json";
    }
    const res = await SELF.fetch(ORIGIN + path, { method, headers: h, body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body), redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async json<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }> {
    const res = await this.raw(method, path, body, headers);
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed as T };
  }

  get = <T = any>(path: string) => this.json<T>("GET", path);
  post = <T = any>(path: string, body?: unknown, headers?: Record<string, string>) => this.json<T>("POST", path, body, headers);
  patch = <T = any>(path: string, body?: unknown) => this.json<T>("PATCH", path, body);
}

export async function signIn(who: Who): Promise<Browser> {
  await ensurePasswords();
  const b = new Browser();
  const r = await b.post("/api/auth/sign-in/username", { username: who, password: PASSWORDS[who] });
  if (r.status !== 200) throw new Error(`sign-in ${who} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return b;
}

export async function team() {
  const [mohammed, ammar, sama, hussein] = await Promise.all([signIn("mohammed"), signIn("ammar"), signIn("sama"), signIn("hussein")]);
  return { mohammed, ammar, sama, hussein };
}

let n = 0;
export const key = () => `k-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;

export async function createTask(as: Browser, fields: Record<string, unknown>): Promise<string> {
  const r = await as.post("/api/tasks", { title: "مهمة اختبار", priority: "normal", ...fields }, { "idempotency-key": key() });
  if (r.status !== 201) throw new Error(`create failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
}

export async function task(as: Browser, id: string) {
  const r = await as.get(`/api/tasks/${id}`);
  if (r.status !== 200) throw new Error(`get failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function act(as: Browser, id: string, action: string, extra: Record<string, unknown> = {}) {
  const t = await task(as, id);
  return as.post(`/api/tasks/${id}/actions/${action}`, { version: t.task.version, ...extra });
}

export { env };

/** A Sunday at 09:00 Baghdad (06:00Z), at least `weeksAhead` weeks after the real clock, so API date checks pass whenever the suite runs. */
export function baseSunday(weeksAhead = 2): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7 * weeksAhead));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 0));
}
export const plus = (t: Date, minutes: number) => new Date(t.getTime() + minutes * 60_000);

export async function sql(query: string, ...params: unknown[]) {
  return env.DB.prepare(query).bind(...params).run();
}
export async function rows<T = Record<string, any>>(query: string, ...params: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(query).bind(...params).all<T>()).results;
}

/** Notifications for a task, grouped as "user:kind" → count. */
export async function noteCounts(taskId: string): Promise<Record<string, number>> {
  const r = await rows<{ user_id: string; kind: string; n: number }>("select user_id, kind, count(*) as n from notifications where task_id = ? group by user_id, kind", taskId);
  return Object.fromEntries(r.map((x) => [`${x.user_id.replace("u_", "")}:${x.kind}`, x.n]));
}
