import { useEffect, useState, type ReactNode } from "react";
import { api } from "./lib/api";
import { Link, match, navigate, useLocation } from "./lib/router";
import { SessionProvider, useSession } from "./lib/session";
import { IBell, ICalendar, IShield, ITasks, IToday, IUser } from "./ui/icons";
import { ErrorBox, Loading, ToastProvider } from "./ui/kit";
import { AccountPage } from "./pages/Account";
import { AdminPage } from "./pages/Admin";
import { CalendarPage } from "./pages/Calendar";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { LoginPage } from "./pages/Login";
import { NewTaskPage } from "./pages/NewTask";
import { NotificationsPage } from "./pages/Notifications";
import { SetupPage } from "./pages/Setup";
import { TaskPage } from "./pages/Task";
import { TasksPage } from "./pages/Tasks";
import { TodayPage } from "./pages/Today";

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Root />
      </SessionProvider>
    </ToastProvider>
  );
}

function Root() {
  const { path, full } = useLocation();
  const { me, loading, error, refresh } = useSession();

  if (path === "/setup") return <SetupPage />;
  if (loading) return <Splash />;
  if (path === "/login") return <LoginPage />;
  if (!me) {
    if (error) {
      return (
        <div className="login-wrap">
          <div className="login-card">
            <ErrorBox error={error} retry={refresh} />
          </div>
        </div>
      );
    }
    return <Redirect to={`/login?next=${encodeURIComponent(full)}`} />;
  }
  if (me.user.must_change_password) return <ChangePasswordPage forced />;
  return (
    <Shell>
      <Routes path={path} />
    </Shell>
  );
}

function Routes({ path }: { path: string }) {
  const { me } = useSession();
  if (path === "/" || path === "/today") return <TodayPage />;
  if (path === "/tasks") return <TasksPage />;
  if (path === "/tasks/new") return me!.user.role === "photographer" ? <NotFound /> : <NewTaskPage />;
  const t = match("/tasks/:id", path);
  if (t) return <TaskPage key={t.id} id={t.id} />;
  if (path === "/calendar") return <CalendarPage />;
  if (path === "/notifications") return <NotificationsPage />;
  if (path === "/account") return <AccountPage />;
  if (path === "/account/password") return <ChangePasswordPage />;
  if (path === "/admin") return me!.user.role === "owner" ? <AdminPage /> : <NotFound />;
  return <NotFound />;
}

function NotFound() {
  return (
    <div className="state">
      <h1>الصفحة غير موجودة</h1>
      <p style={{ marginTop: 8 }}>
        <Link to="/">العودة إلى اليوم</Link>
      </p>
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Splash() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <Loading rows={2} />
      </div>
    </div>
  );
}

function useUnread() {
  const [n, setN] = useState(0);
  const { path } = useLocation();
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api<{ unread: number }>("/api/notifications/unread")
        .then((r) => alive && setN(r.unread))
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [path]);
  return n;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function Shell({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const { me } = useSession();
  const unread = useUnread();
  const online = useOnline();
  const items = [
    { to: "/", label: "اليوم", icon: <IToday />, active: path === "/" || path === "/today" },
    { to: "/tasks", label: "المهام", icon: <ITasks />, active: path.startsWith("/tasks") },
    { to: "/calendar", label: "التقويم", icon: <ICalendar />, active: path === "/calendar" },
    { to: "/notifications", label: "التنبيهات", icon: <IBell />, active: path === "/notifications", badge: unread },
    { to: "/account", label: "الحساب", icon: <IUser />, active: path.startsWith("/account") },
  ];
  return (
    <div className="app">
      <nav className="nav" aria-label="التنقل الرئيسي">
        <div className="nav-brand">
          <img src="/icons/icon.svg" alt="" />
          <span>متابعة الوكالة</span>
        </div>
        {items.map((i) => (
          <Link key={i.to} to={i.to} aria-current={i.active ? "page" : undefined}>
            {i.icon}
            <span>{i.label}</span>
            {i.badge ? <span className="badge-dot" aria-label={`${i.badge} غير مقروء`}>{i.badge > 99 ? "99+" : i.badge}</span> : null}
          </Link>
        ))}
        {me?.user.role === "owner" ? (
          <Link to="/admin" className="admin-link" aria-current={path === "/admin" ? "page" : undefined}>
            <IShield />
            <span>الإدارة</span>
          </Link>
        ) : null}
      </nav>
      <div className="content-col">
        {!online ? <div className="offline-bar">لا يوجد اتصال بالشبكة. لن يُحفظ أي تغيير حتى يعود الاتصال.</div> : null}
        <header className="topbar">
          <div className="topbar-inner">
            <Link to="/" className="brand">
              <img src="/icons/icon.svg" alt="" />
              <span>متابعة الوكالة</span>
            </Link>
            <span className="small muted">{me?.user.name}</span>
          </div>
        </header>
        <main className="main" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
