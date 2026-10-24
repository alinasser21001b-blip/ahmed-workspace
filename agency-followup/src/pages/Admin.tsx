import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useTitle } from "../lib/router";
import { ROLE_LABEL } from "../lib/session";
import { fmtAgo, fmtFull } from "../lib/time";
import { IRefresh } from "../ui/icons";
import { Alert, Button, ErrorBox, Field, Loading, Sheet, useApi, useToast } from "../ui/kit";
import type { Role } from "../../shared/domain";

type Overview = {
  now: string;
  members: { id: string; username: string; name: string; role: Role; title: string; active: boolean; has_password: boolean; setup_link_pending_until: string | null; sessions: number; last_sign_in: string | null; devices: number; last_push_success: string | null }[];
  scheduler: { last_ok: { started_at: string; finished_at: string; summary: string } | null; runs: { id: number; started_at: string; ok: number; summary: string | null; error: string | null }[] };
  outbox_24h: Record<string, number>;
  outbox_failures: { last_error: string; n: number }[];
  push_configured: boolean;
  settings: { work_hours: { value: WorkHours; updated_at: string; updated_by: string | null }; rules: { value: Rules; updated_at: string; updated_by: string | null } };
  demo_tasks: number;
};
type WorkHours = { tz: string; days: number[]; start: string; end: string; assumed?: boolean };
type Rules = { ack: { normal: number[]; urgent: number[] }; dueSoonMinutes: { normal: number; urgent: number }; blockerFollowMinutes: { normal: number; urgent: number }; reviewMinutes: { normal: number[]; urgent: number[] }; urgentOutsideHours: boolean; demoReminders: boolean };

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const OUTBOX_LABEL: Record<string, string> = { sent: "وصلت للأجهزة", pending: "بالانتظار", skipped: "بلا جهاز مفعّل", failed: "فشلت", cancelled: "أُلغيت لأنها لم تعد لازمة" };

