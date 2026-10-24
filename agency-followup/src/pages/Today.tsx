import { useState } from "react";
import { api } from "../lib/api";
import { Link, useTitle } from "../lib/router";
import { useMe } from "../lib/session";
import { fmtDay, fmtDue, fmtTime, parts } from "../lib/time";
import { IAlert, ICamera, IPlus } from "../ui/icons";
import { ErrorBox, Loading, useApi } from "../ui/kit";
import { TaskList, type TaskSummary } from "../ui/TaskCard";

export type Booking =
  | { id: string; starts_at: string; ends_at: string; resource_id: string; busy_only: true; title: string }
  | { id: string; starts_at: string; ends_at: string; resource_id: string; resource: string; busy_only: false; title: string; client: { id: string; name: string }; task_id: string | null; created_by: string; can_manage: boolean };

type Today = {
  role: string;
  clients: { id: string; name: string }[];
  counts: Record<"waiting_ack" | "overdue" | "at_risk" | "blocked" | "awaiting_me", number>;
  sections: { key: string; title: string; hint?: string; empty: string; tasks: TaskSummary[] }[];
  bookings: Booking[];
  conflicts: { kind: string; at: string; text: string; task_id?: string | null }[];
  work_hours: { assumed?: boolean };
};

const GREETING = () => (parts(new Date()).h < 12 ? "صباح الخير" : "مساء الخير");

export function TodayPage() {
  useTitle("اليوم");
  const me = useMe();
  const role = me.user.role;
  const [client, setClient] = useState<string>("");
  const { data, error, loading, reload } = useApi<Today>((signal) => api(`/api/today${client ? `?client=${client}` : ""}`, { signal }), [client], { pollMs: 60_000 });

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>
            {GREETING()}، {me.user.name}
          </h1>
          <p className="sub">{fmtDay(new Date().toISOString())}</p>
        </div>
        {role !== "photographer" ? (
          <Link to="/tasks/new" className="btn primary small">
            <IPlus />
            مهمة
          </Link>
        ) : null}
      </div>

      {role === "exec" || role === "owner" ? (
        <div className="seg" role="group" aria-label="تصفية حسب العميل">
          <button aria-pressed={client === ""} onClick={() => setClient("")}>
            كل العملاء
          </button>
          {me.clients.map((c) => (
            <button key={c.id} aria-pressed={client === c.id} onClick={() => setClient(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <Loading rows={4} /> : null}
      {error && !data ? <ErrorBox error={error} retry={reload} /> : null}
      {data ? (
        <>
          {role === "owner" || role === "exec" ? <Counters c={data.counts} /> : null}
          {data.sections.map((s, i) => (
            <div key={s.key} className="stack-lg">
              <section aria-labelledby={`s-${s.key}`}>
                <div className="section-title">
                  <h2 id={`s-${s.key}`}>
                    {s.title}
                    <span className="count">{s.tasks.length}</span>
                  </h2>
                </div>
                {s.hint ? <p className="section-hint">{s.hint}</p> : null}
                <TaskList tasks={s.tasks} empty={s.empty} showAssignee={role !== "photographer"} />
              </section>
              {role === "photographer" && i === 1 ? <MyBookings bookings={data.bookings} /> : null}
            </div>
          ))}
          {role === "owner" || role === "exec" ? <Conflicts items={data.conflicts} /> : null}
          {role === "account_manager" ? <MyBookings bookings={data.bookings} title="مواعيد حسين القريبة" /> : null}
        </>
      ) : null}
    </div>
  );
}

function Counters({ c }: { c: Today["counts"] }) {
  const items: [keyof Today["counts"], string, string][] = [
    ["waiting_ack", "لم تُستلم", c.waiting_ack ? "warm" : ""],
    ["overdue", "متأخرة", c.overdue ? "hot" : ""],
    ["at_risk", "معرّضة للتأخر", c.at_risk ? "warm" : ""],
    ["awaiting_me", "بانتظار قراري", c.awaiting_me ? "warm" : ""],
    ["blocked", "متوقفة بعائق", c.blocked ? "warm" : ""],
  ];
  return (
    <div className="counters">
      {items.map(([k, label, cls]) => (
        <a key={k} href={`#s-${k}`} className={`counter ${cls}`}>
          <div className="n">{c[k]}</div>
          <div className="l">{label}</div>
        </a>
      ))}
    </div>
  );
}

function MyBookings({ bookings, title = "حجوزاتي" }: { bookings: Booking[]; title?: string }) {
  return (
    <section>
      <div className="section-title">
        <h2>
          {title}
          <span className="count">{bookings.length}</span>
        </h2>
        <Link to="/calendar" className="small">
          التقويم
        </Link>
      </div>
      {!bookings.length ? <p className="empty-line">لا حجوزات خلال الأيام السبعة القادمة.</p> : null}
      <div className="stack" style={{ gap: 6 }}>
        {bookings.slice(0, 8).map((b) => (
          <div key={b.id} className={`slot ${b.busy_only ? "busy" : ""}`}>
            <div className="time">
              <span>{fmtTime(b.starts_at)}</span>
              <span className="muted">حتى {fmtTime(b.ends_at)}</span>
            </div>
            <div>
              <div style={{ fontWeight: 600 }}>{b.busy_only ? "مشغول" : b.title}</div>
              <div className="small muted">
                {fmtDue(b.starts_at).split(" ")[0]} {b.busy_only ? "" : `· ${b.client.name}`}
              </div>
              {!b.busy_only && b.task_id ? (
                <Link to={`/tasks/${b.task_id}`} className="small">
                  فتح المهمة
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Conflicts({ items }: { items: Today["conflicts"] }) {
  return (
    <section>
      <div className="section-title">
        <h2>
          تعارضات وقت حسين<span className="count">{items.length}</span>
        </h2>
      </div>
      {!items.length ? <p className="empty-line">لا تعارضات في وقت حسين.</p> : null}
      <div className="stack" style={{ gap: 6 }}>
        {items.map((c, i) => (
          <div key={i} className="card card-tight row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
            {c.kind === "refused_booking" ? <ICamera width={20} /> : <IAlert width={20} />}
            <div>
              <div>{c.text}</div>
              <div className="small muted">{fmtDue(c.at)}</div>
              {c.task_id ? (
                <Link to={`/tasks/${c.task_id}`} className="small">
                  فتح المهمة
                </Link>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
