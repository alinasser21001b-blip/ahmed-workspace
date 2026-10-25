// Waiting on others is not the assignee's lateness (§6, §8, §12, §14.13), the
// due-soon reminder counts working minutes, and the start-of-day summary.
// The scheduler runs on an injected clock B; API actions run on the real
// clock, so the times that matter are set with SQL relative to the clock in use.

import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCtx } from "../worker/db";
import { drainOutbox, runScheduler } from "../worker/scheduler";
import { act, baseSunday, createTask, noteCounts, plus, rows, sql, task, team } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
// Sunday 09:00 Baghdad, weeks ahead of the real clock so every API date check passes.
const B = baseSunday(4);
const run = (minutes: number, base = B) => runScheduler(env, plus(base, minutes), { push: false });
const iso = (t: Date) => t.toISOString();
const DUE = ["due_soon", "overdue", "overdue_escalation"];
const only = (c: Record<string, number>, kinds: string[]) => Object.fromEntries(Object.entries(c).filter(([k]) => kinds.includes(k.split(":")[1])));
const bodies = (id: string) => rows<{ kind: string; body: string }>("select kind, body from notifications where task_id = ? and kind in ('due_soon', 'overdue', 'overdue_escalation') order by kind", id);

beforeAll(async () => {
  T = await team();
});

describe("§14.13 time spent waiting on others is given back on the deadline", () => {
  it("§14.13 a client wait across the deadline: nothing on resolve, then one overdue and one escalation when his own time runs out", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: iso(plus(B, 120)) }); // Sunday 11:00
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    expect((await act(T.hussein, id, "block", { kind: "client_wait", reason: "العيادة لم ترسل المنتج" })).status).toBe(200);
    const b = (await task(T.sama, id)).blockers[0];
    // He waits on the clinic from 10:00 to 12:30: 150 working minutes, so his own deadline moves from 11:00 to 13:30.
    await sql("update blockers set opened_at = ? where id = ?", iso(plus(B, 60)), b.id);
    await run(130);
    expect(only(await noteCounts(id), DUE)).toEqual({});

    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "وصل المنتج" })).status).toBe(200);
    await sql("update blockers set resolved_at = ? where id = ?", iso(plus(B, 210)), b.id);
    await run(211);
    // 59 working minutes of his own are left: a due-soon reminder, no overdue and no escalation.
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1 });
    await run(270);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1 });

    await run(271);
    await run(275);
    await run(400);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1, "hussein:overdue": 1, "sama:overdue_escalation": 1 });
    for (const n of await bodies(id)) expect(n.body).toContain("بعد احتساب وقت الانتظار");
    // The waiting history is kept.
    expect((await task(T.sama, id)).blockers[0]).toMatchObject({ opened_at: iso(plus(B, 60)), resolved_at: iso(plus(B, 210)) });
  });

  it("§6 a clarification request across the deadline does not count against him either", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: iso(plus(B, 120)) }); // Sunday 11:00
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    expect((await act(T.hussein, id, "clarify", { question: "أي خلفية نستخدم؟" })).status).toBe(200);
    const b = (await task(T.sama, id)).blockers[0];
    expect(b).toMatchObject({ kind: "clarification", resolver_id: "u_sama" });
    // Asked at 10:30, answered at 11:30: 60 minutes given back, so his own deadline is 12:00.
    await sql("update blockers set opened_at = ? where id = ?", iso(plus(B, 90)), b.id);
    await run(125);
    expect(only(await noteCounts(id), DUE)).toEqual({});
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "الخلفية البيضاء" })).status).toBe(200);
    await sql("update blockers set resolved_at = ? where id = ?", iso(plus(B, 150)), b.id);
    await run(151);
    await run(180);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1 });
    await run(181);
    await run(200);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1, "hussein:overdue": 1, "sama:overdue_escalation": 1 });
  });

  it("§14.13 an account manager waiting on her own client is still chased at the real deadline", async () => {
    const id = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama", due_at: iso(plus(B, 120)) });
    expect((await act(T.sama, id, "ack")).status).toBe(200);
    expect((await act(T.sama, id, "block", { kind: "client_wait", reason: "بانتظار موافقة العيادة" })).status).toBe(200);
    const d = await task(T.mohammed, id);
    expect(d.blockers[0].resolver_id).toBe("u_sama");
    expect(d.task.flags).toMatchObject({ blocked: true, blocked_kind: "client_wait", external_wait: false, blocker_resolver: { id: "u_sama", name: "سما" } });
    await sql("update blockers set opened_at = ? where id = ?", iso(plus(B, 30)), d.blockers[0].id);
    await run(61);
    expect(only(await noteCounts(id), DUE)).toEqual({ "sama:due_soon": 1 });
    await run(121);
    await run(130);
    expect(only(await noteCounts(id), DUE)).toEqual({ "sama:due_soon": 1, "sama:overdue": 1, "ammar:overdue_escalation": 1 });
    for (const n of await bodies(id)) expect(n.body).not.toContain("وقت الانتظار");
  });
});

