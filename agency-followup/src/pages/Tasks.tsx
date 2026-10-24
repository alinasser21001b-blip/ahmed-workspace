import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Link, navigate, useLocation, useTitle } from "../lib/router";
import { useMe } from "../lib/session";
import { IPlus, ISearch } from "../ui/icons";
import { ErrorBox, Loading, useApi } from "../ui/kit";
import { TaskList, type TaskSummary } from "../ui/TaskCard";

export function TasksPage() {
  useTitle("المهام");
  const me = useMe();
  const { query } = useLocation();
  const [q, setQ] = useState(query.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const status = query.get("status") ?? "open";
  const client = query.get("client") ?? "";
  const mine = query.get("mine") === "1";
  const archived = query.get("archived") === "1";

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(query);
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
    navigate(`/tasks${p.toString() ? `?${p}` : ""}`, { replace: true });
  };

  const qs = new URLSearchParams({ status, ...(client ? { client } : {}), ...(mine ? { mine: "1" } : {}), ...(debounced ? { q: debounced } : {}), ...(archived ? { archived: "1" } : {}) });
  const { data, error, loading, reload } = useApi<{ tasks: TaskSummary[] }>((signal) => api(`/api/tasks?${qs}`, { signal }), [qs.toString()], { pollMs: 60_000 });

  return (
    <div className="stack">
      <div className="page-head">
        <h1>المهام</h1>
        {me.user.role !== "photographer" ? (
          <Link to="/tasks/new" className="btn primary small">
            <IPlus />
            مهمة جديدة
          </Link>
        ) : null}
      </div>
      <div className="search">
        <ISearch />
        <input className="input" type="search" placeholder="ابحث في العناوين والوصف" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      </div>
      <div className="seg" role="group" aria-label="الحالة">
        {[
          ["open", "مفتوحة"],
          ["in_review", "بانتظار المراجعة"],
          ["done", "مكتملة وملغاة"],
          ["all", "الكل"],
        ].map(([v, l]) => (
          <button key={v} aria-pressed={status === v} onClick={() => setParam("status", v === "open" ? null : v)}>
            {l}
          </button>
        ))}
      </div>
      <div className="row">
        {me.user.role !== "photographer" && me.clients.length > 1 ? (
          <select className="input" style={{ width: "auto", flex: "1 1 180px" }} value={client} onChange={(e) => setParam("client", e.target.value)} aria-label="العميل">
            <option value="">كل العملاء</option>
            {me.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        {me.user.role !== "photographer" ? (
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setParam("mine", e.target.checked ? "1" : null)} />
            المسندة إليّ فقط
          </label>
        ) : null}
        {me.user.role === "owner" ? (
          <label className="check">
            <input type="checkbox" checked={archived} onChange={(e) => setParam("archived", e.target.checked ? "1" : null)} />
            المؤرشفة
          </label>
        ) : null}
      </div>
      {loading ? <Loading /> : null}
      {error && !data ? <ErrorBox error={error} retry={reload} /> : null}
      {data ? <TaskList tasks={data.tasks} empty={debounced ? "لا نتائج مطابقة." : "لا مهام هنا."} /> : null}
    </div>
  );
}
