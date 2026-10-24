import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Role } from "../../shared/domain";
import { api, ApiError, onUnauthenticated } from "./api";
import { navigate } from "./router";
import { setTimeZone } from "./time";

export type Me = {
  user: { id: string; username: string; name: string; role: Role; title: string; must_change_password: boolean };
  clients: { id: string; name: string; level: "owner" | "manage" | "oversee" }[];
  assignment: { client: { id: string; name: string }; assignees: { id: string; name: string; role: Role; outside_team: boolean }[]; reviewers: { id: string; name: string; role: Role }[] }[];
  members: { id: string; name: string; role: Role }[];
  work_hours: { tz: string; days: number[]; start: string; end: string; assumed?: boolean };
};

type Session = { me: Me | null; loading: boolean; error: unknown; refresh: () => Promise<void>; clear: () => void };
const Ctx = createContext<Session>({ me: null, loading: true, error: null, refresh: async () => {}, clear: () => {} });
export const useSession = () => useContext(Ctx);
export const useMe = () => useContext(Ctx).me!;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>("/api/account/me");
      setTimeZone(m.work_hours.tz);
      setMe(m);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
      else setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(
    () =>
      onUnauthenticated(() => {
        setMe(null);
        const here = location.pathname + location.search;
        if (!here.startsWith("/login") && !here.startsWith("/setup")) navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
      }),
    [],
  );
  return <Ctx.Provider value={{ me, loading, error, refresh, clear: () => setMe(null) }}>{children}</Ctx.Provider>;
}

export const ROLE_LABEL: Record<Role, string> = { owner: "مدير الوكالة", exec: "المدير التنفيذي", account_manager: "مسؤولة حساب", photographer: "المصور" };
