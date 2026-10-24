import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { navigate, safeNext, useLocation, useTitle } from "../lib/router";
import { useSession } from "../lib/session";
import { Alert, Button, Field } from "../ui/kit";

export function LoginPage() {
  useTitle("تسجيل الدخول");
  const { query } = useLocation();
  const { refresh } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(query.get("next"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/sign-in/username", { body: { username: username.trim().toLowerCase(), password } });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit} noValidate>
        <div className="login-logo">
          <img src="/icons/icon.svg" alt="" />
          <div>
            <h1>متابعة الوكالة</h1>
            <p className="small muted">مساحة الفريق الداخلية</p>
          </div>
        </div>
        {next !== "/" ? <Alert kind="info">سجّل الدخول لفتح الصفحة المطلوبة.</Alert> : null}
        <Field label="اسم المستخدم" htmlFor="u">
          <input id="u" className="input ltr" style={{ display: "block" }} autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="كلمة المرور" htmlFor="p">
          <input id="p" className="input" type="password" autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Button className="primary block" type="submit" busy={busy} disabled={!username || !password}>
          دخول
        </Button>
        <p className="small muted">أول مرة؟ افتح رابط الإعداد الذي أرسله لك محمد لاختيار كلمة المرور. نسيت كلمة المرور؟ اطلب من محمد رابطاً جديداً.</p>
      </form>
    </div>
  );
}
