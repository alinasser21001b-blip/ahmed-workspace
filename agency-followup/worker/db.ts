import type { Actor, ClientRef, Member, ScopeLevel } from "./policy";
import type { WorkHours } from "./lib/time";
import { DEFAULT_WORK_HOURS } from "./lib/time";
import type { Role } from "../shared/domain";

export type Rules = {
  ack: { normal: number[]; urgent: number[] };
  dueSoonMinutes: { normal: number; urgent: number };
  blockerFollowMinutes: { normal: number; urgent: number };
  reviewMinutes: { normal: number[]; urgent: number[] };
  urgentOutsideHours: boolean;
  demoReminders: boolean;
};

export const DEFAULT_RULES: Rules = {
  ack: { normal: [60, 120, 240, 480], urgent: [15, 30, 60, 120] },
  dueSoonMinutes: { normal: 60, urgent: 30 },
  blockerFollowMinutes: { normal: 120, urgent: 60 },
  reviewMinutes: { normal: [120, 240], urgent: [30, 60] },
  urgentOutsideHours: false,
  demoReminders: false,
};

export type TaskRow = {
  id: string;
  client_id: string;
  parent_id: string | null;
  template: string | null;
  title: string;
  description: string;
  acceptance: string;
  requester_id: string;
  assignee_id: string;
  reviewer_id: string;
  priority: "normal" | "high" | "urgent";
  status: string;
  due_at: string | null;
  client_due_at: string | null;
  original_due_at: string | null;
  ref_url: string | null;
  requires_publish: number;
  publish_url: string | null;
  next_step: string;
  is_demo: number;
  archived_at: string | null;
  cycle: number;
  cycle_started_at: string;
  ack_epoch: number;
  ack_clock_from: string;
  due_version: number;
  review_round: number;
  version: number;
  created_at: string;
  updated_at: string;
  acknowledged_at: string | null;
  started_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  reviewer_since: string | null;
};

export type BlockerRow = {
  id: string;
  task_id: string;
  kind: "internal" | "client_wait" | "clarification";
  reason: string;
  resolver_id: string;
  opened_by: string;
  opened_at: string;
  expected_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  resolver_since: string | null;
};

type MemberRow = { user_id: string; username: string; display_name: string; role: Role; rank: number; active: number; must_change_password: number; title: string };

export async function loadMembers(db: D1Database): Promise<(Member & { title: string; must_change_password: boolean })[]> {
  const { results } = await db.prepare("select user_id, username, display_name, role, rank, active, must_change_password, title from members order by rank desc").all<MemberRow>();
  return results.map((r) => ({
    id: r.user_id,
    username: r.username,
    name: r.display_name,
    role: r.role,
    rank: r.rank,
    active: r.active === 1,
    title: r.title,
    must_change_password: r.must_change_password === 1,
  }));
}

export async function loadScopes(db: D1Database): Promise<Map<string, Record<string, ScopeLevel>>> {
  const { results } = await db.prepare("select client_id, user_id, level from client_scopes").all<{ client_id: string; user_id: string; level: ScopeLevel }>();
  const map = new Map<string, Record<string, ScopeLevel>>();
  for (const r of results) {
    const s = map.get(r.user_id) ?? {};
    s[r.client_id] = r.level;
    map.set(r.user_id, s);
  }
  return map;
}

export async function loadClients(db: D1Database): Promise<(ClientRef & { name: string })[]> {
  const { results } = await db.prepare("select id, name, account_manager_id, supervisor_id from clients order by name").all<ClientRef & { name: string }>();
  return results;
}

export type Ctx = {
  db: D1Database;
  env: Env;
  now: Date;
  members: Awaited<ReturnType<typeof loadMembers>>;
  membersById: Map<string, Awaited<ReturnType<typeof loadMembers>>[number]>;
  scopes: Map<string, Record<string, ScopeLevel>>;
  clients: Awaited<ReturnType<typeof loadClients>>;
  clientsById: Map<string, Awaited<ReturnType<typeof loadClients>>[number]>;
  workHours: WorkHours;
  rules: Rules;
};

export async function loadCtx(env: Env, now = new Date()): Promise<Ctx> {
  const db = env.DB;
  const [members, scopes, clients, settings] = await Promise.all([loadMembers(db), loadScopes(db), loadClients(db), loadSettings(db)]);
  return {
    db,
    env,
    now,
    members,
    membersById: new Map(members.map((m) => [m.id, m])),
    scopes,
    clients,
    clientsById: new Map(clients.map((c) => [c.id, c])),
    workHours: settings.workHours,
    rules: settings.rules,
  };
}