describe("§14.13 the task flags keep lateness and waiting apart", () => {
  it("§14.13 GET /api/tasks/:id and the list: late by the clock, not on his own time, with the wait and its resolver shown", async () => {
    // These run on the real clock, so the task is placed on a Sunday 8 to 14 days ago.
    const P = baseSunday(-2);
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "WAIT-FLAGS", due_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    expect((await act(T.hussein, id, "block", { kind: "client_wait", reason: "العيادة لم ترد" })).status).toBe(200);
    const b = (await task(T.sama, id)).blockers[0];
    await sql("update tasks set due_at = ?, cycle_started_at = ? where id = ?", iso(plus(P, 60)), iso(P), id);
    await sql("update blockers set opened_at = ? where id = ?", iso(plus(P, 30)), b.id);

    const fromList = async () => (await T.sama.get("/api/tasks")).body.tasks.find((t: any) => t.id === id).flags;
    const waiting = { overdue: true, overdue_own: false, blocked: true, blocked_kind: "client_wait", external_wait: true, blocker_resolver: { id: "u_sama", name: "سما" }, late_business_minutes: 0 };
    for (const flags of [(await task(T.sama, id)).task.flags, await fromList()]) {
      expect(flags).toMatchObject(waiting);
      expect(flags.waited_business_minutes).toBeGreaterThan(30);
    }

    // Cleared at 11:00 that day: 90 minutes given back, his own time ran out at 11:30, and he is late from then on.
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "ردّت العيادة" })).status).toBe(200);
    await sql("update blockers set resolved_at = ? where id = ?", iso(plus(P, 120)), b.id);
    const cleared = { overdue: true, overdue_own: true, waited_business_minutes: 90, blocked: false, blocked_kind: null, blocker_resolver: null, external_wait: false };
    for (const flags of [(await task(T.sama, id)).task.flags, await fromList()]) {
      expect(flags).toMatchObject(cleared);
      expect(flags.late_business_minutes).toBeGreaterThan(0);
    }
    // A wait from an earlier cycle is not given back again.
    await sql("update tasks set cycle_started_at = ? where id = ?", iso(plus(P, 200)), id);
    expect((await task(T.sama, id)).task.flags).toMatchObject({ overdue: true, overdue_own: true, waited_business_minutes: 0 });
  });

  it("§6 an open clarification request stops the «not acknowledged» minutes from counting", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await sql("update tasks set ack_clock_from = ? where id = ?", iso(baseSunday(-2)), id);
    expect((await task(T.sama, id)).task.flags.unacked_business_minutes).toBeGreaterThan(0);
    expect((await act(T.hussein, id, "clarify", { question: "ما المقاس المطلوب؟" })).status).toBe(200);
    expect((await task(T.sama, id)).task.flags).toMatchObject({ waiting_ack: true, unacked_business_minutes: 0, blocked_kind: "clarification" });
  });

  it("§9 Today: answered questions and cleared blockers leave the lists that wait on them; Ammar sees each card once", async () => {
    const asked = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "TODAY-ASKED" });
    expect((await act(T.hussein, asked, "clarify", { question: "أي مدخل؟" })).status).toBe(200);
    const section = async (who: typeof T.sama, key: string) => ((await who.get("/api/today")).body.sections.find((s: any) => s.key === key)?.tasks ?? []).map((t: any) => t.id);
    expect(await section(T.hussein, "questions")).toContain(asked);
    expect(await section(T.sama, "awaiting_me")).toContain(asked);
    const b = (await task(T.sama, asked)).blockers[0];
    expect((await act(T.sama, asked, "resolve_blocker", { blocker_id: b.id, resolution: "المدخل الرئيسي" })).status).toBe(200);
    expect(await section(T.hussein, "questions")).not.toContain(asked);
    expect(await section(T.sama, "awaiting_me")).not.toContain(asked);

    // Not acknowledged → under «متابعة سما وحسين» only; a quiet task with a far due date → under «كل المهام المفتوحة».
    const quiet = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama", title: "TODAY-QUIET", due_at: new Date(Date.now() + 20 * 86_400_000).toISOString() });
    expect((await act(T.sama, quiet, "ack")).status).toBe(200);
    const today = (await T.ammar.get("/api/today")).body;
    const ids = (key: string) => today.sections.find((s: any) => s.key === key).tasks.map((t: any) => t.id) as string[];
    expect(ids("follow")).toContain(asked);
    expect(ids("open")).not.toContain(asked);
    expect(ids("open")).toContain(quiet);
    expect(ids("follow").filter((x) => ids("open").includes(x))).toEqual([]);
  });
});

