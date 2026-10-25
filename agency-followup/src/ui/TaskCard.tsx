import { Link } from "../lib/router";
import { fmtDue, fmtMinutes } from "../lib/time";
import { IAlert, IClock, IPause } from "./icons";
import { PriorityText, StatusBadge } from "./kit";

export type TaskSummary = {
  id: string;
  title: string;
  client: { id: string; name: string };
  template: string | null;
  status: string;
  priority: string;
  assignee: { id: string; name: string } | null;
  requester: { id: string; name: string } | null;
  reviewer: { id: string; name: string } | null;
  due_at: string | null;
  original_due_at: string | null;
  next_step: string;
  is_demo: boolean;
  archived_at: string | null;
  version: number;
  created_at: string;
  // Mirrors TaskFlags in worker/views.ts. The newer fields are optional so a
  // payload from an older server still renders (read them with ??).
  flags: {
    waiting_ack: boolean;
    /** A working task past its due time (a fact, kept until handled). */
    overdue: boolean;
    /** Past the deadline on the assignee's own working time: business minutes spent waiting on others are given back. */
    overdue_own?: boolean;
    waited_business_minutes?: number;
    at_risk: boolean;
    blocked: boolean;
    blocked_kind: "internal" | "client_wait" | "clarification" | null;
    /** Who must clear the first open blocker. */
    blocker_resolver?: { id: string; name: string } | null;
    /** An open client wait that waits on others (not the assignee himself): not counted against the assignee. */
    external_wait: boolean;
    /** The assignee's own late minutes (0 when not overdue). */
    late_business_minutes: number;
    unacked_business_minutes: number;
  };
};

/** Late on the assignee's own time. An older server sends only `overdue`. */
const lateOwn = (f: TaskSummary["flags"]) => f.overdue_own ?? f.overdue;

/** The next step someone typed, or one derived from the status and the open blocker (spec 27, 146). '' when the task is finished. */
export function nextStepOf(t: TaskSummary): string {
  if (t.next_step) return t.next_step;
  if (t.status === "done" || t.status === "cancelled") return "";
  const f = t.flags;
  const by = (label: string, p: { name: string } | null | undefined) => (p ? `${label}: ${p.name}` : label);
  if (f.blocked) {
    const r = f.blocker_resolver?.name;
    if (f.blocked_kind === "client_wait") return r ? `بانتظار رد العميل (المتابعة: ${r})` : "بانتظار رد العميل";
    if (f.blocked_kind === "clarification") return r ? `بانتظار توضيح من ${r}` : "بانتظار توضيح";
    return by("حل العائق", f.blocker_resolver);
  }
  switch (t.status) {
    case "new": return by("الاستلام", t.assignee);
    case "acknowledged": return by("بدء التنفيذ", t.assignee);
    case "in_progress": return by("التسليم للمراجعة", t.assignee);
    case "in_review": return by("المراجعة", t.reviewer);
    case "changes_requested": return by("تنفيذ التعديلات", t.assignee);
  }
  return "";
}

function blockedText(f: TaskSummary["flags"]): string {
  const r = f.blocker_resolver?.name;
  if (f.blocked_kind === "client_wait") return r ? `بانتظار العميل · المتابعة: ${r}` : "بانتظار العميل";
  if (f.blocked_kind === "clarification") return r ? `بانتظار توضيح من ${r}` : "بانتظار توضيح";
  return r ? `متوقفة بعائق · عند: ${r}` : "متوقفة بعائق";
}

export function FlagChips({ t }: { t: TaskSummary }) {
  const f = t.flags;
  const own = lateOwn(f);
  // Past the date only because of time spent waiting on others: not his delay.
  // Late on his own time stays «متأخرة», even if a blocker opened afterwards.
  const lateByWait = f.overdue && !own;
  return (
    <div className="row chips" style={{ gap: 6 }}>
      {t.is_demo ? <span className="chip demo">تجريبي</span> : null}
      {f.waiting_ack ? (
        <span className="chip info">
          <IClock />
          لم تُستلم{f.unacked_business_minutes > 0 ? ` · ${fmtMinutes(f.unacked_business_minutes)} عمل` : ""}
        </span>
      ) : null}
      {f.overdue && own ? (
        <span className="chip danger">
          <IAlert />
          متأخرة{f.late_business_minutes > 0 ? ` · ${fmtMinutes(f.late_business_minutes)} عمل` : ""}
        </span>
      ) : null}
      {lateByWait && f.blocked ? (
        <span className="chip warn">
          <IAlert />
          تجاوزت الموعد أثناء العائق
        </span>
      ) : null}
      {lateByWait && !f.blocked ? (
        <span className="chip warn">
          <IAlert />
          تجاوزت الموعد بسبب الانتظار
        </span>
      ) : null}
      {f.at_risk ? (
        <span className="chip warn">
          <IClock />
          معرّضة للتأخر
        </span>
      ) : null}
      {f.blocked ? (
        <span className="chip warn">
          <IPause />
          {blockedText(f)}
        </span>
      ) : null}
      {(f.external_wait && !own) || lateByWait ? <span className="chip">لا يُحتسب على المنفذ</span> : null}
    </div>
  );
}

export function TaskCard({ t, showAssignee = true }: { t: TaskSummary; showAssignee?: boolean }) {
  const next = nextStepOf(t);
  return (
    <Link to={`/tasks/${t.id}`} className="task-card">
      <div className="row-between">
        <span className="client">{t.client.name}</span>
        <StatusBadge status={t.status} />
      </div>
      <div className="title">{t.title}</div>
      <div className="meta">
        {showAssignee && t.assignee ? <span>المنفذ: {t.assignee.name}</span> : null}
        {t.due_at ? <span className={lateOwn(t.flags) ? "prio-urgent" : ""}>الموعد: {fmtDue(t.due_at)}</span> : <span>بلا موعد</span>}
        <PriorityText p={t.priority} />
      </div>
      {next ? <div className="next">الخطوة التالية: {next}</div> : null}
      <FlagChips t={t} />
    </Link>
  );
}

export function TaskList({ tasks, empty, showAssignee }: { tasks: TaskSummary[]; empty: string; showAssignee?: boolean }) {
  if (!tasks.length) return <p className="empty-line">{empty}</p>;
  return (
    <div className="task-list">
      {tasks.map((t) => (
        <TaskCard key={t.id} t={t} showAssignee={showAssignee} />
      ))}
    </div>
  );
}
