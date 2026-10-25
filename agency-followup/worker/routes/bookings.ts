import { Hono } from "hono";
import { z } from "zod";
import { guardStmt, isGuardFailure, isUniqueFailure, logEventStmt, unguardStmt, type Ctx } from "../db";
import { ApiError, badRequest, body, forbidden, id, instant, notFound, text, type AppEnv } from "../http";
import { randomId } from "../lib/crypto";
import { businessMinutesBetween, isBusinessTime, nextBusinessStart } from "../lib/time";
import { notifyMany } from "../notify";
import { canCreateBooking, canManageBooking, canOpenTask, canSeeBookingDetails, type Actor } from "../policy";
import { loadVisibleTask } from "./tasks";

export const bookings = new Hono<AppEnv>();

export type BookingRow = {
  id: string;
  client_id: string;
  task_id: string | null;
  resource_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: "active" | "cancelled";
  created_by: string;
  created_at: string;
  cancel_reason: string | null;
};

/** Full details for those allowed; everyone else gets only that the slot is busy. */
export function shapeBookings(ctx: Ctx, actor: Actor, rows: BookingRow[]) {
  return rows.map((b) => {
    if (!canSeeBookingDetails(actor, b)) {
      return { id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, resource_id: b.resource_id, busy_only: true as const, title: "مشغول" };
    }
    return {
      id: b.id,
      starts_at: b.starts_at,
      ends_at: b.ends_at,
      resource_id: b.resource_id,
      resource: ctx.membersById.get(b.resource_id)?.name ?? "",
      busy_only: false as const,
      title: b.title,
      client: { id: b.client_id, name: ctx.clientsById.get(b.client_id)?.name ?? "" },
      task_id: b.task_id,
      created_by: ctx.membersById.get(b.created_by)?.name ?? "",
      can_manage: canManageBooking(actor, b),
    };
  });
}

/** shapeBookings plus task links only where the viewer may open the task. Use this for every list a member receives. */
export async function shapeBookingsForViewer(ctx: Ctx, actor: Actor, rows: BookingRow[]) {
  const shaped = shapeBookings(ctx, actor, rows);
  const taskIds = JSON.stringify([...new Set(rows.map((b) => b.task_id).filter(Boolean))]);
  if (taskIds === "[]") return shaped.map((b) => (b.busy_only ? b : { ...b, task_id: null }));
  const [linked, granted] = await Promise.all([
    ctx.db
      .prepare("select id, client_id, requester_id, assignee_id, reviewer_id, status, archived_at from tasks where id in (select value from json_each(?))")
      .bind(taskIds)
      .all<{ id: string; client_id: string; requester_id: string; assignee_id: string; reviewer_id: string; status: string; archived_at: string | null }>(),
    ctx.db.prepare("select task_id from task_grants where user_id = ? and task_id in (select value from json_each(?))").bind(actor.id, taskIds).all<{ task_id: string }>(),
  ]);
  const grantedIds = new Set(granted.results.map((g) => g.task_id));
  // Same rule as opening the task: archived tasks are the owner's only.
  const visible = new Set(linked.results.filter((t) => canOpenTask(actor, t, grantedIds.has(t.id))).map((t) => t.id));
  return shaped.map((b) => (b.busy_only ? b : { ...b, task_id: b.task_id && visible.has(b.task_id) ? b.task_id : null }));
}

const overlapSql = "select count(*) = 0 from bookings where resource_id = ? and status = 'active' and starts_at < ? and ends_at > ? and id != ?";

async function conflictsAndSuggestion(ctx: Ctx, actor: Actor, resourceId: string, startsAt: string, endsAt: string, excludeId = "") {
  const { results } = await ctx.db
    .prepare("select * from bookings where resource_id = ? and status = 'active' and starts_at < ? and ends_at > ? and id != ? order by starts_at")
    .bind(resourceId, endsAt, startsAt, excludeId)
    .all<BookingRow>();
  return { conflicts: await shapeBookingsForViewer(ctx, actor, results), suggestion: await suggestSlot(ctx, resourceId, new Date(startsAt), new Date(endsAt).getTime() - new Date(startsAt).getTime(), excludeId) };
}

