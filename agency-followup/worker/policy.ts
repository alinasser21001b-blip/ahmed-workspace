// The one place that decides who may see or do what. Every route, query,
// counter, export, calendar view and notification goes through these
// functions; nothing trusts a role, user id or client id sent by the browser.

import type { Role } from "../shared/domain";

export type Member = { id: string; username: string; name: string; role: Role; rank: number; active: boolean };
export type ScopeLevel = "manage" | "oversee";
export type Actor = Member & { scopes: Record<string, ScopeLevel> };
export type ClientRef = { id: string; account_manager_id: string; supervisor_id: string | null };
export type TaskRef = {
  id: string;
  client_id: string;
  requester_id: string;
  assignee_id: string;
  reviewer_id: string;
  status: string;
};
export type BlockerRef = { resolver_id: string; opened_by: string };
export type BookingRef = { client_id: string; resource_id: string; created_by: string };

export type Decision = { ok: true; grant?: boolean } | { ok: false; reason: string };
const deny = (reason: string): Decision => ({ ok: false, reason });
const allow = (grant = false): Decision => ({ ok: true, grant });

export const isOwner = (a: Member) => a.role === "owner";

/** The actor's standing on a client: the owner stands over every client. */
export function clientAuthority(a: Actor, clientId: string): "owner" | ScopeLevel | null {
  if (isOwner(a)) return "owner";
  if (a.role === "photographer") return null;
  return a.scopes[clientId] ?? null;
}

export function isInvolved(a: Member, t: TaskRef): boolean {
  return t.assignee_id === a.id || t.reviewer_id === a.id || t.requester_id === a.id;
}

export function canViewTask(a: Actor, t: TaskRef, hasGrant: boolean): boolean {
  if (!a.active) return false;
  if (isOwner(a)) return true;
  if (isInvolved(a, t) || hasGrant) return true;
  return clientAuthority(a, t.client_id) !== null;
}

/**
 * May the actor open the task by id or follow a link to it? canViewTask, and
 * archived tasks are the owner's only. canViewTask itself stays without the
 * archive rule: notifications and the owner's archived list rely on it.
 */
export function canOpenTask(a: Actor, t: TaskRef & { archived_at: string | null }, hasGrant: boolean): boolean {
  return canViewTask(a, t, hasGrant) && (!t.archived_at || isOwner(a));
}

/**
 * SQL twin of canViewTask for list queries, counters, search and export, so a
 * hidden task is never fetched and then filtered in the browser. `alias` is
 * the tasks table alias. Kept next to canViewTask so the two stay identical.
 */
export function taskVisibilitySql(a: Actor, alias = "t"): { sql: string; params: unknown[] } {
  if (isOwner(a)) return { sql: "1 = 1", params: [] };
  const scoped = a.role === "photographer" ? [] : Object.keys(a.scopes);
  const parts = [
    `${alias}.assignee_id = ?`,
    `${alias}.reviewer_id = ?`,
    `${alias}.requester_id = ?`,
    `exists (select 1 from task_grants g where g.task_id = ${alias}.id and g.user_id = ?)`,
  ];
  const params: unknown[] = [a.id, a.id, a.id, a.id];
  if (scoped.length) {
    parts.push(`${alias}.client_id in (${scoped.map(() => "?").join(", ")})`);
    params.push(...scoped);
  }
  return { sql: `(${parts.join(" or ")})`, params };
}

/** Members who normally work on a client: its account manager, its supervisor and the shared photographer(s). */
export function clientTeam(c: ClientRef, members: Member[]): Set<string> {
  const team = new Set<string>([c.account_manager_id]);
  if (c.supervisor_id) team.add(c.supervisor_id);
  for (const m of members) if (m.role === "photographer" || m.role === "owner") team.add(m.id);
  return team;
}

/** May the actor make `assignee` responsible for work on client `c`? */
export function canAssignTo(a: Actor, c: ClientRef, assignee: Member, members: Member[]): Decision {
  if (!assignee.active) return deny("العضو غير مفعّل");
  if (a.role === "photographer") return deny("لا يملك المصور صلاحية الإسناد");
  if (isOwner(a)) {
    const inTeam = clientTeam(c, members).has(assignee.id);
    return allow(!inTeam);
  }
  const level = clientAuthority(a, c.id);
  if (!level) return deny("العميل خارج نطاقك");
  if (assignee.role === "owner") return deny("لا يُسند إلى مدير الوكالة؛ اطلب منه قراراً أو مساعدة");
  if (assignee.id !== a.id && assignee.rank >= a.rank) return deny("لا يمكنك الإسناد إلى من هو في مستواك أو أعلى");
  if (!clientTeam(c, members).has(assignee.id)) return deny("هذا العضو ليس ضمن فريق هذا العميل");
  if (a.role === "account_manager" && level !== "manage") return deny("العميل خارج نطاقك");
  return allow(false);
}

