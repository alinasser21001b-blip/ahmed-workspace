import { Hono } from "hono";
import { z } from "zod";
import { OPEN_STATUSES, PRIORITIES, PRIORITY_LABEL, STATUSES, TEMPLATES, WORKING_STATUSES, type TaskStatus } from "../../shared/domain";
import {
  actorFor,
  cycleBlockers,
  getTask,
  guardStmt,
  isGuardFailure,
  isUniqueFailure,
  logEventStmt,
  taskGrants,
  unguardStmt,
  type BlockerRow,
  type Ctx,
  type TaskRow,
} from "../db";
import { body, badRequest, conflict, forbidden, httpUrl, id, instant, notFound, text, type AppEnv } from "../http";
import { randomId } from "../lib/crypto";
import { ACK_KINDS, DUE_KINDS, REVIEW_KINDS, cancelPendingStmts, notifyMany, notifyStmts } from "../notify";
import {
  canArchive,
  canAssignTo,
  canEditTask,
  canOpenTask,
  canResolveBlocker,
  canReviewTask,
  canViewTask,
  clientAuthority,
  escalationChain,
  isAssignee,
  validReviewer,
  type Actor,
} from "../policy";
import { listVisibleTasks, taskSummary, visibleClients } from "../views";
import { shapeBookings } from "./bookings";

export const tasks = new Hono<AppEnv>();

const TEMPLATE_KEYS = Object.keys(TEMPLATES) as [keyof typeof TEMPLATES, ...(keyof typeof TEMPLATES)[]];
const optionalUrl = z.union([httpUrl, z.literal("")]).nullish().transform((v) => (v ? v : null));

type Loaded = { t: TaskRow; grants: Set<string> };

/** Load a task the actor may see; anything else is a 404, so existence is not revealed. */
export async function loadVisibleTask(ctx: Ctx, actor: Actor, taskId: string): Promise<Loaded> {
  const t = await getTask(ctx.db, taskId);
  if (!t) throw notFound();
  const grants = await taskGrants(ctx.db, t.id);
  if (!canOpenTask(actor, t, grants.has(actor.id))) throw notFound();
  return { t, grants };
}

function member(ctx: Ctx, userId: string) {
  const m = ctx.membersById.get(userId);
  if (!m) throw badRequest("عضو غير معروف");
  return m;
}

function canSee(ctx: Ctx, t: TaskRow, grants: Set<string>, userId: string): boolean {
  const a = actorFor(ctx, userId);
  return !!a && canViewTask(a, t, grants.has(userId));
}

/** Task notifications go only to people who may open the task (as it stands after this change). */
function notifyVisible(ctx: Ctx, t: TaskRow, grants: Set<string>, userIds: (string | null | undefined)[], actorId: string, make: Parameters<typeof notifyMany>[3]) {
  return notifyMany(ctx, userIds.filter((u): u is string => !!u && canSee(ctx, t, grants, u)), actorId, make);
}

const taskUrl = (taskId: string) => `/tasks/${taskId}`;
const clientName = (ctx: Ctx, t: Pick<TaskRow, "client_id">) => ctx.clientsById.get(t.client_id)?.name ?? "";

function abilities(ctx: Ctx, actor: Actor, t: TaskRow, blockers: BlockerRow[]) {
  const requester = member(ctx, t.requester_id);
  const assignee = member(ctx, t.assignee_id);
  const status = t.status as TaskStatus;
  const open = OPEN_STATUSES.includes(status) && !t.archived_at;
  const working = WORKING_STATUSES.includes(status) && !t.archived_at;
  const mine = isAssignee(actor, t);
  const edit = canEditTask(actor, t, requester, assignee) && open;
  const review = canReviewTask(actor, t) && status === "in_review" && !t.archived_at;
  return {
    ack: mine && status === "new" && !t.archived_at,
    clarify: mine && working,
    start: mine && (status === "new" || status === "acknowledged" || status === "changes_requested") && !t.archived_at,
    block: (mine && working) || edit,
    propose_due: mine && working,
    submit: mine && (status === "acknowledged" || status === "in_progress" || status === "changes_requested") && !t.archived_at,
    approve: review,
    request_changes: review,
    edit,
    cancel: edit,
    decide_due: edit,
    next_step: (mine || edit) && open,
    escalate: open && actor.role !== "owner" && actor.role !== "photographer",
    archive: canArchive(actor) && !t.archived_at,
    comment: !t.archived_at,
    resolve_blocker: blockers.filter((b) => !b.resolved_at && canResolveBlocker(actor, t, b, requester, assignee)).map((b) => b.id),
  };
}

// ---------- list and today ----------

tasks.get("/", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const q = c.req.query();
  const status = q.status && (["open", "done", "all", ...STATUSES] as string[]).includes(q.status) ? (q.status as "open") : "open";
  const { rows, blockers } = await listVisibleTasks(ctx, actor, {
    clientId: q.client || undefined,
    status,
    assigneeId: q.mine === "1" ? actor.id : q.assignee || undefined,
    q: q.q ? q.q.slice(0, 80) : undefined,
    archived: q.archived === "1" && actor.role === "owner",
  });
  return c.json({ tasks: rows.map((r) => taskSummary(ctx, r, blockers)), clients: visibleClients(ctx, actor) });
});

// ---------- create ----------

const createSchema = z.object({
  client_id: id,
  parent_id: id.nullish(),
  template: z.enum(TEMPLATE_KEYS).nullish(),
  title: text(140, 3, "العنوان مطلوب (3 أحرف على الأقل)"),
  description: text(4000).default(""),
  acceptance: text(1000).default(""),
  assignee_id: id,
  reviewer_id: id.nullish(),
  priority: z.enum(PRIORITIES).default("normal"),
  due_at: instant.nullish(),
  client_due_at: instant.nullish(),
  ref_url: optionalUrl,
  requires_publish: z.boolean().default(false),
});