/** First free slot of the same length, inside one working window, from the requested start onwards. */
export async function suggestSlot(ctx: Ctx, resourceId: string, from: Date, durationMs: number, excludeId = ""): Promise<{ starts_at: string; ends_at: string } | null> {
  const horizon = new Date(from.getTime() + 14 * 86_400_000);
  const { results } = await ctx.db
    .prepare("select starts_at, ends_at from bookings where resource_id = ? and status = 'active' and ends_at > ? and starts_at < ? and id != ? order by starts_at")
    .bind(resourceId, from.toISOString(), horizon.toISOString(), excludeId)
    .all<{ starts_at: string; ends_at: string }>();
  const quarter = 15 * 60_000;
  let cursor = from < ctx.now ? new Date(Math.ceil(ctx.now.getTime() / quarter) * quarter) : from;
  const minutes = Math.floor(durationMs / 60_000);
  for (let i = 0; i < 300 && cursor < horizon; i++) {
    cursor = nextBusinessStart(cursor, ctx.workHours);
    const end = new Date(cursor.getTime() + durationMs);
    if (businessMinutesBetween(cursor, end, ctx.workHours) < minutes) {
      const next = nextBusinessStart(end, ctx.workHours);
      cursor = next > cursor ? next : new Date(end.getTime() + 60_000);
      continue;
    }
    const s = cursor.toISOString();
    const e = end.toISOString();
    const clash = results.find((b) => b.starts_at < e && b.ends_at > s);
    if (!clash) return { starts_at: s, ends_at: e };
    cursor = new Date(clash.ends_at);
  }
  return null;
}

function photographer(ctx: Ctx) {
  return ctx.members.find((m) => m.role === "photographer" && m.active);
}

function validateSlot(startsAt: string, endsAt: string) {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (!(e > s)) throw badRequest("وقت النهاية يجب أن يكون بعد البداية", { field: "ends_at" });
  if (e - s > 12 * 3_600_000) throw badRequest("مدة الحجز أطول من 12 ساعة");
  if (e - s < 15 * 60_000) throw badRequest("أقل مدة للحجز 15 دقيقة");
}

bookings.get("/", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const fromIso = from && !Number.isNaN(Date.parse(from)) ? new Date(from).toISOString() : new Date(ctx.now.getTime() - 86_400_000).toISOString();
  const toIso = to && !Number.isNaN(Date.parse(to)) ? new Date(to).toISOString() : new Date(ctx.now.getTime() + 14 * 86_400_000).toISOString();
  const { results } = await ctx.db
    .prepare("select * from bookings where status = 'active' and ends_at > ? and starts_at < ? order by starts_at limit 500")
    .bind(fromIso, toIso)
    .all<BookingRow>();
  // The photographer's calendar holds every booking of his time; a task link
  // is kept only when the viewer may open that task.
  const shaped = await shapeBookingsForViewer(ctx, actor, results);
  const p = photographer(ctx);
  return c.json({
    bookings: shaped,
    resource: p ? { id: p.id, name: p.name } : null,
    can_create: ctx.clients.some((cl) => canCreateBooking(actor, cl.id)),
  });
});

const createSchema = z.object({
  client_id: id,
  task_id: id.nullish(),
  title: text(140, 2, "اكتب عنواناً للحجز"),
  starts_at: instant,
  ends_at: instant,
  create_key: z.string().min(4).max(80),
});

