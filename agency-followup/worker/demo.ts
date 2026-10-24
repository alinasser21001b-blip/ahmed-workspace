// Example tasks for the team trial. Every one is marked «تجريبي», carries
// no real links, no patient data and no approval attributed to a person, and
// sends no reminders unless Mohammed turns demo reminders on. Fixed ids make
// the seed idempotent; Mohammed can archive the whole set from the admin page.

import type { Ctx } from "./db";
import { localParts, nextBusinessStart, zonedToUtc } from "./lib/time";

type Demo = {
  id: string;
  client: "c_obesity" | "c_ward";
  parent?: string;
  template?: string;
  title: string;
  description: string;
  requester: string;
  assignee: string;
  reviewer: string;
  priority: "normal" | "high" | "urgent";
  status: string;
  due: string | null; // "D+0 15:00" style, relative to the trial day
  requires_publish?: boolean;
};

const DEMOS: Demo[] = [
  { id: "t_demo_01", client: "c_ward", template: "content_followup", title: "تجريبي: خطة محتوى أسبوع مستشفى ورد", description: "مثال: خطة منشورات الأسبوع القادم مع الجدول المقترح.", requester: "u_mohammed", assignee: "u_ammar", reviewer: "u_mohammed", priority: "normal", status: "in_progress", due: "D+2 14:00" },
  { id: "t_demo_02", client: "c_obesity", template: "content_followup", title: "تجريبي: متابعة حملة عيادة بغداد للسمنة", description: "مثال: مراجعة أداء منشورات الحملة واقتراح التعديلات.", requester: "u_mohammed", assignee: "u_sama", reviewer: "u_mohammed", priority: "high", status: "new", due: "D+1 12:00" },
  { id: "t_demo_03", client: "c_obesity", template: "shoot_request", title: "تجريبي: تصوير لقطات استقبال العيادة", description: "مثال: لقطات عامة للاستقبال دون ظهور أي مراجع.", requester: "u_sama", assignee: "u_hussein", reviewer: "u_sama", priority: "high", status: "new", due: "D+0 16:00" },
  { id: "t_demo_04", client: "c_ward", template: "shoot_request", title: "تجريبي: تصوير جولة في مدخل مستشفى ورد", description: "مثال: لقطات للمدخل والممرات العامة فقط.", requester: "u_ammar", assignee: "u_hussein", reviewer: "u_ammar", priority: "normal", status: "acknowledged", due: "D+0 17:00" },
  { id: "t_demo_05", parent: "t_demo_04", client: "c_ward", title: "تجريبي: تجهيز قائمة اللقطات", description: "مهمة فرعية: قائمة مختصرة باللقطات المطلوبة.", requester: "u_ammar", assignee: "u_hussein", reviewer: "u_ammar", priority: "normal", status: "in_progress", due: "D+0 12:00" },
  { id: "t_demo_06", client: "c_obesity", template: "shoot_request", title: "تجريبي: تصوير منتج جديد بانتظار موافقة العيادة", description: "مثال لعائق خارجي: العيادة لم تؤكد الموعد بعد.", requester: "u_sama", assignee: "u_hussein", reviewer: "u_sama", priority: "normal", status: "acknowledged", due: "D-1 15:00" },
  { id: "t_demo_07", client: "c_ward", template: "footage_delivery", title: "تجريبي: تسليم صور فعالية المستشفى", description: "مثال لتسليم بانتظار المراجعة.", requester: "u_ammar", assignee: "u_hussein", reviewer: "u_ammar", priority: "normal", status: "in_review", due: "D+1 11:00" },
  { id: "t_demo_08", client: "c_obesity", template: "shoot_scheduling", title: "تجريبي: تنسيق موعد تصوير مع طبيب العيادة", description: "مثال لتعارض: الموعد المطلوب يقع أثناء حجز آخر لحسين.", requester: "u_sama", assignee: "u_hussein", reviewer: "u_sama", priority: "normal", status: "acknowledged", due: "D+0 14:00" },
  { id: "t_demo_09", client: "c_obesity", template: "content_followup", title: "تجريبي: تقرير أسبوعي لمنشورات العيادة", description: "مثال لعمل سما بانتظار مراجعة عمار.", requester: "u_ammar", assignee: "u_sama", reviewer: "u_ammar", priority: "normal", status: "in_review", due: "D+1 13:00" },
  { id: "t_demo_10", client: "c_ward", template: "content_followup", title: "تجريبي: مثال مهمة مكتملة", description: "مثال يوضّح شكل المهمة بعد الإكمال. لم يعتمدها أحد فعلياً.", requester: "u_mohammed", assignee: "u_ammar", reviewer: "u_mohammed", priority: "normal", status: "done", due: "D-1 12:00" },
];

