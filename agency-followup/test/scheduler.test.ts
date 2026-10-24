import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../worker/index";
import { loadCtx } from "../worker/db";
import { seedDemo } from "../worker/demo";
import { runScheduler } from "../worker/scheduler";
import { act, baseSunday, createTask, noteCounts, plus, rows, sql, team, task } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
// Sunday 09:00 Baghdad, comfortably in the future so every API date check passes.
const B = baseSunday(2);
const run = (minutes: number) => runScheduler(env, plus(B, minutes), { push: false });
const startClock = (id: string, at = B) => sql("update tasks set ack_clock_from = ?, cycle_started_at = ? where id = ?", at.toISOString(), at.toISOString(), id);
const only = (c: Record<string, number>, kinds: string[]) => Object.fromEntries(Object.entries(c).filter(([k]) => kinds.includes(k.split(":")[1])));
const ACK = ["ack_reminder", "ack_escalation"];

beforeAll(async () => {
  T = await team();
});

describe("§14.11 escalation: once per stage, the right chain", () => {
  it("§14.11 Hussein on the clinic: reminder at 60, then Sama 120, Ammar 240, Mohammed 480 — each once however often the cron runs", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await startClock(id);
    await run(59);
    expect(only(await noteCounts(id), ACK)).toEqual({});
    await run(60);
    await run(60);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1 });
    await run(121);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1, "sama:ack_escalation": 1 });
    await run(240);
    await Promise.all([run(480), run(480), run(481)]);
    await run(500);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1, "sama:ack_escalation": 1, "ammar:ack_escalation": 1, "mohammed:ack_escalation": 1 });
    const runs = await rows("select ok, summary from scheduler_runs order by id desc limit 1");
    expect(runs[0].ok).toBe(1);
    expect(JSON.parse(runs[0].summary)).toMatchObject({ inHours: true });
  });

  it("§14.11 Hussein on Ward → Ammar → Mohammed; Sama → Ammar → Mohammed; Ammar → Mohammed; Mohammed gets a reminder only", async () => {
    const ward = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein" });
    const sama = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama" });
    const ammar = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar" });
    const owner = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_mohammed" });
    for (const id of [ward, sama, ammar, owner]) await startClock(id);
    for (const m of [60, 120, 240, 480, 480, 530]) await run(m);
    expect(only(await noteCounts(ward), ACK)).toEqual({ "hussein:ack_reminder": 1, "ammar:ack_escalation": 1, "mohammed:ack_escalation": 1 });
    expect(only(await noteCounts(sama), ACK)).toEqual({ "sama:ack_reminder": 1, "ammar:ack_escalation": 1, "mohammed:ack_escalation": 1 });
    expect(only(await noteCounts(ammar), ACK)).toEqual({ "ammar:ack_reminder": 1, "mohammed:ack_escalation": 1 });
    expect(only(await noteCounts(owner), ACK)).toEqual({ "mohammed:ack_reminder": 1 });
    // Escalation never reassigns.
    expect((await task(T.mohammed, ward)).task.assignee.id).toBe("u_hussein");
  });

  it("§14.11 urgent work uses 15/30/60/120", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", priority: "urgent" });
    await startClock(id);
    await run(15);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1 });
    await run(30);
    await run(60);
    await run(120);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1, "sama:ack_escalation": 1, "ammar:ack_escalation": 1, "mohammed:ack_escalation": 1 });
  });

  it("§14.11 nothing is sent outside working hours; the next working start catches up", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    const thursdayEvening = plus(B, 4 * 1440 + 9 * 60 + 30); // Thu 18:30
    await startClock(id, plus(B, 4 * 1440 + 8 * 60)); // Thu 17:00
    await runScheduler(env, thursdayEvening, { push: false });
    await runScheduler(env, plus(B, 5 * 1440 + 180), { push: false }); // Friday noon
    expect(only(await noteCounts(id), ACK)).toEqual({});
    await runScheduler(env, plus(B, 7 * 1440 + 1), { push: false }); // next Sunday 09:01 → 61 business minutes
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1 });
  });
});

