import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { actorFor, loadCtx } from "../worker/db";
import {
  canAssignTo,
  canEditTask,
  canReviewTask,
  canViewTask,
  escalationChain,
  taskVisibilitySql,
  validReviewer,
  type Actor,
  type ClientRef,
  type Member,
  type ScopeLevel,
} from "../worker/policy";

const M: Record<string, Member> = {
  mohammed: { id: "u_mohammed", username: "mohammed", name: "محمد", role: "owner", rank: 3, active: true },
  ammar: { id: "u_ammar", username: "ammar", name: "عمار", role: "exec", rank: 2, active: true },
  sama: { id: "u_sama", username: "sama", name: "سما", role: "account_manager", rank: 1, active: true },
  hussein: { id: "u_hussein", username: "hussein", name: "حسين", role: "photographer", rank: 0, active: true },
};
const members = Object.values(M);
const SCOPES: Record<string, Record<string, ScopeLevel>> = { u_sama: { c_obesity: "manage" }, u_ammar: { c_obesity: "oversee", c_ward: "manage" } };
const scopesOf = (id: string) => SCOPES[id] ?? {};
const A = (m: Member): Actor => ({ ...m, scopes: scopesOf(m.id) });
const clinic: ClientRef = { id: "c_obesity", account_manager_id: "u_sama", supervisor_id: "u_ammar" };
const ward: ClientRef = { id: "c_ward", account_manager_id: "u_ammar", supervisor_id: null };
const task = (o: Partial<{ client_id: string; requester_id: string; assignee_id: string; reviewer_id: string }>) => ({
  id: "t",
  client_id: "c_obesity",
  requester_id: "u_sama",
  assignee_id: "u_hussein",
  reviewer_id: "u_sama",
  status: "new",
  ...o,
});

describe("policy: canAssignTo", () => {
  it("owner assigns anyone; outside the client team needs a single-task grant", () => {
    expect(canAssignTo(A(M.mohammed), ward, M.sama, members)).toEqual({ ok: true, grant: true });
    expect(canAssignTo(A(M.mohammed), clinic, M.ammar, members)).toEqual({ ok: true, grant: false });
    expect(canAssignTo(A(M.mohammed), ward, M.hussein, members)).toEqual({ ok: true, grant: false });
    expect(canAssignTo(A(M.mohammed), clinic, M.mohammed, members)).toEqual({ ok: true, grant: false });
  });
  it("exec assigns sama (clinic) and hussein (both), never the owner, never sama on ward", () => {
    expect(canAssignTo(A(M.ammar), clinic, M.sama, members).ok).toBe(true);
    expect(canAssignTo(A(M.ammar), clinic, M.hussein, members).ok).toBe(true);
    expect(canAssignTo(A(M.ammar), ward, M.hussein, members).ok).toBe(true);
    expect(canAssignTo(A(M.ammar), ward, M.ammar, members).ok).toBe(true);
    expect(canAssignTo(A(M.ammar), ward, M.mohammed, members).ok).toBe(false);
    expect(canAssignTo(A(M.ammar), clinic, M.mohammed, members).ok).toBe(false);
    expect(canAssignTo(A(M.ammar), ward, M.sama, members).ok).toBe(false);
  });
  it("account manager assigns herself or hussein on her client only", () => {
    expect(canAssignTo(A(M.sama), clinic, M.hussein, members).ok).toBe(true);
    expect(canAssignTo(A(M.sama), clinic, M.sama, members).ok).toBe(true);
    expect(canAssignTo(A(M.sama), clinic, M.ammar, members).ok).toBe(false);
    expect(canAssignTo(A(M.sama), clinic, M.mohammed, members).ok).toBe(false);
    expect(canAssignTo(A(M.sama), ward, M.hussein, members).ok).toBe(false);
  });
  it("photographer assigns nobody; inactive members cannot be assigned", () => {
    for (const m of members) expect(canAssignTo(A(M.hussein), clinic, m, members).ok).toBe(false);
    expect(canAssignTo(A(M.mohammed), clinic, { ...M.hussein, active: false }, members).ok).toBe(false);
  });
});

