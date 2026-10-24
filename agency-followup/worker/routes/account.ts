import { Hono } from "hono";
import { z } from "zod";
import { getAuth } from "../auth";
import { loadMembers } from "../db";
import { ApiError, badRequest, body, hit, limitAddress, type AppEnv } from "../http";
import { hashPassword, randomId, sha256, verifyPassword } from "../lib/crypto";
import { assignmentOptions } from "./tasks";
import { visibleClients } from "../views";

const passwordRule = z
  .string()
  .min(10, "كلمة المرور 10 أحرف على الأقل")
  .max(128, "كلمة المرور أطول من المسموح")
  .refine((p) => new Set(p).size >= 5, "كلمة المرور ضعيفة: استخدم أحرفاً متنوعة");

function iterations(env: Env) {
  return Number(env.PBKDF2_ITERATIONS) || 100_000;
}

// ---------- public: first-time setup and reset links ----------

export const setup = new Hono<{ Bindings: Env }>();

type TokenRow = { id: string; user_id: string; expires_at: string };

async function findToken(db: D1Database, token: string, now: Date): Promise<TokenRow | null> {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  return db
    .prepare("select id, user_id, expires_at from setup_tokens where token_hash = ? and used_at is null and revoked_at is null and expires_at > ?")
    .bind(await sha256(token), now.toISOString())
    .first<TokenRow>();
}

async function limitSetup(db: D1Database, ip: string, now: Date) {
  if (!(await hit(db, `setup:${ip}`, 20, 900, now))) throw new ApiError(429, "rate_limited", "محاولات كثيرة. انتظر ربع ساعة ثم أعد المحاولة.");
}

setup.post("/check", async (c) => {
  const now = new Date();
  const ip = limitAddress(c.req.header("cf-connecting-ip") ?? "local");
  await limitSetup(c.env.DB, ip, now);
  const { token } = await body(c as never, z.object({ token: z.string().max(100) }));
  const row = await findToken(c.env.DB, token, now);
  if (!row) return c.json({ valid: false });
  const m = (await loadMembers(c.env.DB)).find((x) => x.id === row.user_id);
  if (!m || !m.active) return c.json({ valid: false });
  return c.json({ valid: true, username: m.username, name: m.name, expires_at: row.expires_at });
});

setup.post("/complete", async (c) => {
  const now = new Date();
  const db = c.env.DB;
  const ip = limitAddress(c.req.header("cf-connecting-ip") ?? "local");
  await limitSetup(db, ip, now);
  const input = await body(c as never, z.object({ token: z.string().max(100), password: passwordRule }));
  const row = await findToken(db, input.token, now);
  if (!row) throw badRequest("الرابط غير صالح أو انتهت صلاحيته. اطلب رابطاً جديداً من محمد.");
  const m = (await loadMembers(db)).find((x) => x.id === row.user_id);
  if (!m || !m.active) throw badRequest("الرابط غير صالح");
  if (input.password.toLowerCase().includes(m.username)) throw badRequest("لا تستخدم اسم المستخدم داخل كلمة المرور");

  const hash = await hashPassword(input.password, iterations(c.env));
  const nowIso = now.toISOString();
  const used = await db.prepare("update setup_tokens set used_at = ? where id = ? and used_at is null").bind(nowIso, row.id).run();
  if (used.meta.changes !== 1) throw badRequest("استُخدم هذا الرابط مسبقاً");
  const existing = await db.prepare(`select id from "account" where "userId" = ? and "providerId" = 'credential'`).bind(m.id).first<{ id: string }>();
  await db.batch([
    existing
      ? db.prepare(`update "account" set "password" = ?, "updatedAt" = ? where id = ?`).bind(hash, nowIso, existing.id)
      : db.prepare(`insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") values (?, ?, 'credential', ?, ?, ?, ?)`).bind(randomId("a_"), m.id, m.id, hash, nowIso, nowIso),
    db.prepare(`delete from "session" where "userId" = ?`).bind(m.id),
    db.prepare("update push_subscriptions set revoked_at = ? where user_id = ? and revoked_at is null").bind(nowIso, m.id),
    db.prepare("update setup_tokens set revoked_at = ? where user_id = ? and used_at is null and revoked_at is null").bind(nowIso, m.id),
    db.prepare("update members set must_change_password = 0 where user_id = ?").bind(m.id),
    db.prepare("insert into events (task_id, actor_id, type, data, created_at) values (null, ?, 'setup_completed', '{}', ?)").bind(m.id, nowIso),
  ]);

  // Sign straight in with the password just chosen.
  const origin = new URL(c.req.url).origin;
  const res = await getAuth(c.env, origin).api.signInUsername({ body: { username: m.username, password: input.password }, headers: c.req.raw.headers, asResponse: true });
  const out = c.json({ ok: true, username: m.username, signed_in: res.ok });
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie);
  return out;
});

