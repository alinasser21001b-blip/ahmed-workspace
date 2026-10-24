// What a member gets back about tasks. Rows come only from queries that
// already apply taskVisibilitySql, so shaping never has to hide anything.

import { WORKING_STATUSES, type TaskStatus } from "../shared/domain";
import type { BlockerRow, Ctx, TaskRow } from "./db";
import { openBlockers } from "./db";
import { businessMinutesBetween } from "./lib/time";
import { taskVisibilitySql, type Actor } from "./policy";

export type TaskFlags = {
  waiting_ack: boolean;
  overdue: boolean;
  at_risk: boolean;
  blocked: boolean;
  blocked_kind: BlockerRow["kind"] | null;
  /** Late while waiting on the client: not counted against the assignee. */
  external_wait: boolean;
  late_business_minutes: number;
  unacked_business_minutes: number;
};

export function flagsFor(ctx: Ctx, t: TaskRow, blockers: BlockerRow[]): TaskFlags {
  const now = ctx.now;
  const working = WORKING_STATUSES.includes(t.status as TaskStatus) && !t.archived_at;
  const open = blockers.filter((b) => b.task_id === t.id && !b.resolved_at);
  const due = t.due_at ? new Date(t.due_at) : null;
  const overdue = working && !!due && due < now;
  const hoursLeft = due ? (due.getTime() - now.getTime()) / 3_600_000 : Infinity;
  const atRisk = working && !overdue && !!due && (hoursLeft <= 2 || (hoursLeft <= 24 && (t.status === "new" || t.status === "acknowledged" || open.length > 0)));
  const external = open.some((b) => b.kind === "client_wait");
  return {
    waiting_ack: t.status === "new" && !t.archived_at,
    overdue,
    at_risk: atRisk,
    blocked: open.length > 0,
    blocked_kind: open[0]?.kind ?? null,
    external_wait: external,
    late_business_minutes: overdue && due ? businessMinutesBetween(due, now, ctx.workHours) : 0,
    unacked_business_minutes: t.status === "new" ? businessMinutesBetween(new Date(t.ack_clock_from), now, ctx.workHours) : 0,
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
    parent_id: t.parent_id,
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
  const blockers = await openBlockers(
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
