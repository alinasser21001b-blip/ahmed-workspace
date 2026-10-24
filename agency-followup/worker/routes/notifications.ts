import { Hono } from "hono";
import { z } from "zod";
import { badRequest, body, type AppEnv } from "../http";
import { randomId } from "../lib/crypto";
import { notifyStmts, PUSH_TEXT } from "../notify";
import { allowedEndpoint, pushConfigured, sendToUser } from "../push";

export const notifications = new Hono<AppEnv>();

notifications.get("/", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const nowIso = ctx.now.toISOString();
  const { results } = await ctx.db
    .prepare(
      `select id, task_id, kind, title, body, url, deliver_at, read_at from notifications
       where user_id = ? and deliver_at <= ? and cancelled_at is null order by deliver_at desc limit 100`,
    )
    .bind(actor.id, nowIso)
    .all();
  const unread = await ctx.db
    .prepare("select count(*) as n from notifications where user_id = ? and deliver_at <= ? and cancelled_at is null and read_at is null")
    .bind(actor.id, nowIso)
    .first<{ n: number }>();
  return c.json({ notifications: results, unread: unread?.n ?? 0 });
});

notifications.get("/unread", async (c) => {
  const ctx = c.get("ctx");
  const r = await ctx.db
    .prepare("select count(*) as n from notifications where user_id = ? and deliver_at <= ? and cancelled_at is null and read_at is null")
    .bind(c.get("actor").id, ctx.now.toISOString())
    .first<{ n: number }>();
  return c.json({ unread: r?.n ?? 0 });
});

notifications.post("/read", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ ids: z.array(z.string().max(64)).max(200).optional(), all: z.boolean().optional() }));
  const me = c.get("actor").id;
  const nowIso = ctx.now.toISOString();
  if (input.all) {
    await ctx.db.prepare("update notifications set read_at = ? where user_id = ? and read_at is null and deliver_at <= ?").bind(nowIso, me, nowIso).run();
  } else if (input.ids?.length) {
    await ctx.db
      .prepare(`update notifications set read_at = ? where user_id = ? and read_at is null and id in (select value from json_each(?))`)
      .bind(nowIso, me, JSON.stringify(input.ids))
      .run();
  }
  return c.json({ ok: true });
});

// ---------- device push ----------

export const push = new Hono<AppEnv>();

push.get("/status", async (c) => {
  const ctx = c.get("ctx");
  const me = c.get("actor").id;
  const { results } = await ctx.db
    .prepare("select id, user_agent, created_at, last_success_at, last_error, session_id = ? as this_session from push_subscriptions where user_id = ? and revoked_at is null order by created_at desc")
    .bind(c.get("sessionId"), me)
    .all();
  return c.json({ configured: pushConfigured(ctx.env), public_key: ctx.env.VAPID_PUBLIC_KEY ?? null, devices: results });
});

const subSchema = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

push.post("/subscribe", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, subSchema);
  if (!allowedEndpoint(input.endpoint, (ctx.env as { PUSH_TEST_HOSTS?: string }).PUSH_TEST_HOSTS?.split(",").filter(Boolean))) throw badRequest("خدمة الإشعارات في هذا المتصفح غير معروفة");
  const nowIso = ctx.now.toISOString();
  // One device, one owner: the subscription follows whoever is signed in on it now.
  await ctx.db
    .prepare(
      `insert into push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, user_agent, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (endpoint) do update set user_id = excluded.user_id, session_id = excluded.session_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent, revoked_at = null, failures = 0, last_error = null, created_at = excluded.created_at`,
    )
    .bind(randomId("ps_"), c.get("actor").id, c.get("sessionId"), input.endpoint, input.keys.p256dh, input.keys.auth, (c.req.header("user-agent") ?? "").slice(0, 200), nowIso)
    .run();
  // At most five active devices per member; the oldest beyond that are dropped.
  await ctx.db
    .prepare(
      `update push_subscriptions set revoked_at = ? where user_id = ? and revoked_at is null and id not in
         (select id from push_subscriptions where user_id = ? and revoked_at is null order by created_at desc limit 5)`,
    )
    .bind(nowIso, c.get("actor").id, c.get("actor").id)
    .run();
  return c.json({ ok: true });
});

/** Is this browser's subscription still bound to the signed-in member on the server? */
push.post("/check", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ endpoint: z.string().max(1000) }));
  const row = await ctx.db.prepare("select 1 as x from push_subscriptions where endpoint = ? and user_id = ? and revoked_at is null").bind(input.endpoint, c.get("actor").id).first();
  return c.json({ active: !!row });
});

push.post("/unsubscribe", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ endpoint: z.string().max(1000) }));
  await ctx.db.prepare("update push_subscriptions set revoked_at = ? where endpoint = ? and user_id = ?").bind(ctx.now.toISOString(), input.endpoint, c.get("actor").id).run();
  return c.json({ ok: true });
});

/** «أرسل إشعار اختبار لي»: an in-app notification plus an immediate push to the member's own devices. */
push.post("/test", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const key = `test:${actor.id}:${randomId()}`;
  await ctx.db.batch(notifyStmts(ctx, { userId: actor.id, kind: "test", title: "إشعار تجريبي", body: "إذا وصلك هذا على جهازك فالإشعارات تعمل.", url: "/account", dedupeKey: key, push: false, deliverAt: ctx.now }));
  const origin = new URL(c.req.url).origin;
  const r = await sendToUser(ctx, actor.id, { title: "متابعة الوكالة", body: PUSH_TEXT.test, url: "/account", tag: "test" }, origin, "high");
  return c.json({ configured: pushConfigured(ctx.env), devices: r.devices, sent: r.sent, failed: r.failed, expired: r.gone, errors: r.errors.slice(0, 3) });
});