tasks.post("/", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const input = await body(c, createSchema);
  const createKey = (c.req.header("idempotency-key") ?? "").slice(0, 80) || randomId("k_");

  const existing = await ctx.db.prepare("select id from tasks where requester_id = ? and create_key = ?").bind(actor.id, createKey).first<{ id: string }>();
  if (existing) return c.json({ id: existing.id, duplicate: true }, 200);

  let clientId = input.client_id;
  if (input.parent_id) {
    const parent = await loadVisibleTask(ctx, actor, input.parent_id);
    clientId = parent.t.client_id; // subtasks inherit the client
  }
  const client = ctx.clientsById.get(clientId);
  if (!client) throw notFound();
  if (actor.role !== "owner" && !clientAuthority(actor, clientId)) throw notFound();

  const assignee = member(ctx, input.assignee_id);
  const decision = canAssignTo(actor, client, assignee, ctx.members);
  if (!decision.ok) throw forbidden(decision.reason);

  let reviewerId = input.reviewer_id ?? null;
  if (!reviewerId) {
    if (assignee.id !== actor.id) reviewerId = actor.id;
    else reviewerId = escalationChain(actor, client, ctx.members)[0]?.id ?? actor.id;
  }
  const reviewer = member(ctx, reviewerId);
  const rv = validReviewer(client, assignee, reviewer, actor.id, (u) => ctx.scopes.get(u) ?? {});
  if (!rv.ok) throw badRequest(rv.reason);

  const now = ctx.now.toISOString();
  if (input.due_at && Date.parse(input.due_at) < ctx.now.getTime() - 5 * 60_000) throw badRequest("موعد التسليم في الماضي");

  const taskId = randomId("t_");
  const acceptance = input.acceptance || (input.template ? TEMPLATES[input.template].acceptance : "");
  const stmts: D1PreparedStatement[] = [
    ctx.db
      .prepare(
        `insert into tasks (id, client_id, parent_id, template, title, description, acceptance, requester_id, assignee_id, reviewer_id, priority, status,
           due_at, client_due_at, original_due_at, ref_url, requires_publish, cycle, cycle_started_at, ack_epoch, ack_clock_from, create_key, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, ?, ?)`,
      )
      .bind(
        taskId,
        clientId,
        input.parent_id ?? null,
        input.template ?? null,
        input.title,
        input.description,
        acceptance,
        actor.id,
        assignee.id,
        reviewer.id,
        input.priority,
        input.due_at ?? null,
        input.client_due_at ?? null,
        input.due_at ?? null,
        input.ref_url,
        input.requires_publish ? 1 : 0,
        now,
        now,
        createKey,
        now,
        now,
      ),
    logEventStmt(ctx.db, taskId, actor.id, "created", { assignee: assignee.id, reviewer: reviewer.id, priority: input.priority, due_at: input.due_at ?? null }, ctx.now),
  ];
  if (decision.grant) {
    const reason = "إسناد من المدير إلى عضو خارج فريق العميل";
    stmts.push(
      ctx.db.prepare("insert into task_grants (task_id, user_id, granted_by, reason, created_at) values (?, ?, ?, ?, ?)").bind(taskId, assignee.id, actor.id, reason, now),
      logEventStmt(ctx.db, taskId, actor.id, "grant", { user: assignee.id, reason }, ctx.now),
    );
  }
  if (assignee.id !== actor.id) {
    stmts.push(
      ...notifyStmts(ctx, {
        userId: assignee.id,
        task: { id: taskId, cycle: 1, priority: input.priority },
        kind: "assigned",
        title: `مهمة جديدة: ${input.title}`,
        body: `${client.name} · من ${actor.name}`,
        url: taskUrl(taskId),
        dedupeKey: `assigned:${taskId}:1`,
      }),
    );
  }
  try {
    await ctx.db.batch(stmts);
  } catch (e) {
    if (isUniqueFailure(e)) {
      const again = await ctx.db.prepare("select id from tasks where requester_id = ? and create_key = ?").bind(actor.id, createKey).first<{ id: string }>();
      if (again) return c.json({ id: again.id, duplicate: true }, 200);
    }
    throw e;
  }
  return c.json({ id: taskId }, 201);
});

// ---------- detail ----------

