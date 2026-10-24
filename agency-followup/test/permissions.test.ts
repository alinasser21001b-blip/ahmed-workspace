import { beforeAll, describe, expect, it } from "vitest";
import { act, Browser, createTask, key, rows, team, task } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
const future = (h = 24) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeAll(async () => {
  T = await team();
});

const create = (as: Browser, fields: Record<string, unknown>) => as.post("/api/tasks", { title: "مهمة اختبار", priority: "normal", ...fields }, { "idempotency-key": key() });

describe("§14.1 Mohammed assigns to each member", () => {
  it("§14.1 assigns Ammar, Sama, Hussein and himself; outside-team assignment grants that one task only", async () => {
    const toAmmar = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar" });
    const toSamaWard = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_sama", title: "مهمة ورد مشتركة مع سما" });
    const toHussein = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_hussein" });
    const toSelf = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_mohammed" });
    expect((await task(T.mohammed, toAmmar)).task.assignee.id).toBe("u_ammar");
    expect((await task(T.mohammed, toHussein)).task.assignee.id).toBe("u_hussein");
    expect((await task(T.mohammed, toSelf)).task.assignee.id).toBe("u_mohammed");

    const grants = await rows("select * from task_grants where task_id = ?", toSamaWard);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ user_id: "u_sama", granted_by: "u_mohammed" });
    expect(await rows("select * from events where task_id = ? and type = 'grant'", toSamaWard)).toHaveLength(1);
    expect(await rows("select * from task_grants where task_id in (?, ?, ?)", toAmmar, toHussein, toSelf)).toHaveLength(0);

    // The grant opens that task and nothing else on the client.
    expect((await T.sama.get(`/api/tasks/${toSamaWard}`)).status).toBe(200);
    expect((await T.sama.get(`/api/tasks/${toAmmar}`)).status).toBe(404);
    expect((await T.sama.get(`/api/tasks/${toSelf}`)).status).toBe(404);
    const list = await T.sama.get("/api/tasks?status=all");
    const wardIds = list.body.tasks.filter((t: any) => t.client.id === "c_ward").map((t: any) => t.id);
    expect(wardIds).toEqual([toSamaWard]);
  });
});

