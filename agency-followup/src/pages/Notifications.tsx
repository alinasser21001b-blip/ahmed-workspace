import { api } from "../lib/api";
import { Link, navigate, useTitle } from "../lib/router";
import { fmtAgo } from "../lib/time";
import { IBell } from "../ui/icons";
import { Button, ErrorBox, Loading, useApi, useToast } from "../ui/kit";

type N = { id: string; task_id: string | null; kind: string; title: string; body: string; url: string | null; deliver_at: string; read_at: string | null };

export function NotificationsPage() {
  useTitle("التنبيهات");
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<{ notifications: N[]; unread: number }>((signal) => api("/api/notifications", { signal }), [], { pollMs: 30_000 });

  const open = (n: N) => {
    if (!n.read_at) {
      // Shown as read only once the server saved it; offline it stays unread.
      api("/api/notifications/read", { body: { ids: [n.id] } })
        .then(() =>
          setData((d) => {
            // A second tap or a poll may have marked it already: count it once.
            if (!d || !d.notifications.some((x) => x.id === n.id && !x.read_at)) return d;
            return { ...d, unread: Math.max(0, d.unread - 1), notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) };
          }),
        )
        .catch(() => toast("error", "تعذّر تعليم التنبيه كمقروء"));
    }
    // The notification opens regardless; the server re-checks access to the task.
    if (n.url) navigate(n.url);
  };
  const readAll = async () => {
    try {
      await api("/api/notifications/read", { body: { all: true } });
      reload();
    } catch {
      toast("error", "تعذّر التحديث");
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>التنبيهات</h1>
          <p className="sub">كل التنبيهات محفوظة هنا حتى لو لم تصل على الجهاز.</p>
        </div>
        {data?.unread ? (
          <Button className="small" onClick={readAll}>
            تعليم الكل كمقروء
          </Button>
        ) : null}
      </div>
      <p className="small">
        لتصلك التنبيهات والتطبيق مغلق: <Link to="/account">فعّل إشعارات جهازك من صفحة الحساب</Link>.
      </p>
      {loading ? <Loading /> : null}
      {error && !data ? <ErrorBox error={error} retry={reload} /> : null}
      {data && !data.notifications.length ? (
        <div className="state">
          <IBell />
          <p>لا تنبيهات بعد.</p>
        </div>
      ) : null}
      <div className="stack" style={{ gap: 6 }}>
        {data?.notifications.map((n) => (
          <button key={n.id} className={`notif ${n.read_at ? "read" : "unread"}`} onClick={() => open(n)}>
            <span className="dot" aria-hidden="true" />
            <span className="stack wrap" style={{ gap: 2 }}>
              <strong style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</strong>
              {n.body ? <span className="small muted">{n.body}</span> : null}
              <span className="tiny muted">{fmtAgo(n.deliver_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