tasks.get("/:id", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const { t, grants } = await loadVisibleTask(ctx, actor, c.req.param("id"));
  const db = ctx.db;
  const [comments, deliverables, blockers, proposals, events, subtasks, bookings] = await Promise.all([
    db.prepare("select id, author_id, kind, body, created_at from comments where task_id = ? order by created_at").bind(t.id).all(),
    db.prepare("select id, url, evidence, version_label, review_round, submitted_by, created_at from deliverables where task_id = ? order by created_at").bind(t.id).all(),
    db.prepare("select * from blockers where task_id = ? order by opened_at").bind(t.id).all<BlockerRow>(),
    db.prepare("select * from due_proposals where task_id = ? order by created_at").bind(t.id).all(),
    db.prepare("select id, actor_id, type, data, created_at from events where task_id = ? order by id desc limit 200").bind(t.id).all<{ id: number; actor_id: string | null; type: string; data: string; created_at: string }>(),
    db.prepare("select * from tasks where parent_id = ? order by created_at").bind(t.id).all<TaskRow>(),
    db.prepare("select * from bookings where task_id = ? and status = 'active' order by starts_at").bind(t.id).all(),
  ]);
  const subGrants = await Promise.all(subtasks.results.map((s) => taskGrants(db, s.id)));
  const visibleSubs = subtasks.results.filter((s, i) => canOpenTask(actor, s, subGrants[i].has(actor.id)));
  const parent = t.parent_id ? await getTask(db, t.parent_id) : null;
  // A live subtask of an archived parent shows no parent link to non-owners.
  const parentVisible = parent ? canOpenTask(actor, parent, (await taskGrants(db, parent.id)).has(actor.id)) : false;
  const subBlockers = await cycleBlockers(db, visibleSubs.map((s) => s.id));
  const name = (u: string | null) => (u ? (ctx.membersById.get(u)?.name ?? "—") : null);

  return c.json({
    task: {
      ...taskSummary(ctx, t, blockers.results),
      parent_id: parentVisible ? t.parent_id : null,
      description: t.description,
      acceptance: t.acceptance,
      ref_url: t.ref_url,
      requires_publish: t.requires_publish === 1,
      publish_url: t.publish_url,
      cancel_reason: t.cancel_reason,
      started_at: t.started_at,
      cancelled_at: t.cancelled_at,
      review_round: t.review_round,
      cycle: t.cycle,
    },
    parent: parent && parentVisible ? { id: parent.id, title: parent.title } : null,
    shared_with: [...grants].map((u) => ({ id: u, name: name(u) })),
    can: abilities(ctx, actor, t, blockers.results),
    // The assignee is this client's account manager: a client wait lands on
    // him and keeps counting against him (he is the one chasing the client).
    client_wait_is_assignees: ctx.clientsById.get(t.client_id)?.account_manager_id === t.assignee_id && ctx.membersById.get(t.assignee_id)?.role !== "owner",
    comments: comments.results.map((r) => ({ ...r, author: name(r.author_id as string) })),
    deliverables: deliverables.results.map((r) => ({ ...r, submitted_by_name: name(r.submitted_by as string) })),
    blockers: blockers.results.map((b) => ({ ...b, resolver: name(b.resolver_id), opened_by_name: name(b.opened_by), resolved_by_name: name(b.resolved_by) })),
    due_proposals: proposals.results.map((p) => ({ ...p, proposed_by_name: name(p.proposed_by as string), decided_by_name: name(p.decided_by as string | null) })),
    events: events.results.map((e) => ({ ...e, data: safeJson(e.data), actor: name(e.actor_id) })),
    subtasks: visibleSubs.map((s) => taskSummary(ctx, s, subBlockers)),
    bookings: shapeBookings(ctx, actor, bookings.results as never),
  });
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// ---------- edit ----------

const patchSchema = z.object({
  version: z.number().int().positive(),
  title: text(140, 3, "العنوان مطلوب").optional(),
  description: text(4000).optional(),
  acceptance: text(1000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  due_at: instant.nullable().optional(),
  client_due_at: instant.nullable().optional(),
  assignee_id: id.optional(),
  reviewer_id: id.optional(),
  ref_url: optionalUrl.optional(),
  requires_publish: z.boolean().optional(),
  reason: text(500).optional(),
});

tasks.patch("/:id", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const { t, grants } = await loadVisibleTask(ctx, actor, c.req.param("id"));
  const input = await body(c, patchSchema);
  const requester = member(ctx, t.requester_id);
  const assignee = member(ctx, t.assignee_id);
  if (!canEditTask(actor, t, requester, assignee)) throw forbidden("لا تملك صلاحية تعديل هذه المهمة");
  if (!OPEN_STATUSES.includes(t.status as TaskStatus) || t.archived_at) throw badRequest("لا يمكن تعديل مهمة مغلقة");
  // The edit was made on the version the browser showed; anything newer means someone else changed it first.
  if (input.version !== t.version) throw conflict();
  const client = ctx.clientsById.get(t.client_id)!;

  const set: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const note = (k: string, from: unknown, to: unknown) => {
    if (from !== to) changes[k] = { from, to };
  };
  for (const k of ["title", "description", "acceptance", "client_due_at", "ref_url"] as const) {
    if (input[k] !== undefined && input[k] !== t[k]) {
      set[k] = input[k];
      note(k, t[k], input[k]);
    }
  }
  if (input.requires_publish !== undefined && (input.requires_publish ? 1 : 0) !== t.requires_publish) {
    set.requires_publish = input.requires_publish ? 1 : 0;
    note("requires_publish", t.requires_publish === 1, input.requires_publish);
  }
  const dueChanged = input.due_at !== undefined && input.due_at !== t.due_at;
  const priorityChanged = input.priority !== undefined && input.priority !== t.priority;
  const assigneeChanged = input.assignee_id !== undefined && input.assignee_id !== t.assignee_id;
  const reviewerChanged = input.reviewer_id !== undefined && input.reviewer_id !== t.reviewer_id;
  if ((dueChanged || priorityChanged || assigneeChanged) && !(input.reason && input.reason.length >= 3)) {
    throw badRequest("اكتب سبب تغيير الموعد أو الأولوية أو المنفذ", { field: "reason" });
  }

  const stmts: D1PreparedStatement[] = [];
  let newCycle = t.cycle;
  let newAssignee = assignee;
  let grantsNewAssignee = false;
  if (assigneeChanged) {
    if (t.status === "in_review") throw badRequest("لا يمكن تغيير المنفذ أثناء المراجعة. اطلب تعديلاً أولاً.");
    newAssignee = member(ctx, input.assignee_id!);
    const d = canAssignTo(actor, client, newAssignee, ctx.members);
    if (!d.ok) throw forbidden(d.reason);
    grantsNewAssignee = !!d.grant;
    newCycle = t.cycle + 1;
    Object.assign(set, {
      assignee_id: newAssignee.id,
      status: "new",
      acknowledged_at: null,
      started_at: null,
      cycle: newCycle,
      cycle_started_at: ctx.now.toISOString(),
      ack_epoch: 0,
      ack_clock_from: ctx.now.toISOString(),
    });
    note("assignee_id", t.assignee_id, newAssignee.id);
    // The single-task access that came with the old assignment ends with it.
    if (grants.has(t.assignee_id)) {
      stmts.push(
        ctx.db.prepare("delete from task_grants where task_id = ? and user_id = ?").bind(t.id, t.assignee_id),
        logEventStmt(ctx.db, t.id, actor.id, "grant_revoked", { user: t.assignee_id, reason: "إعادة الإسناد" }, ctx.now),
      );
    }
    if (d.grant && !grants.has(newAssignee.id)) {
      const reason = "إعادة إسناد من المدير إلى عضو خارج فريق العميل";
      stmts.push(
        ctx.db.prepare("insert or ignore into task_grants (task_id, user_id, granted_by, reason, created_at) values (?, ?, ?, ?, ?)").bind(t.id, newAssignee.id, actor.id, reason, ctx.now.toISOString()),
        logEventStmt(ctx.db, t.id, actor.id, "grant", { user: newAssignee.id, reason }, ctx.now),
      );
    }
  }
  const reviewerId = reviewerChanged ? input.reviewer_id! : t.reviewer_id;
  if (reviewerChanged || assigneeChanged) {
    const rv = validReviewer(client, newAssignee, member(ctx, reviewerId), t.requester_id, (u) => ctx.scopes.get(u) ?? {});
    if (!rv.ok) throw badRequest(rv.reason);
    if (reviewerChanged) {
      set.reviewer_id = reviewerId;
      if (t.status === "in_review") set.reviewer_since = ctx.now.toISOString();
      note("reviewer_id", t.reviewer_id, reviewerId);
    }
  }
  if (priorityChanged) {
    set.priority = input.priority;
    note("priority", t.priority, input.priority);
  }
  if (dueChanged) {
    if (input.due_at && Date.parse(input.due_at) < ctx.now.getTime() - 5 * 60_000) throw badRequest("الموعد الجديد في الماضي");
    set.due_at = input.due_at;
    set.due_version = t.due_version + 1;
    set.wait_clock_from = ctx.now.toISOString();
    if (!t.original_due_at && t.due_at) set.original_due_at = t.due_at;
    note("due_at", t.due_at, input.due_at);
  }
  if (!Object.keys(changes).length) return c.json({ ok: true, unchanged: true });

  const opId = randomId("op_");
  const updated = { ...t, ...set } as TaskRow;
  const newGrants = new Set(grants);
  if (assigneeChanged) {
    newGrants.delete(t.assignee_id);
    if (grantsNewAssignee) newGrants.add(newAssignee.id);
    // The old cycle's loose ends: the old assignee's open questions close
    // (they would otherwise pause the new assignee's clock), his pending date
    // proposals close, and blockers move to someone who can act on them.
    const nowIso = ctx.now.toISOString();
    const handTo = updated.requester_id !== newAssignee.id ? updated.requester_id : updated.reviewer_id;
    const oldStillSees = canSee(ctx, updated, newGrants, t.assignee_id);
    const { results: openBlockers } = await ctx.db.prepare("select * from blockers where task_id = ? and resolved_at is null").bind(t.id).all<BlockerRow>();
    for (const b of openBlockers) {
      if (b.kind === "clarification" && b.opened_by === t.assignee_id) {
        const resolution = "أُغلق مع إعادة إسناد المهمة";
        stmts.push(
          ctx.db.prepare("update blockers set resolved_at = ?, resolved_by = ?, resolution = ? where id = ? and resolved_at is null").bind(nowIso, actor.id, resolution, b.id),
          logEventStmt(ctx.db, t.id, actor.id, "blocker_resolved", { blocker: b.id, kind: b.kind, resolution }, ctx.now),
        );
        continue;
      }
      // Who should now clear it: not someone who lost the task; not the new
      // assignee for an internal blocker; and waiting on the client goes back
      // to the client's account manager when it would land on the new assignee.
      const am = client.account_manager_id;
      const dest = b.kind === "client_wait" && b.resolver_id === newAssignee.id && newAssignee.id !== am && newAssignee.role !== "owner" ? am : handTo;
      const move =
        (b.resolver_id === t.assignee_id && !oldStillSees) ||
        (b.kind === "internal" && b.resolver_id === newAssignee.id && newAssignee.role !== "owner") ||
        (b.kind === "client_wait" && b.resolver_id === newAssignee.id && newAssignee.id !== am && newAssignee.role !== "owner");
      if (!move || dest === b.resolver_id) continue;
      stmts.push(
        ctx.db.prepare("update blockers set resolver_id = ?, resolver_since = ? where id = ? and resolved_at is null").bind(dest, nowIso, b.id),
        logEventStmt(ctx.db, t.id, actor.id, "blocker_handed_over", { blocker: b.id, from: b.resolver_id, to: dest }, ctx.now),
        ...notifyVisible(ctx, updated, newGrants, [dest], actor.id, () => ({
          task: { id: t.id, cycle: newCycle, priority: updated.priority },
          kind: "blocker_opened",
          title: `${b.kind === "client_wait" ? "بانتظار العميل" : "عائق"} انتقل إليك: ${t.title}`,
          body: b.reason.slice(0, 200),
          url: taskUrl(t.id),
          refId: b.id,
          dedupeKey: `blocker_handover:${b.id}:${dest}:${newCycle}`,
        })),
      );
    }
    const { results: pendingProposals } = await ctx.db.prepare("select id from due_proposals where task_id = ? and status = 'pending' and proposed_by = ?").bind(t.id, t.assignee_id).all<{ id: string }>();
    for (const p of pendingProposals) {
      stmts.push(
        ctx.db
          .prepare("update due_proposals set status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? where id = ? and status = 'pending'")
          .bind(actor.id, nowIso, "أُعيد إسناد المهمة", p.id),
        logEventStmt(ctx.db, t.id, actor.id, "due_proposal_rejected", { proposal: p.id, note: "أُعيد إسناد المهمة" }, ctx.now),
      );
    }
  }
  stmts.unshift(...updateStmts(ctx, opId, t, set));
  stmts.push(logEventStmt(ctx.db, t.id, actor.id, "edited", { changes, reason: input.reason ?? null }, ctx.now));
  if (assigneeChanged) {
    stmts.push(...cancelPendingStmts(ctx, t.id, { beforeCycle: newCycle }));
    stmts.push(
      ...notifyVisible(ctx, updated, newGrants, [newAssignee.id], actor.id, () => ({
        task: { id: t.id, cycle: newCycle, priority: updated.priority },
        kind: "reassigned",
        title: `أُسندت إليك: ${t.title}`,
        body: `${clientName(ctx, t)} · السبب: ${input.reason}`,
        url: taskUrl(t.id),
        dedupeKey: `assigned:${t.id}:${newCycle}`,
      })),
      ...notifyVisible(ctx, t, grants, [t.assignee_id], actor.id, () => ({
        task: { id: t.id, cycle: newCycle, priority: updated.priority },
        kind: "reassigned_away",
        title: `أُسندت مهمة «${t.title}» إلى شخص آخر`,
        body: "لم تعد هذه المهمة مسندة إليك.",
        url: null,
        push: false,
        dedupeKey: `reassigned_away:${t.id}:${newCycle}`,
      })),
    );
  }
  if (dueChanged) {
    stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: DUE_KINDS }));
    stmts.push(
      ...notifyVisible(ctx, updated, newGrants, [updated.assignee_id], actor.id, () => ({
        task: { id: t.id, cycle: newCycle, priority: updated.priority },
        kind: "due_changed",
        title: `تغيّر موعد: ${t.title}`,
        body: `السبب: ${input.reason}`,
        url: taskUrl(t.id),
        dedupeKey: `due_changed:${t.id}:${t.due_version + 1}`,
      })),
    );
  }
  if (reviewerChanged && updated.status === "in_review") {
    stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: REVIEW_KINDS }));
    stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: ["submitted"], userId: t.reviewer_id }));
    stmts.push(
      ...notifyVisible(ctx, updated, newGrants, [reviewerId], actor.id, () => ({
        task: { id: t.id, cycle: newCycle, priority: updated.priority },
        kind: "submitted",
        title: `بانتظار مراجعتك: ${t.title}`,
        body: `أصبحت المراجع بدلاً من ${member(ctx, t.reviewer_id).name}`,
        url: taskUrl(t.id),
        dedupeKey: `submitted:${t.id}:${t.cycle}:${t.review_round}:${reviewerId}`,
      })),
    );
  }
  if (priorityChanged && !assigneeChanged && !dueChanged) {
    stmts.push(
      ...notifyVisible(ctx, updated, newGrants, [updated.assignee_id], actor.id, () => ({
        task: { id: t.id, cycle: newCycle, priority: updated.priority },
        kind: "due_changed",
        title: `تغيّرت أولوية: ${t.title} ← ${PRIORITY_LABEL[updated.priority]}`,
        body: `السبب: ${input.reason}`,
        url: taskUrl(t.id),
        push: false,
        dedupeKey: `priority:${t.id}:${opId}`,
      })),
    );
  }
  await runGuarded(ctx, opId, stmts);
  return c.json({ ok: true });
});

