import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { currentState, disablePushOnThisDevice, enablePush, isIOS, type PushState } from "../lib/push";
import { Link, navigate, useLocation, useTitle } from "../lib/router";
import { ROLE_LABEL, useMe, useSession } from "../lib/session";
import { fmtAgo } from "../lib/time";
import { IShield } from "../ui/icons";
import { Alert, Button, useToast } from "../ui/kit";

const STATE_TEXT: Record<PushState, { kind: "ok" | "warn" | "info" | "error"; text: string }> = {
  enabled: { kind: "ok", text: "الإشعارات مفعّلة على هذا الجهاز." },
  needs_permission: { kind: "info", text: "هذا المتصفح يدعم الإشعارات، ويحتاج إذنك." },
  denied: { kind: "error", text: "رفض هذا المتصفح الإشعارات. فعّلها من إعدادات المتصفح أو الهاتف لهذا الموقع، ثم ارجع هنا." },
  needs_install: { kind: "warn", text: "على الآيفون تعمل الإشعارات فقط بعد إضافة التطبيق إلى الشاشة الرئيسية وفتحه من هناك." },
  unsupported: { kind: "warn", text: "هذا المتصفح لا يدعم إشعارات الويب. استخدم Chrome على أندرويد أو Safari على آيفون بعد الإضافة للشاشة الرئيسية." },
  server_off: { kind: "warn", text: "إشعارات الأجهزة غير مهيأة على الخادم بعد. التنبيهات داخل التطبيق تعمل." },
};

