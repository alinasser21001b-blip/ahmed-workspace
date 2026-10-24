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
  flags: {
    waiting_ack: boolean;
    overdue: boolean;
    at_risk: boolean;
    blocked: boolean;
    blocked_kind: "internal" | "client_wait" | "clarification" | null;
    external_wait: boolean;
    late_business_minutes: number;
    unacked_business_minutes: number;
  };
};

export function FlagChips({ t }: { t: TaskSummary }) {
  const f = t.flags;
  return (
    <div className="row chips" style={{ gap: 6 }}>
      {t.is_demo ? <span className="chip demo">تجريبي</span> : null}
      {f.waiting_ack ? (
        <span className="chip info">
          <IClock />
          لم تُستلم{f.unacked_business_minutes > 0 ? ` · ${fmtMinutes(f.unacked_business_minutes)} عمل` : ""}
        </span>
      ) : null}
      {f.overdue && !f.blocked ? (
        <span className="chip danger">
          <IAlert />
          متأخرة
        </span>
      ) : null}
      {f.overdue && f.blocked ? (
        <span className="chip warn">
          <IAlert />
          تجاوزت الموعد أثناء العائق
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
          {f.blocked_kind === "client_wait" ? "بانتظار العميل" : f.blocked_kind === "clarification" ? "بانتظار توضيح" : "متوقفة بعائق"}
        </span>
      ) : null}
      {f.external_wait ? <span className="chip">لا يُحتسب على المنفذ</span> : null}
    </div>
  );
}

export function TaskCard({ t, showAssignee = true }: { t: TaskSummary; showAssignee?: boolean }) {
  return (
    <Link to={`/tasks/${t.id}`} className="task-card">
      <div className="row-between">
        <span className="client">{t.client.name}</span>
        <StatusBadge status={t.status} />
      </div>
      <div className="title">{t.title}</div>
      <div className="meta">
        {showAssignee && t.assignee ? <span>المنفذ: {t.assignee.name}</span> : null}
        {t.due_at ? <span className={t.flags.overdue ? "prio-urgent" : ""}>الموعد: {fmtDue(t.due_at)}</span> : <span>بلا موعد</span>}
        <PriorityText p={t.priority} />
      </div>
      {t.next_step ? <div className="next">الخطوة التالية: {t.next_step}</div> : null}
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