/** Version-checked update of the task row; the batch aborts if someone else changed it first. */
function updateStmts(ctx: Ctx, opId: string, t: TaskRow, set: Record<string, unknown>): D1PreparedStatement[] {
  const cols = Object.keys(set);
  const assignments = cols.map((k) => `${k} = ?`).join(", ");
  return [
    guardStmt(ctx.db, opId, "select count(*) from tasks where id = ? and version = ?", [t.id, t.version]),
    ctx.db
      .prepare(`update tasks set ${assignments}${cols.length ? ", " : ""}version = version + 1, updated_at = ? where id = ? and version = ?`)
      .bind(...cols.map((k) => set[k]), ctx.now.toISOString(), t.id, t.version),
  ];
}

async function runGuarded(ctx: Ctx, opId: string, stmts: D1PreparedStatement[]) {
  try {
    await ctx.db.batch([...stmts, unguardStmt(ctx.db, opId)]);
  } catch (e) {
    if (isGuardFailure(e)) throw conflict();
    throw e;
  }
}

// ---------- actions ----------

const v = { version: z.number().int().positive() };
const schemas = {
  ack: z.object(v),
  start: z.object(v),
  clarify: z.object({ ...v, question: text(1000, 3, "اكتب سؤالك") }),
  block: z.object({
    ...v,
    kind: z.enum(["internal", "client_wait"]),
    reason: text(500, 3, "اكتب سبب العائق"),
    resolver_id: id.nullish(),
    expected_at: instant.nullish(),
  }),
  resolve_blocker: z.object({ ...v, blocker_id: id, resolution: text(2000, 1, "اكتب الحل أو التوضيح") }),
  propose_due: z.object({ ...v, proposed_due_at: instant, reason: text(500, 3, "اكتب سبب اقتراح الموعد") }),
  decide_due: z.object({ ...v, proposal_id: id, accept: z.boolean(), note: text(500).optional() }),
  submit: z.object({ ...v, url: optionalUrl, evidence: text(2000).optional(), version_label: text(40).optional() }),
  approve: z.object({ ...v, note: text(1000).optional(), publish_url: optionalUrl }),
  request_changes: z.object({ ...v, note: text(2000, 3, "اكتب المطلوب تعديله") }),
  cancel: z.object({ ...v, reason: text(500, 3, "اكتب سبب الإلغاء") }),
  archive: z.object(v),
  escalate: z.object({ ...v, reason: text(500, 3, "اكتب سبب التصعيد") }),
  next_step: z.object({ ...v, next_step: text(300) }),
} as const;
type ActionName = keyof typeof schemas;

