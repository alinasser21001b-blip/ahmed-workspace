// What a member gets back about tasks. Rows come only from queries that
// already apply taskVisibilitySql, so shaping never has to hide anything.

import { WORKING_STATUSES, type Role, type TaskStatus } from "../shared/domain";
import type { BlockerRow, Ctx, TaskRow } from "./db";
import { cycleBlockers } from "./db";
import { addBusinessMinutes, businessMinutesBetween, isBusinessTime } from "./lib/time";
import { taskVisibilitySql, type Actor } from "./policy";

export type TaskFlags = {
  waiting_ack: boolean;
  /** Past the due date. A task can be blocked and late at once; the mark stays until the task is handled. */
  overdue: boolean;
  /** Past the deadline on the assignee's own time: working time spent waiting on others is given back. */
  overdue_own: boolean;
  /** Working minutes this cycle during which the assignee waited on others (overlapping waits count once). */
  waited_business_minutes: number;
  at_risk: boolean;
  blocked: boolean;
  blocked_kind: BlockerRow["kind"] | null;
  /** Who must clear the first open blocker. */
  blocker_resolver: { id: string; name: string } | null;
  /** Waiting on the client, held by someone else: not counted against the assignee. */
  external_wait: boolean;
  /** The assignee's own late working minutes (waiting on others taken off). */
  late_business_minutes: number;
  unacked_business_minutes: number;
};

/**
 * Whether a blocker leaves the assignee waiting on someone else. An assignee
 * who holds his own blocker (an account manager chasing her own client) keeps
 * being chased; the owner has nobody above him, so his waits always count.
 */
export function waitsOnOthers(t: Pick<TaskRow, "assignee_id">, b: Pick<BlockerRow, "resolver_id">, assigneeRole: Role | null | undefined): boolean {
  return b.resolver_id !== t.assignee_id || assigneeRole === "owner";
}

/**
 * The deadline on the assignee's own time. The working minutes of this cycle
 * during which he waited on others are given back, so resolving a blocker
 * resumes the measurement without counting the wait against him (§6, §14.13).
 * Only waits since the current due date was set count: a date agreed after a
 * wait already allows for it.
 * Reminders, escalations and the «متأخرة» mark use this; `overdue` stays the
 * plain fact that the due date has passed.
 */
