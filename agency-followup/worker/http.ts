import type { Context } from "hono";
import { z } from "zod";
import type { Ctx } from "./db";
import type { Actor } from "./policy";

export type AppEnv = {
  Bindings: Env;
  Variables: { ctx: Ctx; actor: Actor; sessionId: string };
};
export type C = Context<AppEnv>;

/** An error the API reports as JSON with a stable code and an Arabic message. */
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, "not_found", "غير موجود أو لا تملك صلاحية الوصول إليه");
export const forbidden = (msg = "لا تملك صلاحية هذا الإجراء") => new ApiError(403, "forbidden", msg);
export const badRequest = (msg: string, extra?: Record<string, unknown>) => new ApiError(400, "bad_request", msg, extra);
export const conflict = (msg = "تغيّرت المهمة منذ فتحتها. حدّث الصفحة ثم أعد المحاولة.") => new ApiError(409, "version_conflict", msg);

export async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("صيغة الطلب غير صحيحة");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(first?.message && !first.message.startsWith("Invalid") ? first.message : "بيانات ناقصة أو غير صحيحة", { field: first?.path?.join(".") });
  }
  return r.data;
}

/** ISO instant in, canonical UTC ISO string out. */
export const instant = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), "تاريخ غير صحيح")
  .transform((s) => new Date(s).toISOString());

export const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "الرابط يجب أن يبدأ بـ https://");

export const text = (max: number, min = 0, msg = "النص مطلوب") => z.string().trim().max(max, "النص أطول من المسموح").min(min, msg);
export const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export function clientIp(c: C): string {
  return c.req.header("cf-connecting-ip") ?? "local";
}

/**
 * Fixed-window counter in D1 for login and setup attempts. Returns false when
 * the key is over its limit. One upsert statement, so concurrent attempts
 * cannot both slip under the limit.
 */
export async function hit(db: D1Database, key: string, max: number, windowSeconds: number, now: Date): Promise<boolean> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const row = await db
    .prepare(
      `insert into request_limits (key, count, window_start) values (?, 1, ?)
       on conflict (key) do update set
         count = case when request_limits.window_start = excluded.window_start then request_limits.count + 1 else 1 end,
         window_start = excluded.window_start
       returning count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= max;
}
