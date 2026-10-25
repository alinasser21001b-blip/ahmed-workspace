// The role-specific Today screen. Every section is computed from tasks the
// member may already see, so a counter can never reveal a hidden task.

import { Hono } from "hono";
import type { AppEnv } from "../http";
import { taskSummary, listVisibleTasks, visibleClients, type TaskSummary } from "../views";
import { shapeBookingsForViewer, type BookingRow } from "./bookings";
import type { Actor } from "../policy";
import { localParts, zonedToUtc } from "../lib/time";
import type { Ctx } from "../db";

export const today = new Hono<AppEnv>();

type Section = { key: string; title: string; hint?: string; empty: string; tasks: TaskSummary[] };

const byDue = (a: TaskSummary, b: TaskSummary) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
const byAge = (a: TaskSummary, b: TaskSummary) => a.created_at.localeCompare(b.created_at);

today.get("/", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const clientFilter = c.req.query("client") || undefined;
  const { rows, blockers } = await listVisibleTasks(ctx, actor, { status: "open", clientId: clientFilter, limit: 500 });
  const all = rows.map((r) => taskSummary(ctx, r, blockers));
  const me = actor.id;

  const pendingProposals = await ctx.db
    .prepare(`select p.task_id from due_proposals p where p.status = 'pending' and p.task_id in (select value from json_each(?))`)
    .bind(JSON.stringify(rows.map((r) => r.id)))
    .all<{ task_id: string }>();
  const proposalTasks = new Set(pendingProposals.results.map((p) => p.task_id));
  // `blockers` also holds this cycle's resolved ones (for lateness); these sets want the open ones.
  const open = blockers.filter((b) => !b.resolved_at);
  const myBlockers = new Set(open.filter((b) => b.resolver_id === me).map((b) => b.task_id));
  const myOpenQuestions = new Set(open.filter((b) => b.opened_by === me && b.kind === "clarification").map((b) => b.task_id));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  // A due-date proposal waits on the requester (or on the reviewer when the requester assigned himself).
  const decidesProposal = (t: TaskSummary) => {
    const r = rowById.get(t.id)!;
    return r.requester_id === me || (r.requester_id === r.assignee_id && r.reviewer_id === me);
  };
  const awaitingMe = all.filter((t) => (t.status === "in_review" && t.reviewer?.id === me) || myBlockers.has(t.id) || (proposalTasks.has(t.id) && decidesProposal(t)));

  const sections: Section[] = [];
  const counts = {
    waiting_ack: all.filter((t) => t.flags.waiting_ack).length,
    overdue: all.filter((t) => t.flags.overdue).length,
    at_risk: all.filter((t) => t.flags.at_risk).length,
    blocked: all.filter((t) => t.flags.blocked).length,
    awaiting_me: awaitingMe.length,
  };

  if (actor.role === "owner") {
    sections.push(
      { key: "waiting_ack", title: "لم تُستلم بعد", empty: "كل المهام المسندة استُلمت.", tasks: all.filter((t) => t.flags.waiting_ack).sort(byAge) },
      { key: "overdue", title: "متأخرة", hint: "المهام التي تجاوزت موعدها بسبب انتظار العميل أو زميل آخر تظهر معلَّمة، ولا يُحتسب ذلك على المنفذ.", empty: "لا توجد مهام متأخرة.", tasks: all.filter((t) => t.flags.overdue).sort(byDue) },
      { key: "at_risk", title: "معرّضة للتأخر", empty: "لا توجد مهام قريبة من موعدها دون تقدم.", tasks: all.filter((t) => t.flags.at_risk).sort(byDue) },
      { key: "awaiting_me", title: "بانتظار قراري", empty: "لا شيء بانتظار قرارك.", tasks: awaitingMe.sort(byAge) },
      { key: "blocked", title: "متوقفة بعائق", empty: "لا توجد عوائق مفتوحة.", tasks: all.filter((t) => t.flags.blocked).sort(byAge) },
    );
  } else if (actor.role === "exec") {
    const followIds = ctx.members.filter((m) => m.role === "account_manager" || m.role === "photographer").map((m) => m.id);
    const follow = all.filter((t) => followIds.includes(t.assignee?.id ?? "") && (t.flags.waiting_ack || t.flags.overdue || t.flags.blocked || t.flags.at_risk)).sort(byDue);
    const followSet = new Set(follow.map((t) => t.id));
    sections.push(
      { key: "awaiting_me", title: "بانتظار قراري أو مراجعتي", empty: "لا شيء بانتظارك.", tasks: awaitingMe.sort(byAge) },
      { key: "mine", title: "مهامي", empty: "لا مهام مسندة إليك الآن.", tasks: all.filter((t) => t.assignee?.id === me && t.status !== "in_review").sort(byDue) },
      {
        key: "follow",
        title: "متابعة سما وحسين",
        hint: "غير مستلمة أو متأخرة أو متوقفة.",
        empty: "لا يوجد ما يحتاج متابعة.",
        tasks: follow,
      },
      // Cards already under «متابعة سما وحسين» are not repeated here.
      { key: "open", title: "كل المهام المفتوحة", empty: "لا مهام مفتوحة.", tasks: all.filter((t) => t.assignee?.id !== me && !followSet.has(t.id)).sort(byDue) },
    );
  } else if (actor.role === "account_manager") {
    const photographerIds = ctx.members.filter((m) => m.role === "photographer").map((m) => m.id);
    sections.push(
      { key: "mine", title: "مهامي", empty: "لا مهام مسندة إليك الآن.", tasks: all.filter((t) => t.assignee?.id === me && t.status !== "in_review").sort(byDue) },
      { key: "from_photographer", title: "بانتظاري من حسين", empty: "لا شيء معلق عند حسين.", tasks: all.filter((t) => photographerIds.includes(t.assignee?.id ?? "")).sort(byDue) },
      { key: "awaiting_me", title: "مراجعاتي وقراراتي", empty: "لا شيء بانتظار مراجعتك.", tasks: awaitingMe.sort(byAge) },
      { key: "submitted", title: "ما سلّمته", empty: "لا شيء بانتظار المراجعة.", tasks: all.filter((t) => t.assignee?.id === me && t.status === "in_review") },
    );
  } else {
    const todayEnd = endOfLocalDay(ctx);
    sections.push(
      { key: "waiting_ack", title: "بحاجة لاستلامي", empty: "لا مهام جديدة بانتظار استلامك.", tasks: all.filter((t) => t.assignee?.id === me && t.status === "new").sort(byAge) },
      {
        key: "today",
        title: "عمل اليوم",
        empty: "لا عمل مستحق اليوم.",
        tasks: all.filter((t) => t.assignee?.id === me && ["acknowledged", "in_progress", "changes_requested"].includes(t.status) && (!t.due_at || t.due_at <= todayEnd)).sort(byDue),
      },
      { key: "questions", title: "توضيحات أنتظرها", empty: "لا أسئلة معلقة.", tasks: all.filter((t) => myOpenQuestions.has(t.id)) },
      { key: "later", title: "مهام قادمة", empty: "لا مهام قادمة.", tasks: all.filter((t) => t.assignee?.id === me && ["acknowledged", "in_progress", "changes_requested"].includes(t.status) && !!t.due_at && t.due_at > todayEnd).sort(byDue) },
      { key: "submitted", title: "ما سلّمته", empty: "لا شيء بانتظار المراجعة.", tasks: all.filter((t) => t.assignee?.id === me && t.status === "in_review") },
    );
  }

  const bookingsRows = await ctx.db
    .prepare("select * from bookings where status = 'active' and ends_at > ? and starts_at < ? order by starts_at limit 100")
    .bind(ctx.now.toISOString(), new Date(ctx.now.getTime() + 7 * 86_400_000).toISOString())
    .all<BookingRow>();
  const bookings = await shapeBookingsForViewer(ctx, actor, bookingsRows.results);
  const conflicts = actor.role === "owner" || actor.role === "exec" ? await photographerConflicts(ctx, actor, bookingsRows.results, rows) : [];

  return c.json({
    role: actor.role,
    clients: visibleClients(ctx, actor),
    client: clientFilter ?? null,
    counts,
    sections,
    bookings: actor.role === "photographer" ? bookings : bookings.slice(0, 20),
    conflicts,
    work_hours: ctx.workHours,
    now: ctx.now.toISOString(),
  });
});