/** Is `reviewer` a valid approver for work that `assignee` does on client `c`, requested by `requesterId`? */
// Naming the owner as reviewer is allowed for everyone: it asks him for a
// decision, it does not assign him work.
export function validReviewer(c: ClientRef, assignee: Member, reviewer: Member, requesterId: string, scopesOf: (id: string) => Record<string, ScopeLevel>): Decision {
  if (!reviewer.active) return deny("المراجع غير مفعّل");
  if (reviewer.role === "photographer") return deny("المصور لا يعتمد الأعمال");
  if (reviewer.id === assignee.id && assignee.role !== "owner") return deny("لا يراجع أحد عمله بنفسه");
  const reviewerHasAuthority = reviewer.role === "owner" || scopesOf(reviewer.id)[c.id] !== undefined;
  if (!reviewerHasAuthority && reviewer.id !== requesterId) return deny("المراجع يجب أن يكون صاحب الطلب أو مسؤولاً عن العميل");
  return allow();
}

/** Change title, description, priority, due date, assignee or reviewer. */
export function canEditTask(a: Actor, t: TaskRef, requester: Member, assignee: Member): boolean {
  if (isOwner(a)) return true;
  if (a.role === "photographer") return false;
  if (assignee.role === "owner") return false;
  const hasStanding = a.id === t.requester_id || clientAuthority(a, t.client_id) !== null;
  return hasStanding && a.rank >= requester.rank;
}

export function canReviewTask(a: Actor, t: TaskRef): boolean {
  if (isOwner(a)) return true;
  return a.id === t.reviewer_id && a.id !== t.assignee_id;
}

export function isAssignee(a: Member, t: TaskRef): boolean {
  return a.id === t.assignee_id;
}

export function canResolveBlocker(a: Actor, t: TaskRef, b: BlockerRef, requester: Member, assignee: Member): boolean {
  return b.resolver_id === a.id || b.opened_by === a.id || canEditTask(a, t, requester, assignee);
}

export function canComment(a: Actor, t: TaskRef, hasGrant: boolean): boolean {
  return canViewTask(a, t, hasGrant);
}

export const canArchive = (a: Member) => isOwner(a);
export const canManageTeam = (a: Member) => isOwner(a);
export const canEditSettings = (a: Member) => isOwner(a);
export const canExport = (a: Member) => isOwner(a);
export const canSeeAdminReports = (a: Member) => isOwner(a);

export function canCreateBooking(a: Actor, clientId: string): boolean {
  const level = clientAuthority(a, clientId);
  return level !== null;
}

export function canManageBooking(a: Actor, b: BookingRef): boolean {
  if (isOwner(a)) return true;
  return b.created_by === a.id || clientAuthority(a, b.client_id) !== null;
}

/** Full booking details, or only "busy" for the rest. */
export function canSeeBookingDetails(a: Actor, b: BookingRef): boolean {
  if (isOwner(a)) return true;
  if (b.resource_id === a.id || b.created_by === a.id) return true;
  return clientAuthority(a, b.client_id) !== null;
}

/**
 * Who hears about it when the assignee does not respond: the client's account
 * manager, its supervisor and the owner, keeping only people who outrank the
 * assignee, lowest rank first, never the assignee, never twice, ending at the
 * owner. Escalation never reassigns the task.
 */
export function escalationChain(assignee: Member, c: ClientRef, members: Member[]): Member[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const owner = members.find((m) => m.role === "owner");
  const ids = [c.account_manager_id, c.supervisor_id, owner?.id].filter((x): x is string => !!x);
  const seen = new Set<string>([assignee.id]);
  const chain: Member[] = [];
  for (const id of ids) {
    const m = byId.get(id);
    if (!m || !m.active || seen.has(id) || m.rank <= assignee.rank) continue;
    seen.add(id);
    chain.push(m);
  }
  chain.sort((x, y) => x.rank - y.rank);
  return chain;
}

/** Superiors of a reviewer for review-wait escalation; empty for the owner (reminder only, no loop). */
export function reviewerChain(reviewer: Member, c: ClientRef, members: Member[]): Member[] {
  return escalationChain(reviewer, c, members);
}
