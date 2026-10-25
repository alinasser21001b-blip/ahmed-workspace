// Notifications are rows in D1 first; delivery to devices goes through the
// outbox, which the cron drains with retries. Every notification has a
// dedupe key, so the scheduler can run as often as it likes (or twice at the
// same minute) and still create each reminder once.

import type { Ctx, TaskRow } from "./db";
import { randomId } from "./lib/crypto";
import { isBusinessTime, nextBusinessStart } from "./lib/time";

export type NotifyInput = {
  userId: string;
  task?: Pick<TaskRow, "id" | "cycle" | "priority"> | null;
  kind: string;
  title: string;
  body: string;
  url?: string | null;
  refId?: string | null;
  dedupeKey: string;
  /** Also deliver to the member's devices. In-app only when false. */
  push?: boolean;
  deliverAt?: Date;
};

/** Now during working hours; otherwise the next working start (urgent work may be allowed through). */
export function deliveryTime(ctx: Ctx, priority?: string): Date {
  if (isBusinessTime(ctx.now, ctx.workHours)) return ctx.now;
  if (priority === "urgent" && ctx.rules.urgentOutsideHours) return ctx.now;
  return nextBusinessStart(ctx.now, ctx.workHours);
}

export function notifyStmts(ctx: Ctx, n: NotifyInput): D1PreparedStatement[] {
  const id = randomId("n_");
  const now = ctx.now.toISOString();
  const at = (n.deliverAt ?? deliveryTime(ctx, n.task?.priority)).toISOString();
  const taskId = n.task?.id ?? null;
  const cycle = n.task?.cycle ?? null;
  const out = [
    ctx.db
      .prepare(
        `insert into notifications (id, user_id, task_id, kind, title, body, url, task_cycle, ref_id, deliver_at, created_at, dedupe_key)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (dedupe_key) do nothing`,
      )
      .bind(id, n.userId, taskId, n.kind, n.title.slice(0, 200), n.body.slice(0, 500), n.url ?? null, cycle, n.refId ?? null, at, now, n.dedupeKey),
  ];
  if (n.push !== false) {
    out.push(
      ctx.db
        .prepare(
          `insert into outbox (id, notification_id, user_id, task_id, task_cycle, status, attempts, next_attempt_at, created_at)
           select ?, ?, ?, ?, ?, 'pending', 0, ?, ? where exists (select 1 from notifications where id = ?)`,
        )
        .bind(randomId("o_"), id, n.userId, taskId, cycle, at, now, id),
    );
  }
  return out;
}

/** Notify several people, skipping the actor and duplicates. */
export function notifyMany(ctx: Ctx, userIds: (string | null | undefined)[], actorId: string | null, make: (userId: string) => Omit<NotifyInput, "userId">): D1PreparedStatement[] {
  const seen = new Set<string>();
  const out: D1PreparedStatement[] = [];
  for (const u of userIds) {
    if (!u || u === actorId || seen.has(u)) continue;
    seen.add(u);
    out.push(...notifyStmts(ctx, { userId: u, ...make(u) }));
  }
  return out;
}

/**
 * Cancel what has not gone out yet for a task: device deliveries still in
 * the outbox, and in-app notifications whose delivery time has not come.
 * Delivered notifications stay as history.
 */
export function cancelPendingStmts(ctx: Ctx, taskId: string, filter: { kinds?: string[]; userId?: string; beforeCycle?: number; refId?: string } = {}): D1PreparedStatement[] {
  const conds = ["n.task_id = ?"];
  const params: unknown[] = [taskId];
  if (filter.kinds?.length) {
    conds.push(`n.kind in (${filter.kinds.map(() => "?").join(", ")})`);
    params.push(...filter.kinds);
  }
  if (filter.userId) {
    conds.push("n.user_id = ?");
    params.push(filter.userId);
  }
  if (filter.beforeCycle !== undefined) {
    conds.push("n.task_cycle < ?");
    params.push(filter.beforeCycle);
  }
  if (filter.refId) {
    conds.push("n.ref_id = ?");
    params.push(filter.refId);
  }
  const where = conds.join(" and ");
  const now = ctx.now.toISOString();
  return [
    ctx.db
      .prepare(`update outbox set status = 'cancelled', last_error = 'superseded' where status = 'pending' and notification_id in (select n.id from notifications n where ${where})`)
      .bind(...params),
    ctx.db.prepare(`update notifications set cancelled_at = ? where cancelled_at is null and deliver_at > ? and id in (select n.id from notifications n where ${where})`).bind(now, now, ...params),
  ];
}

// Reminder kinds are re-checked against the task before they go to a device.
export const ACK_KINDS = ["assigned", "ack_reminder", "ack_escalation"];
export const DUE_KINDS = ["due_soon", "overdue", "overdue_escalation"];
export const REVIEW_KINDS = ["review_reminder", "review_escalation"];
export const BLOCKER_KINDS_N = ["blocker_opened", "blocker_follow", "blocker_escalation"];

/** Short lock-screen text: no client name, no task title, nothing sensitive. */
export const PUSH_TEXT: Record<string, string> = {
  assigned: "مهمة جديدة بانتظار استلامك",
  ack_reminder: "تذكير: مهمة لم تستلمها بعد",
  ack_escalation: "مهمة في فريقك لم تُستلم بعد",
  due_soon: "موعد تسليم يقترب",
  overdue: "مهمة تجاوزت موعدها",
  overdue_escalation: "مهمة في فريقك تجاوزت موعدها",
  daily_summary: "ملخص اليوم: مواعيد تسليم قريبة",
  blocker_opened: "عائق بانتظار حلك",
  blocker_follow: "متابعة: عائق ما زال مفتوحاً",
  blocker_escalation: "عائق في فريقك ما زال مفتوحاً",
  clarification: "طلب توضيح بانتظارك",
  clarification_answered: "وصل التوضيح المطلوب",
  submitted: "عمل بانتظار مراجعتك",
  review_reminder: "تذكير: عمل بانتظار مراجعتك",
  review_escalation: "مراجعة متأخرة في فريقك",
  approved: "اعتُمد عملك",
  changes_requested: "مطلوب تعديل على عملك",
  due_changed: "تغيّر موعد مهمة",
  due_proposal: "اقتراح موعد بانتظار قرارك",
  due_decided: "صدر قرار على الموعد المقترح",
  reassigned: "مهمة أُسندت إليك",
  reassigned_away: "أُسندت مهمة إلى شخص آخر",
  cancelled: "أُلغيت مهمة",
  escalated: "تصعيد بانتظار انتباهك",
  booking_created: "حجز تصوير جديد",
  booking_changed: "تغيّر موعد حجز",
  booking_cancelled: "أُلغي حجز",
  comment: "تعليق جديد",
  test: "إشعار تجريبي من متابعة الوكالة",
};