describe("§8 due soon counts working minutes", () => {
  it("§8 a task due Monday 09:00 is reminded on Sunday at 17:00, not before, and is overdue from Monday 09:01", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: iso(plus(B, 1440)) });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    await run(300);
    await run(479); // Sunday 16:59: 61 working minutes left
    expect(only(await noteCounts(id), DUE)).toEqual({});
    await run(480); // Sunday 17:00: 60 left
    await run(481);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1 });
    await run(1440); // Monday 09:00, the deadline itself
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1 });
    await run(1441);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:due_soon": 1, "hussein:overdue": 1, "sama:overdue_escalation": 1 });
  });
});

describe("§8 start-of-day summary", () => {
  it("§8 one summary in the first working hour, none later the same day or on a day the first hour was missed, and again the next working day", async () => {
    const D = baseSunday(6); // its own week, Sunday 09:00
    const make = (title: string, due: Date) => createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar", title, due_at: iso(due) });
    for (const n of [1, 2, 3, 4]) await make(`SUM-TODAY-${n}`, plus(D, 240 + n)); // Sunday 13:01 … 13:04
    await make("SUM-LATER", plus(D, 3 * 1440 + 240)); // Wednesday
    const demo = await make("SUM-DEMO", plus(D, 300));
    await sql("update tasks set is_demo = 1 where id = ?", demo);
    const waiting = await make("SUM-WAITING", plus(D, 300));
    expect((await act(T.ammar, waiting, "block", { kind: "internal", reason: "بانتظار قرار محمد" })).status).toBe(200);

    const day = (offsetDays: number) => {
      const t = new Date(D.getTime() + offsetDays * 86_400_000 + 3 * 3_600_000); // the Baghdad calendar date
      return t.toISOString().slice(0, 10);
    };
    const summaries = () => rows<{ title: string; body: string; url: string; task_id: string | null; dedupe_key: string; id: string }>("select id, title, body, url, task_id, dedupe_key from notifications where user_id = 'u_ammar' and kind = 'daily_summary' order by dedupe_key");

    await run(-1, D); // 08:59, before working hours
    expect(await summaries()).toEqual([]);
    await run(0, D);
    await run(30, D);
    let got = await summaries();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ dedupe_key: `daily_summary:u_ammar:${day(0)}`, task_id: null, url: "/", title: "ملخص اليوم: 4 مهام عليك تسليمها اليوم" });
    expect(got[0].body).toBe("«SUM-TODAY-1»، «SUM-TODAY-2»، «SUM-TODAY-3» و…");
    // It goes to his devices like any other notification (he has none here, so it is skipped, not cancelled).
    await drainOutbox(await loadCtx(env, plus(D, 31)), 500);
    expect((await rows<{ status: string; task_id: string | null }>("select status, task_id from outbox where notification_id = ?", got[0].id))[0]).toEqual({ status: "skipped", task_id: null });

    await run(1440 + 10, D); // Monday 09:10: the next working day
    got = await summaries();
    expect(got.map((s) => s.dedupe_key)).toEqual([`daily_summary:u_ammar:${day(0)}`, `daily_summary:u_ammar:${day(1)}`]);
    expect(got[1].title).toBe("ملخص اليوم: 4 مهام عليك تسليمها اليوم"); // yesterday's four, now late; Wednesday's is not yet due

    await run(2 * 1440 + 120, D); // Tuesday 11:00, nothing ran in its first hour
    await run(2 * 1440 + 121, D);
    expect((await summaries()).map((s) => s.dedupe_key)).toEqual([`daily_summary:u_ammar:${day(0)}`, `daily_summary:u_ammar:${day(1)}`]);
  });
});
