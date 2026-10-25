// The minute-by-minute cron. It derives every reminder and escalation from
// the task rows and the clock, writes them as deduplicated notifications, and
// then drains the device outbox. Running it twice for the same minute, or
// after a gap, creates each reminder once. `now` is a parameter so tests can
// move time; nothing in production lets a request choose it.

import { OPEN_STATUSES, WORKING_STATUSES, type TaskStatus } from "../shared/domain";
import { actorFor, cycleBlockers, loadCtx, type Ctx, type TaskRow } from "./db";
import { addBusinessMinutes, businessMinutesBetween, isBusinessTime, localParts, zonedToUtc } from "./lib/time";
import { ACK_KINDS, BLOCKER_KINDS_N, DUE_KINDS, PUSH_TEXT, REVIEW_KINDS, notifyStmts, type NotifyInput } from "./notify";
import { canViewTask, escalationChain, type Member } from "./policy";
import { deliver, type SubRow } from "./push";
import { ownDeadline, waitsOnOthers } from "./views";

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
  // This cycle's blockers, resolved ones too: the time spent waiting on others is given back on the deadline.
  const blockers = await cycleBlockers(ctx.db, ids);
  const grants = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const ph = chunk.map(() => "?").join(",");
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
  // The first working hour of the day carries the start-of-day summary (§8).
  const day = localParts(ctx.now, tz);
  const [sh, sm] = ctx.workHours.start.split(":").map(Number);
  const dayStart = zonedToUtc(day.y, day.m, day.d, sh || 0, sm || 0, tz);
  const summaryDay =
    inHours && ctx.now.getTime() - dayStart.getTime() < 60 * 60_000
      ? { key: `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`, end: zonedToUtc(day.y, day.m, day.d + 1, 0, 0, tz) }
      : null;
  const summary = new Map<string, { title: string; due: number }[]>();
  // Just past how far "due soon" reaches from now, in working minutes; a deadline beyond it is not counted out.
  const soonBound = {
    normal: addBusinessMinutes(ctx.now, ctx.rules.dueSoonMinutes.normal + 1, ctx.workHours),
    urgent: addBusinessMinutes(ctx.now, ctx.rules.dueSoonMinutes.urgent + 1, ctx.workHours),
  };
  for (const t of eligible) {
    const client = ctx.clientsById.get(t.client_id);
    const assignee = ctx.membersById.get(t.assignee_id);
    if (!client || !assignee) continue;
    /** The first person above both `holder` and the assignee, so an escalation never lands on either of them. */
    const above = (holder: Member) => {
      const top = holder.rank >= assignee.rank ? holder : assignee;
      return escalationChain(top, client, ctx.members).filter((m) => m.id !== holder.id && m.id !== assignee.id && sees(m))[0];
    };
    const g = grants.get(t.id) ?? new Set<string>();
    const sees = (m: Member) => {
      const a = actorFor(ctx, m.id);
      return !!a && canViewTask(a, t, g.has(m.id));
    };
    const speed = t.priority === "urgent" ? "urgent" : "normal";
    const cycleRows = blockers.filter((b) => b.task_id === t.id);
    const open = cycleRows.filter((b) => !b.resolved_at);
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

    // 2. Due soon / overdue, on the assignee's own working time: what he
    // spent waiting on others this cycle is given back. While a blocker is
    // open the task waits on its resolver, so the assignee is not chased for
    // it, unless he holds that blocker himself (an account manager waiting on
    // her own client). The keys stay per due date: overdue fires once, when
    // his own time runs out.
    const waitingOnOthers = open.some((b) => waitsOnOthers(t, b, assignee.role));
    const own = WORKING_STATUSES.includes(t.status as TaskStatus) && t.due_at && !waitingOnOthers ? ownDeadline(ctx, t, cycleRows, assignee.role) : null;
    if (own?.due && t.due_at) {
      const soon = ctx.rules.dueSoonMinutes[speed];
      const given = own.waited ? " بعد احتساب وقت الانتظار" : "";
      // Working minutes left, counted only once the deadline is that close; a
      // night run (urgent work) also waits until it is close on the clock.
      if (ctx.now < own.due && own.due <= soonBound[speed] && (inHours || own.due.getTime() - ctx.now.getTime() <= soon * 60_000)) {
        const left = inHours ? businessMinutesBetween(ctx.now, own.due, ctx.workHours) : Math.ceil((own.due.getTime() - ctx.now.getTime()) / 60_000);
        const body = own.waited ? `${client.name} · بقي ${fmtBusinessDuration(left)} عمل${given}` : `${client.name} · الموعد ${fmtTime(t.due_at, tz)}`;
        if (left > 0 && left <= soon) push({ userId: assignee.id, task: ref, kind: "due_soon", title: `يقترب موعد التسليم: ${t.title}`, body, url, dedupeKey: `due_soon:${t.id}:${t.cycle}:${t.due_version}` });
      }
      if (own.overdueOwn) {
        push({ userId: assignee.id, task: ref, kind: "overdue", title: `تجاوزت موعدها: ${t.title}`, body: `${client.name} · كان الموعد ${fmtTime(t.due_at, tz)}${own.waited ? ` ·${given}` : ""}`, url, dedupeKey: `overdue:${t.id}:${t.cycle}:${t.due_version}` });
        const first = chain[0];
        if (first) push({ userId: first.id, task: ref, kind: "overdue_escalation", title: `تجاوزت موعدها: ${t.title}`, body: `${assignee.name} · ${client.name}${own.waited ? ` ·${given}` : ""}`, url, dedupeKey: `overdue_esc:${t.id}:${t.cycle}:${t.due_version}` });
      }
    }

    // 2b. What goes into the assignee's start-of-day summary: work due today
    // on his own time, or already past it.
    if (summaryDay && own?.due && own.due < summaryDay.end && assignee.active && sees(assignee)) {
      summary.set(assignee.id, [...(summary.get(assignee.id) ?? []), { title: t.title, due: own.due.getTime() }]);
    }

    // 3. Open blockers: follow up with the resolver, then the person above him.
    for (const b of open) {
      // Follow-ups go to someone who can still open the task.
      const named = ctx.membersById.get(b.resolver_id);
      const requester = ctx.membersById.get(t.requester_id);
      const resolver = named && sees(named) ? named : requester && sees(requester) ? requester : null;
      if (!resolver) continue;
      const follow = ctx.rules.blockerFollowMinutes[speed];
      const since = b.resolver_since && b.resolver_since > b.opened_at ? b.resolver_since : b.opened_at;
      const elapsed = businessMinutesBetween(new Date(since), ctx.now, ctx.workHours);
      const label = b.kind === "client_wait" ? "بانتظار العميل" : b.kind === "clarification" ? "طلب توضيح" : "عائق";
      // Keys carry the holder and since when he holds it, so a blocker that
      // moves (or comes back) is followed up afresh with its current holder.
      const stint = `${resolver.id}:${since}`;
      if (elapsed >= follow) {
        push({ userId: resolver.id, task: ref, kind: "blocker_follow", title: `${label} ما زال مفتوحاً: ${t.title}`, body: `${b.reason.slice(0, 120)} · منذ ${fmtBusinessDuration(elapsed)} عمل`, url, refId: b.id, dedupeKey: `blocker_follow:${b.id}:${stint}:1` });
      }
      if (elapsed >= follow * 2) {
        const up = above(resolver);
        if (up) push({ userId: up.id, task: ref, kind: "blocker_escalation", title: `${label} عند ${resolver.name} ما زال مفتوحاً: ${t.title}`, body: b.reason.slice(0, 120), url, refId: b.id, dedupeKey: `blocker_follow:${b.id}:${stint}:2` });
      }
    }

    // 4. Waiting for review.
    if (t.status === "in_review" && t.submitted_at) {
      const reviewer = ctx.membersById.get(t.reviewer_id);
      const [remind, escalate] = ctx.rules.reviewMinutes[speed];
      const since = t.reviewer_since && t.reviewer_since > t.submitted_at ? t.reviewer_since : t.submitted_at;
      const elapsed = businessMinutesBetween(new Date(since), ctx.now, ctx.workHours);
      if (reviewer && elapsed >= remind) {
        push({ userId: reviewer.id, task: ref, kind: "review_reminder", title: `بانتظار مراجعتك منذ ${fmtBusinessDuration(elapsed)}: ${t.title}`, body: `${assignee.name} · ${client.name}`, url, dedupeKey: `review:${t.id}:${t.cycle}:${t.review_round}:${t.reviewer_id}:${since}:0` });
      }
      if (reviewer && escalate && elapsed >= escalate) {
        const up = above(reviewer);
        if (up) push({ userId: up.id, task: ref, kind: "review_escalation", title: `مراجعة متأخرة عند ${reviewer.name}: ${t.title}`, body: `${client.name} · منذ ${fmtBusinessDuration(elapsed)} عمل`, url, dedupeKey: `review:${t.id}:${t.cycle}:${t.review_round}:${t.reviewer_id}:${since}:1` });
      }
    }
  }

  // 5. One start-of-day summary per member, once a day.
  if (summaryDay) {
    for (const [userId, items] of summary) {
      items.sort((a, b) => a.due - b.due);
      const n = items.length;
      const count = n === 1 ? "مهمة واحدة عليك تسليمها" : n === 2 ? "مهمتان عليك تسليمهما" : `${n} ${n > 10 ? "مهمة" : "مهام"} عليك تسليمها`;
      const names = items
        .slice(0, 3)
        .map((i) => `«${i.title.slice(0, 80)}»`)
        .join("، ");
      noteIdx.push(stmts.length);
      stmts.push(
        ...notifyStmts(ctx, { userId, task: null, kind: "daily_summary", title: `ملخص اليوم: ${count} اليوم`, body: n > 3 ? `${names} و…` : names, url: "/", dedupeKey: `daily_summary:${userId}:${summaryDay.key}`, deliverAt: ctx.now }),
      );
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

type OutboxRow = { id: string; user_id: string; task_id: string | null; task_cycle: number | null; attempts: number; notification_id: string };
type NoteRow = { id: string; kind: string; url: string | null; ref_id: string | null; cancelled_at: string | null };

const BACKOFF_MIN = [1, 5, 15];
const MAX_ATTEMPTS = 4;
// Push requests per run. Each one costs about a millisecond of CPU for its
// encryption and signature, and Workers Free allows 10 ms of CPU and 50
// outbound requests per invocation; the cron runs every minute, so the rest
// simply go out on the next runs.
export const FETCH_BUDGET = 8;

/**
 * Deliver due outbox entries to devices. At-least-once: a crash mid-send can
 * repeat a push, never lose the in-app record. A fixed number of D1 queries
 * per run however many rows are due, and at most FETCH_BUDGET push requests;
 * rows beyond the budget are released for the next run.
 */
export async function drainOutbox(ctx: Ctx, limit = 20): Promise<{ sent: number; skipped: number; failed: number; cancelled: number; retried: number }> {
  const stats = { sent: 0, skipped: 0, failed: 0, cancelled: 0, retried: 0 };
  const nowIso = ctx.now.toISOString();
  // Rows that kept dying mid-run (attempts beyond the limit) are given up on.
  await ctx.db.prepare("update outbox set status = 'failed', last_error = coalesce(last_error, 'too_many_attempts') where status = 'pending' and attempts >= ?").bind(MAX_ATTEMPTS + 2).run();
  // Claim a batch in one statement: an overlapping run sees these rows leased for three minutes.
  const lease = new Date(ctx.now.getTime() + 3 * 60_000).toISOString();
  const { results: claimed } = await ctx.db
    .prepare(
      `update outbox set attempts = attempts + 1, next_attempt_at = ?
       where id in (select id from outbox where status = 'pending' and next_attempt_at <= ? order by next_attempt_at limit ?)
       returning id, user_id, task_id, task_cycle, attempts, notification_id`,
    )
    .bind(lease, nowIso, limit)
    .all<OutboxRow>();
  if (!claimed.length) return stats;

  const list = (xs: (string | null)[]) => JSON.stringify([...new Set(xs.filter((x): x is string => !!x))]);
  const taskIds = list(claimed.map((o) => o.task_id));
  const [notes, tasks, grantRows, subs, origin] = await Promise.all([
    ctx.db.prepare("select id, kind, url, ref_id, cancelled_at from notifications where id in (select value from json_each(?))").bind(list(claimed.map((o) => o.notification_id))).all<NoteRow>(),
    ctx.db.prepare("select * from tasks where id in (select value from json_each(?))").bind(taskIds).all<TaskRow>(),
    ctx.db.prepare("select task_id, user_id from task_grants where task_id in (select value from json_each(?))").bind(taskIds).all<{ task_id: string; user_id: string }>(),
    ctx.db.prepare("select id, user_id, endpoint, p256dh, auth from push_subscriptions where revoked_at is null and user_id in (select value from json_each(?))").bind(list(claimed.map((o) => o.user_id))).all<SubRow & { user_id: string }>(),
    ctx.db.prepare("select value from settings where key = 'app_origin'").first<{ value: string }>(),
  ]);
  const noteById = new Map(notes.results.map((n) => [n.id, n]));
  const refIds = list(notes.results.map((n) => n.ref_id));
  const blockers = await ctx.db.prepare("select id, resolved_at from blockers where id in (select value from json_each(?))").bind(refIds).all<{ id: string; resolved_at: string | null }>();
  const blockerOpen = new Map(blockers.results.map((b) => [b.id, !b.resolved_at]));
  const taskById = new Map(tasks.results.map((t) => [t.id, t]));
  const grants = new Map<string, Set<string>>();
  for (const g of grantRows.results) grants.set(g.task_id, (grants.get(g.task_id) ?? new Set()).add(g.user_id));
  const subsByUser = new Map<string, SubRow[]>();
  for (const sub of subs.results) subsByUser.set(sub.user_id, [...(subsByUser.get(sub.user_id) ?? []), sub]);
  const subject = origin?.value ?? "mailto:admin@agency-followup.invalid";

  // Status writes go out every three rows or so, so a run that dies part-way
  // repeats at most the rows since the last flush.
  let writes: D1PreparedStatement[] = [];
  const flush = async () => {
    for (let i = 0; i < writes.length; i += 80) await ctx.db.batch(writes.slice(i, i + 80));
    writes = [];
  };
  const setStatus = (id: string, status: string, err: string | null) =>
    writes.push(ctx.db.prepare("update outbox set status = ?, last_error = ?, sent_at = case when ? = 'sent' then ? else sent_at end where id = ?").bind(status, err, status, nowIso, id));

  let fetches = 0;
  for (const [i, o] of claimed.entries()) {
    const n = noteById.get(o.notification_id);
    const reason = !n ? "cancelled" : irrelevance(ctx, o, n, o.task_id ? (taskById.get(o.task_id) ?? null) : null, grants.get(o.task_id ?? "") ?? new Set(), blockerOpen);
    if (reason || !n) {
      setStatus(o.id, "cancelled", reason ?? "cancelled");
      stats.cancelled++;
      continue;
    }
    const devices = subsByUser.get(o.user_id) ?? [];
    if (fetches + devices.length > FETCH_BUDGET) {
      // Out of push requests for this run: hand the rest back untouched.
      const rest = claimed.slice(i).map((x) => x.id);
      writes.push(ctx.db.prepare("update outbox set attempts = attempts - 1, next_attempt_at = ? where id in (select value from json_each(?)) and status = 'pending'").bind(nowIso, JSON.stringify(rest)));
      break;
    }
    fetches += devices.length;
    const { result: r, stmts, gone } = await deliver(
      ctx,
      devices,
      { title: "متابعة الوكالة", body: PUSH_TEXT[n.kind] ?? "تنبيه جديد", url: n.url ?? "/notifications", tag: o.task_id ?? o.notification_id },
      subject,
      n.kind.includes("escalation") || n.kind === "assigned" ? "high" : "normal",
    );
    writes.push(...stmts);
    // A device the push service says is gone is not tried again in this run.
    if (gone.length) subsByUser.set(o.user_id, devices.filter((d) => !gone.includes(d.id)));
    if (r.sent > 0) {
      setStatus(o.id, "sent", r.failed ? r.errors.join("; ").slice(0, 300) : null);
      stats.sent++;
    } else if (r.devices === 0 || r.errors.includes("push_not_configured") || (r.devices === r.gone && r.failed === 0)) {
      setStatus(o.id, "skipped", r.errors.includes("push_not_configured") ? "push_not_configured" : "no_device");
      stats.skipped++;
    } else if (r.retryable && o.attempts < MAX_ATTEMPTS) {
      // `attempts` already counts this try (the claim incremented it).
      const next = new Date(ctx.now.getTime() + BACKOFF_MIN[Math.min(o.attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
      writes.push(ctx.db.prepare("update outbox set next_attempt_at = ?, last_error = ? where id = ?").bind(next, r.errors.join("; ").slice(0, 300), o.id));
      stats.retried++;
    } else {
      setStatus(o.id, "failed", r.errors.join("; ").slice(0, 300));
      stats.failed++;
    }
    if (writes.length >= 6) await flush();
  }
  await flush();
  return stats;
}

/** Why a queued delivery should no longer go out, or null if it still should. */
function irrelevance(ctx: Ctx, o: OutboxRow, n: NoteRow, t: TaskRow | null, taskGrants: Set<string>, blockerOpen: Map<string, boolean>): string | null {
  if (n.cancelled_at) return "cancelled";
  const member = actorFor(ctx, o.user_id);
  if (!member || !member.active) return "member_inactive";
  if (!o.task_id) return null;
  if (!t || t.archived_at) return "task_gone";
  if (!canViewTask(member, t, taskGrants.has(member.id))) return "no_longer_visible";
  const cycleMatches = o.task_cycle === null || o.task_cycle === t.cycle;
  if (ACK_KINDS.includes(n.kind) && (t.status !== "new" || !cycleMatches)) return "already_acknowledged";
  if (DUE_KINDS.includes(n.kind) && (!WORKING_STATUSES.includes(t.status as TaskStatus) || !cycleMatches)) return "no_longer_due";
  if (REVIEW_KINDS.includes(n.kind) && (t.status !== "in_review" || !cycleMatches)) return "already_reviewed";
  if (n.kind === "reassigned" && !cycleMatches) return "reassigned_again";
  if ((BLOCKER_KINDS_N.includes(n.kind) || n.kind === "clarification") && n.ref_id && !blockerOpen.get(n.ref_id)) return "blocker_resolved";
  return null;
}

// Cleanup follows the wall clock, not the injectable reminder clock, so a
// test that moves `now` forward cannot expire real sessions. It runs at most
// once an hour; every statement uses an index, so the minute-by-minute cron
// stays far below D1's daily read allowance.
async function housekeeping(ctx: Ctx) {
  const now = new Date();
  const last = await ctx.db.prepare("select value from settings where key = 'housekeeping_at'").first<{ value: string }>();
  if (last && now.getTime() - Date.parse(last.value) < 3_600_000) return;
  const day = new Date(now.getTime() - 86_400_000).toISOString();
  await ctx.db.batch([
    ctx.db.prepare("insert into settings (key, value, updated_at) values ('housekeeping_at', ?, ?) on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at").bind(now.toISOString(), now.toISOString()),
    ctx.db.prepare("delete from request_limits where window_start < ?").bind(day),
    ctx.db.prepare("delete from scheduler_runs where started_at < ?").bind(day),
    ctx.db.prepare(`delete from "session" where "expiresAt" < ?`).bind(now.toISOString()),
    ctx.db.prepare(`delete from "rateLimit" where "lastRequest" < ?`).bind(now.getTime() - 86_400_000),
    // A device whose session ended (expired or signed out elsewhere) stops receiving the account's pushes.
    ctx.db.prepare(`update push_subscriptions set revoked_at = ? where revoked_at is null and session_id is not null and session_id not in (select id from "session")`).bind(now.toISOString()),
  ]);
}