describe("§14.10 acknowledging stops its reminders", () => {
  it("§14.10 pending deliveries are cancelled and no later stage fires", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await startClock(id);
    await run(65);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1 });
    const pending = await rows("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind in ('assigned', 'ack_reminder')", id);
    expect(pending.map((p) => p.status)).toEqual(["pending", "pending"]);
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    const after = await rows("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind in ('assigned', 'ack_reminder')", id);
    expect(after.map((p) => p.status)).toEqual(["cancelled", "cancelled"]);
    for (const m of [121, 241, 481]) await run(m);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1 });
  });

  it("§14.10 an open clarification request pauses the acknowledgement clock; the answer restarts it", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await act(T.hussein, id, "clarify", { question: "ما المقاس المطلوب؟" });
    await startClock(id);
    await run(130);
    expect(only(await noteCounts(id), ACK)).toEqual({});
    const b = (await task(T.sama, id)).blockers[0];
    await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "مربع ومستطيل" });
    await sql("update tasks set ack_clock_from = ? where id = ?", plus(B, 140).toISOString(), id);
    await run(199);
    expect(only(await noteCounts(id), ACK)).toEqual({});
    await run(200);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1 });
    expect(await rows("select dedupe_key from notifications where task_id = ? and kind = 'ack_reminder'", id)).toEqual([{ dedupe_key: `ack:${id}:1:1:0` }]);
  });
});

describe("§14.12 changing the owner or the due date cancels old reminders and keeps the trace", () => {
  it("§14.12 reassignment starts a new cycle; the old assignee's pending reminders are cancelled", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await startClock(id);
    await run(130);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1, "sama:ack_escalation": 1 });
    const v = (await task(T.mohammed, id)).task.version;
    expect((await T.mohammed.patch(`/api/tasks/${id}`, { version: v, assignee_id: "u_ammar", reason: "حسين في إجازة" })).status).toBe(200);
    const old = await rows("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.task_cycle = 1", id);
    expect(old.length).toBeGreaterThan(0);
    expect(old.every((o) => o.status === "cancelled")).toBe(true);
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_ammar' and kind = 'reassigned' and task_cycle = 2", id)).toHaveLength(1);
    await startClock(id);
    await run(130);
    expect(only(await noteCounts(id), ACK)).toEqual({ "hussein:ack_reminder": 1, "sama:ack_escalation": 1, "ammar:ack_reminder": 1, "mohammed:ack_escalation": 1 });
    const d = await task(T.mohammed, id);
    expect(d.events.find((e: any) => e.type === "edited").data).toMatchObject({ reason: "حسين في إجازة", changes: { assignee_id: { from: "u_hussein", to: "u_ammar" } } });
    expect(d.events.filter((e: any) => e.type === "created")).toHaveLength(1);
  });

  it("§14.12 a new due date cancels pending overdue reminders, keeps the original date, and reminds again on the new date", async () => {
    const due = plus(B, 120).toISOString();
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: due });
    await act(T.hussein, id, "ack");
    const DUE = ["due_soon", "overdue", "overdue_escalation"];
    await run(130);
    await run(135);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:overdue": 1, "sama:overdue_escalation": 1 });
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, due_at: plus(B, 300).toISOString(), reason: "العيادة أجّلت" })).status).toBe(200);
    const cancelled = await rows("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind in ('overdue', 'overdue_escalation')", id);
    expect(cancelled.map((c) => c.status)).toEqual(["cancelled", "cancelled"]);
    const t = (await rows("select original_due_at, due_version from tasks where id = ?", id))[0];
    expect(t).toEqual({ original_due_at: due, due_version: 2 });
    await run(140);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:overdue": 1, "sama:overdue_escalation": 1 });
    await run(250);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:overdue": 1, "sama:overdue_escalation": 1, "hussein:due_soon": 1 });
    await run(310);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:overdue": 2, "sama:overdue_escalation": 2, "hussein:due_soon": 1 });
  });
});