describe("policy: validReviewer, canEditTask, canReviewTask", () => {
  it("validReviewer", () => {
    expect(validReviewer(clinic, M.sama, M.hussein, "u_sama", scopesOf).ok).toBe(false);
    expect(validReviewer(clinic, M.sama, M.sama, "u_ammar", scopesOf).ok).toBe(false);
    expect(validReviewer(ward, M.mohammed, M.mohammed, "u_mohammed", scopesOf).ok).toBe(true);
    expect(validReviewer(ward, M.hussein, M.sama, "u_ammar", scopesOf).ok).toBe(false);
    expect(validReviewer(clinic, M.hussein, M.sama, "u_sama", scopesOf).ok).toBe(true);
    expect(validReviewer(clinic, M.hussein, M.ammar, "u_sama", scopesOf).ok).toBe(true);
  });
  it("canEditTask follows standing and rank", () => {
    const samaReq = task({ requester_id: "u_sama" });
    expect(canEditTask(A(M.mohammed), samaReq, M.sama, M.hussein)).toBe(true);
    expect(canEditTask(A(M.sama), samaReq, M.sama, M.hussein)).toBe(true);
    expect(canEditTask(A(M.ammar), samaReq, M.sama, M.hussein)).toBe(true);
    expect(canEditTask(A(M.hussein), samaReq, M.sama, M.hussein)).toBe(false);
    const ammarReq = task({ requester_id: "u_ammar", reviewer_id: "u_ammar" });
    expect(canEditTask(A(M.sama), ammarReq, M.ammar, M.hussein)).toBe(false);
    const ownerReq = task({ client_id: "c_ward", requester_id: "u_mohammed", assignee_id: "u_ammar", reviewer_id: "u_mohammed" });
    expect(canEditTask(A(M.ammar), ownerReq, M.mohammed, M.ammar)).toBe(false);
    const ownerAssigned = task({ client_id: "c_ward", requester_id: "u_ammar", assignee_id: "u_mohammed", reviewer_id: "u_ammar" });
    expect(canEditTask(A(M.ammar), ownerAssigned, M.ammar, M.mohammed)).toBe(false);
  });
  it("canReviewTask: the named reviewer (not the assignee) or the owner", () => {
    const t = task({ reviewer_id: "u_sama" });
    expect(canReviewTask(A(M.sama), t)).toBe(true);
    expect(canReviewTask(A(M.ammar), t)).toBe(false);
    expect(canReviewTask(A(M.hussein), t)).toBe(false);
    expect(canReviewTask(A(M.mohammed), t)).toBe(true);
    expect(canReviewTask(A(M.hussein), task({ reviewer_id: "u_hussein" }))).toBe(false);
  });
});

describe("policy: escalationChain", () => {
  const names = (c: Member[]) => c.map((m) => m.username);
  it("matches the spec chains", () => {
    expect(names(escalationChain(M.hussein, clinic, members))).toEqual(["sama", "ammar", "mohammed"]);
    expect(names(escalationChain(M.hussein, ward, members))).toEqual(["ammar", "mohammed"]);
    expect(names(escalationChain(M.sama, clinic, members))).toEqual(["ammar", "mohammed"]);
    expect(names(escalationChain(M.sama, ward, members))).toEqual(["ammar", "mohammed"]);
    expect(names(escalationChain(M.ammar, ward, members))).toEqual(["mohammed"]);
    expect(names(escalationChain(M.ammar, clinic, members))).toEqual(["mohammed"]);
    expect(names(escalationChain(M.mohammed, ward, members))).toEqual([]);
  });
  it("skips inactive members", () => {
    const inactive = members.map((m) => (m.id === "u_sama" ? { ...m, active: false } : m));
    expect(names(escalationChain(M.hussein, clinic, inactive))).toEqual(["ammar", "mohammed"]);
  });
});

describe("policy: taskVisibilitySql matches canViewTask", () => {
  it("same answer for every member on a grid of tasks", async () => {
    const now = new Date().toISOString();
    const ids = ["u_mohammed", "u_ammar", "u_sama", "u_hussein"];
    const combos: { id: string; client: string; req: string; asg: string; rev: string; grant?: string }[] = [];
    let i = 0;
    for (const client of ["c_obesity", "c_ward"])
      for (const req of ids)
        for (const asg of ids)
          for (const rev of ["u_mohammed", "u_ammar", "u_sama"]) combos.push({ id: `pv_${i++}`, client, req, asg, rev, grant: i % 7 === 0 ? "u_hussein" : i % 11 === 0 ? "u_sama" : undefined });
    const stmts = combos.flatMap((c) => {
      const s = [
        env.DB.prepare(
          "insert into tasks (id, client_id, title, requester_id, assignee_id, reviewer_id, cycle_started_at, ack_clock_from, created_at, updated_at) values (?, ?, 'pv', ?, ?, ?, ?, ?, ?, ?)",
        ).bind(c.id, c.client, c.req, c.asg, c.rev, now, now, now, now),
      ];
      if (c.grant) s.push(env.DB.prepare("insert into task_grants (task_id, user_id, granted_by, reason, created_at) values (?, ?, 'u_mohammed', 'test', ?)").bind(c.id, c.grant, now));
      return s;
    });
    for (let k = 0; k < stmts.length; k += 50) await env.DB.batch(stmts.slice(k, k + 50));
    const ctx = await loadCtx(env);
    for (const uid of ids) {
      const actor = actorFor(ctx, uid)!;
      const vis = taskVisibilitySql(actor, "t");
      const got = new Set(
        (await env.DB.prepare(`select t.id from tasks t where ${vis.sql} and t.id like 'pv_%'`).bind(...vis.params).all<{ id: string }>()).results.map((r) => r.id),
      );
      for (const c of combos) {
        const expected = canViewTask(actor, { id: c.id, client_id: c.client, requester_id: c.req, assignee_id: c.asg, reviewer_id: c.rev, status: "new" }, c.grant === uid);
        expect(got.has(c.id), `${uid} ${JSON.stringify(c)}`).toBe(expected);
      }
    }
  });
});