export function actorFor(ctx: Ctx, userId: string): Actor | null {
  const m = ctx.membersById.get(userId);
  if (!m) return null;
  return { ...m, scopes: ctx.scopes.get(userId) ?? {} };
}

export async function loadSettings(db: D1Database): Promise<{ workHours: WorkHours; rules: Rules; raw: Record<string, string> }> {
  const { results } = await db.prepare("select key, value from settings").all<{ key: string; value: string }>();
  const raw: Record<string, string> = {};
  for (const r of results) raw[r.key] = r.value;
  let workHours = DEFAULT_WORK_HOURS;
  let rules = DEFAULT_RULES;
  try {
    if (raw.work_hours) workHours = { ...DEFAULT_WORK_HOURS, ...JSON.parse(raw.work_hours) };
  } catch {
    /* keep defaults */
  }
  try {
    if (raw.rules) rules = { ...DEFAULT_RULES, ...JSON.parse(raw.rules) };
  } catch {
    /* keep defaults */
  }
  return { workHours, rules, raw };
}

export async function getTask(db: D1Database, id: string): Promise<TaskRow | null> {
  return db.prepare("select * from tasks where id = ?").bind(id).first<TaskRow>();
}

export async function hasGrant(db: D1Database, taskId: string, userId: string): Promise<boolean> {
  const r = await db.prepare("select 1 as x from task_grants where task_id = ? and user_id = ?").bind(taskId, userId).first();
  return !!r;
}

export async function openBlockers(db: D1Database, taskIds: string[]): Promise<BlockerRow[]> {
  if (!taskIds.length) return [];
  const out: BlockerRow[] = [];
  for (let i = 0; i < taskIds.length; i += 80) {
    const chunk = taskIds.slice(i, i + 80);
    const { results } = await db
      .prepare(`select * from blockers where resolved_at is null and task_id in (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<BlockerRow>();
    out.push(...results);
  }
  return out;
}

/**
 * Open blockers plus those resolved during their task's current cycle, oldest
 * first: what lateness needs to give back the time spent waiting on others.
 */
export async function cycleBlockers(db: D1Database, taskIds: string[]): Promise<BlockerRow[]> {
  if (!taskIds.length) return [];
  const out: BlockerRow[] = [];
  for (let i = 0; i < taskIds.length; i += 80) {
    const chunk = taskIds.slice(i, i + 80);
    const { results } = await db
      .prepare(
        `select b.* from blockers b join tasks t on t.id = b.task_id
         where b.task_id in (${chunk.map(() => "?").join(",")}) and (b.resolved_at is null or b.resolved_at > t.cycle_started_at)
         order by b.opened_at`,
      )
      .bind(...chunk)
      .all<BlockerRow>();
    out.push(...results);
  }
  return out;
}

export function logEventStmt(db: D1Database, taskId: string | null, actorId: string | null, type: string, data: unknown, now: Date): D1PreparedStatement {
  return db.prepare("insert into events (task_id, actor_id, type, data, created_at) values (?, ?, ?, ?, ?)").bind(taskId, actorId, type, JSON.stringify(data ?? {}), now.toISOString());
}

/**
 * Atomic optimistic locking inside a D1 batch: put guardStmt first and
 * unguardStmt last. If the condition is false the guard insert violates a
 * CHECK constraint and D1 rolls the whole batch back.
 */
export function guardStmt(db: D1Database, opId: string, conditionSql: string, params: unknown[]): D1PreparedStatement {
  return db.prepare(`insert into op_guard (id, ok) values (?, (${conditionSql}))`).bind(opId, ...params);
}
export function unguardStmt(db: D1Database, opId: string): D1PreparedStatement {
  return db.prepare("delete from op_guard where id = ?").bind(opId);
}
export function isGuardFailure(e: unknown): boolean {
  return String((e as Error)?.message ?? e).includes("op_guard_conflict");
}
export function isUniqueFailure(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e));
}

export async function taskGrants(db: D1Database, taskId: string): Promise<Set<string>> {
  const { results } = await db.prepare("select user_id from task_grants where task_id = ?").bind(taskId).all<{ user_id: string }>();
  return new Set(results.map((r) => r.user_id));
}
