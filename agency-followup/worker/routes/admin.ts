// Mohammed only. Every route checks the policy again; the page being hidden
// in the interface is not the protection.

import { Hono } from "hono";
import { z } from "zod";
import { logEventStmt, type Ctx } from "../db";
import { badRequest, body, forbidden, id, type AppEnv } from "../http";
import { randomToken, sha256, randomId } from "../lib/crypto";
import { canArchive, canEditSettings, canExport, canManageTeam, canSeeAdminReports } from "../policy";
import { pushConfigured } from "../push";
import { archiveDemo, seedDemo } from "../demo";

export const admin = new Hono<AppEnv>();

admin.use("*", async (c, next) => {
  if (!canSeeAdminReports(c.get("actor"))) throw forbidden("هذه الصفحة لمدير الوكالة فقط");
  await next();
});

const SETUP_TTL_HOURS = 72;

/** A one-time setup link. Only its SHA-256 is stored; the link itself is returned once. */
export async function createSetupToken(db: D1Database, userId: string, createdBy: string | null, now: Date): Promise<{ token: string; expiresAt: string; stmts: D1PreparedStatement[] }> {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SETUP_TTL_HOURS * 3_600_000).toISOString();
  const nowIso = now.toISOString();
  return {
    token,
    expiresAt,
    stmts: [
      db.prepare("update setup_tokens set revoked_at = ? where user_id = ? and used_at is null and revoked_at is null").bind(nowIso, userId),
      db.prepare("insert into setup_tokens (id, user_id, token_hash, expires_at, created_by, created_at) values (?, ?, ?, ?, ?, ?)").bind(randomId("st_"), userId, await sha256(token), expiresAt, createdBy, nowIso),
    ],
  };
}

admin.get("/overview", async (c) => {
  const ctx = c.get("ctx");
  const nowIso = ctx.now.toISOString();
  const [accounts, tokens, sessions, devices, runs, lastOk, outbox, settings] = await Promise.all([
    ctx.db.prepare(`select "userId" as user_id, "password" is not null as has_password from "account" where "providerId" = 'credential'`).all<{ user_id: string; has_password: number }>(),
    ctx.db.prepare("select user_id, max(expires_at) as expires_at from setup_tokens where used_at is null and revoked_at is null and expires_at > ? group by user_id").bind(nowIso).all<{ user_id: string; expires_at: string }>(),
    ctx.db.prepare(`select "userId" as user_id, count(*) as n, max("createdAt") as last from "session" where "expiresAt" > ? group by "userId"`).bind(nowIso).all<{ user_id: string; n: number; last: string }>(),
    ctx.db.prepare("select user_id, count(*) as n, max(last_success_at) as last_success from push_subscriptions where revoked_at is null group by user_id").all<{ user_id: string; n: number; last_success: string | null }>(),
    ctx.db.prepare("select id, started_at, finished_at, ok, summary, error from scheduler_runs order by id desc limit 10").all(),
    ctx.db.prepare("select started_at, finished_at, summary from scheduler_runs where ok = 1 order by id desc limit 1").first(),
    ctx.db.prepare("select status, count(*) as n from outbox where created_at > ? group by status").bind(new Date(ctx.now.getTime() - 86_400_000).toISOString()).all<{ status: string; n: number }>(),
    ctx.db.prepare("select key, value, updated_at, updated_by from settings where key in ('work_hours', 'rules')").all<{ key: string; value: string; updated_at: string; updated_by: string | null }>(),
  ]);
  const by = <T extends { user_id: string }>(rows: T[]) => new Map(rows.map((r) => [r.user_id, r]));
  const acc = by(accounts.results);
  const tok = by(tokens.results);
  const ses = by(sessions.results);
  const dev = by(devices.results);
  const lastFailures = await ctx.db.prepare("select last_error, count(*) as n from outbox where status = 'failed' and created_at > ? group by last_error order by n desc limit 5").bind(new Date(ctx.now.getTime() - 86_400_000).toISOString()).all();
  const demo = await ctx.db.prepare("select count(*) as n from tasks where is_demo = 1 and archived_at is null").first<{ n: number }>();
  return c.json({
    now: nowIso,
    members: ctx.members.map((m) => ({
      id: m.id,
      username: m.username,
      name: m.name,
      role: m.role,
      title: m.title,
      active: m.active,
      has_password: !!acc.get(m.id)?.has_password,
      setup_link_pending_until: tok.get(m.id)?.expires_at ?? null,
      sessions: ses.get(m.id)?.n ?? 0,
      last_sign_in: ses.get(m.id)?.last ?? null,
      devices: dev.get(m.id)?.n ?? 0,
      last_push_success: dev.get(m.id)?.last_success ?? null,
    })),
    scheduler: { last_ok: lastOk ?? null, runs: runs.results },
    outbox_24h: Object.fromEntries(outbox.results.map((r) => [r.status, r.n])),
    outbox_failures: lastFailures.results,
    push_configured: pushConfigured(ctx.env),
    settings: Object.fromEntries(settings.results.map((s) => [s.key, { value: JSON.parse(s.value), updated_at: s.updated_at, updated_by: s.updated_by ? (ctx.membersById.get(s.updated_by)?.name ?? null) : null }])),
    demo_tasks: demo?.n ?? 0,
  });
});

