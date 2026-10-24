import { useMemo, useState, type FormEvent } from "react";
import { PRIORITIES, PRIORITY_LABEL, TEMPLATES, type TemplateKey } from "../../shared/domain";
import { api, ApiError, newKey } from "../lib/api";
import { navigate, useLocation, useTitle } from "../lib/router";
import { useMe } from "../lib/session";
import { localInputToIso } from "../lib/time";
import { Alert, Button, Field, useApi, useToast } from "../ui/kit";

export function NewTaskPage() {
  useTitle("مهمة جديدة");
  const me = useMe();
  const toast = useToast();
  const { query } = useLocation();
  const parentId = query.get("parent");
  const parent = useApi<{ task: { id: string; title: string; client: { id: string } } } | null>((signal) => (parentId ? api(`/api/tasks/${parentId}`, { signal }) : Promise.resolve(null)), [parentId]);

  const options = me.assignment;
  const [template, setTemplate] = useState<TemplateKey | "">("");
  const [clientId, setClientId] = useState(options.length === 1 ? options[0].client.id : "");
  const effectiveClient = parent.data?.task.client.id ?? clientId;
  const opt = options.find((o) => o.client.id === effectiveClient);
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [due, setDue] = useState("");
  const [clientDue, setClientDue] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [requiresPublish, setRequiresPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const idemKey = useMemo(newKey, []);

  const assignee = opt?.assignees.find((a) => a.id === assigneeId);
  const reviewers = (opt?.reviewers ?? []).filter((r) => r.id !== assigneeId || r.role === "owner");

  const pickTemplate = (k: TemplateKey | "") => {
    setTemplate(k);
    if (k) {
      if (!acceptance) setAcceptance(TEMPLATES[k].acceptance);
      if (!title) setTitle(`${TEMPLATES[k].label}: `);
      if ((k === "shoot_request" || k === "footage_delivery" || k === "shoot_scheduling") && !assigneeId) {
        const photographer = opt?.assignees.find((a) => a.role === "photographer");
        if (photographer) setAssigneeId(photographer.id);
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const dueIso = due ? localInputToIso(due) : null;
    const clientDueIso = clientDue ? localInputToIso(clientDue) : null;
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/api/tasks", {
        body: {
          client_id: effectiveClient,
          parent_id: parentId ?? undefined,
          template: template || undefined,
          title,
          description,
          acceptance,
          assignee_id: assigneeId,
          reviewer_id: reviewerId || undefined,
          priority,
          due_at: dueIso,
          client_due_at: clientDueIso,
          ref_url: refUrl || null,
          requires_publish: requiresPublish,
        },
        headers: { "idempotency-key": idemKey },
      });
      toast("ok", "حُفظت المهمة وأُرسلت للمنفذ.");
      const shoot = template === "shoot_request" || template === "shoot_scheduling";
      navigate(`/tasks/${r.id}${shoot ? "?book=1" : ""}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, field: err.data.field as string | undefined } : { message: "تعذّر الحفظ" });
    } finally {
      setBusy(false);
    }
  };

  const ferr = (f: string) => (error?.field === f ? error.message : null);
  const ready = !!effectiveClient && !!assigneeId && title.trim().length >= 3;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{parentId ? "مهمة فرعية" : "مهمة جديدة"}</h1>
          {parent.data ? <p className="sub">ضمن: {parent.data.task.title}</p> : null}
        </div>
      </div>
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="field">
          <span className="label">قالب (اختياري)</span>
          <div className="seg" role="group" aria-label="القالب">
            {(Object.keys(TEMPLATES) as TemplateKey[]).map((k) => (
              <button type="button" key={k} aria-pressed={template === k} onClick={() => pickTemplate(template === k ? "" : k)}>
                {TEMPLATES[k].label}
              </button>
            ))}
          </div>
        </div>

        {!parentId ? (
          <Field label="العميل" htmlFor="client">
            <select id="client" className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setAssigneeId(""); setReviewerId(""); }}>
              <option value="">اختر العميل</option>
              {options.map((o) => (
                <option key={o.client.id} value={o.client.id}>
                  {o.client.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="العنوان" htmlFor="title" error={ferr("title")}>
          <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="مثال: تصوير لقطات قسم الاستقبال" />
        </Field>

        <div className="grid-2">
          <Field label="المنفذ" htmlFor="assignee">
            <select id="assignee" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} disabled={!opt}>
              <option value="">اختر المنفذ</option>
              {opt?.assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === me.user.id ? `${a.name} (أنا)` : a.name}
                  {a.outside_team ? " — خارج فريق العميل" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="المراجع" htmlFor="reviewer" help={!reviewerId ? (assigneeId === me.user.id ? "الافتراضي: المسؤول الأعلى" : "الافتراضي: أنت") : undefined}>
            <select id="reviewer" className="input" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} disabled={!opt}>
              <option value="">الافتراضي</option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id === me.user.id ? `${r.name} (أنا)` : r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {assignee?.outside_team ? <Alert kind="info">{assignee.name} ليس ضمن فريق هذا العميل. سيُمنح وصولاً لهذه المهمة وحدها، ويُسجَّل ذلك.</Alert> : null}

        <div className="field">
          <span className="label">الأولوية</span>
          <div className="seg" role="group" aria-label="الأولوية">
            {PRIORITIES.map((p) => (
              <button type="button" key={p} aria-pressed={priority === p} onClick={() => setPriority(p)}>
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-2">
          <Field label="موعد التسليم" htmlFor="due" help="بتوقيت بغداد" error={ferr("due_at")}>
            <input id="due" className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="موعد العميل (اختياري)" htmlFor="cdue">
            <input id="cdue" className="input" type="datetime-local" value={clientDue} onChange={(e) => setClientDue(e.target.value)} />
          </Field>
        </div>

        <Field label="الوصف" htmlFor="desc">
          <textarea id="desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} placeholder="ما المطلوب بالتحديد؟ لا تكتب بيانات مرضى." />
        </Field>
        <Field label="معيار القبول" htmlFor="acc" help="متى تُعدّ المهمة منجزة؟">
          <textarea id="acc" className="input" value={acceptance} onChange={(e) => setAcceptance(e.target.value)} maxLength={1000} style={{ minHeight: 70 }} />
        </Field>
        <Field label="رابط مرجعي (اختياري)" htmlFor="ref" error={ferr("ref_url")}>
          <input id="ref" className="input" type="url" dir="ltr" inputMode="url" value={refUrl} onChange={(e) => setRefUrl(e.target.value)} placeholder="https://" />
        </Field>
        <label className="check">
          <input type="checkbox" checked={requiresPublish} onChange={(e) => setRequiresPublish(e.target.checked)} />
          تتطلب رابط نشر قبل الإكمال
        </label>

        {error && !error.field ? <Alert kind="error">{error.message}</Alert> : null}
        <div className="form-actions">
          <Button className="primary" type="submit" busy={busy} disabled={!ready}>
            إنشاء وإرسال
          </Button>
          <button type="button" className="btn ghost" onClick={() => history.back()}>
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}