tasks.post("/:id/actions/:action", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const action = c.req.param("action") as ActionName;
  if (!Object.hasOwn(schemas, action)) throw notFound();
  const { t, grants } = await loadVisibleTask(ctx, actor, c.req.param("id"));
  const input = (await body(c, schemas[action])) as Record<string, unknown> & { version: number };
  if (input.version !== t.version) throw conflict();

  const { results: blockerRows } = await ctx.db.prepare("select * from blockers where task_id = ?").bind(t.id).all<BlockerRow>();
  const can = abilities(ctx, actor, t, blockerRows);
  const nowIso = ctx.now.toISOString();
  const opId = randomId("op_");
  const stmts: D1PreparedStatement[] = [];
  const set: Record<string, unknown> = {};
  const event = (type: string, data: unknown = {}) => stmts.push(logEventStmt(ctx.db, t.id, actor.id, type, data, ctx.now));
  const ref = { id: t.id, cycle: t.cycle, priority: t.priority };
  const cname = clientName(ctx, t);
  const deny = () => {
    throw forbidden();
  };

  switch (action) {
    case "ack": {
      if (!can.ack) deny();
      Object.assign(set, { status: "acknowledged", acknowledged_at: nowIso });
      event("acknowledged");
      stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: ACK_KINDS }));
      stmts.push(...notifyVisible(ctx, t, grants, [t.requester_id], actor.id, () => ({ task: ref, kind: "acknowledged", title: `${actor.name} استلم: ${t.title}`, body: cname, url: taskUrl(t.id), push: false, dedupeKey: `acknowledged:${t.id}:${t.cycle}` })));
      break;
    }
    case "start": {
      if (!can.start) deny();
      Object.assign(set, { status: "in_progress", started_at: t.started_at ?? nowIso, acknowledged_at: t.acknowledged_at ?? nowIso });
      event("started", { from: t.status });
      if (t.status === "new") stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: ACK_KINDS }));
      break;
    }
    case "clarify": {
      if (!can.clarify) deny();
      const question = input.question as string;
      const resolverId = t.requester_id !== actor.id ? t.requester_id : t.reviewer_id;
      const blockerId = randomId("b_");
      stmts.push(
        ctx.db.prepare("insert into comments (id, task_id, author_id, kind, body, created_at) values (?, ?, ?, 'clarification_request', ?, ?)").bind(randomId("c_"), t.id, actor.id, question, nowIso),
        ctx.db
          .prepare("insert into blockers (id, task_id, kind, reason, resolver_id, opened_by, opened_at) values (?, ?, 'clarification', ?, ?, ?, ?)")
          .bind(blockerId, t.id, question.slice(0, 500), resolverId, actor.id, nowIso),
      );
      event("clarification_requested", { blocker: blockerId, resolver: resolverId });
      stmts.push(
        ...notifyVisible(ctx, t, grants, [resolverId], actor.id, () => ({
          task: ref,
          kind: "clarification",
          title: `${actor.name} يحتاج توضيحاً: ${t.title}`,
          body: question.slice(0, 200),
          url: taskUrl(t.id),
          refId: blockerId,
          dedupeKey: `clarification:${blockerId}`,
        })),
      );
      break;
    }
    case "block": {
      if (!can.block) deny();
      const kind = input.kind as "internal" | "client_wait";
      const client = ctx.clientsById.get(t.client_id)!;
      let resolverId = (input.resolver_id as string | null) ?? null;
      if (!resolverId) resolverId = kind === "client_wait" ? client.account_manager_id : t.requester_id !== t.assignee_id ? t.requester_id : t.reviewer_id;
      // An internal blocker is cleared by someone other than the assignee, so
      // it is never a way to stop his own reminders. The owner has nobody
      // above him, so he may hold his own. Waiting on the client stays with
      // the client's account manager, even when she is the assignee.
      const assigneeIsOwner = member(ctx, t.assignee_id).role === "owner";
      if (kind === "internal" && resolverId === t.assignee_id && !assigneeIsOwner) throw badRequest("اختر شخصاً آخر يحل العائق؛ لا يكون المنفذ مسؤولاً عن حل عائقه");
      if (kind === "client_wait" && resolverId === t.assignee_id && resolverId !== client.account_manager_id && !assigneeIsOwner) throw badRequest("متابعة العميل مسؤولية مسؤول الحساب");
      if (!ctx.membersById.get(resolverId)?.active || !canSee(ctx, t, grants, resolverId)) throw badRequest("هذا الشخص لا يستطيع رؤية المهمة؛ اختر مسؤولاً آخر عن الحل");
      if (ctx.membersById.get(resolverId)!.role === "photographer" && kind === "client_wait") throw badRequest("متابعة العميل مسؤولية مسؤول الحساب");
      const blockerId = randomId("b_");
      stmts.push(
        ctx.db
          .prepare("insert into blockers (id, task_id, kind, reason, resolver_id, opened_by, opened_at, expected_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(blockerId, t.id, kind, input.reason, resolverId, actor.id, nowIso, (input.expected_at as string | null) ?? null),
      );
      event("blocker_opened", { blocker: blockerId, kind, resolver: resolverId, reason: input.reason });
      stmts.push(
        ...notifyVisible(ctx, t, grants, [resolverId], actor.id, () => ({
          task: ref,
          kind: "blocker_opened",
          title: `${kind === "client_wait" ? "بانتظار العميل" : "عائق"}: ${t.title}`,
          body: `${input.reason as string} · سجّله ${actor.name}`,
          url: taskUrl(t.id),
          refId: blockerId,
          dedupeKey: `blocker_opened:${blockerId}`,
        })),
      );
      break;
    }
    case "resolve_blocker": {
      const b = blockerRows.find((x) => x.id === input.blocker_id);
      if (!b || b.resolved_at) throw badRequest("العائق غير موجود أو حُلّ مسبقاً");
      if (!can.resolve_blocker.includes(b.id)) deny();
      const resolution = input.resolution as string;
      stmts.push(ctx.db.prepare("update blockers set resolved_at = ?, resolved_by = ?, resolution = ? where id = ? and resolved_at is null").bind(nowIso, actor.id, resolution, b.id));
      if (b.kind === "clarification") {
        stmts.push(ctx.db.prepare("insert into comments (id, task_id, author_id, kind, body, created_at) values (?, ?, ?, 'clarification_answer', ?, ?)").bind(randomId("c_"), t.id, actor.id, resolution, nowIso));
        // The acknowledgement clock restarts from the answer: asking was not a delay.
        // Withdrawing one's own question does not restart the clock; an answer does.
        if (t.status === "new" && actor.id !== b.opened_by) Object.assign(set, { ack_epoch: t.ack_epoch + 1, ack_clock_from: nowIso });
      }
      event("blocker_resolved", { blocker: b.id, kind: b.kind, resolution });
      stmts.push(...cancelPendingStmts(ctx, t.id, { refId: b.id }));
      stmts.push(
        ...notifyVisible(ctx, t, grants, [t.assignee_id, b.opened_by], actor.id, () => ({
          task: ref,
          kind: b.kind === "clarification" ? "clarification_answered" : "blocker_resolved",
          title: `${b.kind === "clarification" ? "وصل التوضيح" : "زال العائق"}: ${t.title}`,
          body: resolution.slice(0, 200),
          url: taskUrl(t.id),
          refId: b.id,
          dedupeKey: `blocker_resolved:${b.id}`,
        })),
      );
      break;
    }
    case "propose_due": {
      if (!can.propose_due) deny();
      if (Date.parse(input.proposed_due_at as string) < ctx.now.getTime()) throw badRequest("الموعد المقترح في الماضي", { field: "proposed_due_at" });
      const pid = randomId("p_");
      stmts.push(
        ctx.db
          .prepare("insert into due_proposals (id, task_id, proposed_by, proposed_due_at, reason, status, created_at) values (?, ?, ?, ?, ?, 'pending', ?)")
          .bind(pid, t.id, actor.id, input.proposed_due_at, input.reason, nowIso),
      );
      event("due_proposed", { proposal: pid, proposed_due_at: input.proposed_due_at, reason: input.reason });
      const decider = t.requester_id !== actor.id ? t.requester_id : t.reviewer_id;
      stmts.push(
        ...notifyVisible(ctx, t, grants, [decider], actor.id, () => ({
          task: ref,
          kind: "due_proposal",
          title: `${actor.name} يقترح موعداً: ${t.title}`,
          body: input.reason as string,
          url: taskUrl(t.id),
          refId: pid,
          dedupeKey: `due_proposal:${pid}`,
        })),
      );
      break;
    }
    case "decide_due": {
      if (!can.decide_due) deny();
      const p = await ctx.db
        .prepare("select * from due_proposals where id = ? and task_id = ? and status = 'pending'")
        .bind(input.proposal_id, t.id)
        .first<{ id: string; proposed_due_at: string; proposed_by: string; reason: string }>();
      if (!p) throw badRequest("الاقتراح غير موجود أو تقرر مسبقاً");
      if (input.accept && Date.parse(p.proposed_due_at) < ctx.now.getTime()) throw badRequest("الموعد المقترح مضى؛ ارفضه أو غيّر الموعد مباشرة مع ذكر السبب");
      const accept = input.accept as boolean;
      stmts.push(
        ctx.db
          .prepare("update due_proposals set status = ?, decided_by = ?, decided_at = ?, decision_note = ? where id = ? and status = 'pending'")
          .bind(accept ? "accepted" : "rejected", actor.id, nowIso, (input.note as string) ?? null, p.id),
      );
      if (accept) {
        Object.assign(set, { due_at: p.proposed_due_at, due_version: t.due_version + 1, wait_clock_from: nowIso });
        if (!t.original_due_at && t.due_at) set.original_due_at = t.due_at;
        stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: DUE_KINDS }));
      }
      event(accept ? "due_proposal_accepted" : "due_proposal_rejected", { proposal: p.id, from: t.due_at, to: accept ? p.proposed_due_at : t.due_at, note: input.note ?? null });
      stmts.push(
        ...notifyVisible(ctx, t, grants, [p.proposed_by], actor.id, () => ({
          task: ref,
          kind: "due_decided",
          title: `${accept ? "قُبل" : "رُفض"} الموعد المقترح: ${t.title}`,
          body: (input.note as string) || "",
          url: taskUrl(t.id),
          dedupeKey: `due_decided:${p.id}`,
        })),
      );
      break;
    }
    case "submit": {
      if (!can.submit) deny();
      const url = input.url as string | null;
      const evidence = ((input.evidence as string) ?? "").trim();
      if (!url && evidence.length < 3) throw badRequest("أرفق رابط التسليم أو اكتب دليلاً واضحاً على التسليم", { field: "url" });
      const round = t.review_round + 1;
      stmts.push(
        ctx.db
          .prepare("insert into deliverables (id, task_id, url, evidence, version_label, review_round, submitted_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(randomId("d_"), t.id, url, evidence || null, (input.version_label as string) || null, round, actor.id, nowIso),
      );
      Object.assign(set, { status: "in_review", submitted_at: nowIso, review_round: round, started_at: t.started_at ?? nowIso, acknowledged_at: t.acknowledged_at ?? nowIso });
      event("submitted", { round, url, version_label: input.version_label ?? null });
      stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: [...ACK_KINDS, ...DUE_KINDS] }));
      stmts.push(
        ...notifyVisible(ctx, t, grants, [t.reviewer_id], actor.id, () => ({
          task: ref,
          kind: "submitted",
          title: `بانتظار مراجعتك: ${t.title}`,
          body: `سلّمه ${actor.name}${input.version_label ? ` · ${input.version_label}` : ""}`,
          url: taskUrl(t.id),
          dedupeKey: `submitted:${t.id}:${t.cycle}:${round}`,
        })),
      );
      break;
    }
    case "approve": {
      if (!can.approve) deny();
      const publishUrl = (input.publish_url as string | null) ?? t.publish_url;
      if (t.requires_publish === 1 && !publishUrl) throw badRequest("هذه المهمة تتطلب رابط النشر قبل الإكمال", { field: "publish_url" });
      Object.assign(set, { status: "done", completed_at: nowIso, publish_url: publishUrl });
      if (input.note) stmts.push(ctx.db.prepare("insert into comments (id, task_id, author_id, kind, body, created_at) values (?, ?, ?, 'review_note', ?, ?)").bind(randomId("c_"), t.id, actor.id, input.note, nowIso));
      event("approved", { round: t.review_round, publish_url: publishUrl ?? null });
      stmts.push(...cancelPendingStmts(ctx, t.id, {}));
      stmts.push(
        ...notifyVisible(ctx, t, grants, [t.assignee_id, t.requester_id], actor.id, (u) => ({
          task: ref,
          kind: "approved",
          title: `اعتُمد وأُكمل: ${t.title}`,
          body: `اعتمده ${actor.name}`,
          url: taskUrl(t.id),
          push: u === t.assignee_id,
          dedupeKey: `approved:${t.id}:${t.review_round}:${u}`,
        })),
      );
      break;
    }
    case "request_changes": {
      if (!can.request_changes) deny();
      Object.assign(set, { status: "changes_requested" });
      stmts.push(ctx.db.prepare("insert into comments (id, task_id, author_id, kind, body, created_at) values (?, ?, ?, 'changes_requested', ?, ?)").bind(randomId("c_"), t.id, actor.id, input.note, nowIso));
      event("changes_requested", { round: t.review_round });
      stmts.push(...cancelPendingStmts(ctx, t.id, { kinds: REVIEW_KINDS }));
      stmts.push(
        ...notifyVisible(ctx, t, grants, [t.assignee_id], actor.id, () => ({
          task: ref,
          kind: "changes_requested",
          title: `مطلوب تعديل: ${t.title}`,
          body: (input.note as string).slice(0, 200),
          url: taskUrl(t.id),
          dedupeKey: `changes_requested:${t.id}:${t.review_round}`,
        })),
      );
      break;
    }
    case "cancel": {
      if (!can.cancel) deny();
      Object.assign(set, { status: "cancelled", cancelled_at: nowIso, cancel_reason: input.reason });
      event("cancelled", { reason: input.reason, from: t.status });
      stmts.push(...cancelPendingStmts(ctx, t.id, {}));
      stmts.push(
        ...notifyVisible(ctx, t, grants, [t.assignee_id, t.reviewer_id], actor.id, (u) => ({
          task: ref,
          kind: "cancelled",
          title: `أُلغيت: ${t.title}`,
          body: `السبب: ${input.reason as string}`,
          url: taskUrl(t.id),
          push: u === t.assignee_id,
          dedupeKey: `cancelled:${t.id}:${u}`,
        })),
      );
      break;
    }
    case "archive": {
      if (!can.archive) deny();
      Object.assign(set, { archived_at: nowIso });
      event("archived");
      stmts.push(...cancelPendingStmts(ctx, t.id, {}));
      break;
    }
    case "escalate": {
      if (!can.escalate) deny();
      const client = ctx.clientsById.get(t.client_id)!;
      const up = escalationChain(actor, client, ctx.members).filter((m) => canSee(ctx, t, grants, m.id))[0];
      if (!up) throw badRequest("لا يوجد مستوى أعلى للتصعيد");
      event("escalated", { to: up.id, reason: input.reason });
      stmts.push(
        ...notifyStmts(ctx, {
          userId: up.id,
          task: ref,
          kind: "escalated",
          title: `تصعيد من ${actor.name}: ${t.title}`,
          body: input.reason as string,
          url: taskUrl(t.id),
          deliverAt: ctx.now,
          dedupeKey: `escalated:${t.id}:${opId}`,
        }),
      );
      break;
    }
    case "next_step": {
      if (!can.next_step) deny();
      set.next_step = input.next_step;
      event("next_step", { next_step: input.next_step });
      break;
    }
  }

  stmts.unshift(...updateStmts(ctx, opId, t, set));
  await runGuarded(ctx, opId, stmts);
  return c.json({ ok: true });
});

