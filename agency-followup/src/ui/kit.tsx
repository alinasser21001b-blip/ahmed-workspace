import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type TaskStatus } from "../../shared/domain";
import { ApiError } from "../lib/api";
import { IAlert, ICheck, IClose, IInbox, IInfo, SAck, SCancelled, SChanges, SDone, SNew, SProgress, SReview } from "./icons";

const STATUS_ICON: Record<TaskStatus, (p: { width?: number }) => ReactNode> = {
  new: SNew,
  acknowledged: SAck,
  in_progress: SProgress,
  in_review: SReview,
  changes_requested: SChanges,
  done: SDone,
  cancelled: SCancelled,
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as TaskStatus;
  const Icon = STATUS_ICON[s] ?? SNew;
  return (
    <span className={`status ${s}`}>
      <Icon />
      {STATUS_LABEL[s] ?? status}
    </span>
  );
}

export function PriorityText({ p }: { p: string }) {
  if (p === "normal") return null;
  return <span className={`prio-${p}`}>{PRIORITY_LABEL[p as Priority]}</span>;
}

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

export function Button({ busy, children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className={`btn ${className}`} disabled={busy || rest.disabled} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="جارٍ التحميل">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="state">
      <IInbox />
      <p>{children}</p>
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : "حدث خطأ غير متوقع.";
  return (
    <div className="alert error" role="alert">
      <IAlert />
      <div className="stack" style={{ gap: 8 }}>
        <span>{msg}</span>
        {retry ? (
          <span>
            <button className="btn small" onClick={retry}>
              أعد المحاولة
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const Icon = kind === "ok" ? ICheck : kind === "info" ? IInfo : IAlert;
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

export function Field({ label, help, error, children, htmlFor }: { label: string; help?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help ? <span className="help">{help}</span> : null}
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass inline closures, and their pages re-render on every poll or
  // window focus. Focus moves only when the sheet opens, never on a re-render.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="إغلاق" data-close>
            <IClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- toasts: success only after the server confirmed ----------

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        <div className="stack" style={{ width: "100%", alignItems: "center", gap: 8 }}>
          {items.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
              {t.kind === "ok" ? <ICheck /> : t.kind === "error" ? <IAlert /> : <IInfo />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- data loading ----------

export function useApi<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    load(ac.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError(e);
      })
      .finally(() => !ac.signal.aborted && setLoading(false));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  useEffect(() => {
    if (!opts.pollMs) return;
    const refresh = () => document.visibilityState === "visible" && reload();
    const id = setInterval(refresh, opts.pollMs);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [opts.pollMs, reload]);
  return { data, error, loading: loading && data === null, refreshing: loading, reload, setData };
}