export function ownDeadline(ctx: Ctx, t: TaskRow, blockers: BlockerRow[], assigneeRole: Role | null | undefined): { waited: number; due: Date | null; overdueOwn: boolean } {
  const now = ctx.now.getTime();
  const from = Math.max(Date.parse(t.cycle_started_at), t.wait_clock_from ? Date.parse(t.wait_clock_from) : 0);
  const spans = blockers
    .filter((b) => b.task_id === t.id && waitsOnOthers(t, b, assigneeRole))
    .map((b): [number, number] => [Math.max(Date.parse(b.opened_at), from), Math.min(b.resolved_at ? Date.parse(b.resolved_at) : now, now)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  // Merge overlapping waits, then count each stretch once in working minutes.
  let waited = 0;
  let [s0, e0] = [0, 0];
  for (const [s, e] of spans) {
    if (s > e0) {
      waited += businessMinutesBetween(new Date(s0), new Date(e0), ctx.workHours);
      [s0, e0] = [s, e];
    } else e0 = Math.max(e0, e);
  }
  waited += businessMinutesBetween(new Date(s0), new Date(e0), ctx.workHours);
  const due = t.due_at ? new Date(t.due_at) : null;
  // Urgent work chased outside hours with a deadline outside them gets the
  // wait back on the clock; otherwise a short wait would move it to the
  // next working morning.
  const nightUrgent = t.priority === "urgent" && ctx.rules.urgentOutsideHours && !!due && !isBusinessTime(due, ctx.workHours);
  const ownDue = due && waited ? (nightUrgent ? new Date(due.getTime() + waited * 60_000) : addBusinessMinutes(due, waited, ctx.workHours)) : due;
  const working = WORKING_STATUSES.includes(t.status as TaskStatus) && !t.archived_at;
  return { waited, due: ownDue, overdueOwn: working && !!ownDue && ownDue < ctx.now };
}

export function flagsFor(ctx: Ctx, t: TaskRow, blockers: BlockerRow[]): TaskFlags {
  const now = ctx.now;
  const working = WORKING_STATUSES.includes(t.status as TaskStatus) && !t.archived_at;
  const open = blockers.filter((b) => b.task_id === t.id && !b.resolved_at);
  const role = ctx.membersById.get(t.assignee_id)?.role;
  const own = t.due_at ? ownDeadline(ctx, t, blockers, role) : { waited: 0, due: null, overdueOwn: false };
  const due = t.due_at ? new Date(t.due_at) : null;
  const overdue = working && !!due && due < now;
  const hoursLeft = due ? (due.getTime() - now.getTime()) / 3_600_000 : Infinity;
  const atRisk = working && !overdue && !!due && (hoursLeft <= 2 || (hoursLeft <= 24 && (t.status === "new" || t.status === "acknowledged" || open.length > 0)));
  const external = open.some((b) => b.kind === "client_wait" && waitsOnOthers(t, b, role));
  const first = open[0];
  return {
    waiting_ack: t.status === "new" && !t.archived_at,
    overdue,
    overdue_own: own.overdueOwn,
    waited_business_minutes: own.waited,
    at_risk: atRisk,
    blocked: open.length > 0,
    blocked_kind: first?.kind ?? null,
    blocker_resolver: first ? { id: first.resolver_id, name: ctx.membersById.get(first.resolver_id)?.name ?? "—" } : null,
    external_wait: external,
    late_business_minutes: overdue && due ? Math.max(0, businessMinutesBetween(due, now, ctx.workHours) - own.waited) : 0,
    // An open clarification request pauses this clock, as in the scheduler.
    unacked_business_minutes: t.status === "new" && !open.some((b) => b.kind === "clarification") ? businessMinutesBetween(new Date(t.ack_clock_from), now, ctx.workHours) : 0,
  };
}

const person = (ctx: Ctx, id: string | null) => {
  if (!id) return null;
  const m = ctx.membersById.get(id);
  return m ? { id: m.id, name: m.name, role: m.role } : { id, name: "—", role: null };
};

export function taskSummary(ctx: Ctx, t: TaskRow, blockers: BlockerRow[]) {
  const client = ctx.clientsById.get(t.client_id);
  return {
    id: t.id,
    title: t.title,
    client: { id: t.client_id, name: client?.name ?? "" },
    template: t.template,
    status: t.status,
    priority: t.priority,
    requester: person(ctx, t.requester_id),
    assignee: person(ctx, t.assignee_id),
    reviewer: person(ctx, t.reviewer_id),
    due_at: t.due_at,
    client_due_at: t.client_due_at,
    original_due_at: t.original_due_at,
    next_step: t.next_step,
    is_demo: t.is_demo === 1,
    archived_at: t.archived_at,
    version: t.version,
    created_at: t.created_at,
    updated_at: t.updated_at,
    acknowledged_at: t.acknowledged_at,
    submitted_at: t.submitted_at,
    completed_at: t.completed_at,
    flags: flagsFor(ctx, t, blockers),
  };
}
export type TaskSummary = ReturnType<typeof taskSummary>;

export type ListFilter = {
  clientId?: string;
  status?: "open" | "done" | "all" | TaskStatus;
  assigneeId?: string;
  q?: string;
  archived?: boolean;
  limit?: number;
};

/** Every task the actor may see that matches the filter, newest activity first. */
export async function listVisibleTasks(ctx: Ctx, actor: Actor, f: ListFilter = {}): Promise<{ rows: TaskRow[]; blockers: BlockerRow[] }> {
  const vis = taskVisibilitySql(actor, "t");
  const where = [vis.sql];
  const params: unknown[] = [...vis.params];
  where.push(f.archived ? "t.archived_at is not null" : "t.archived_at is null");
  if (f.clientId) {
    where.push("t.client_id = ?");
    params.push(f.clientId);
  }
  if (f.assigneeId) {
    where.push("t.assignee_id = ?");
    params.push(f.assigneeId);
  }
  if (f.status === "open" || !f.status) where.push("t.status in ('new', 'acknowledged', 'in_progress', 'in_review', 'changes_requested')");
  else if (f.status === "done") where.push("t.status in ('done', 'cancelled')");
  else if (f.status !== "all") {
    where.push("t.status = ?");
    params.push(f.status);
  }
  if (f.q) {
    where.push("(t.title like ? escape '\\' or t.description like ? escape '\\')");
    const like = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    params.push(like, like);
  }
  const limit = Math.min(f.limit ?? 300, 500);
  const { results } = await ctx.db
    .prepare(`select t.* from tasks t where ${where.join(" and ")} order by t.updated_at desc limit ${limit}`)
    .bind(...params)
    .all<TaskRow>();
  // This cycle's blockers, resolved ones too: lateness gives back the time spent waiting.
  const blockers = await cycleBlockers(
    ctx.db,
    results.map((r) => r.id),
  );
  return { rows: results, blockers };
}

/** Clients the actor works on (for filters and the new-task form). */
export function visibleClients(ctx: Ctx, actor: Actor) {
  if (actor.role === "owner") return ctx.clients.map((c) => ({ id: c.id, name: c.name, level: "owner" as const }));
  return ctx.clients.filter((c) => actor.scopes[c.id]).map((c) => ({ id: c.id, name: c.name, level: actor.scopes[c.id] }));
}
