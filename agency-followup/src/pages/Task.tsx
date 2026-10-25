import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ACTION_LABEL, BLOCKER_LABEL, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, type BlockerKind, type TaskStatus } from "../../shared/domain";
import { api, ApiError, newKey } from "../lib/api";
import { Link, navigate, useLocation, useTitle } from "../lib/router";
import { useMe } from "../lib/session";
import { fmtAgo, fmtDateTime, fmtDue, fmtFull, isoToLocalInput, localInputToIso } from "../lib/time";
import { IBack, ICamera, ILink, IPlus } from "../ui/icons";
import { Alert, Button, ErrorBox, Field, Loading, PriorityText, Sheet, StatusBadge, useApi, useToast } from "../ui/kit";
import { FlagChips, nextStepOf, TaskList, type TaskSummary } from "../ui/TaskCard";
import type { Booking } from "./Today";

type Detail = {
  task: TaskSummary & {
    description: string;
    acceptance: string;
    ref_url: string | null;
    requires_publish: boolean;
    publish_url: string | null;
    cancel_reason: string | null;
    client_due_at: string | null;
    review_round: number;
    submitted_at: string | null;
    completed_at: string | null;
    acknowledged_at: string | null;
  };
  parent: { id: string; title: string } | null;
  shared_with: { id: string; name: string }[];
  client_wait_is_assignees?: boolean;
  can: Record<"ack" | "clarify" | "start" | "block" | "propose_due" | "submit" | "approve" | "request_changes" | "edit" | "cancel" | "decide_due" | "next_step" | "escalate" | "archive" | "comment", boolean> & { resolve_blocker: string[] };
  comments: { id: string; author: string; kind: string; body: string; created_at: string }[];
  deliverables: { id: string; url: string | null; evidence: string | null; version_label: string | null; review_round: number; submitted_by_name: string; created_at: string }[];
  blockers: { id: string; kind: BlockerKind; reason: string; resolver: string; opened_by_name: string; opened_at: string; expected_at: string | null; resolved_at: string | null; resolved_by_name: string | null; resolution: string | null }[];
  due_proposals: { id: string; proposed_due_at: string; reason: string; status: string; proposed_by_name: string; decided_by_name: string | null; decision_note: string | null; created_at: string }[];
  events: { id: number; type: string; data: Record<string, any>; actor: string | null; created_at: string }[];
  subtasks: TaskSummary[];
  bookings: Booking[];
};

type SheetKind = null | "clarify" | "block" | "propose_due" | "submit" | "approve" | "request_changes" | "cancel" | "escalate" | "next_step" | "edit" | { resolve: string } | { decide: string };