bookings.post("/", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const input = await body(c, createSchema);
  if (!ctx.clientsById.has(input.client_id) || !canCreateBooking(actor, input.client_id)) throw forbidden("لا تملك صلاحية الحجز لهذا العميل");
  validateSlot(input.starts_at, input.ends_at);
  if (Date.parse(input.starts_at) < ctx.now.getTime() - 10 * 60_000) throw badRequest("لا يمكن الحجز في وقت مضى");
  const resource = photographer(ctx);
  if (!resource) throw badRequest("لا يوجد مصور مفعّل");
  if (input.task_id) {
    const { t } = await loadVisibleTask(ctx, actor, input.task_id);
    if (t.client_id !== input.client_id) throw badRequest("المهمة تتبع عميلاً آخر");
  }
  const dup = await ctx.db.prepare("select id from bookings where created_by = ? and create_key = ?").bind(actor.id, input.create_key).first<{ id: string }>();
  if (dup) return c.json({ id: dup.id, duplicate: true });

  const bid = randomId("bk_");
  const opId = randomId("op_");
  const nowIso = ctx.now.toISOString();
  const stmts = [
    // The free-slot check and the insert run in one batch, so two people
    // booking the same time cannot both succeed.
    guardStmt(ctx.db, opId, overlapSql, [resource.id, input.ends_at, input.starts_at, ""]),
    ctx.db
      .prepare("insert into bookings (id, client_id, task_id, resource_id, title, starts_at, ends_at, status, created_by, create_key, created_at) values (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)")
      .bind(bid, input.client_id, input.task_id ?? null, resource.id, input.title, input.starts_at, input.ends_at, actor.id, input.create_key, nowIso),
    logEventStmt(ctx.db, input.task_id ?? null, actor.id, "booking_created", { booking: bid, starts_at: input.starts_at, ends_at: input.ends_at, client: input.client_id }, ctx.now),
    ...notifyMany(ctx, [resource.id], actor.id, () => ({
      task: null,
      kind: "booking_created",
      title: `حجز تصوير: ${input.title}`,
      body: `${ctx.clientsById.get(input.client_id)?.name ?? ""} · ${actor.name}`,
      url: "/calendar",
      refId: bid,
      dedupeKey: `booking_created:${bid}`,
    })),
    unguardStmt(ctx.db, opId),
  ];
  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    // A repeat of the same request (a double tap) that lands just after the
    // first one took the slot fails the slot check, not the key: it gets the
    // same booking back, never a conflict with itself.
    if (isGuardFailure(e) || isUniqueFailure(e)) {
      const again = await ctx.db.prepare("select id from bookings where created_by = ? and create_key = ?").bind(actor.id, input.create_key).first<{ id: string }>();
      if (again) return c.json({ id: again.id, duplicate: true });
    }
    if (isGuardFailure(e)) {
      const info = await conflictsAndSuggestion(ctx, actor, resource.id, input.starts_at, input.ends_at);
      await ctx.db.batch([logEventStmt(ctx.db, input.task_id ?? null, actor.id, "booking_conflict", { starts_at: input.starts_at, ends_at: input.ends_at, client: input.client_id, suggestion: info.suggestion }, ctx.now)]);
      throw new ApiError(409, "booking_conflict", "الوقت محجوز لحسين. اختر الوقت المقترح أو وقتاً آخر.", info);
    }
    throw e;
  }
  return c.json({ id: bid }, 201);
});

bookings.get("/check", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const s = c.req.query("starts_at");
  const e = c.req.query("ends_at");
  if (!s || !e || Number.isNaN(Date.parse(s)) || Number.isNaN(Date.parse(e))) throw badRequest("حدد وقت البداية والنهاية");
  const startsAt = new Date(s).toISOString();
  const endsAt = new Date(e).toISOString();
  validateSlot(startsAt, endsAt);
  const resource = photographer(ctx);
  if (!resource) throw badRequest("لا يوجد مصور مفعّل");
  const info = await conflictsAndSuggestion(ctx, actor, resource.id, startsAt, endsAt, c.req.query("exclude") ?? "");
  return c.json({ free: info.conflicts.length === 0, ...info, within_hours: isBusinessTime(new Date(startsAt), ctx.workHours) });
});

async function loadBooking(ctx: Ctx, actor: Actor, bookingId: string): Promise<BookingRow> {
  const b = await ctx.db.prepare("select * from bookings where id = ? and status = 'active'").bind(bookingId).first<BookingRow>();
  if (!b || !canManageBooking(actor, b)) throw notFound();
  return b;
}

