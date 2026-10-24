import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { navigate, useTitle } from "../lib/router";
import { useSession } from "../lib/session";
import { Alert, Button, Field, Loading } from "../ui/kit";

// The token travels in the URL fragment, which browsers never send to the
// server or in Referer headers; it is removed from the address bar at once.
let tokenFromUrl: string | null = null;
function takeToken(): string | null {
  if (tokenFromUrl === null) {
    tokenFromUrl = location.hash.replace(/^#/, "") || "";
    if (location.hash) history.replaceState(null, "", "/setup");
  }
  return tokenFromUrl || null;
}

export function SetupPage() {
  useTitle("إعداد الحساب");
  const { refresh } = useSession();
  const [token] = useState(takeToken);
  const [check, setCheck] = useState<{ valid: boolean; username?: string; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setCheck({ valid: false });
      return;
    }
    api("/api/setup/check", { body: { token } })
      .then(setCheck)
      .catch((e) => setError(e instanceof ApiError ? e.message : "تعذّر التحقق من الرابط"));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError("كلمتا المرور غير متطابقتين");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ signed_in: boolean }>("/api/setup/complete", { body: { token, password: pw } });
      tokenFromUrl = "";
      await refresh();
      navigate(r.signed_in ? "/account?welcome=1" : "/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّر حفظ كلمة المرور");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div className="login-logo">
          <img src="/icons/icon.svg" alt="" />
          <h1>إعداد حسابك</h1>
        </div>
        {!check && !error ? <Loading rows={1} /> : null}
        {check && !check.valid ? <Alert kind="error">الرابط غير صالح أو انتهت صلاحيته أو استُخدم مسبقاً. اطلب من محمد رابطاً جديداً.</Alert> : null}
        {check?.valid ? (
          <form className="stack" onSubmit={submit} noValidate>
            <p>
              أهلاً {check.name}. اسم المستخدم الخاص بك: <strong className="ltr">{check.username}</strong>
            </p>
            <p className="small muted">اختر كلمة مرور لا تقل عن 10 أحرف، ولا تشاركها مع أحد. الرابط يعمل مرة واحدة فقط.</p>
            <Field label="كلمة المرور الجديدة" htmlFor="p1">
              <input id="p1" className="input" type="password" autoComplete="new-password" dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} minLength={10} required />
            </Field>
            <Field label="أعد كتابة كلمة المرور" htmlFor="p2">
              <input id="p2" className="input" type="password" autoComplete="new-password" dir="ltr" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            </Field>
            <input type="text" autoComplete="username" value={check.username} readOnly hidden />
            {error ? <Alert kind="error">{error}</Alert> : null}
            <Button className="primary block" type="submit" busy={busy} disabled={pw.length < 10 || !pw2}>
              حفظ والدخول
            </Button>
          </form>
        ) : null}
        {error && !check?.valid ? <Alert kind="error">{error}</Alert> : null}
      </div>
    </div>
  );
}