admin.post("/members/:id/reset", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  if (!canManageTeam(actor)) throw forbidden();
  const targetId = id.parse(c.req.param("id"));
  const target = ctx.membersById.get(targetId);
  if (!target) throw badRequest("عضو غير معروف");
  if (target.id === actor.id) throw badRequest("لتغيير كلمة مرورك استخدم صفحة الحساب");
  const { token, expiresAt, stmts } = await createSetupToken(ctx.db, target.id, actor.id, ctx.now);
  const nowIso = ctx.now.toISOString();
  await ctx.db.batch([
    ...stmts,
    // The old password stops working and every device is signed out.
    ctx.db.prepare(`delete from "account" where "userId" = ? and "providerId" = 'credential'`).bind(target.id),
    ctx.db.prepare(`delete from "session" where "userId" = ?`).bind(target.id),
    ctx.db.prepare("update push_subscriptions set revoked_at = ? where user_id = ? and revoked_at is null").bind(nowIso, target.id),
    logEventStmt(ctx.db, null, actor.id, "member_reset", { member: target.id }, ctx.now),
  ]);
  const origin = new URL(c.req.url).origin;
  return c.json({ link: `${origin}/setup#${token}`, expires_at: expiresAt, username: target.username, name: target.name });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "الوقت بصيغة 09:00");
// Each message names the field as the settings page labels it, so Mohammed sees which value to fix.
const minutes = (min: number, max: number, what: string) => {
  const range = `${what}: القيمة بين ${min} و${max} دقيقة`;
  return z.number(`${what}: أدخل رقماً`).int(`${what}: أدخل رقماً صحيحاً`).min(min, range).max(max, range);
};
const increasing = (arr: number[]) => arr.every((x, i) => i === 0 || x > arr[i - 1]);
const stages = (count: 2 | 4, min: number, max: number, what: string) =>
  z
    .array(minutes(min, max, what))
    .length(count, `${what}: أدخل ${count === 4 ? "أربع قيم" : "قيمتين"} مفصولة بفواصل`)
    .refine(increasing, `${what}: المراحل تصاعدية`);
const settingsSchema = z.object({
  work_hours: z
    .object({
      tz: z.string().max(64).refine((tz) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "منطقة زمنية غير معروفة"),
      days: z.array(z.number().int().min(0).max(6)).min(1, "اختر يوم عمل واحداً على الأقل").max(7),
      start: hhmm,
      end: hhmm,
    })
    .refine((w) => w.end > w.start, "نهاية الدوام يجب أن تكون بعد بدايته"),
  rules: z.object({
    ack: z.object({ normal: stages(4, 5, 6000, "عدم الاستلام — عادية"), urgent: stages(4, 5, 6000, "عدم الاستلام — عاجلة") }),
    dueSoonMinutes: z.object({ normal: minutes(5, 1440, "تذكير قبل الموعد — عادية"), urgent: minutes(5, 1440, "تذكير قبل الموعد — عاجلة") }),
    blockerFollowMinutes: z.object({ normal: minutes(15, 2880, "متابعة العائق بعد — عادية"), urgent: minutes(15, 2880, "متابعة العائق بعد — عاجلة") }),
    reviewMinutes: z.object({ normal: stages(2, 15, 6000, "انتظار المراجعة — عادية"), urgent: stages(2, 15, 6000, "انتظار المراجعة — عاجلة") }),
    urgentOutsideHours: z.boolean(),
    demoReminders: z.boolean(),
  }),
});