// ---------- signed in ----------

export const account = new Hono<AppEnv>();

account.get("/me", (c) => {
  const ctx = c.get("ctx");
  const a = c.get("actor");
  const m = ctx.membersById.get(a.id)!;
  return c.json({
    user: { id: a.id, username: a.username, name: a.name, role: a.role, title: m.title, must_change_password: m.must_change_password },
    clients: visibleClients(ctx, a),
    assignment: assignmentOptions(ctx, a),
    members: ctx.members.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, role: x.role })),
    work_hours: ctx.workHours,
    now: ctx.now.toISOString(),
  });
});

account.post("/password", async (c) => {
  const ctx = c.get("ctx");
  const a = c.get("actor");
  // Per member, wherever the requests come from: only a signed-in session can
  // count against it, and it caps guessing the current password.
  if (!(await hit(ctx.db, `pw:${a.id}`, 5, 900, ctx.now))) throw new ApiError(429, "rate_limited", "محاولات كثيرة. انتظر ربع ساعة.");
  const input = await body(c, z.object({ current: z.string().max(128), next: passwordRule }));
  if (input.next.toLowerCase().includes(a.username)) throw badRequest("لا تستخدم اسم المستخدم داخل كلمة المرور");
  if (input.next === input.current) throw badRequest("اختر كلمة مرور جديدة مختلفة");
  const acc = await ctx.db.prepare(`select id, "password" as password from "account" where "userId" = ? and "providerId" = 'credential'`).bind(a.id).first<{ id: string; password: string | null }>();
  if (!acc?.password || !(await verifyPassword(acc.password, input.current))) throw badRequest("كلمة المرور الحالية غير صحيحة", { field: "current" });
  const hash = await hashPassword(input.next, iterations(ctx.env));
  const nowIso = ctx.now.toISOString();
  const sid = c.get("sessionId");
  await ctx.db.batch([
    ctx.db.prepare(`update "account" set "password" = ?, "updatedAt" = ? where id = ?`).bind(hash, nowIso, acc.id),
    // Every other device is signed out; this one stays signed in.
    ctx.db.prepare(`delete from "session" where "userId" = ? and id != ?`).bind(a.id, sid),
    ctx.db.prepare("update push_subscriptions set revoked_at = ? where user_id = ? and revoked_at is null and (session_id is null or session_id != ?)").bind(nowIso, a.id, sid),
    ctx.db.prepare("update members set must_change_password = 0 where user_id = ?").bind(a.id),
    ctx.db.prepare("insert into events (task_id, actor_id, type, data, created_at) values (null, ?, 'password_changed', '{}', ?)").bind(a.id, nowIso),
  ]);
  return c.json({ ok: true });
});

account.get("/sessions", async (c) => {
  const ctx = c.get("ctx");
  const { results } = await ctx.db
    .prepare(`select id, "createdAt" as created_at, "userAgent" as user_agent, "expiresAt" as expires_at from "session" where "userId" = ? order by "createdAt" desc`)
    .bind(c.get("actor").id)
    .all<{ id: string }>();
  return c.json({ sessions: results.map((s) => ({ ...s, current: s.id === c.get("sessionId") })) });
});

account.post("/sign-out-others", async (c) => {
  const ctx = c.get("ctx");
  const a = c.get("actor");
  const sid = c.get("sessionId");
  const nowIso = ctx.now.toISOString();
  await ctx.db.batch([
    ctx.db.prepare(`delete from "session" where "userId" = ? and id != ?`).bind(a.id, sid),
    ctx.db.prepare("update push_subscriptions set revoked_at = ? where user_id = ? and revoked_at is null and (session_id is null or session_id != ?)").bind(nowIso, a.id, sid),
  ]);
  return c.json({ ok: true });
});
