import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { navigate, useTitle } from "../lib/router";
import { useSession } from "../lib/session";
import { Alert, Button, Field, useToast } from "../ui/kit";

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  useTitle("تغيير كلمة المرور");
  const { refresh, me } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== next2) return setError("كلمتا المرور الجديدتان غير متطابقتين");
    setBusy(true);
    setError(null);
    try {
      await api("/api/account/password", { body: { current, next } });
      toast("ok", "تم تغيير كلمة المرور، وخرجت أجهزتك الأخرى من الحساب.");
      await refresh();
      navigate("/account", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تغيير كلمة المرور");
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form className="card stack" onSubmit={submit} noValidate>
      {forced ? <Alert kind="warn">يجب تغيير كلمة المرور المؤقتة قبل المتابعة.</Alert> : null}
      <input type="text" autoComplete="username" value={me?.user.username ?? ""} readOnly hidden />
      <Field label="كلمة المرور الحالية" htmlFor="c">
        <input id="c" className="input" type="password" autoComplete="current-password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label="كلمة المرور الجديدة" htmlFor="n" help="10 أحرف على الأقل.">
        <input id="n" className="input" type="password" autoComplete="new-password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label="أعد كتابة الجديدة" htmlFor="n2">
        <input id="n2" className="input" type="password" autoComplete="new-password" dir="ltr" value={next2} onChange={(e) => setNext2(e.target.value)} />
      </Field>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="form-actions">
        <Button className="primary" type="submit" busy={busy} disabled={!current || next.length < 10}>
          حفظ كلمة المرور
        </Button>
        {!forced ? (
          <button type="button" className="btn ghost" onClick={() => navigate("/account")}>
            رجوع
          </button>
        ) : null}
      </div>
    </form>
  );
  if (forced) {
    return (
      <div className="login-wrap">
        <div className="login-card stack">
          <h1>تغيير كلمة المرور</h1>
          {form}
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="page-head">
        <h1>تغيير كلمة المرور</h1>
      </div>
      {form}
    </div>
  );
}