admin.put("/settings", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  if (!canEditSettings(actor)) throw forbidden();
  const input = await body(c, settingsSchema);
  const nowIso = ctx.now.toISOString();
  const wh = { ...input.work_hours, days: [...new Set(input.work_hours.days)].sort(), assumed: false };
  await ctx.db.batch([
    ctx.db.prepare("update settings set value = ?, updated_at = ?, updated_by = ? where key = 'work_hours'").bind(JSON.stringify(wh), nowIso, actor.id),
    ctx.db.prepare("update settings set value = ?, updated_at = ?, updated_by = ? where key = 'rules'").bind(JSON.stringify(input.rules), nowIso, actor.id),
    logEventStmt(ctx.db, null, actor.id, "settings_changed", { from: { work_hours: ctx.workHours, rules: ctx.rules }, to: { work_hours: wh, rules: input.rules } }, ctx.now),
  ]);
  return c.json({ ok: true });
});

admin.get("/export", async (c) => {
  const ctx = c.get("ctx");
  if (!canExport(c.get("actor"))) throw forbidden();
  const format = c.req.query("format") === "csv" ? "csv" : "json";
  const stamp = ctx.now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  if (format === "csv") {
    const { results } = await ctx.db.prepare("select * from tasks order by created_at").all<Record<string, unknown>>();
    const name = (u: unknown) => (typeof u === "string" ? (ctx.membersById.get(u)?.name ?? u) : "");
    const cols: [string, (r: Record<string, unknown>) => unknown][] = [
      ["المعرف", (r) => r.id],
      ["العميل", (r) => ctx.clientsById.get(r.client_id as string)?.name],
      ["العنوان", (r) => r.title],
      ["الحالة", (r) => r.status],
      ["الأولوية", (r) => r.priority],
      ["صاحب الطلب", (r) => name(r.requester_id)],
      ["المنفذ", (r) => name(r.assignee_id)],
      ["المراجع", (r) => name(r.reviewer_id)],
      ["الموعد", (r) => r.due_at],
      ["الموعد الأصلي", (r) => r.original_due_at],
      ["أنشئت", (r) => r.created_at],
      ["استُلمت", (r) => r.acknowledged_at],
      ["سُلّمت", (r) => r.submitted_at],
      ["أُكملت", (r) => r.completed_at],
      ["تجريبية", (r) => (r.is_demo ? "نعم" : "")],
      ["مؤرشفة", (r) => r.archived_at],
    ];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Neutralise spreadsheet formulas in exported text.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const csv = "﻿" + [cols.map((c) => c[0]).join(","), ...results.map((r) => cols.map(([, f]) => esc(f(r))).join(","))].join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="tasks-${stamp}.csv"`, "cache-control": "no-store" } });
  }
  const tables = ["clients", "client_scopes", "tasks", "task_grants", "comments", "deliverables", "blockers", "due_proposals", "bookings", "events", "notifications", "settings"];
  const data: Record<string, unknown> = { exported_at: ctx.now.toISOString(), members: ctx.members.map(({ id: mid, username, name, role, title, active }) => ({ id: mid, username, name, role, title, active })) };
  for (const t of tables) data[t] = (await ctx.db.prepare(`select * from ${t}`).all()).results;
  return new Response(JSON.stringify(data, null, 1), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="agency-followup-${stamp}.json"`, "cache-control": "no-store" } });
});

admin.post("/demo/seed", async (c) => {
  const ctx: Ctx = c.get("ctx");
  const n = await seedDemo(ctx);
  await ctx.db.prepare("update settings set value = 'done', updated_at = ? where key = 'demo_seed'").bind(ctx.now.toISOString()).run();
  return c.json({ inserted: n });
});

admin.post("/demo/archive", async (c) => {
  const ctx = c.get("ctx");
  if (!canArchive(c.get("actor"))) throw forbidden();
  return c.json({ archived: await archiveDemo(ctx) });
});