// ---------- comments ----------

const commentSchema = z.object({ body: text(2000, 1, "اكتب التعليق"), client_key: z.string().min(4).max(80) });

tasks.post("/:id/comments", async (c) => {
  const ctx = c.get("ctx");
  const actor = c.get("actor");
  const { t, grants } = await loadVisibleTask(ctx, actor, c.req.param("id"));
  if (t.archived_at) throw badRequest("المهمة مؤرشفة");
  const input = await body(c, commentSchema);
  const cid = randomId("c_");
  const res = await ctx.db
    .prepare("insert into comments (id, task_id, author_id, kind, body, client_key, created_at) values (?, ?, ?, 'comment', ?, ?, ?) on conflict (task_id, author_id, client_key) do nothing")
    .bind(cid, t.id, actor.id, input.body, input.client_key, ctx.now.toISOString())
    .run();
  if (res.meta.changes === 1) {
    const stmts = notifyVisible(ctx, t, grants, [t.assignee_id, t.requester_id, t.reviewer_id], actor.id, (u) => ({
      task: { id: t.id, cycle: t.cycle, priority: t.priority },
      kind: "comment",
      title: `تعليق من ${actor.name}: ${t.title}`,
      body: input.body.slice(0, 200),
      url: taskUrl(t.id),
      push: false,
      deliverAt: ctx.now,
      dedupeKey: `comment:${cid}:${u}`,
    }));
    if (stmts.length) await ctx.db.batch(stmts);
  }
  return c.json({ ok: true, duplicate: res.meta.changes !== 1 }, res.meta.changes === 1 ? 201 : 200);
});

// Assignment options for the form: who the actor may assign on each client, computed by the same policy.
export function assignmentOptions(ctx: Ctx, actor: Actor) {
  return visibleClients(ctx, actor)
    .filter(() => actor.role !== "photographer")
    .map((cl) => {
      const client = ctx.clientsById.get(cl.id)!;
      const assignees = ctx.members.filter((m) => m.active && canAssignTo(actor, client, m, ctx.members).ok).map((m) => ({ id: m.id, name: m.name, role: m.role, outside_team: canAssignTo(actor, client, m, ctx.members).ok && (canAssignTo(actor, client, m, ctx.members) as { grant?: boolean }).grant === true }));
      // Whom validReviewer accepts with the actor as requester: the owner, members with a scope on the client, or the actor himself.
      const reviewers = ctx.members
        .filter((m) => m.active && m.role !== "photographer" && (m.role === "owner" || (ctx.scopes.get(m.id) ?? {})[cl.id] !== undefined || m.id === actor.id))
        .map((m) => ({ id: m.id, name: m.name, role: m.role }));
      return { client: cl, assignees, reviewers };
    });
}