describe("§14.13 blockers", () => {
  it("§14.13 waiting on the client: the resolver hears at once and is followed up; the photographer is not chased", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: plus(B, 60).toISOString() });
    await act(T.hussein, id, "ack");
    expect((await act(T.hussein, id, "block", { kind: "client_wait", reason: "العيادة لم ترسل المنتج" })).status).toBe(200);
    const d = await task(T.sama, id);
    const b = d.blockers[0];
    expect(b).toMatchObject({ kind: "client_wait", resolver_id: "u_sama", opened_by: "u_hussein" });
    expect(d.task.flags).toMatchObject({ blocked: true, blocked_kind: "client_wait", external_wait: true });
    expect(await noteCounts(id)).toMatchObject({ "sama:blocker_opened": 1 });

    await sql("update blockers set opened_at = ? where id = ?", B.toISOString(), b.id);
    const DUE = ["overdue", "overdue_escalation"];
    await run(90);
    expect(only(await noteCounts(id), DUE)).toEqual({});
    await run(120);
    await run(125);
    expect(only(await noteCounts(id), ["blocker_follow", "blocker_escalation"])).toEqual({ "sama:blocker_follow": 1 });
    await run(240);
    await run(245);
    expect(only(await noteCounts(id), ["blocker_follow", "blocker_escalation"])).toEqual({ "sama:blocker_follow": 1, "ammar:blocker_escalation": 1 });
    expect(only(await noteCounts(id), DUE)).toEqual({});

    // Resolving resumes measurement and keeps the waiting history.
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "وصل المنتج" })).status).toBe(200);
    await run(250);
    expect(only(await noteCounts(id), DUE)).toEqual({ "hussein:overdue": 1, "sama:overdue_escalation": 1 });
    const after = await task(T.sama, id);
    expect(after.blockers[0].resolved_at).toBeTruthy();
    expect(after.blockers[0].opened_at).toBe(B.toISOString());
    expect(after.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(["blocker_opened", "blocker_resolved"]));
  });

  it("§14.13 internal blockers go to the requester; the resolver must be able to see the task", async () => {
    const id = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein" });
    const bad = await act(T.hussein, id, "block", { kind: "internal", reason: "الكاميرا معطلة", resolver_id: "u_sama" });
    expect(bad.status).toBe(400);
    expect((await act(T.hussein, id, "block", { kind: "internal", reason: "الكاميرا معطلة" })).status).toBe(200);
    expect((await task(T.ammar, id)).blockers[0].resolver_id).toBe("u_ammar");
    expect(await noteCounts(id)).toMatchObject({ "ammar:blocker_opened": 1 });
  });
});

describe("review waiting", () => {
  it("§14.14 reminder to the reviewer at 120, escalation at 240; the owner as reviewer gets a reminder only", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await act(T.hussein, id, "start");
    await act(T.hussein, id, "submit", { url: "https://drive.example/r" });
    const own = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar" });
    await act(T.ammar, own, "start");
    await act(T.ammar, own, "submit", { evidence: "الخطة في الملف المشترك" });
    await sql("update tasks set submitted_at = ? where id in (?, ?)", B.toISOString(), id, own);
    const R = ["review_reminder", "review_escalation"];
    await run(119);
    expect(only(await noteCounts(id), R)).toEqual({});
    for (const m of [120, 125, 240, 300]) await run(m);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:review_reminder": 1, "ammar:review_escalation": 1 });
    expect(only(await noteCounts(own), R)).toEqual({ "mohammed:review_reminder": 1 });
  });
});

describe("demo data", () => {
  it("demo tasks are seeded once by the cron, marked, carry no links, and send no reminders by default", async () => {
    const ctrl = createScheduledController({ scheduledTime: Date.now(), cron: "* * * * *" });
    const ectx = createExecutionContext();
    await worker.scheduled!(ctrl, env, ectx);
    await waitOnExecutionContext(ectx);
    const demo = await rows("select id, title, is_demo from tasks where id like 't_demo_%'");
    expect(demo).toHaveLength(10);
    expect(demo.every((d) => d.is_demo === 1 && d.title.startsWith("تجريبي"))).toBe(true);
    expect(await rows("select * from deliverables where task_id like 't_demo_%' and url is not null")).toHaveLength(0);
    expect((await rows("select value from settings where key = 'demo_seed'"))[0].value).toBe("done");
    expect(await seedDemo(await loadCtx(env))).toBe(0);
    for (const m of [60, 480]) await run(m);
    expect(await rows("select * from notifications where task_id like 't_demo_%'")).toHaveLength(0);
    expect(await rows("select * from bookings where id like 'bk_demo_%' and status = 'active'")).toHaveLength(2);

    // Mohammed sees the planted conflict; Sama sees Ward demo work only as busy time.
    const today = (await T.mohammed.get("/api/today")).body;
    const kinds = today.conflicts.map((c: any) => c.kind);
    expect(kinds).toContain("refused_booking");
    const wardBooking = (await rows("select ends_at from bookings where id = 'bk_demo_04'"))[0];
    if (wardBooking.ends_at > new Date().toISOString()) expect(kinds).toContain("due_during_booking");
    const samaBookings = (await T.sama.get("/api/bookings?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z")).body.bookings;
    const wardForSama = samaBookings.filter((b: any) => b.id === "bk_demo_04");
    expect(wardForSama).toEqual([expect.objectContaining({ busy_only: true, title: "مشغول" })]);
    expect((await T.sama.get("/api/tasks/t_demo_01")).status).toBe(404);

    expect((await T.mohammed.post("/api/admin/demo/archive")).body.archived).toBe(10);
    expect((await T.hussein.get("/api/tasks/t_demo_03")).status).toBe(404);
    expect(await rows("select * from bookings where id like 'bk_demo_%' and status = 'active'")).toHaveLength(0);
  });
});
