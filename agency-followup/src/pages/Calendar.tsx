import { useEffect, useMemo, useState } from "react";
import { api, ApiError, newKey } from "../lib/api";
import { Link, useLocation, useTitle } from "../lib/router";
import { useMe } from "../lib/session";
import { dayKey, fmtDay, fmtDue, fmtTime, isoToLocalInput, localInputToIso } from "../lib/time";
import { ICamera, IPlus } from "../ui/icons";
import { Alert, Button, ErrorBox, Field, Loading, Sheet, useApi, useToast } from "../ui/kit";
import type { TaskSummary } from "../ui/TaskCard";
import type { Booking } from "./Today";

type Suggestion = { starts_at: string; ends_at: string } | null;

export function CalendarPage() {
  useTitle("التقويم");
  const { query } = useLocation();
  const [days, setDays] = useState(7);
  const from = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);
  const to = new Date(new Date(from).getTime() + days * 86_400_000).toISOString();
  const { data, error, loading, reload } = useApi<{ bookings: Booking[]; resource: { id: string; name: string } | null; can_create: boolean }>((signal) => api(`/api/bookings?from=${from}&to=${to}`, { signal }), [from, to], { pollMs: 60_000 });
  const [creating, setCreating] = useState(query.get("task") ? true : false);
  const [managing, setManaging] = useState<Booking | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of data?.bookings ?? []) {
      const k = dayKey(b.starts_at);
      m.set(k, [...(m.get(k) ?? []), b]);
    }
    return [...m.entries()];
  }, [data]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>تقويم {data?.resource?.name ?? "حسين"}</h1>
          <p className="sub">حجوزات التصوير. الأوقات بتوقيت بغداد.</p>
        </div>
        {data?.can_create ? (
          <Button className="primary small" onClick={() => setCreating(true)}>
            <IPlus />
            حجز
          </Button>
        ) : null}
      </div>
      {loading ? <Loading /> : null}
      {error && !data ? <ErrorBox error={error} retry={reload} /> : null}
      {data ? (
        <>
          {!grouped.length ? (
            <div className="state">
              <ICamera />
              <p>لا حجوزات خلال {days === 7 ? "الأسبوع القادم" : "الأسبوعين القادمين"}.</p>
            </div>
          ) : null}
          {grouped.map(([k, items]) => (
            <div key={k} className="day">
              <div className="day-head">{fmtDay(items[0].starts_at)}</div>
              {items.map((b) => (
                <div key={b.id} className={`slot ${b.busy_only ? "busy" : ""}`}>
                  <div className="time">
                    <span>{fmtTime(b.starts_at)}</span>
                    <span className="muted">حتى {fmtTime(b.ends_at)}</span>
                  </div>
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{b.busy_only ? "مشغول" : b.title}</strong>
                    {!b.busy_only ? (
                      <>
                        <span className="small muted">
                          {b.client.name} · حجزه {b.created_by}
                        </span>
                        <span className="row small">
                          {b.task_id ? <Link to={`/tasks/${b.task_id}`}>فتح المهمة</Link> : null}
                          {b.can_manage ? (
                            <button className="btn small ghost" style={{ minHeight: 32, padding: "2px 8px" }} onClick={() => setManaging(b)}>
                              تعديل أو إلغاء
                            </button>
                          ) : null}
                        </span>
                      </>
                    ) : (
                      <span className="small muted">وقت محجوز لعمل آخر</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {days === 7 ? (
            <button className="btn small" onClick={() => setDays(14)}>
              عرض أسبوعين
            </button>
          ) : null}
        </>
      ) : null}
      {creating ? <BookingSheet close={() => setCreating(false)} done={reload} /> : null}
      {managing && !managing.busy_only ? <ManageSheet b={managing} close={() => setManaging(null)} done={reload} /> : null}
    </div>
  );
}

function useSlotCheck(startsAt: string | null, endsAt: string | null, exclude?: string) {
  const [state, setState] = useState<{ free: boolean; suggestion: Suggestion; conflicts: Booking[]; within_hours: boolean } | null>(null);
  useEffect(() => {
    setState(null);
    if (!startsAt || !endsAt || endsAt <= startsAt) return;
    const ac = new AbortController();
    const id = setTimeout(() => {
      api(`/api/bookings/check?starts_at=${encodeURIComponent(startsAt)}&ends_at=${encodeURIComponent(endsAt)}${exclude ? `&exclude=${exclude}` : ""}`, { signal: ac.signal })
        .then(setState)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [startsAt, endsAt, exclude]);
  return state;
}

function SlotStatus({ check, onUse }: { check: ReturnType<typeof useSlotCheck>; onUse: (s: NonNullable<Suggestion>) => void }) {
  if (!check) return null;
  if (check.free) return <Alert kind={check.within_hours ? "ok" : "warn"}>{check.within_hours ? "الوقت متاح." : "الوقت متاح لكنه خارج ساعات الدوام."}</Alert>;
  return (
    <Alert kind="warn">
      <div className="stack" style={{ gap: 6 }}>
        <span>الوقت يتعارض مع حجز آخر لحسين ({check.conflicts.map((c) => `${fmtTime(c.starts_at)}–${fmtTime(c.ends_at)}`).join("، ")}).</span>
        {check.suggestion ? (
          <span>
            <button className="btn small" onClick={() => onUse(check.suggestion!)}>
              استخدم أقرب وقت متاح: {fmtDue(check.suggestion.starts_at)}
            </button>
          </span>
        ) : null}
      </div>
    </Alert>
  );
}

function BookingSheet({ close, done }: { close: () => void; done: () => void }) {
  const me = useMe();
  const toast = useToast();
  const { query } = useLocation();
  const clients = me.clients;
  const [clientId, setClientId] = useState(query.get("client") ?? (clients.length === 1 ? clients[0].id : ""));
  const [taskId, setTaskId] = useState(query.get("task") ?? "");
  const [title, setTitle] = useState(query.get("title") ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const tasks = useApi<{ tasks: TaskSummary[] }>((signal) => (clientId ? api(`/api/tasks?client=${clientId}`, { signal }) : Promise.resolve({ tasks: [] })), [clientId]);
  const s = start ? localInputToIso(start) : null;
  const e = end ? localInputToIso(end) : null;
  const check = useSlotCheck(s, e);

  const onStart = (v: string) => {
    setStart(v);
    if (v && (!end || end <= v)) {
      const iso = localInputToIso(v);
      if (iso) setEnd(isoToLocalInput(new Date(new Date(iso).getTime() + 2 * 3_600_000).toISOString()));
    }
  };
  const use = (sg: NonNullable<Suggestion>) => {
    setStart(isoToLocalInput(sg.starts_at));
    setEnd(isoToLocalInput(sg.ends_at));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/bookings", { body: { client_id: clientId, task_id: taskId || null, title, starts_at: s, ends_at: e, create_key: key } });
      toast("ok", "حُجز الوقت وأُبلغ حسين.");
      done();
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === "booking_conflict") {
        setError(err.message);
        const sg = err.data.suggestion as Suggestion;
        if (sg && confirm(`الوقت محجوز. هل تستخدم أقرب وقت متاح: ${fmtDue(sg.starts_at)}؟`)) use(sg);
      } else setError(err instanceof ApiError ? err.message : "تعذّر الحجز");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="حجز وقت تصوير" onClose={close}>
      <div className="stack">
        <Field label="العميل" htmlFor="bc">
          <select id="bc" className="input" value={clientId} onChange={(ev) => { setClientId(ev.target.value); setTaskId(""); }}>
            <option value="">اختر العميل</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="المهمة المرتبطة (اختياري)" htmlFor="bt">
          <select id="bt" className="input" value={taskId} onChange={(ev) => { setTaskId(ev.target.value); const t = tasks.data?.tasks.find((x) => x.id === ev.target.value); if (t && !title) setTitle(t.title); }}>
            <option value="">بلا مهمة</option>
            {tasks.data?.tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
            {taskId && !tasks.data?.tasks.some((t) => t.id === taskId) ? <option value={taskId}>{title || "المهمة الحالية"}</option> : null}
          </select>
        </Field>
        <Field label="العنوان" htmlFor="bti">
          <input id="bti" className="input" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="مثال: تصوير الاستقبال" />
        </Field>
        <div className="grid-2">
          <Field label="من" htmlFor="bs">
            <input id="bs" className="input" type="datetime-local" value={start} onChange={(ev) => onStart(ev.target.value)} />
          </Field>
          <Field label="إلى" htmlFor="be">
            <input id="be" className="input" type="datetime-local" value={end} onChange={(ev) => setEnd(ev.target.value)} />
          </Field>
        </div>
        <SlotStatus check={check} onUse={use} />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button className="primary" busy={busy} disabled={!clientId || title.trim().length < 2 || !s || !e} onClick={save}>
          تأكيد الحجز
        </Button>
        <p className="tiny muted">يتحقق الخادم من التعارض لحظة الحفظ؛ إذا حجز شخص آخر الوقت نفسه قبلك يُرفض الحجز ويُقترح وقت بديل.</p>
      </div>
    </Sheet>
  );
}

function ManageSheet({ b, close, done }: { b: Extract<Booking, { busy_only: false }>; close: () => void; done: () => void }) {
  const toast = useToast();
  const [start, setStart] = useState(isoToLocalInput(b.starts_at));
  const [end, setEnd] = useState(isoToLocalInput(b.ends_at));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = localInputToIso(start);
  const e = localInputToIso(end);
  const moved = s !== b.starts_at || e !== b.ends_at;
  const check = useSlotCheck(moved ? s : null, moved ? e : null, b.id);

  const move = async () => {
    setBusy("move");
    setError(null);
    try {
      await api(`/api/bookings/${b.id}`, { method: "PATCH", body: { starts_at: s, ends_at: e, reason } });
      toast("ok", "تغيّر موعد الحجز وأُبلغ المعنيون.");
      done();
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      await api(`/api/bookings/${b.id}/cancel`, { body: { reason } });
      toast("ok", "أُلغي الحجز.");
      done();
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر الإلغاء");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet title={b.title} onClose={close}>
      <div className="stack">
        <div className="grid-2">
          <Field label="من" htmlFor="ms">
            <input id="ms" className="input" type="datetime-local" value={start} onChange={(ev) => setStart(ev.target.value)} />
          </Field>
          <Field label="إلى" htmlFor="me">
            <input id="me" className="input" type="datetime-local" value={end} onChange={(ev) => setEnd(ev.target.value)} />
          </Field>
        </div>
        {moved ? <SlotStatus check={check} onUse={(sg) => { setStart(isoToLocalInput(sg.starts_at)); setEnd(isoToLocalInput(sg.ends_at)); }} /> : null}
        <Field label="السبب" htmlFor="mr" help="مطلوب لتغيير الموعد أو الإلغاء، ويصل لحسين وصاحب الحجز.">
          <input id="mr" className="input" value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <div className="form-actions">
          <Button className="primary" busy={busy === "move"} disabled={!moved || reason.trim().length < 3} onClick={move}>
            حفظ الموعد الجديد
          </Button>
          <Button className="danger" busy={busy === "cancel"} disabled={reason.trim().length < 3} onClick={cancel}>
            إلغاء الحجز
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
