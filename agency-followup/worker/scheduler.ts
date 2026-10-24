// The minute-by-minute cron. It derives every reminder and escalation from
// the task rows and the clock, writes them as deduplicated notifications, and
// then drains the device outbox. Running it twice for the same minute, or
// after a gap, creates each reminder once. `now` is a parameter so tests can
// move time; nothing in production lets a request choose it.

import { OPEN_STATUSES, WORKING_STATUSES, type TaskStatus } from "../shared/domain";
import { actorFor, loadCtx, type BlockerRow, type Ctx, type TaskRow } from "./db";
import { businessMinutesBetween, isBusinessTime } from "./lib/time";
import { ACK_KINDS, BLOCKER_KINDS_N, DUE_KINDS, PUSH_TEXT, REVIEW_KINDS, notifyStmts, type NotifyInput } from "./notify";
import { canViewTask, escalationChain, reviewerChain, type Member } from "./policy";
import { sendToUser } from "./push";

export type SchedulerSummary = { tasks: number; created: number; sent: number; skipped: number; failed: number; cancelled: number; retried: number; inHours: boolean };

const fmtTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("ar-IQ", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit", numberingSystem: "latn" }).format(new Date(iso));

export function fmtBusinessDuration(min: number): string {
  if (min < 60) return `${min} دقيقة`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ساعة و${m} دقيقة` : `${h} ساعة`;
}

export async function runScheduler(env: Env, now = new Date(), opts: { push?: boolean } = {}): Promise<SchedulerSummary> {
  const ctx = await loadCtx(env, now);
  const run = await ctx.db.prepare("insert into scheduler_runs (started_at) values (?) returning id").bind(now.toISOString()).first<{ id: number }>();
  try {
    const created = await generateReminders(ctx);
    const delivery = opts.push === false ? { sent: 0, skipped: 0, failed: 0, cancelled: 0, retried: 0 } : await drainOutbox(ctx);
    await housekeeping(ctx);
    const summary: SchedulerSummary = { ...created, ...delivery };
    await ctx.db.prepare("update scheduler_runs set finished_at = ?, ok = 1, summary = ? where id = ?").bind(new Date().toISOString(), JSON.stringify(summary), run!.id).run();
    return summary;
  } catch (e) {
    await ctx.db
      .prepare("update scheduler_runs set finished_at = ?, ok = 0, error = ? where id = ?")
      .bind(new Date().toISOString(), String((e as Error)?.stack ?? e).slice(0, 1000), run!.id)
      .run();
    throw e;
  }
}

async function generateReminders(ctx: Ctx): Promise<{ tasks: number; created: number; inHours: boolean }> {
  const inHours = isBusinessTime(ctx.now, ctx.workHours);
  const { results: tasks } = await ctx.db
    .prepare(`select * from tasks where archived_at is null and status in (${OPEN_STATUSES.map(() => "?").join(",")})`)
    .bind(...OPEN_STATUSES)
    .all<TaskRow>();
  // Reminders and escalations go out in working hours only; urgent work may
  // be let through outside them when Mohammed turns that on.
  const eligible = tasks.filter((t) => (inHours || (t.priority === "urgent" && ctx.rules.urgentOutsideHours)) && (t.is_demo === 0 || ctx.rules.demoReminders));
  if (!eligible.length) return { tasks: tasks.length, created: 0, inHours };

  const ids = eligible.map((t) => t.id);
  const blockers: BlockerRow[] = [];
  const grants = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const ph = chunk.map(() => "?").join(",");
    const b = await ctx.db.prepare(`select * from blockers where resolved_at is null and task_id in (${ph})`).bind(...chunk).all<BlockerRow>();
    blockers.push(...b.results);
    const g = await ctx.db.prepare(`select task_id, user_id from task_grants where task_id in (${ph})`).bind(...chunk).all<{ task_id: string; user_id: string }>();
    for (const r of g.results) {
      const s = grants.get(r.task_id) ?? new Set<string>();
      s.add(r.user_id);
      grants.set(r.task_id, s);
    }
  }

  const stmts: D1PreparedStatement[] = [];
  const noteIdx: number[] = [];
  const tz = ctx.workHours.tz;
  for (const t of eligible) {
    const client = ctx.clientsById.get(t.client_id);
    const assignee = ctx.membersById.get(t.assignee_id);
    if (!client || !assignee) continue;
    const g = grants.get(t.id) ?? new Set<string>();
    const sees = (m: Member) => {
      const a = actorFor(ctx, m.id);
      return !!a && canViewTask(a, t, g.has(m.id));
    };
    const speed = t.priority === "urgent" ? "urgent" : "normal";
    const open = blockers.filter((b) => b.task_id === t.id);
    const chain = escalationChain(assignee, client, ctx.members).filter(sees);
    const ref = { id: t.id, cycle: t.cycle, priority: t.priority };
    const url = `/tasks/${t.id}`;
    const push = (n: NotifyInput) => {
      const s = notifyStmts(ctx, { ...n, deliverAt: ctx.now });
      noteIdx.push(stmts.length);
      stmts.push(...s);
    };

    // 1. Not acknowledged. An open clarification request pauses this clock:
    // asking a question is not a delay.
    if (t.status === "new" && !open.some((b) => b.kind === "clarification")) {
      const elapsed = businessMinutesBetween(new Date(t.ack_clock_from), ctx.now, ctx.workHours);
      const stages = ctx.rules.ack[speed];
      stages.forEach((threshold, stage) => {
        if (elapsed < threshold) return;
        const key = `ack:${t.id}:${t.cycle}:${t.ack_epoch}:${stage}`;
        if (stage === 0) {
          push({ userId: assignee.id, task: ref, kind: "ack_reminder", title: `تذكير: لم تستلم «${t.title}» بعد`, body: `${client.name} · منذ ${fmtBusinessDuration(elapsed)} عمل`, url, dedupeKey: key });
        } else {
          const target = chain[stage - 1];
          if (target) push({ userId: target.id, task: ref, kind: "ack_escalation", title: `لم تُستلم بعد: ${t.title}`, body: `${assignee.name} · ${client.name} · منذ ${fmtBusinessDuration(elapsed)} عمل`, url, dedupeKey: key });
        }
      });
    }

    // 2. Due soon / overdue. While a blocker is open the task waits on its
    // resolver, so the assignee is not chased for it.
    if (WORKING_STATUSES.includes(t.status as TaskStatus) && t.due_at && open.length === 0) {
      const due = new Date(t.due_at);
      const soon = ctx.rules.dueSoonMinutes[speed] * 60_000;
      if (ctx.now < due && due.getTime() - ctx.now.getTime() <= soon) {
        push({ userId: assignee.id, task: ref, kind: "due_soon", title: `يقترب موعد التسليم: ${t.title}`, body: `${client.name} · الموعد ${fmtTime(t.due_at, tz)}`, url, dedupeKey: `due_soon:${t.id}:${t.cycle}:${t.due_version}` });
      }
      if (ctx.now >= due) {
        push({ userId: assignee.id, task: ref, kind: "overdue", title: `تجاوزت موعدها: ${t.title}`, body: `${client.name} · كان الموعد ${fmtTime(t.due_at, tz)}`, url, dedupeKey: `overdue:${t.id}:${t.cycle}:${t.due_version}` });
        const first = chain[0];
        if (first) push({ userId: first.id, task: ref, kind: "overdue_escalation", title: `تجاوزت موعدها: ${t.title}`, body: `${assignee.name} · ${client.name}`, url, dedupeKey: `overdue_esc:${t.id}:${t.cycle}:${t.due_version}` });
      }
    }

    // 3. Open blockers: follow up with the resolver, then the person above him.
    for (const b of open) {
      const resolver = ctx.membersById.get(b.resolver_id);
      if (!resolver) continue;
      const follow = ctx.rules.blockerFollowMinutes[speed];
      const elapsed = businessMinutesBetween(new Date(b.opened_at), ctx.now, ctx.workHours);
      const label = b.kind === "client_wait" ? "بانتظار العميل" : b.kind === "clarification" ? "طلب توضيح" : "عائق";
      if (elapsed >= follow) {
        push({ userId: resolver.id, task: ref, kind: "blocker_follow", title: `${label} ما زال مفتوحاً: ${t.title}`, body: `${b.reason.slice(0, 120)} · منذ ${fmtBusinessDuration(elapsed)} عمل`, url, refId: b.id, dedupeKey: `blocker_follow:${b.id}:1` });
      }
      if (elapsed >= follow * 2) {
        const up = escalationChain(resolver, client, ctx.members).filter(sees)[0];
        if (up) push({ userId: up.id, task: ref, kind: "blocker_escalation", title: `${label} عند ${resolver.name} ما زال مفتوحاً: ${t.title}`, body: b.reason.slice(0, 120), url, refId: b.id, dedupeKey: `blocker_follow:${b.id}:2` });
      }
    }

    // 4. Waiting for review.
    if (t.status === "in_review" && t.submitted_at) {
      const reviewer = ctx.membersById.get(t.reviewer_id);
      const [remind, escalate] = ctx.rules.reviewMinutes[speed];
      const elapsed = businessMinutesBetween(new Date(t.submitted_at), ctx.now, ctx.workHours);
      if (reviewer && elapsed >= remind) {
        push({ userId: reviewer.id, task: ref, kind: "review_reminder", title: `بانتظار مراجعتك منذ ${fmtBusinessDuration(elapsed)}: ${t.title}`, body: `${assignee.name} · ${client.name}`, url, dedupeKey: `review:${t.id}:${t.cycle}:${t.review_round}:0` });
      }
      if (reviewer && escalate && elapsed >= escalate) {
        const up = reviewerChain(reviewer, client, ctx.members).filter(sees)[0];
        if (up) push({ userId: up.id, task: ref, kind: "review_escalation", title: `مراجعة متأخرة عند ${reviewer.name}: ${t.title}`, body: `${client.name} · منذ ${fmtBusinessDuration(elapsed)} عمل`, url, dedupeKey: `review:${t.id}:${t.cycle}:${t.review_round}:1` });
      }
    }
  }

  let created = 0;
  for (let i = 0; i < stmts.length; i += 60) {
    const res = await ctx.db.batch(stmts.slice(i, i + 60));
    res.forEach((r, j) => {
      if (noteIdx.includes(i + j)) created += r.meta.changes ?? 0;
    });
  }
  return { tasks: tasks.length, created, inHours };
}

type OutboxJoin = {
  id: string;
  user_id: string;
  task_id: string | null;
  task_cycle: number | null;
  attempts: number;
  kind: string;
  url: string | null;
  ref_id: string | null;
  cancelled_at: string | null;
  notification_id: string;
};

const BACKOFF_MIN = [1, 5, 15];
const MAX_ATTEMPTS = 4;

/** Deliver due outbox entries to devices. At-least-once: a crash mid-send can repeat a push, never lose the in-app record. */
export async function drainOutbox(ctx: Ctx, limit = 40): Promise<{ sent: number; skipped: number; failed: number; cancelled: number; retried: number }> {
  const stats = { sent: 0, skipped: 0, failed: 0, cancelled: 0, retried: 0 };
  const nowIso = ctx.now.toISOString();
  const { results } = await ctx.db
    .prepare(
      `select o.id, o.user_id, o.task_id, o.task_cycle, o.attempts, o.notification_id, n.kind, n.url, n.ref_id, n.cancelled_at
       from outbox o join notifications n on n.id = o.notification_id
       where o.status = 'pending' and o.next_attempt_at <= ? order by o.next_attempt_at limit ?`,
    )
    .bind(nowIso, limit)
    .all<OutboxJoin>();
  if (!results.length) return stats;
  const origin = (await ctx.db.prepare("select value from settings where key = 'app_origin'").first<{ value: string }>())?.value ?? "mailto:admin@agency-followup.invalid";
  const taskCache = new Map<string, { t: TaskRow | null; grants: Set<string> }>();
  const setStatus = (id: string, status: string, err: string | null) =>
    ctx.db.prepare("update outbox set status = ?, last_error = ?, sent_at = case when ? = 'sent' then ? else sent_at end where id = ?").bind(status, err, status, nowIso, id).run();

  for (const o of results) {
    // Claim the row for three minutes so an overlapping run skips it.
    const lease = new Date(ctx.now.getTime() + 3 * 60_000).toISOString();
    const claim = await ctx.db.prepare("update outbox set attempts = attempts + 1, next_attempt_at = ? where id = ? and status = 'pending' and attempts = ?").bind(lease, o.id, o.attempts).run();
    if (claim.meta.changes !== 1) continue;

    const reason = await irrelevance(ctx, o, taskCache);
    if (reason) {
      await setStatus(o.id, "cancelled", reason);
      stats.cancelled++;
      continue;
    }
    const r = await sendToUser(
      ctx,
      o.user_id,
      { title: "متابعة الوكالة", body: PUSH_TEXT[o.kind] ?? "تنبيه جديد", url: o.url ?? "/notifications", tag: o.task_id ?? o.notification_id },
      origin,
      o.kind.includes("escalation") || o.kind === "assigned" ? "high" : "normal",
    );
    if (r.sent > 0) {
      await setStatus(o.id, "sent", r.failed ? r.errors.join("; ").slice(0, 300) : null);
      stats.sent++;
    } else if (r.devices === 0 || r.errors.includes("push_not_configured") || (r.devices === r.gone && r.failed === 0)) {
      await setStatus(o.id, "skipped", r.errors.includes("push_not_configured") ? "push_not_configured" : "no_device");
      stats.skipped++;
    } else if (r.retryable && o.attempts + 1 < MAX_ATTEMPTS) {
      const next = new Date(ctx.now.getTime() + BACKOFF_MIN[Math.min(o.attempts, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
      await ctx.db.prepare("update outbox set next_attempt_at = ?, last_error = ? where id = ?").bind(next, r.errors.join("; ").slice(0, 300), o.id).run();
      stats.retried++;
    } else {
      await setStatus(o.id, "failed", r.errors.join("; ").slice(0, 300));
      stats.failed++;
    }
  }
  return stats;
}

/** Why a queued delivery should no longer go out, or null if it still should. */
async function irrelevance(ctx: Ctx, o: OutboxJoin, cache: Map<string, { t: TaskRow | null; grants: Set<string> }>): Promise<string | null> {
  if (o.cancelled_at) return "cancelled";
  const member = actorFor(ctx, o.user_id);
  if (!member || !member.active) return "member_inactive";
  if (!o.task_id) return null;
  let entry = cache.get(o.task_id);
  if (!entry) {
    const t = await ctx.db.prepare("select * from tasks where id = ?").bind(o.task_id).first<TaskRow>();
    const g = await ctx.db.prepare("select user_id from task_grants where task_id = ?").bind(o.task_id).all<{ user_id: string }>();
    entry = { t, grants: new Set(g.results.map((r) => r.user_id)) };
    cache.set(o.task_id, entry);
  }
  const t = entry.t;
  if (!t || t.archived_at) return "task_gone";
  if (!canViewTask(member, t, entry.grants.has(member.id))) return "no_longer_visible";
  const cycleMatches = o.task_cycle === null || o.task_cycle === t.cycle;
  if (ACK_KINDS.includes(o.kind) && (t.status !== "new" || !cycleMatches)) return "already_acknowledged";
  if (DUE_KINDS.includes(o.kind) && (!WORKING_STATUSES.includes(t.status as TaskStatus) || !cycleMatches)) return "no_longer_due";
  if (REVIEW_KINDS.includes(o.kind) && (t.status !== "in_review" || !cycleMatches)) return "already_reviewed";
  if (o.kind === "reassigned" && !cycleMatches) return "reassigned_again";
  if ((BLOCKER_KINDS_N.includes(o.kind) || o.kind === "clarification") && o.ref_id) {
    const b = await ctx.db.prepare("select resolved_at from blockers where id = ?").bind(o.ref_id).first<{ resolved_at: string | null }>();
    if (!b || b.resolved_at) return "blocker_resolved";
  }
  return null;
}

// Cleanup follows the wall clock, not the injectable reminder clock, so a
// test that moves `now` forward cannot expire real sessions.
async function housekeeping(ctx: Ctx) {
  const now = new Date();
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  const threeDays = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  await ctx.db.batch([
    ctx.db.prepare("delete from request_limits where window_start < ?").bind(day),
    ctx.db.prepare("delete from scheduler_runs where started_at < ?").bind(threeDays),
    ctx.db.prepare(`delete from "session" where "expiresAt" < ?`).bind(now.toISOString()),
    ctx.db.prepare(`delete from "rateLimit" where "lastRequest" < ?`).bind(now.getTime() - 86_400_000),
  ]);
}