function endOfLocalDay(ctx: Ctx): string {
  const p = localParts(ctx.now, ctx.workHours.tz);
  return zonedToUtc(p.y, p.m, p.d, 23, 59, ctx.workHours.tz).toISOString();
}

/**
 * Where the photographer's time does not add up: recent booking attempts the
 * server refused because the slot was taken, and his open tasks that fall due
 * inside a booking for other work.
 */
async function photographerConflicts(ctx: Ctx, actor: Actor, bookings: BookingRow[], taskRows: { id: string; title: string; assignee_id: string; due_at: string | null; client_id: string }[]) {
  const out: { kind: "refused_booking" | "due_during_booking"; at: string; text: string; task_id?: string | null }[] = [];
  const since = new Date(ctx.now.getTime() - 3 * 86_400_000).toISOString();
  const { results } = await ctx.db
    .prepare("select actor_id, task_id, data, created_at from events where type = 'booking_conflict' and created_at > ? order by id desc limit 20")
    .bind(since)
    .all<{ actor_id: string; task_id: string | null; data: string; created_at: string }>();
  for (const e of results) {
    let d: { starts_at?: string; client?: string } = {};
    try {
      d = JSON.parse(e.data);
    } catch {
      /* ignore */
    }
    if (actor.role !== "owner" && d.client && !actor.scopes[d.client]) continue;
    // Link only tasks on this member's open list (archived or hidden ones stay unlinked).
    const linkable = e.task_id && taskRows.some((t) => t.id === e.task_id) ? e.task_id : null;
    out.push({ kind: "refused_booking", at: d.starts_at ?? e.created_at, text: `${ctx.membersById.get(e.actor_id)?.name ?? ""} طلب وقتاً محجوزاً مسبقاً (${ctx.clientsById.get(d.client ?? "")?.name ?? ""})`, task_id: linkable });
  }
  const photographers = new Set(ctx.members.filter((m) => m.role === "photographer").map((m) => m.id));
  for (const t of taskRows) {
    if (!photographers.has(t.assignee_id) || !t.due_at) continue;
    const clash = bookings.find((b) => b.task_id !== t.id && b.starts_at <= t.due_at! && b.ends_at > t.due_at!);
    if (clash) out.push({ kind: "due_during_booking", at: t.due_at, text: `«${t.title}» مستحقة أثناء حجز آخر لحسين`, task_id: t.id });
  }
  return out;
}