export async function seedDemo(ctx: Ctx): Promise<number> {
  const tz = ctx.workHours.tz;
  const base = localParts(nextBusinessStart(ctx.now, ctx.workHours), tz);
  const at = (spec: string | null) => {
    if (!spec) return null;
    const m = /^D([+-]\d+) (\d\d):(\d\d)$/.exec(spec)!;
    const day = new Date(Date.UTC(base.y, base.m - 1, base.d + Number(m[1])));
    return zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Number(m[2]), Number(m[3]), tz).toISOString();
  };
  const nowIso = ctx.now.toISOString();
  const db = ctx.db;
  const stmts: D1PreparedStatement[] = [];
  for (const d of DEMOS) {
    const due = at(d.due);
    const acked = d.status !== "new" ? nowIso : null;
    stmts.push(
      db
        .prepare(
          `insert or ignore into tasks (id, client_id, parent_id, template, title, description, acceptance, requester_id, assignee_id, reviewer_id, priority, status,
             due_at, original_due_at, is_demo, cycle, cycle_started_at, ack_epoch, ack_clock_from, review_round, created_at, updated_at,
             acknowledged_at, started_at, submitted_at, completed_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          d.id,
          d.client,
          d.parent ?? null,
          d.template ?? null,
          d.title,
          d.description,
          "مثال تجريبي.",
          d.requester,
          d.assignee,
          d.reviewer,
          d.priority,
          d.status,
          due,
          due,
          nowIso,
          nowIso,
          d.status === "in_review" || d.status === "done" ? 1 : 0,
          nowIso,
          nowIso,
          acked,
          ["in_progress", "in_review", "done"].includes(d.status) ? nowIso : null,
          d.status === "in_review" || d.status === "done" ? nowIso : null,
          d.status === "done" ? nowIso : null,
        ),
    );
  }
  const res = await db.batch(stmts);
  const inserted = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  if (!inserted) return 0;

  const extra: D1PreparedStatement[] = [];
  for (const d of DEMOS) extra.push(db.prepare("insert into events (task_id, actor_id, type, data, created_at) select ?, null, 'demo_seeded', '{}', ? where not exists (select 1 from events where task_id = ? and type = 'demo_seeded')").bind(d.id, nowIso, d.id));
  extra.push(
    db.prepare("insert or ignore into deliverables (id, task_id, url, evidence, version_label, review_round, submitted_by, created_at) values ('d_demo_07', 't_demo_07', null, ?, 'نسخة 1', 1, 'u_hussein', ?)").bind("تجريبي: لا يوجد رابط حقيقي. في التجربة الفعلية ضع رابط المجلد هنا.", nowIso),
    db.prepare("insert or ignore into deliverables (id, task_id, url, evidence, version_label, review_round, submitted_by, created_at) values ('d_demo_09', 't_demo_09', null, ?, null, 1, 'u_sama', ?)").bind("تجريبي: ملخص مكتوب بدل رابط حقيقي.", nowIso),
    db.prepare("insert or ignore into deliverables (id, task_id, url, evidence, version_label, review_round, submitted_by, created_at) values ('d_demo_10', 't_demo_10', null, ?, null, 1, 'u_ammar', ?)").bind("تجريبي: مثال فقط.", nowIso),
    db
      .prepare("insert or ignore into blockers (id, task_id, kind, reason, resolver_id, opened_by, opened_at, expected_at) values ('b_demo_06', 't_demo_06', 'client_wait', ?, 'u_sama', 'u_hussein', ?, ?)")
      .bind("العيادة لم تؤكد موعد التصوير بعد (مثال تجريبي).", nowIso, at("D+1 10:00")),
  );
  // Two bookings on the trial day, each only if the slot is still free.
  const book = (bid: string, client: string, task: string, title: string, s: string, e: string, by: string) =>
    db
      .prepare(
        `insert or ignore into bookings (id, client_id, task_id, resource_id, title, starts_at, ends_at, status, created_by, created_at)
         select ?, ?, ?, 'u_hussein', ?, ?, ?, 'active', ?, ? where not exists (select 1 from bookings where resource_id = 'u_hussein' and status = 'active' and starts_at < ? and ends_at > ?)`,
      )
      .bind(bid, client, task, title, s, e, by, nowIso, e, s);
  const s1 = at("D+0 10:00")!;
  const e1 = at("D+0 11:30")!;
  const s2 = at("D+0 13:00")!;
  const e2 = at("D+0 15:00")!;
  extra.push(book("bk_demo_03", "c_obesity", "t_demo_03", "تجريبي: تصوير استقبال العيادة", s1, e1, "u_sama"));
  extra.push(book("bk_demo_04", "c_ward", "t_demo_04", "تجريبي: جولة مدخل مستشفى ورد", s2, e2, "u_ammar"));
  extra.push(
    db
      .prepare("insert into events (task_id, actor_id, type, data, created_at) select 't_demo_08', null, 'booking_conflict', ?, ? where not exists (select 1 from events where task_id = 't_demo_08' and type = 'booking_conflict')")
      .bind(JSON.stringify({ starts_at: at("D+0 14:00"), ends_at: at("D+0 15:00"), client: "c_obesity", suggestion: { starts_at: e2, ends_at: at("D+0 16:00") }, demo: true }), nowIso),
  );
  await db.batch(extra);
  return inserted;
}

export async function archiveDemo(ctx: Ctx): Promise<number> {
  const nowIso = ctx.now.toISOString();
  const r = await ctx.db.batch([
    ctx.db.prepare("update tasks set archived_at = ?, version = version + 1, updated_at = ? where is_demo = 1 and archived_at is null").bind(nowIso, nowIso),
    ctx.db.prepare("update bookings set status = 'cancelled', cancelled_at = ?, cancel_reason = 'أرشفة الأمثلة التجريبية' where id like 'bk_demo_%' and status = 'active'").bind(nowIso),
    ctx.db.prepare("update outbox set status = 'cancelled', last_error = 'demo_archived' where status = 'pending' and task_id in (select id from tasks where is_demo = 1)"),
    ctx.db.prepare("insert into events (task_id, actor_id, type, data, created_at) values (null, null, 'demo_archived', '{}', ?)").bind(nowIso),
  ]);
  return r[0].meta.changes ?? 0;
}