export function TaskPage({ id }: { id: string }) {
  const me = useMe();
  const toast = useToast();
  const { query } = useLocation();
  const { data, error, loading, reload } = useApi<Detail>((signal) => api(`/api/tasks/${id}`, { signal }), [id], { pollMs: 45_000 });
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useTitle(data?.task.title ?? "مهمة");

  if (loading) return <Loading rows={4} />;
  if (error && !data) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="stack">
          <Alert kind="warn">هذه المهمة غير موجودة أو لم تعد ضمن صلاحياتك (ربما أُعيد إسنادها).</Alert>
          <Link to="/">العودة إلى اليوم</Link>
        </div>
      );
    }
    return <ErrorBox error={error} retry={reload} />;
  }
  if (!data) return null;
  const t = data.task;
  const can = data.can;

  /** Send an action; report success only after the server confirms it. */
  const run = async (action: string, extra: Record<string, unknown> = {}, ok = "تم الحفظ.") => {
    setBusy(action);
    try {
      await api(`/api/tasks/${t.id}/actions/${action}`, { body: { version: t.version, ...extra } });
      toast("ok", ok);
      setSheet(null);
      reload();
      return true;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "تعذّر الحفظ";
      toast("error", msg);
      if (e instanceof ApiError && e.code === "version_conflict") reload();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const primary: ReactNode[] = [];
  if (can.ack) primary.push(<Button key="ack" className="primary" busy={busy === "ack"} onClick={() => run("ack", {}, "سُجّل الاستلام.")}>{ACTION_LABEL.ack}</Button>);
  if (can.start && t.status !== "new") primary.push(<Button key="start" className="primary" busy={busy === "start"} onClick={() => run("start", {}, "سُجّل البدء.")}>{ACTION_LABEL.start}</Button>);
  if (can.submit) primary.push(<Button key="submit" className={t.status === "in_progress" ? "primary" : ""} onClick={() => setSheet("submit")}>{ACTION_LABEL.submit}</Button>);
  if (can.approve) primary.push(<Button key="approve" className="primary" onClick={() => setSheet("approve")}>{ACTION_LABEL.approve}</Button>);
  if (can.request_changes) primary.push(<Button key="rc" onClick={() => setSheet("request_changes")}>{ACTION_LABEL.request_changes}</Button>);
  if (can.clarify) primary.push(<Button key="clarify" onClick={() => setSheet("clarify")}>{ACTION_LABEL.clarify}</Button>);
  if (can.block) primary.push(<Button key="block" onClick={() => setSheet("block")}>{ACTION_LABEL.block}</Button>);
  if (can.propose_due) primary.push(<Button key="pd" onClick={() => setSheet("propose_due")}>{ACTION_LABEL.propose_due}</Button>);
  if (can.start && t.status === "new") primary.push(<Button key="start-new" busy={busy === "start"} onClick={() => run("start", {}, "سُجّل الاستلام والبدء.")}>{ACTION_LABEL.start}</Button>);

  const next = nextStepOf(t);
  const openBlockers = data.blockers.filter((b) => !b.resolved_at);
  const closedBlockers = data.blockers.filter((b) => b.resolved_at);
  const pending = data.due_proposals.filter((p) => p.status === "pending");

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 8 }}>
        <button className="btn ghost small" style={{ alignSelf: "flex-start", paddingInline: 4 }} onClick={() => (history.length > 1 ? history.back() : navigate("/"))}>
          <IBack />
          رجوع
        </button>
        <div className="row" style={{ gap: 6 }}>
          <span className="client" style={{ color: "var(--accent-2)", fontWeight: 600, fontSize: "0.88rem" }}>{t.client.name}</span>
          <StatusBadge status={t.status} />
          <PriorityText p={t.priority} />
        </div>
        <h1 className="wrap">{t.title}</h1>
        {data.parent ? (
          <p className="small wrap">
            مهمة فرعية من: <Link to={`/tasks/${data.parent.id}`}>{data.parent.title}</Link>
          </p>
        ) : null}
        <FlagChips t={t} />
        {t.archived_at ? <Alert kind="info">هذه المهمة مؤرشفة.</Alert> : null}
        {t.status === "cancelled" && t.cancel_reason ? <Alert kind="info">أُلغيت: {t.cancel_reason}</Alert> : null}
      </div>

      {primary.length ? (
        <div className="actionbar" aria-label="الإجراءات">
          {primary}
        </div>
      ) : null}

      {query.get("book") === "1" && data.can.edit ? (
        <Alert kind="info">
          هذه مهمة تصوير. <Link to={`/calendar?task=${t.id}&client=${t.client.id}&title=${encodeURIComponent(t.title)}`}>احجز وقت حسين الآن</Link> حتى لا يتعارض مع عمل آخر.
        </Alert>
      ) : null}

      <section className="card stack">
        <div className="facts">
          <Fact k="المنفذ" v={t.assignee?.name} />
          <Fact k="صاحب الطلب" v={t.requester?.name} />
          <Fact k="المراجع" v={t.reviewer?.name} />
          <Fact k="موعد التسليم" v={t.due_at ? fmtFull(t.due_at) : "بلا موعد"} sub={t.original_due_at && t.original_due_at !== t.due_at ? `الموعد الأصلي: ${fmtDateTime(t.original_due_at)}` : undefined} />
          {t.client_due_at ? <Fact k="موعد العميل" v={fmtFull(t.client_due_at)} /> : null}
          <Fact k="الأولوية" v={PRIORITY_LABEL[t.priority as "normal"]} />
          {t.acknowledged_at ? <Fact k="استُلمت" v={fmtDateTime(t.acknowledged_at)} /> : null}
        </div>
        <div className="divider" />
        <div className="row-between">
          <div className="wrap">
            <div className="small muted">الخطوة التالية</div>
            <div>
              {next || <span className="muted">—</span>}
              {next && !t.next_step ? <span className="tiny muted"> (تلقائية)</span> : null}
            </div>
          </div>
          {can.next_step ? (
            <button className="btn small" onClick={() => setSheet("next_step")}>
              تحديث
            </button>
          ) : null}
        </div>
        {data.shared_with.length ? <p className="small muted">وصول خاص لهذه المهمة فقط: {data.shared_with.map((s) => s.name).join("، ")}</p> : null}
        <MoreActions can={can} onPick={setSheet} onArchive={() => run("archive", {}, "أُرشفت المهمة.")} />
      </section>

      {t.description || t.acceptance || t.ref_url ? (
        <section className="card stack">
          {t.description ? (
            <div>
              <h3>الوصف</h3>
              <p className="wrap" style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>
            </div>
          ) : null}
          {t.acceptance ? (
            <div>
              <h3>معيار القبول</h3>
              <p className="wrap" style={{ whiteSpace: "pre-wrap" }}>{t.acceptance}</p>
            </div>
          ) : null}
          {t.ref_url ? (
            <a href={t.ref_url} target="_blank" rel="noopener noreferrer" className="row">
              <ILink width={18} />
              الرابط المرجعي
            </a>
          ) : null}
          {t.requires_publish ? <p className="small muted">تتطلب رابط نشر قبل الإكمال.{t.publish_url ? " " : ""}{t.publish_url ? <a href={t.publish_url} target="_blank" rel="noopener noreferrer">رابط النشر</a> : null}</p> : null}
        </section>
      ) : null}

      {openBlockers.length || closedBlockers.length ? (
        <section className="stack">
          <h2>العوائق والتوضيحات</h2>
          {openBlockers.map((b) => (
            <div key={b.id} className="blocker stack" style={{ gap: 6 }}>
              <div className="row-between">
                <strong>{BLOCKER_LABEL[b.kind]}</strong>
                <span className="small muted">{fmtAgo(b.opened_at)}</span>
              </div>
              <p className="wrap" style={{ whiteSpace: "pre-wrap" }}>{b.reason}</p>
              <p className="small muted">
                سجّله {b.opened_by_name} · المسؤول عن الحل: {b.resolver}
                {b.expected_at ? ` · الحل المتوقع: ${fmtDue(b.expected_at)}` : ""}
              </p>
              {b.kind === "client_wait" ? <p className="small">الانتظار على العميل لا يُحتسب تأخيراً على المنفذ.</p> : null}
              {can.resolve_blocker.includes(b.id) ? (
                <span>
                  <button className="btn small primary" onClick={() => setSheet({ resolve: b.id })}>
                    {b.kind === "clarification" ? "أجب عن السؤال" : "تم الحل"}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
          {closedBlockers.length ? (
            <details className="more">
              <summary>عوائق محلولة ({closedBlockers.length})</summary>
              <div className="stack" style={{ marginTop: 8 }}>
                {closedBlockers.map((b) => (
                  <div key={b.id} className="blocker resolved small wrap">
                    <strong>{BLOCKER_LABEL[b.kind]}:</strong> {b.reason}
                    <div className="muted">
                      فُتح {fmtDateTime(b.opened_at)} · حُلّ {fmtDateTime(b.resolved_at!)} بواسطة {b.resolved_by_name}
                    </div>
                    {b.resolution ? <div>الحل: {b.resolution}</div> : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {data.due_proposals.length ? (
        <section className="stack">
          <h2>اقتراحات المواعيد</h2>
          {data.due_proposals.map((p) => (
            <div key={p.id} className="card card-tight stack" style={{ gap: 4 }}>
              <div className="row-between">
                <strong>{fmtFull(p.proposed_due_at)}</strong>
                <span className={`chip ${p.status === "pending" ? "info" : p.status === "accepted" ? "ok" : ""}`}>{p.status === "pending" ? "بانتظار القرار" : p.status === "accepted" ? "قُبل" : "رُفض"}</span>
              </div>
              <p className="small wrap">
                {p.proposed_by_name}: {p.reason}
              </p>
              {p.decision_note ? <p className="small muted wrap">قرار {p.decided_by_name}: {p.decision_note}</p> : null}
              {p.status === "pending" && can.decide_due ? (
                <span>
                  <button className="btn small primary" onClick={() => setSheet({ decide: p.id })}>
                    اتخذ القرار
                  </button>
                </span>
              ) : null}
            </div>
          ))}
          {pending.length && !can.decide_due ? <p className="small muted">بانتظار قرار صاحب الطلب.</p> : null}
        </section>
      ) : null}

      {data.deliverables.length ? (
        <section className="stack">
          <h2>المخرجات</h2>
          {data.deliverables.map((d) => (
            <div key={d.id} className="card card-tight stack" style={{ gap: 4 }}>
              <div className="row-between">
                <strong>
                  التسليم {d.review_round}
                  {d.version_label ? ` · ${d.version_label}` : ""}
                </strong>
                <span className="small muted">{fmtDateTime(d.created_at)}</span>
              </div>
              {d.url ? (
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="row" style={{ overflowWrap: "anywhere" }}>
                  <ILink width={18} />
                  فتح رابط التسليم
                </a>
              ) : null}
              {d.evidence ? <p className="wrap" style={{ whiteSpace: "pre-wrap" }}>{d.evidence}</p> : null}
              <p className="small muted">سلّمه {d.submitted_by_name}</p>
            </div>
          ))}
        </section>
      ) : null}

      <Bookings data={data} />

      {data.subtasks.length || can.edit ? (
        <section className="stack">
          <div className="row-between">
            <h2>المهام الفرعية</h2>
            {can.edit && me.user.role !== "photographer" ? (
              <Link to={`/tasks/new?parent=${t.id}`} className="btn small">
                <IPlus />
                فرعية
              </Link>
            ) : null}
          </div>
          <TaskList tasks={data.subtasks} empty="لا مهام فرعية." />
        </section>
      ) : null}

      <Discussion data={data} reload={reload} />
      <History events={data.events} />

      {sheet ? <ActionSheet sheet={sheet} data={data} busy={busy} run={run} close={() => setSheet(null)} reload={reload} /> : null}
    </div>
  );
}

function Fact({ k, v, sub }: { k: string; v?: ReactNode; sub?: string }) {
  return (
    <div className="fact">
      <div className="k">{k}</div>
      <div className="v">{v ?? "—"}</div>
      {sub ? <div className="tiny muted">{sub}</div> : null}
    </div>
  );
}

function MoreActions({ can, onPick, onArchive }: { can: Detail["can"]; onPick: (s: SheetKind) => void; onArchive: () => void }) {
  const items: [string, () => void, string?][] = [];
  if (can.edit) items.push(["تعديل المهمة أو المنفذ أو الموعد", () => onPick("edit")]);
  if (can.escalate) items.push(["تصعيد للمسؤول الأعلى", () => onPick("escalate")]);
  if (can.cancel) items.push(["إلغاء المهمة", () => onPick("cancel"), "danger"]);
  if (can.archive) items.push(["أرشفة", () => (confirm("أرشفة هذه المهمة؟ ستختفي من القوائم.") ? onArchive() : undefined)]);
  if (!items.length) return null;
  return (
    <details className="more">
      <summary>إجراءات أخرى</summary>
      <div className="row" style={{ marginTop: 8 }}>
        {items.map(([label, fn, cls]) => (
          <button key={label} className={`btn small ${cls ?? ""}`} onClick={fn}>
            {label}
          </button>
        ))}
      </div>
    </details>
  );
}

function Bookings({ data }: { data: Detail }) {
  const t = data.task;
  const shoot = t.template === "shoot_request" || t.template === "shoot_scheduling";
  if (!data.bookings.length && !(shoot && data.can.edit)) return null;
  return (
    <section className="stack">
      <div className="row-between">
        <h2>حجوزات التصوير</h2>
        {data.can.edit ? (
          <Link to={`/calendar?task=${t.id}&client=${t.client.id}&title=${encodeURIComponent(t.title)}`} className="btn small">
            <ICamera />
            حجز وقت
          </Link>
        ) : null}
      </div>
      {!data.bookings.length ? <p className="empty-line">لا حجز لهذه المهمة بعد.</p> : null}
      {data.bookings.map((b) => (
        <div key={b.id} className="slot">
          <div className="time">{fmtDue(b.starts_at)}</div>
          <div>{b.busy_only ? "مشغول" : b.title}</div>
        </div>
      ))}
    </section>
  );
}

const COMMENT_KIND: Record<string, string> = {
  clarification_request: "طلب توضيح",
  clarification_answer: "توضيح",
  changes_requested: "تعديل مطلوب",
  review_note: "ملاحظة المراجعة",
};

function Discussion({ data, reload }: { data: Detail; reload: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const send = async () => {
    setBusy(true);
    try {
      await api(`/api/tasks/${data.task.id}/comments`, { body: { body, client_key: key } });
      setBody("");
      setKey(newKey());
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "لم يُرسل التعليق");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="stack">
      <h2>النقاش</h2>
      {!data.comments.length ? <p className="empty-line">لا تعليقات بعد.</p> : null}
      {data.comments.map((c) => (
        <div key={c.id} className={`comment ${c.kind}`}>
          <div className="row" style={{ gap: 6 }}>
            <span className="who">{c.author}</span>
            {COMMENT_KIND[c.kind] ? <span className="chip">{COMMENT_KIND[c.kind]}</span> : null}
            <span className="tiny muted">{fmtAgo(c.created_at)}</span>
          </div>
          <div className="body">{c.body}</div>
        </div>
      ))}
      {data.can.comment ? (
        <div className="stack" style={{ gap: 8 }}>
          <textarea className="input" aria-label="تعليق جديد" placeholder="اكتب تعليقاً. التعليق لا يغيّر حالة المهمة ولا موعدها." value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} style={{ minHeight: 70 }} />
          <span>
            <Button className="small" busy={busy} disabled={!body.trim()} onClick={send}>
              إرسال التعليق
            </Button>
          </span>
        </div>
      ) : null}
    </section>
  );
}

function describe(e: Detail["events"][number]): string {
  const d = e.data ?? {};
  const who = e.actor ?? "النظام";
  switch (e.type) {
    case "created": return `${who} أنشأ المهمة`;
    case "demo_seeded": return "أُنشئت كمثال تجريبي";
    case "grant": return `${who} منح وصولاً خاصاً لهذه المهمة`;
    case "acknowledged": return `${who} استلم المهمة`;
    case "started": return `${who} بدأ التنفيذ`;
    case "clarification_requested": return `${who} طلب توضيحاً`;
    case "blocker_opened": return `${who} سجّل ${d.kind === "client_wait" ? "انتظار العميل" : "عائقاً"}: ${d.reason ?? ""}`;
    case "blocker_resolved": return `${who} ${d.kind === "clarification" ? "أجاب عن طلب التوضيح" : "حلّ العائق"}`;
    case "due_proposed": return `${who} اقترح موعداً: ${d.proposed_due_at ? fmtDateTime(d.proposed_due_at) : ""}`;
    case "due_proposal_accepted": return `${who} قبل الموعد المقترح`;
    case "due_proposal_rejected": return `${who} رفض الموعد المقترح`;
    case "submitted": return `${who} سلّم للمراجعة (التسليم ${d.round ?? ""})`;
    case "approved": return `${who} اعتمد وأكمل المهمة`;
    case "changes_requested": return `${who} طلب تعديلات`;
    case "cancelled": return `${who} ألغى المهمة: ${d.reason ?? ""}`;
    case "archived": return `${who} أرشف المهمة`;
    case "escalated": return `${who} صعّد المهمة: ${d.reason ?? ""}`;
    case "next_step": return `${who} حدّث الخطوة التالية`;
    case "booking_created": return `${who} حجز وقت تصوير`;
    case "booking_conflict": return `${who ?? "طلب"} حاول حجز وقت محجوز مسبقاً`;
    case "booking_rescheduled": return `${who} غيّر موعد الحجز: ${d.reason ?? ""}`;
    case "booking_cancelled": return `${who} ألغى الحجز: ${d.reason ?? ""}`;
    case "edited": {
      const c = d.changes ?? {};
      const parts: string[] = [];
      if (c.due_at) parts.push(`الموعد من ${c.due_at.from ? fmtDateTime(c.due_at.from) : "بلا موعد"} إلى ${c.due_at.to ? fmtDateTime(c.due_at.to) : "بلا موعد"}`);
      if (c.assignee_id) parts.push("المنفذ");
      if (c.priority) parts.push(`الأولوية إلى ${PRIORITY_LABEL[c.priority.to as "normal"] ?? ""}`);
      if (c.reviewer_id) parts.push("المراجع");
      if (c.title || c.description || c.acceptance) parts.push("التفاصيل");
      return `${who} عدّل ${parts.join("، ") || "المهمة"}${d.reason ? ` — السبب: ${d.reason}` : ""}`;
    }
    default: return `${who}: ${e.type}`;
  }
}

function History({ events }: { events: Detail["events"] }) {
  return (
    <section className="stack">
      <details className="more">
        <summary>سجل التغييرات ({events.length})</summary>
        <ul className="timeline" style={{ marginTop: 10 }}>
          {events.map((e) => (
            <li key={e.id}>
              <div>
                <div>{describe(e)}</div>
                <div className="tiny muted">{fmtFull(e.created_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

// ---------- action sheets ----------

function ActionSheet({ sheet, data, busy, run, close, reload }: { sheet: Exclude<SheetKind, null>; data: Detail; busy: string | null; run: (a: string, extra?: Record<string, unknown>, ok?: string) => Promise<boolean>; close: () => void; reload: () => void }) {
  const t = data.task;
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [when, setWhen] = useState("");
  const [kind, setKind] = useState<"internal" | "client_wait">("internal");
  const [resolver, setResolver] = useState("");
  const me = useMe();

  if (typeof sheet === "object" && "resolve" in sheet) {
    const b = data.blockers.find((x) => x.id === sheet.resolve)!;
    return (
      <Sheet title={b.kind === "clarification" ? "الإجابة عن طلب التوضيح" : "حل العائق"} onClose={close}>
        <div className="stack">
          <p className="small muted wrap">{b.reason}</p>
          <Field label={b.kind === "clarification" ? "التوضيح" : "ما الذي حُلّ؟"} htmlFor="res">
            <textarea id="res" className="input" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Button className="primary" busy={busy === "resolve_blocker"} disabled={!text.trim()} onClick={() => run("resolve_blocker", { blocker_id: b.id, resolution: text }, "سُجّل الحل.")}>
            حفظ
          </Button>
        </div>
      </Sheet>
    );
  }
  if (typeof sheet === "object" && "decide" in sheet) {
    const p = data.due_proposals.find((x) => x.id === sheet.decide)!;
    return (
      <Sheet title="قرار الموعد المقترح" onClose={close}>
        <div className="stack">
          <p>
            المقترح: <strong>{fmtFull(p.proposed_due_at)}</strong>
          </p>
          <p className="small muted">السبب: {p.reason}</p>
          <Field label="ملاحظة (اختيارية)" htmlFor="note">
            <input id="note" className="input" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="form-actions">
            <Button className="primary" busy={busy === "decide_due"} onClick={() => run("decide_due", { proposal_id: p.id, accept: true, note: text || undefined }, "اعتُمد الموعد الجديد، والموعد الأصلي محفوظ في السجل.")}>
              قبول الموعد
            </Button>
            <Button busy={busy === "decide_due"} onClick={() => run("decide_due", { proposal_id: p.id, accept: false, note: text || undefined }, "رُفض الاقتراح.")}>
              رفض
            </Button>
          </div>
        </div>
      </Sheet>
    );
  }

  switch (sheet) {
    case "clarify":
      return (
        <Sheet title={ACTION_LABEL.clarify} onClose={close}>
          <div className="stack">
            <p className="small muted">طلب التوضيح لا يعني قبول المهمة ولا يُحتسب عليك تأخيراً؛ يتوقف عدّاد الاستلام حتى يصلك الرد.</p>
            <Field label="سؤالك" htmlFor="q">
              <textarea id="q" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button className="primary" busy={busy === "clarify"} disabled={text.trim().length < 3} onClick={() => run("clarify", { question: text }, "أُرسل طلب التوضيح.")}>
              إرسال السؤال
            </Button>
          </div>
        </Sheet>
      );
    case "block":
      return (
        <Sheet title={ACTION_LABEL.block} onClose={close}>
          <div className="stack">
            <div className="seg" role="group" aria-label="نوع العائق">
              <button aria-pressed={kind === "internal"} onClick={() => setKind("internal")}>
                عائق داخلي
              </button>
              <button aria-pressed={kind === "client_wait"} onClick={() => setKind("client_wait")}>
                بانتظار العميل
              </button>
            </div>
            {kind === "client_wait" ? (
              <p className="small muted">
                {data.client_wait_is_assignees
                  ? "أنت مسؤول حساب هذا العميل، فتتابع الرد بنفسك ويبقى وقت الانتظار محسوباً عليك."
                  : "يتابعه مسؤول الحساب مع العميل، ولا يُحتسب الانتظار على المنفذ."}
              </p>
            ) : null}
            <Field label="ما العائق؟" htmlFor="r">
              <textarea id="r" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            {kind === "internal" ? (
              <Field label="من يستطيع حله؟" htmlFor="who" help="الافتراضي: صاحب الطلب">
                <select id="who" className="input" value={resolver} onChange={(e) => setResolver(e.target.value)}>
                  <option value="">الافتراضي</option>
                  {me.members
                    .filter((m) => m.id !== t.assignee?.id && m.role !== "photographer" && [t.requester?.id, t.reviewer?.id, ...me.members.filter((x) => x.role === "owner" || x.role === "exec").map((x) => x.id)].includes(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}
            <Field label="متى يُتوقع الحل؟ (اختياري)" htmlFor="exp">
              <input id="exp" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Button className="primary" busy={busy === "block"} disabled={text.trim().length < 3} onClick={() => run("block", { kind, reason: text, resolver_id: kind === "internal" && resolver ? resolver : undefined, expected_at: when ? localInputToIso(when) : undefined }, "سُجّل العائق وأُبلغ المسؤول عن حله.")}>
              تسجيل العائق
            </Button>
          </div>
        </Sheet>
      );
    case "propose_due":
      return (
        <Sheet title={ACTION_LABEL.propose_due} onClose={close}>
          <div className="stack">
            <p className="small muted">الموعد الحالي يبقى كما هو حتى يقبل صاحب الطلب اقتراحك.</p>
            <Field label="الموعد المقترح" htmlFor="pd">
              <input id="pd" className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </Field>
            <Field label="السبب" htmlFor="pr">
              <textarea id="pr" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button className="primary" busy={busy === "propose_due"} disabled={!when || text.trim().length < 3} onClick={() => run("propose_due", { proposed_due_at: localInputToIso(when), reason: text }, "أُرسل الاقتراح.")}>
              إرسال الاقتراح
            </Button>
          </div>
        </Sheet>
      );
    case "submit":
      return (
        <Sheet title={ACTION_LABEL.submit} onClose={close}>
          <div className="stack">
            <Field label="رابط التسليم" htmlFor="su" help="رابط المجلد أو الملف. إن لم يوجد رابط اكتب وصفاً واضحاً بالأسفل.">
              <input id="su" className="input" type="url" dir="ltr" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label="وصف التسليم" htmlFor="se">
              <textarea id="se" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="مثال: 40 صورة في مجلد العيادة، ونقص لقطة واحدة" />
            </Field>
            <Field label="رقم النسخة (اختياري)" htmlFor="sv">
              <input id="sv" className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="نسخة 2" />
            </Field>
            <Button className="primary" busy={busy === "submit"} disabled={!url.trim() && text.trim().length < 3} onClick={() => run("submit", { url: url.trim() || null, evidence: text || undefined, version_label: label || undefined }, "سُلّمت للمراجعة وأُبلغ المراجع.")}>
              تسليم للمراجعة
            </Button>
          </div>
        </Sheet>
      );
    case "approve":
      return (
        <Sheet title={ACTION_LABEL.approve} onClose={close}>
          <div className="stack">
            {t.requires_publish ? (
              <Field label="رابط النشر" htmlFor="pu" help="مطلوب قبل الإكمال.">
                <input id="pu" className="input" type="url" dir="ltr" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
            ) : null}
            <Field label="ملاحظة (اختيارية)" htmlFor="an">
              <textarea id="an" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button className="primary" busy={busy === "approve"} disabled={t.requires_publish && !url.trim() && !t.publish_url} onClick={() => run("approve", { note: text || undefined, publish_url: url.trim() || null }, "اعتُمدت المهمة وأُكملت.")}>
              اعتماد وإكمال
            </Button>
          </div>
        </Sheet>
      );
    case "request_changes":
      return (
        <Sheet title={ACTION_LABEL.request_changes} onClose={close}>
          <div className="stack">
            <Field label="ما المطلوب تعديله؟" htmlFor="rc">
              <textarea id="rc" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button className="primary" busy={busy === "request_changes"} disabled={text.trim().length < 3} onClick={() => run("request_changes", { note: text }, "أُرسل طلب التعديل.")}>
              إرسال طلب التعديل
            </Button>
          </div>
        </Sheet>
      );
    case "cancel":
      return (
        <Sheet title="إلغاء المهمة" onClose={close}>
          <div className="stack">
            <p className="small muted">الإلغاء نهائي ويبقى في السجل مع السبب.</p>
            <Field label="سبب الإلغاء" htmlFor="cr">
              <textarea id="cr" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button className="danger" busy={busy === "cancel"} disabled={text.trim().length < 3} onClick={() => run("cancel", { reason: text }, "أُلغيت المهمة.")}>
              إلغاء المهمة
            </Button>
          </div>
        </Sheet>
      );
    case "escalate":
      return (
        <Sheet title="تصعيد" onClose={close}>
          <div className="stack">
            <p className="small muted">يصل التصعيد إلى المسؤول الأعلى، ولا يغيّر المنفذ.</p>
            <Field label="لماذا تصعّد؟" htmlFor="er">
              <textarea id="er" className="input" value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Button className="primary" busy={busy === "escalate"} disabled={text.trim().length < 3} onClick={() => run("escalate", { reason: text }, "أُرسل التصعيد.")}>
              إرسال التصعيد
            </Button>
          </div>
        </Sheet>
      );
    case "next_step":
      return (
        <Sheet title="الخطوة التالية" onClose={close}>
          <div className="stack">
            <Field label="ما الخطوة التالية؟" htmlFor="ns" help="تحديث الخطوة لا يغيّر الموعد ولا يوقف قياس التأخير.">
              <input id="ns" className="input" defaultValue={t.next_step} onChange={(e) => setText(e.target.value)} maxLength={300} />
            </Field>
            <Button className="primary" busy={busy === "next_step"} onClick={() => run("next_step", { next_step: text || t.next_step }, "حُفظت الخطوة التالية.")}>
              حفظ
            </Button>
          </div>
        </Sheet>
      );
    case "edit":
      return <EditSheet data={data} close={close} reload={reload} />;
  }
  return null;
}

function EditSheet({ data, close, reload }: { data: Detail; close: () => void; reload: () => void }) {
  const me = useMe();
  const toast = useToast();
  const t = data.task;
  const opt = me.assignment.find((o) => o.client.id === t.client.id);
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [acceptance, setAcceptance] = useState(t.acceptance);
  const [priority, setPriority] = useState(t.priority);
  const [due, setDue] = useState(isoToLocalInput(t.due_at));
  const [assignee, setAssignee] = useState(t.assignee?.id ?? "");
  const [reviewer, setReviewer] = useState(t.reviewer?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dueIso = useMemo(() => (due ? localInputToIso(due) : null), [due]);
  // Nobody reviews his own work, the owner excepted (validReviewer).
  const reviewers = (opt?.reviewers ?? []).filter((r) => r.id !== assignee || r.role === "owner");
  const pickAssignee = (id: string) => {
    setAssignee(id);
    if (id === reviewer && me.members.find((m) => m.id === id)?.role !== "owner") setReviewer("");
  };
  const needsReason = dueIso !== t.due_at || priority !== t.priority || assignee !== t.assignee?.id;
  useEffect(() => setError(null), [due, priority, assignee]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { version: t.version };
    if (title !== t.title) body.title = title;
    if (description !== t.description) body.description = description;
    if (acceptance !== t.acceptance) body.acceptance = acceptance;
    if (priority !== t.priority) body.priority = priority;
    if (dueIso !== t.due_at) body.due_at = dueIso;
    if (assignee !== t.assignee?.id) body.assignee_id = assignee;
    if (reviewer !== t.reviewer?.id) body.reviewer_id = reviewer;
    if (reason) body.reason = reason;
    try {
      await api(`/api/tasks/${t.id}`, { method: "PATCH", body });
      toast("ok", assignee !== t.assignee?.id ? "أُعيد الإسناد، والمنفذ الجديد يحتاج أن يستلم المهمة." : "حُفظت التعديلات.");
      close();
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذّر الحفظ");
      if (e instanceof ApiError && e.code === "version_conflict") reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="تعديل المهمة" onClose={close}>
      <div className="stack">
        <Field label="العنوان" htmlFor="et">
          <input id="et" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="المنفذ" htmlFor="ea">
            <select id="ea" className="input" value={assignee} onChange={(e) => pickAssignee(e.target.value)} disabled={t.status === "in_review"}>
              {!opt?.assignees.some((a) => a.id === assignee) ? <option value={assignee}>{t.assignee?.name}</option> : null}
              {opt?.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.outside_team ? " — خارج فريق العميل" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المراجع" htmlFor="er2" error={!reviewer ? "لا يراجع أحد عمله بنفسه؛ اختر مراجعاً آخر." : null}>
            <select id="er2" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              {!reviewer ? <option value="">اختر المراجع</option> : null}
              {reviewer && !reviewers.some((r) => r.id === reviewer) ? <option value={reviewer}>{t.reviewer?.name}</option> : null}
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field">
          <span className="label">الأولوية</span>
          <div className="seg">
            {PRIORITIES.map((p) => (
              <button key={p} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <Field label="موعد التسليم" htmlFor="ed" help={t.original_due_at ? `الموعد الأصلي محفوظ: ${fmtDateTime(t.original_due_at)}` : undefined}>
          <input id="ed" className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {needsReason ? (
          <Field label="سبب التغيير" htmlFor="ereason" help="مطلوب عند تغيير الموعد أو الأولوية أو المنفذ.">
            <input id="ereason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
        <Field label="الوصف" htmlFor="edesc">
          <textarea id="edesc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="معيار القبول" htmlFor="eacc">
          <textarea id="eacc" className="input" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
        </Field>
        {assignee !== t.assignee?.id ? <Alert kind="info">إعادة الإسناد تلغي تذكيرات المنفذ السابق، ويحتاج المنفذ الجديد إلى الاستلام من جديد. الحالة الحالية: {STATUS_LABEL[t.status as TaskStatus]}.</Alert> : null}
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button className="primary" busy={busy} disabled={(needsReason && reason.trim().length < 3) || !reviewer} onClick={save}>
          حفظ التعديلات
        </Button>
      </div>
    </Sheet>
  );
}