describe("§14.2 Ammar assigns to Sama and Hussein", () => {
  it("§14.2 Sama on the clinic, Hussein on both clients; never Mohammed; never Sama on Ward", async () => {
    expect((await create(T.ammar, { client_id: "c_obesity", assignee_id: "u_sama" })).status).toBe(201);
    expect((await create(T.ammar, { client_id: "c_obesity", assignee_id: "u_hussein" })).status).toBe(201);
    expect((await create(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein" })).status).toBe(201);
    const toOwner = await create(T.ammar, { client_id: "c_ward", assignee_id: "u_mohammed" });
    expect(toOwner.status).toBe(403);
    expect(toOwner.body.message).toBeTruthy();
    expect((await create(T.ammar, { client_id: "c_obesity", assignee_id: "u_mohammed" })).status).toBe(403);
    expect((await create(T.ammar, { client_id: "c_ward", assignee_id: "u_sama" })).status).toBe(403);
  });
});

describe("§14.3 Sama assigns to Hussein", () => {
  it("§14.3 Hussein and herself on the clinic; not Ammar or Mohammed; no Ward tasks", async () => {
    expect((await create(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" })).status).toBe(201);
    expect((await create(T.sama, { client_id: "c_obesity", assignee_id: "u_sama" })).status).toBe(201);
    expect((await create(T.sama, { client_id: "c_obesity", assignee_id: "u_ammar" })).status).toBe(403);
    expect((await create(T.sama, { client_id: "c_obesity", assignee_id: "u_mohammed" })).status).toBe(403);
    expect((await create(T.sama, { client_id: "c_ward", assignee_id: "u_hussein" })).status).toBe(404);
    expect((await create(T.sama, { client_id: "c_ward", assignee_id: "u_sama" })).status).toBe(404);
  });
});

describe("§14.4 Sama is kept out of Ward tasks", () => {
  it("§14.4 by URL, edit, actions, comments, subtask parent and payload", async () => {
    const ward = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein", title: "ورد: لا تراه سما" });
    const v = (await task(T.ammar, ward)).task.version;
    const get = await T.sama.get(`/api/tasks/${ward}`);
    expect(get.status).toBe(404);
    expect(JSON.stringify(get.body)).not.toContain("لا تراه سما");
    expect((await T.sama.patch(`/api/tasks/${ward}`, { version: v, title: "تعديل" })).status).toBe(404);
    for (const a of ["ack", "start", "cancel", "approve", "archive", "escalate", "block"]) {
      expect((await T.sama.post(`/api/tasks/${ward}/actions/${a}`, { version: v, reason: "سبب كافٍ", kind: "internal" })).status, a).toBe(404);
    }
    expect((await T.sama.post(`/api/tasks/${ward}/comments`, { body: "تعليق", client_key: key() })).status).toBe(404);
    expect((await create(T.sama, { client_id: "c_obesity", parent_id: ward, assignee_id: "u_hussein" })).status).toBe(404);
    expect((await create(T.sama, { client_id: "c_ward", assignee_id: "u_hussein" })).status).toBe(404);
    expect((await T.sama.post("/api/bookings", { client_id: "c_ward", title: "حجز", starts_at: future(100), ends_at: future(101), create_key: key() })).status).toBe(403);
    expect((await task(T.ammar, ward)).task.version).toBe(v);
    expect(await rows("select * from comments where task_id = ?", ward)).toHaveLength(0);
  });
});

describe("§14.5 Hussein's limits", () => {
  it("§14.5 404 on others' tasks; cannot create, assign, approve own work, or change due date, priority or owner; no admin", async () => {
    const samaSelf = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_sama" });
    const ammarSelf = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_ammar" });
    expect((await T.hussein.get(`/api/tasks/${samaSelf}`)).status).toBe(404);
    expect((await T.hussein.get(`/api/tasks/${ammarSelf}`)).status).toBe(404);
    for (const client_id of ["c_obesity", "c_ward"]) {
      const r = await create(T.hussein, { client_id, assignee_id: "u_hussein" });
      expect([403, 404]).toContain(r.status);
    }

    const mine = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: future(48) });
    const before = (await task(T.hussein, mine)).task;
    expect((await T.hussein.patch(`/api/tasks/${mine}`, { version: before.version, due_at: future(72), reason: "أحتاج وقتاً" })).status).toBe(403);
    expect((await T.hussein.patch(`/api/tasks/${mine}`, { version: before.version, priority: "urgent", reason: "مستعجلة" })).status).toBe(403);
    expect((await T.hussein.patch(`/api/tasks/${mine}`, { version: before.version, assignee_id: "u_sama", reason: "ليست لي" })).status).toBe(403);
    expect((await act(T.hussein, mine, "cancel", { reason: "لا أريدها" })).status).toBe(403);

    // He may propose a date; it does not change the due date.
    expect((await act(T.hussein, mine, "propose_due", { proposed_due_at: future(72), reason: "التصوير يحتاج يوماً إضافياً" })).status).toBe(200);
    const proposal = (await task(T.hussein, mine)).due_proposals[0];
    expect((await act(T.hussein, mine, "decide_due", { proposal_id: proposal.id, accept: true })).status).toBe(403);
    expect((await task(T.hussein, mine)).task.due_at).toBe(before.due_at);

    expect((await act(T.hussein, mine, "start")).status).toBe(200);
    expect((await act(T.hussein, mine, "submit", { url: "https://drive.example/folder" })).status).toBe(200);
    expect((await act(T.hussein, mine, "approve")).status).toBe(403);
    expect((await task(T.hussein, mine)).task.status).toBe("in_review");

    for (const p of ["/api/admin/overview", "/api/admin/export", "/api/admin/export?format=csv"]) expect((await T.hussein.get(p)).status, p).toBe(403);
    expect((await T.hussein.post("/api/admin/members/u_sama/reset")).status).toBe(403);
    expect((await T.hussein.post("/api/bookings", { client_id: "c_obesity", title: "حجز", starts_at: future(100), ends_at: future(101), create_key: key() })).status).toBe(403);
  });
});

describe("§14.6 Ammar cannot touch roles or security settings", () => {
  it("§14.6 admin endpoints refuse him; no endpoint changes a role", async () => {
    expect((await T.ammar.get("/api/admin/overview")).status).toBe(403);
    expect((await T.ammar.get("/api/admin/export")).status).toBe(403);
    expect((await T.ammar.post("/api/admin/members/u_mohammed/reset")).status).toBe(403);
    expect((await T.ammar.post("/api/admin/members/u_sama/reset")).status).toBe(403);
    expect((await T.ammar.post("/api/admin/demo/seed")).status).toBe(403);
    expect((await T.ammar.post("/api/admin/demo/archive")).status).toBe(403);
    expect((await T.ammar.json("PUT", "/api/admin/settings", { work_hours: { tz: "UTC", days: [0], start: "00:00", end: "23:00" }, rules: {} })).status).toBe(403);

    for (const [m, p] of [
      ["POST", "/api/auth/update-user"],
      ["POST", "/api/auth/admin/set-role"],
      ["POST", "/api/auth/sign-up/email"],
      ["PATCH", "/api/account/me"],
      ["POST", "/api/account/role"],
      ["PATCH", "/api/admin/members/u_ammar"],
    ] as const) {
      const r = await T.ammar.json(m, p, { role: "owner", userId: "u_ammar", rank: 3 });
      expect([403, 404], `${m} ${p}`).toContain(r.status);
      expect(typeof r.body).toBe("object");
    }
    const me = await T.ammar.get("/api/account/me");
    expect(me.body.user.role).toBe("exec");
    expect(await rows("select role, rank from members where user_id = 'u_ammar'")).toEqual([{ role: "exec", rank: 2 }]);
    expect(await rows("select role, rank from members where user_id = 'u_mohammed'")).toEqual([{ role: "owner", rank: 3 }]);
  });

  it("§14.6 identity fields in a payload are ignored, never trusted", async () => {
    const r = await create(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", requester_id: "u_mohammed", role: "owner", userId: "u_mohammed" });
    expect(r.status).toBe(201);
    expect((await task(T.sama, r.body.id)).task.requester.id).toBe("u_sama");
  });
});

describe("§14.7 nothing leaks through lists, search, counters, notifications or export", () => {
  it("§14.7 Sama never sees a Ward title; Hussein never sees work he is not part of", async () => {
    const SECRET = "سر-ورد-7Q";
    const PRIVATE = "خاص-عمار-9Z";
    const wardTask = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein", title: `${SECRET} تصوير` });
    await T.ammar.post(`/api/tasks/${wardTask}/comments`, { body: `${SECRET} تعليق`, client_key: key() });
    expect((await act(T.hussein, wardTask, "block", { kind: "client_wait", reason: `${SECRET} بانتظار المستشفى` })).status).toBe(200);
    const ammarPrivate = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_ammar", title: PRIVATE });
    const CLINIC_SELF = "عيادة-سما-4K";
    const clinicSelf = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_sama", title: CLINIC_SELF });

    const samaViews = await Promise.all([
      T.sama.get("/api/tasks"),
      T.sama.get("/api/tasks?status=all"),
      T.sama.get(`/api/tasks?q=${encodeURIComponent(SECRET)}`),
      T.sama.get("/api/tasks?client=c_ward&status=all"),
      T.sama.get("/api/today"),
      T.sama.get("/api/today?client=c_ward"),
      T.sama.get("/api/notifications"),
      T.sama.get("/api/bookings"),
      T.sama.get("/api/account/me"),
    ]);
    for (const v of samaViews) {
      expect(v.status).toBe(200);
      expect(JSON.stringify(v.body)).not.toContain(SECRET);
      expect(JSON.stringify(v.body)).not.toContain(PRIVATE);
    }
    expect((await T.sama.get(`/api/tasks?q=${encodeURIComponent(SECRET)}`)).body.tasks).toHaveLength(0);
    expect((await T.sama.get("/api/admin/export")).status).toBe(403);
    expect((await T.ammar.get("/api/admin/export?format=csv")).status).toBe(403);
    const samaNotes = await rows("select n.* from notifications n join tasks t on t.id = n.task_id where n.user_id = 'u_sama' and t.client_id = 'c_ward' and t.id not in (select task_id from task_grants where user_id = 'u_sama')");
    expect(samaNotes).toHaveLength(0);
    expect(JSON.stringify(await rows("select title, body from notifications where user_id = 'u_sama'"))).not.toContain(SECRET);

    // Counters equal the visible list.
    const today = samaViews[4].body;
    const open = samaViews[0].body.tasks;
    expect(today.counts.waiting_ack).toBe(open.filter((t: any) => t.flags.waiting_ack).length);
    expect(today.counts.blocked).toBe(open.filter((t: any) => t.flags.blocked).length);

    const husseinViews = await Promise.all([T.hussein.get("/api/tasks?status=all"), T.hussein.get(`/api/tasks?q=${encodeURIComponent(PRIVATE)}`), T.hussein.get("/api/today")]);
    for (const v of husseinViews) {
      expect(JSON.stringify(v.body)).not.toContain(PRIVATE);
      expect(JSON.stringify(v.body)).not.toContain(CLINIC_SELF);
      for (const t of v.body.tasks ?? []) expect([t.assignee?.id, t.reviewer?.id, t.requester?.id]).toContain("u_hussein");
    }
    expect(JSON.stringify(husseinViews[0].body)).toContain(SECRET); // his own Ward task is visible to him
    expect((await T.hussein.get(`/api/tasks/${ammarPrivate}`)).status).toBe(404);
    expect((await T.hussein.get(`/api/tasks/${clinicSelf}`)).status).toBe(404);

    // The owner's export does include everything.
    const exp = await T.mohammed.raw("GET", "/api/admin/export");
    expect(exp.status).toBe(200);
    expect(await exp.text()).toContain(SECRET);
    const csv = await T.mohammed.raw("GET", "/api/admin/export?format=csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain(PRIVATE);
  });
});
