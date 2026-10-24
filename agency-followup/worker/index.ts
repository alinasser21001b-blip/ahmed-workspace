import { Hono } from "hono";
import { getAuth } from "./auth";
import { actorFor, loadCtx } from "./db";
import { seedDemo } from "./demo";
import { ApiError, clientIp, hit, type AppEnv } from "./http";
import { account, setup } from "./routes/account";
import { admin } from "./routes/admin";
import { bookings } from "./routes/bookings";
import { notifications, push } from "./routes/notifications";
import { tasks } from "./routes/tasks";
import { today } from "./routes/today";
import { runScheduler } from "./scheduler";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
  console.error("unhandled", err);
  return c.json({ error: "server_error", message: "حدث خطأ في الخادم ولم يُحفظ شيء. أعد المحاولة." }, 500);
});
app.notFound((c) => c.json({ error: "not_found", message: "المسار غير موجود" }, 404));

app.use("/api/*", async (c, next) => {
  await next();
  c.res.headers.set("cache-control", "no-store");
  c.res.headers.set("x-content-type-options", "nosniff");
});

// Same-origin JSON only for anything that writes: a page on another site can
// neither send the session cookie with a form nor pass this Origin check.
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const self = new URL(c.req.url).origin;
    if (c.req.header("origin") !== self) throw new ApiError(403, "bad_origin", "طلب من مصدر غير مسموح");
    if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new ApiError(400, "bad_content_type", "صيغة الطلب غير مدعومة");
  }
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

// ---------- authentication: only these Better Auth endpoints are reachable ----------

const GENERIC_LOGIN_ERROR = "اسم المستخدم أو كلمة المرور غير صحيحة";

app.post("/api/auth/sign-in/username", async (c) => {
  const now = new Date();
  const db = c.env.DB;
  let raw: { username?: unknown } = {};
  try {
    raw = await c.req.raw.clone().json();
  } catch {
    /* handled below */
  }
  const uname = String(raw.username ?? "").trim().toLowerCase().slice(0, 40);
  const ip = clientIp(c);
  const allowed = (await hit(db, `login:ip:${ip}`, 30, 900, now)) && (await hit(db, `login:u:${uname}:${ip}`, 8, 900, now)) && (await hit(db, `login:u:${uname}`, 40, 3600, now));
  if (!allowed) throw new ApiError(429, "rate_limited", "محاولات دخول كثيرة. انتظر ربع ساعة ثم أعد المحاولة.");

  const auth = getAuth(c.env, new URL(c.req.url).origin);
  const res = await auth.handler(c.req.raw);
  if (res.status === 429) throw new ApiError(429, "rate_limited", "محاولات دخول كثيرة. انتظر قليلاً ثم أعد المحاولة.");
  if (!res.ok) throw new ApiError(401, "invalid_credentials", GENERIC_LOGIN_ERROR);
  const data = (await res.clone().json()) as { user?: { id?: string } };
  const member = data.user?.id ? await db.prepare("select active from members where user_id = ?").bind(data.user.id).first<{ active: number }>() : null;
  if (!member || member.active !== 1) {
    if (data.user?.id) await db.prepare(`delete from "session" where "userId" = ?`).bind(data.user.id).run();
    throw new ApiError(401, "invalid_credentials", GENERIC_LOGIN_ERROR);
  }
  await db.prepare("insert into events (task_id, actor_id, type, data, created_at) values (null, ?, 'signed_in', ?, ?)").bind(data.user!.id, JSON.stringify({ ua: (c.req.header("user-agent") ?? "").slice(0, 120) }), now.toISOString()).run();
  const out = c.json({ ok: true });
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie);
  return out;
});

app.post("/api/auth/sign-out", async (c) => {
  const auth = getAuth(c.env, new URL(c.req.url).origin);
  const s = await auth.api.getSession({ headers: c.req.raw.headers });
  if (s) {
    // This device stops receiving the account's notifications.
    await c.env.DB.prepare("update push_subscriptions set revoked_at = ? where session_id = ? and revoked_at is null").bind(new Date().toISOString(), s.session.id).run();
  }
  const res = await auth.handler(c.req.raw);
  const out = c.json({ ok: true });
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie);
  return out;
});

app.all("/api/auth/*", (c) => c.json({ error: "not_found", message: "المسار غير موجود" }, 404));

app.route("/api/setup", setup as never);

// ---------- everything else needs a session ----------

const authed = new Hono<AppEnv>();
const PASSWORD_GATE_ALLOWED = new Set(["/api/account/me", "/api/account/password"]);
let knownOrigin: string | null = null;

authed.use("*", async (c, next) => {
  const origin = new URL(c.req.url).origin;
  const auth = getAuth(c.env, origin);
  const { headers, response: s } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
  if (!s) throw new ApiError(401, "unauthenticated", "سجّل الدخول للمتابعة");
  const ctx = await loadCtx(c.env);
  const actor = actorFor(ctx, s.user.id);
  if (!actor || !actor.active) throw new ApiError(401, "unauthenticated", "سجّل الدخول للمتابعة");
  if (ctx.membersById.get(actor.id)!.must_change_password && !PASSWORD_GATE_ALLOWED.has(c.req.path)) {
    throw new ApiError(403, "password_change_required", "غيّر كلمة المرور المؤقتة أولاً");
  }
  c.set("ctx", ctx);
  c.set("actor", actor);
  c.set("sessionId", s.session.id);
  if (knownOrigin !== origin) {
    // The cron has no request; it reads the app's origin from here for the VAPID subject.
    await ctx.db
      .prepare("insert into settings (key, value, updated_at) values ('app_origin', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at where settings.value != excluded.value")
      .bind(origin, ctx.now.toISOString())
      .run();
    knownOrigin = origin;
  }
  await next();
  for (const cookie of headers.getSetCookie()) c.res.headers.append("set-cookie", cookie);
});

authed.route("/account", account);
authed.route("/today", today);
authed.route("/tasks", tasks);
authed.route("/bookings", bookings);
authed.route("/notifications", notifications);
authed.route("/push", push);
authed.route("/admin", admin);
authed.all("*", (c) => c.json({ error: "not_found", message: "المسار غير موجود" }, 404));

app.route("/api", authed);

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const flag = await env.DB.prepare("select value from settings where key = 'demo_seed'").first<{ value: string }>();
        if (flag?.value === "pending") {
          await seedDemo(await loadCtx(env));
          await env.DB.prepare("update settings set value = 'done', updated_at = ? where key = 'demo_seed'").bind(new Date().toISOString()).run();
        }
        await runScheduler(env, new Date());
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