export function AccountPage() {
  useTitle("الحساب");
  const me = useMe();
  const { clear } = useSession();
  const toast = useToast();
  const { query } = useLocation();
  const [state, setState] = useState<PushState | null>(null);
  const [server, setServer] = useState<{ configured: boolean; public_key: string | null; devices: { id: string; user_agent: string; last_success_at: string | null; this_session: number }[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const refreshPush = useCallback(async () => {
    try {
      const s = await api("/api/push/status");
      setServer(s);
      setState((await currentState(s.configured)).state);
    } catch {
      setState("unsupported");
    }
  }, []);
  useEffect(() => {
    void refreshPush();
  }, [refreshPush]);

  const enable = async () => {
    if (!server?.public_key) return;
    setBusy("enable");
    try {
      await enablePush(server.public_key);
      toast("ok", "فُعّلت الإشعارات على هذا الجهاز. أرسل إشعار اختبار للتأكد.");
    } catch (e) {
      const m = (e as Error).message;
      toast("error", m === "denied" ? "رُفض الإذن. فعّله من إعدادات المتصفح." : m === "dismissed" ? "لم يُمنح الإذن." : e instanceof ApiError ? e.message : "تعذّر تفعيل الإشعارات على هذا الجهاز.");
    } finally {
      setBusy(null);
      void refreshPush();
    }
  };

  const test = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const r = await api<{ configured: boolean; devices: number; sent: number; failed: number; expired: number }>("/api/push/test", { body: {} });
      if (!r.configured) setTestResult("الخادم غير مهيأ لإشعارات الأجهزة.");
      else if (!r.devices) setTestResult("لا يوجد جهاز مفعّل لحسابك. فعّل الإشعارات أولاً.");
      else if (r.sent) setTestResult(`أرسل الخادم الإشعار إلى ${r.sent} من ${r.devices} جهاز. إن لم يظهر خلال دقيقة فراجع إعدادات الإشعارات ووضع عدم الإزعاج في الهاتف.`);
      else setTestResult(`تعذّر الإرسال${r.expired ? "؛ انتهى اشتراك الجهاز، فعّل الإشعارات من جديد" : ""}.`);
    } catch (e) {
      setTestResult(e instanceof ApiError ? e.message : "تعذّر الإرسال");
    } finally {
      setBusy(null);
      void refreshPush();
    }
  };

  const logout = async () => {
    setBusy("logout");
    try {
      await disablePushOnThisDevice();
      await api("/api/auth/sign-out", { body: {} });
      clear();
      navigate("/login", { replace: true });
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "تعذّر تسجيل الخروج. تحقق من الاتصال.");
    } finally {
      setBusy(null);
    }
  };

  const signOutOthers = async () => {
    setBusy("others");
    try {
      await api("/api/account/sign-out-others", { body: {} });
      toast("ok", "خرجت كل الأجهزة الأخرى من حسابك.");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "تعذّر التنفيذ");
    } finally {
      setBusy(null);
    }
  };

  const st = state ? STATE_TEXT[state] : null;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{me.user.name}</h1>
          <p className="sub">
            {me.user.title} · <span className="ltr">{me.user.username}</span>
          </p>
        </div>
      </div>
      {query.get("welcome") ? <Alert kind="ok">أهلاً بك. حُفظت كلمة المرور. الخطوة المهمة الآن: فعّل إشعارات جهازك بالأسفل.</Alert> : null}

      <section className="card stack">
        <h2>إشعارات هذا الجهاز</h2>
        <p className="small muted">تصلك تنبيهات المهام الجديدة والتذكيرات والتصعيد حتى والتطبيق مغلق. نص شاشة القفل مختصر ولا يحتوي اسم العميل أو تفاصيل المهمة. لا يمكن ضمان الصوت أو تجاوز وضع الصامت وعدم الإزعاج.</p>
        {st ? <Alert kind={st.kind}>{st.text}</Alert> : null}
        {state === "needs_install" ? <IOSSteps /> : null}
        {state === "needs_permission" ? (
          <span>
            <Button className="primary" busy={busy === "enable"} onClick={enable}>
              فعّل إشعارات جهازي
            </Button>
          </span>
        ) : null}
        {state === "enabled" ? (
          <div className="row">
            <Button className="primary" busy={busy === "test"} onClick={test}>
              أرسل إشعار اختبار لي
            </Button>
            <Button className="small" busy={busy === "enable"} onClick={enable}>
              إعادة الربط
            </Button>
          </div>
        ) : null}
        {testResult ? <Alert kind="info">{testResult}</Alert> : null}
        {server?.devices.length ? (
          <p className="small muted">
            الأجهزة المفعّلة لحسابك: {server.devices.length}
            {server.devices.some((d) => d.last_success_at) ? ` · آخر وصول ناجح ${fmtAgo(server.devices.map((d) => d.last_success_at ?? "").sort().reverse()[0])}` : ""}
          </p>
        ) : null}
        {!isIOS() && state !== "enabled" && state !== "denied" ? (
          <details className="more">
            <summary>تثبيت التطبيق على أندرويد</summary>
            <ol className="steps small">
              <li>افتح الموقع في Chrome.</li>
              <li>من قائمة ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</li>
              <li>افتحه من الأيقونة ثم اضغط «فعّل إشعارات جهازي».</li>
            </ol>
          </details>
        ) : null}
      </section>

      <section className="card stack">
        <h2>الأمان</h2>
        <dl className="kv">
          <dt>الدور</dt>
          <dd>{ROLE_LABEL[me.user.role]}</dd>
        </dl>
        <div className="row">
          <Link to="/account/password" className="btn">
            تغيير كلمة المرور
          </Link>
          <Button busy={busy === "others"} onClick={signOutOthers}>
            إخراج الأجهزة الأخرى
          </Button>
        </div>
        <p className="tiny muted">الدور والصلاحيات يحددها مدير الوكالة فقط ولا تتغير من هنا.</p>
      </section>

      {me.user.role === "owner" ? (
        <Link to="/admin" className="btn">
          <IShield />
          الإدارة: الفريق والإعدادات والمجدول
        </Link>
      ) : null}

      <Button className="danger" busy={busy === "logout"} onClick={logout}>
        تسجيل الخروج من هذا الجهاز
      </Button>
      <p className="tiny muted">تسجيل الخروج يلغي ربط إشعارات هذا الجهاز بحسابك، فلا تصل تنبيهاتك لمن يستخدم الجهاز بعدك.</p>
    </div>
  );
}

function IOSSteps() {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <strong>خطوات الآيفون (iOS 16.4 أو أحدث):</strong>
      <ol className="steps small">
        <li>افتح هذا الموقع في Safari.</li>
        <li>اضغط زر المشاركة (المربع والسهم) أسفل الشاشة.</li>
        <li>اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».</li>
        <li>افتح «المتابعة» من أيقونتها على الشاشة الرئيسية، وسجّل الدخول.</li>
        <li>من صفحة الحساب اضغط «فعّل إشعارات جهازي» ثم «سماح».</li>
      </ol>
    </div>
  );
}