export function AdminPage() {
  useTitle("الإدارة");
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Overview>((signal) => api("/api/admin/overview", { signal }), [], { pollMs: 60_000 });
  const [link, setLink] = useState<{ link: string; name: string; username: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reset = async (m: Overview["members"][number]) => {
    if (!confirm(`إنشاء رابط دخول جديد لـ${m.name}؟ ستتوقف كلمة مروره الحالية ويخرج من كل أجهزته.`)) return;
    setBusy(m.id);
    try {
      setLink(await api(`/api/admin/members/${m.id}/reset`, { body: {} }));
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "تعذّر إنشاء الرابط");
    } finally {
      setBusy(null);
    }
  };
  const demo = async (action: "seed" | "archive") => {
    if (action === "archive" && !confirm("أرشفة كل المهام التجريبية وإلغاء حجوزاتها؟")) return;
    setBusy(action);
    try {
      const r = await api(`/api/admin/demo/${action}`, { body: {} });
      toast("ok", action === "seed" ? `أُضيفت ${r.inserted} مهمة تجريبية.` : `أُرشفت ${r.archived} مهمة تجريبية.`);
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "تعذّر التنفيذ");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading rows={4} />;
  if (error && !data) return <ErrorBox error={error} retry={reload} />;
  if (!data) return null;
  const last = data.scheduler.last_ok;
  const lagMin = last ? Math.round((new Date(data.now).getTime() - new Date(last.started_at).getTime()) / 60000) : null;
  const schedulerOk = lagMin !== null && lagMin <= 5;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>الإدارة</h1>
        <button className="btn small" onClick={reload} aria-label="تحديث">
          <IRefresh />
        </button>
      </div>

      <section className="card stack">
        <h2>حالة التنبيهات</h2>
        <Alert kind={schedulerOk ? "ok" : "error"}>
          {last ? `آخر تشغيل ناجح للمجدول: ${fmtAgo(last.started_at)} (${fmtFull(last.started_at)}).` : "لم يعمل المجدول بعد."}
          {!schedulerOk ? " المجدول متأخر؛ التذكيرات والتصعيد لن تصل حتى يعود." : ""}
        </Alert>
        <Alert kind={data.push_configured ? "ok" : "warn"}>{data.push_configured ? "إشعارات الأجهزة (Web Push) مهيأة على الخادم." : "مفاتيح إشعارات الأجهزة غير مهيأة على الخادم؛ التنبيهات داخل التطبيق فقط."}</Alert>
        <div>
          <h3>إرسال الإشعارات خلال 24 ساعة</h3>
          <dl className="kv" style={{ marginTop: 6 }}>
            {Object.keys(OUTBOX_LABEL).map((k) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{OUTBOX_LABEL[k]}</dt>
                <dd>{data.outbox_24h[k] ?? 0}</dd>
              </div>
            ))}
          </dl>
          {data.outbox_failures.length ? <p className="small muted">أسباب الفشل: {data.outbox_failures.map((f) => `${f.last_error} (${f.n})`).join("، ")}</p> : null}
        </div>
        {data.scheduler.runs.some((r) => !r.ok && r.error) ? <Alert kind="error">آخر خطأ في المجدول: {data.scheduler.runs.find((r) => !r.ok && r.error)?.error?.slice(0, 160)}</Alert> : null}
      </section>

      <section className="card stack">
        <h2>الفريق</h2>
        <div className="table-wrap">
          <table className="simple">
            <thead>
              <tr>
                <th>العضو</th>
                <th>الدخول</th>
                <th>الأجهزة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    <div className="tiny muted">
                      {ROLE_LABEL[m.role]} · <span className="ltr">{m.username}</span>
                    </div>
                  </td>
                  <td className="small">
                    {m.has_password ? (m.last_sign_in ? `آخر دخول ${fmtAgo(m.last_sign_in)}` : "لديه كلمة مرور") : m.setup_link_pending_until ? `رابط إعداد صالح حتى ${fmtFull(m.setup_link_pending_until)}` : "لا كلمة مرور ولا رابط صالح"}
                  </td>
                  <td className="small">
                    {m.devices ? `${m.devices} مفعّل` : "لا جهاز"}
                    {m.last_push_success ? <div className="tiny muted">آخر وصول {fmtAgo(m.last_push_success)}</div> : null}
                  </td>
                  <td>
                    {m.role !== "owner" ? (
                      <Button className="small" busy={busy === m.id} onClick={() => reset(m)}>
                        رابط دخول جديد
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted">رابط الدخول يعمل مرة واحدة لمدة 72 ساعة. أرسله للشخص نفسه عبر قناة خاصة، ولا تضعه في مجموعة.</p>
      </section>

      <SettingsCard data={data} done={reload} />

      <section className="card stack">
        <h2>التصدير والنسخ الاحتياطي</h2>
        <div className="row">
          <a className="btn" href="/api/admin/export?format=csv" download>
            تصدير المهام (Excel/CSV)
          </a>
          <a className="btn" href="/api/admin/export" download>
            نسخة كاملة (JSON)
          </a>
        </div>
      </section>

      <section className="card stack">
        <h2>الأمثلة التجريبية</h2>
        <p className="small muted">المهام التجريبية معلّمة بكلمة «تجريبي» ولا ترسل تذكيرات متكررة إلا إذا فعّلت ذلك في القواعد. عددها الآن: {data.demo_tasks}.</p>
        <div className="row">
          <Button busy={busy === "seed"} onClick={() => demo("seed")}>
            إضافة الأمثلة
          </Button>
          <Button className="danger" busy={busy === "archive"} onClick={() => demo("archive")} disabled={!data.demo_tasks}>
            أرشفة كل الأمثلة
          </Button>
        </div>
      </section>

      {link ? (
        <Sheet title={`رابط دخول ${link.name}`} onClose={() => setLink(null)}>
          <div className="stack">
            <Alert kind="warn">يظهر هذا الرابط مرة واحدة فقط. انسخه وأرسله إلى {link.name} مباشرة. يعمل مرة واحدة حتى {fmtFull(link.expires_at)}.</Alert>
            <p>
              اسم المستخدم: <strong className="ltr">{link.username}</strong>
            </p>
            <div className="copybox">{link.link}</div>
            <Button className="primary" onClick={() => navigator.clipboard?.writeText(link.link).then(() => toast("ok", "نُسخ الرابط."), () => toast("error", "انسخه يدوياً."))}>
              نسخ الرابط
            </Button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function SettingsCard({ data, done }: { data: Overview; done: () => void }) {
  const toast = useToast();
  const [wh, setWh] = useState<WorkHours>(data.settings.work_hours.value);
  const [rules, setRules] = useState<Rules>(data.settings.rules.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setWh(data.settings.work_hours.value);
    setRules(data.settings.rules.value);
  }, [data.settings.work_hours.updated_at, data.settings.rules.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const nums = (s: string) => s.split(/[,،\s]+/).filter(Boolean).map(Number);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/settings", { method: "PUT", body: { work_hours: { tz: wh.tz, days: wh.days, start: wh.start, end: wh.end }, rules } });
      toast("ok", "حُفظت الإعدادات وستُطبّق على التذكيرات القادمة.");
      done();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack">
      <h2>ساعات العمل وقواعد التذكير</h2>
      {data.settings.work_hours.value.assumed ? <Alert kind="warn">ساعات العمل الحالية افتراض أولي (الأحد–الخميس 09:00–18:00 بتوقيت بغداد). صحّحها إن لزم.</Alert> : null}
      <div className="field">
        <span className="label">أيام العمل</span>
        <div className="seg">
          {DAYS.map((d, i) => (
            <button key={d} aria-pressed={wh.days.includes(i)} onClick={() => setWh({ ...wh, days: wh.days.includes(i) ? wh.days.filter((x) => x !== i) : [...wh.days, i].sort() })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <Field label="بداية الدوام" htmlFor="ws">
          <input id="ws" className="input" type="time" value={wh.start} onChange={(e) => setWh({ ...wh, start: e.target.value })} />
        </Field>
        <Field label="نهاية الدوام" htmlFor="we">
          <input id="we" className="input" type="time" value={wh.end} onChange={(e) => setWh({ ...wh, end: e.target.value })} />
        </Field>
      </div>
      <Field label="المنطقة الزمنية" htmlFor="tz">
        <input id="tz" className="input ltr" style={{ display: "block" }} dir="ltr" value={wh.tz} onChange={(e) => setWh({ ...wh, tz: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="عدم الاستلام — عادية (دقائق عمل)" htmlFor="an" help="تذكير، ثم تصعيد ثلاث مراحل">
          <input id="an" className="input ltr" dir="ltr" defaultValue={rules.ack.normal.join(", ")} onChange={(e) => setRules({ ...rules, ack: { ...rules.ack, normal: nums(e.target.value) } })} />
        </Field>
        <Field label="عدم الاستلام — عاجلة" htmlFor="au">
          <input id="au" className="input ltr" dir="ltr" defaultValue={rules.ack.urgent.join(", ")} onChange={(e) => setRules({ ...rules, ack: { ...rules.ack, urgent: nums(e.target.value) } })} />
        </Field>
        <Field label="تذكير قبل الموعد — عادية" htmlFor="dn">
          <input id="dn" className="input ltr" dir="ltr" type="number" value={rules.dueSoonMinutes.normal} onChange={(e) => setRules({ ...rules, dueSoonMinutes: { ...rules.dueSoonMinutes, normal: Number(e.target.value) } })} />
        </Field>
        <Field label="متابعة العائق بعد (دقائق عمل)" htmlFor="bn">
          <input id="bn" className="input ltr" dir="ltr" type="number" value={rules.blockerFollowMinutes.normal} onChange={(e) => setRules({ ...rules, blockerFollowMinutes: { ...rules.blockerFollowMinutes, normal: Number(e.target.value) } })} />
        </Field>
        <Field label="انتظار المراجعة — تذكير، تصعيد" htmlFor="rn">
          <input id="rn" className="input ltr" dir="ltr" defaultValue={rules.reviewMinutes.normal.join(", ")} onChange={(e) => setRules({ ...rules, reviewMinutes: { ...rules.reviewMinutes, normal: nums(e.target.value) } })} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={rules.urgentOutsideHours} onChange={(e) => setRules({ ...rules, urgentOutsideHours: e.target.checked })} />
        السماح بتنبيهات المهام العاجلة خارج الدوام
      </label>
      <label className="check">
        <input type="checkbox" checked={rules.demoReminders} onChange={(e) => setRules({ ...rules, demoReminders: e.target.checked })} />
        تشغيل التذكيرات للمهام التجريبية
      </label>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <span>
        <Button className="primary" busy={busy} onClick={save}>
          حفظ الإعدادات
        </Button>
      </span>
      <p className="tiny muted">
        آخر تعديل: {fmtFull(data.settings.rules.updated_at)}
        {data.settings.rules.updated_by ? ` بواسطة ${data.settings.rules.updated_by}` : ""}
      </p>
    </section>
  );
}