const moveSchema = z.object({ starts_at: instant, ends_at: instant, reason: text(500, 3, "اكتب سبب تغيير الموعد") });

bookings.patch("/:id", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const b = await loadBooking(ctx, actor, c.req.param("id"));
  const input = await body(c, moveSchema);
  validateSlot(input.starts_at, input.ends_at);
  if (input.starts_at !== b.starts_at && Date.parse(input.starts_at) < ctx.now.getTime() - 10 * 60_000) throw badRequest("لا يمكن نقل الحجز إلى وقت مضى");
  if (Date.parse(input.ends_at) <= ctx.now.getTime()) throw badRequest("نهاية الحجز في وقت مضى");
  const opId = randomId("op_");
  const stmts = [
    guardStmt(ctx.db, opId, `select (select count(*) from bookings where id = ? and status = 'active') = 1 and (${overlapSql})`, [b.id, b.resource_id, input.ends_at, input.starts_at, b.id]),
    ctx.db.prepare("update bookings set starts_at = ?, ends_at = ? where id = ? and status = 'active'").bind(input.starts_at, input.ends_at, b.id),
    logEventStmt(ctx.db, b.task_id, actor.id, "booking_rescheduled", { booking: b.id, from: [b.starts_at, b.ends_at], to: [input.starts_at, input.ends_at], reason: input.reason }, ctx.now),
    ...notifyMany(ctx, [b.resource_id, b.created_by], actor.id, (u) => ({
      task: null,
      kind: "booking_changed",
      title: `تغيّر موعد حجز: ${b.title}`,
      body: `السبب: ${input.reason}`,
      url: "/calendar",
      refId: b.id,
      dedupeKey: `booking_changed:${b.id}:${opId}:${u}`,
    })),
    unguardStmt(ctx.db, opId),
  ];
  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    if (isGuardFailure(e)) {
      const still = await ctx.db.prepare("select 1 as x from bookings where id = ? and status = 'active'").bind(b.id).first();
      if (!still) throw new ApiError(409, "booking_gone", "أُلغي هذا الحجز أو تغيّر للتو. حدّث الصفحة.");
      const info = await conflictsAndSuggestion(ctx, actor, b.resource_id, input.starts_at, input.ends_at, b.id);
      throw new ApiError(409, "booking_conflict", "الوقت الجديد يتعارض مع حجز آخر.", info);
    }
    throw e;
  }
  return c.json({ ok: true });
});

bookings.post("/:id/cancel", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const b = await loadBooking(ctx, actor, c.req.param("id"));
  const input = await body(c, z.object({ reason: text(500, 3, "اكتب سبب الإلغاء") }));
  const opId = randomId("op_");
  const stmts = [
    guardStmt(ctx.db, opId, "select count(*) from bookings where id = ? and status = 'active'", [b.id]),
    ctx.db.prepare("update bookings set status = 'cancelled', cancelled_at = ?, cancel_reason = ? where id = ? and status = 'active'").bind(ctx.now.toISOString(), input.reason, b.id),
    logEventStmt(ctx.db, b.task_id, actor.id, "booking_cancelled", { booking: b.id, reason: input.reason }, ctx.now),
    ...notifyMany(ctx, [b.resource_id, b.created_by], actor.id, (u) => ({
      task: null,
      kind: "booking_cancelled",
      title: `أُلغي حجز: ${b.title}`,
      body: `السبب: ${input.reason}`,
      url: "/calendar",
      refId: b.id,
      dedupeKey: `booking_cancelled:${b.id}:${u}`,
    })),
    unguardStmt(ctx.db, opId),
  ];
  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    if (isGuardFailure(e)) throw new ApiError(409, "booking_gone", "أُلغي هذا الحجز أو تغيّر للتو. حدّث الصفحة.");
    throw e;
  }
  return c.json({ ok: true });
});
