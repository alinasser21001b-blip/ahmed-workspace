import { beforeAll, describe, expect, it } from "vitest";
import { act, createTask, key, rows, signIn, team, task } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
const future = (h = 24) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeAll(async () => {
  T = await team();
});

describe("§14.14 submit, review, approve", () => {
  it("§14.14 submission needs a link or written evidence; reviewer approves or asks for changes", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", template: "shoot_request" });
    expect((await task(T.hussein, id)).task.acceptance).toContain("اللقطات");
    expect((await act(T.hussein, id, "submit", { url: "https://x.example" })).status).toBe(403); // not acknowledged yet
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    const t1 = (await task(T.hussein, id)).task;
    expect(t1.status).toBe("acknowledged");
    expect(t1.acknowledged_at).toBeTruthy();

    const empty = await act(T.hussein, id, "submit", {});
    expect(empty.status).toBe(400);
    expect(empty.body.message).toContain("رابط");
    expect((await act(T.hussein, id, "submit", { evidence: "ok" })).status).toBe(400);
    expect((await act(T.hussein, id, "submit", { url: "javascript:alert(1)" })).status).toBe(400);
    expect((await act(T.hussein, id, "submit", { url: "https://drive.example/a", version_label: "نسخة 1" })).status).toBe(200);
    expect((await task(T.sama, id)).task.status).toBe("in_review");
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_sama' and kind = 'submitted'", id)).toHaveLength(1);

    expect((await act(T.hussein, id, "approve")).status).toBe(403);
    expect((await act(T.ammar, id, "approve")).status).toBe(403); // not the named reviewer
    expect((await act(T.sama, id, "request_changes", { note: "" })).status).toBe(400);
    expect((await act(T.sama, id, "request_changes", { note: "نحتاج لقطة أوسع للاستقبال" })).status).toBe(200);
    expect((await task(T.hussein, id)).task.status).toBe("changes_requested");
    expect((await act(T.hussein, id, "start")).status).toBe(200);
    expect((await act(T.hussein, id, "submit", { evidence: "أضفت اللقطة الواسعة في المجلد نفسه", version_label: "نسخة 2" })).status).toBe(200);
    expect((await act(T.sama, id, "approve", { note: "ممتاز" })).status).toBe(200);
    const done = await task(T.hussein, id);
    expect(done.task.status).toBe("done");
    expect(done.task.review_round).toBe(2);
    expect(done.deliverables).toHaveLength(2);
    expect(done.comments.map((c: any) => c.kind)).toEqual(["changes_requested", "review_note"]);
    expect(done.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(["created", "acknowledged", "submitted", "changes_requested", "approved"]));
    expect((await act(T.sama, id, "approve")).status).toBe(403);
  });

  it("§14.14 a task that must be published needs the publish link before completion", async () => {
    const id = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein", requires_publish: true });
    await act(T.hussein, id, "start");
    await act(T.hussein, id, "submit", { url: "https://drive.example/b" });
    const r = await act(T.ammar, id, "approve");
    expect(r.status).toBe(400);
    expect(r.body.field).toBe("publish_url");
    expect((await act(T.ammar, id, "approve", { publish_url: "https://instagram.example/p/1" })).status).toBe(200);
    expect((await task(T.ammar, id)).task.publish_url).toBe("https://instagram.example/p/1");
  });

  it("§14.14 nobody reviews their own work, even when they name themselves", async () => {
    const r = await T.sama.post("/api/tasks", { client_id: "c_obesity", assignee_id: "u_sama", reviewer_id: "u_sama", title: "مراجعة ذاتية" }, { "idempotency-key": key() });
    expect(r.status).toBe(400);
    const r2 = await T.sama.post("/api/tasks", { client_id: "c_obesity", assignee_id: "u_hussein", reviewer_id: "u_hussein", title: "مصور يراجع" }, { "idempotency-key": key() });
    expect(r2.status).toBe(400);
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_sama" });
    expect((await task(T.sama, id)).task.reviewer.id).toBe("u_ammar");
  });
});

describe("clarification, blockers and due proposals", () => {
  it("§14.13 asking for clarification is not acceptance and resolving it restarts the acknowledgement clock", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    expect((await act(T.hussein, id, "clarify", { question: "أي مدخل نصور؟" })).status).toBe(200);
    let d = await task(T.sama, id);
    expect(d.task.status).toBe("new");
    expect(d.task.flags.blocked_kind).toBe("clarification");
    const b = d.blockers[0];
    expect(b.resolver_id).toBe("u_sama");
    expect(d.can.resolve_blocker).toContain(b.id);
    expect((await T.hussein.get(`/api/tasks/${id}`)).body.can.resolve_blocker).toEqual(expect.any(Array));
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_sama' and kind = 'clarification'", id)).toHaveLength(1);
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "المدخل الرئيسي" })).status).toBe(200);
    d = await task(T.hussein, id);
    expect(d.task.flags.blocked).toBe(false);
    expect(d.comments.map((c: any) => c.kind)).toEqual(["clarification_request", "clarification_answer"]);
    expect((await rows<{ ack_epoch: number }>("select ack_epoch from tasks where id = ?", id))[0].ack_epoch).toBe(1);
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: b.id, resolution: "مرة ثانية" })).status).toBe(400);
  });

  it("§14.12 an accepted due-date proposal keeps the original date and the trace", async () => {
    const due = future(30);
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: due });
    await act(T.hussein, id, "ack");
    const proposed = future(60);
    await act(T.hussein, id, "propose_due", { proposed_due_at: proposed, reason: "العيادة مغلقة غداً" });
    const p = (await task(T.sama, id)).due_proposals[0];
    expect(p.status).toBe("pending");
    expect((await T.sama.get("/api/today")).body.sections.find((s: any) => s.key === "awaiting_me").tasks.map((t: any) => t.id)).toContain(id);
    expect((await act(T.sama, id, "decide_due", { proposal_id: p.id, accept: true, note: "موافق" })).status).toBe(200);
    const d = await task(T.sama, id);
    expect(d.task.due_at).toBe(proposed);
    expect(d.task.original_due_at).toBe(due);
    expect(d.due_proposals[0].status).toBe("accepted");
    expect(d.events.find((e: any) => e.type === "due_proposal_accepted").data).toMatchObject({ from: due, to: proposed });
  });

  it("§14.12 a direct due-date or owner change needs a reason and is recorded", async () => {
    const due = future(30);
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: due });
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, due_at: future(40) })).status).toBe(400);
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, due_at: future(40), reason: "طلب العميل" })).status).toBe(200);
    const d = await task(T.sama, id);
    expect(d.task.original_due_at).toBe(due);
    const ev = d.events.find((e: any) => e.type === "edited");
    expect(ev.data.reason).toBe("طلب العميل");
    expect(ev.data.changes.due_at.from).toBe(due);
    expect((await rows<{ due_version: number }>("select due_version from tasks where id = ?", id))[0].due_version).toBe(2);
  });
});

describe("§14.15 data persists across sessions and devices", () => {
  it("§14.15 a second device sees the same data; logging out one device ends only that session", async () => {
    const phone = T.sama;
    const laptop = await signIn("sama");
    const id = await createTask(phone, { client_id: "c_obesity", assignee_id: "u_hussein", title: "مهمة تبقى بعد التحديث" });
    await phone.post(`/api/tasks/${id}/comments`, { body: "تعليق محفوظ", client_key: key() });
    const seen = await task(laptop, id);
    expect(seen.task.title).toBe("مهمة تبقى بعد التحديث");
    expect(seen.comments[0].body).toBe("تعليق محفوظ");
    expect((await laptop.get("/api/tasks")).body.tasks.map((t: any) => t.id)).toContain(id);

    expect((await laptop.post("/api/auth/sign-out")).status).toBe(200);
    expect((await laptop.get("/api/tasks")).status).toBe(401);
    expect((await phone.get(`/api/tasks/${id}`)).status).toBe(200);
    const again = await signIn("sama");
    expect((await task(again, id)).comments).toHaveLength(1);
  });
});

describe("§14.16 failed writes never look like success", () => {
  it("§14.16 a stale version is refused with 409 and a message, nothing changes", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, title: "عنوان أول" })).status).toBe(200);
    const stale = await T.sama.patch(`/api/tasks/${id}`, { version: v, title: "عنوان قديم" });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("version_conflict");
    expect(stale.body.message).toBeTruthy();
    const staleAction = await T.hussein.post(`/api/tasks/${id}/actions/ack`, { version: v });
    expect(staleAction.status).toBe(409);
    expect((await task(T.sama, id)).task.title).toBe("عنوان أول");
    expect((await task(T.sama, id)).task.status).toBe("new");
  });

  it("§14.16 two simultaneous acknowledgements: one wins, the other is a 409, one event", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    const v = (await task(T.hussein, id)).task.version;
    const res = await Promise.all([T.hussein.post(`/api/tasks/${id}/actions/ack`, { version: v }), T.hussein.post(`/api/tasks/${id}/actions/ack`, { version: v })]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await rows("select * from events where task_id = ? and type = 'acknowledged'", id)).toHaveLength(1);
  });

  it("§14.16 a double-clicked create with the same key makes one task", async () => {
    const k = key();
    const body = { client_id: "c_obesity", assignee_id: "u_hussein", title: "نقرة مزدوجة" };
    const [a, b] = await Promise.all([T.sama.post("/api/tasks", body, { "idempotency-key": k }), T.sama.post("/api/tasks", body, { "idempotency-key": k })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await rows("select id from tasks where create_key = ?", k)).toHaveLength(1);
    expect(await rows("select * from notifications where task_id = ? and kind = 'assigned'", a.body.id)).toHaveLength(1);
    const c = key();
    const [c1, c2] = await Promise.all([T.sama.post(`/api/tasks/${a.body.id}/comments`, { body: "مرة واحدة", client_key: c }), T.sama.post(`/api/tasks/${a.body.id}/comments`, { body: "مرة واحدة", client_key: c })]);
    expect([c1.status, c2.status].sort()).toEqual([200, 201]);
    expect(await rows("select * from comments where task_id = ?", a.body.id)).toHaveLength(1);
  });

  it("§14.16 invalid input is a 400 with a message", async () => {
    const r = await T.sama.post("/api/tasks", { client_id: "c_obesity", assignee_id: "u_hussein", title: "x" }, { "idempotency-key": key() });
    expect(r.status).toBe(400);
    expect(r.body.message).toBeTruthy();
    const bad = await T.sama.raw("POST", "/api/tasks", undefined, {});
    expect(bad.status).toBe(400);
    const past = await T.sama.post("/api/tasks", { client_id: "c_obesity", assignee_id: "u_hussein", title: "موعد قديم", due_at: new Date(Date.now() - 86_400_000).toISOString() }, { "idempotency-key": key() });
    expect(past.status).toBe(400);
  });
});

describe("§14.19 a notification link cannot get round permissions", () => {
  it("§14.19 after reassignment the old assignee's link is a 404 and the new assignee must acknowledge again", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "مهمة يعاد إسنادها" });
    await act(T.hussein, id, "ack");
    const link = (await rows<{ url: string }>("select url from notifications where task_id = ? and user_id = 'u_hussein' and kind = 'assigned'", id))[0].url;
    expect(link).toBe(`/tasks/${id}`);
    const v = (await task(T.sama, id)).task.version;
    const sameReviewer = await T.sama.patch(`/api/tasks/${id}`, { version: v, assignee_id: "u_sama", reason: "حسين مشغول اليوم" });
    expect(sameReviewer.status).toBe(400); // Sama is the reviewer: she cannot review her own work
    expect(sameReviewer.body.message).toContain("بنفسه");
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, assignee_id: "u_sama", reviewer_id: "u_ammar", reason: "حسين مشغول اليوم" })).status).toBe(200);
    expect((await T.hussein.get(`/api/tasks/${id}`)).status).toBe(404);
    expect((await T.hussein.post(`/api/tasks/${id}/comments`, { body: "؟", client_key: key() })).status).toBe(404);
    const d = await task(T.sama, id);
    expect(d.task.status).toBe("new");
    expect(d.task.assignee.id).toBe("u_sama");
    expect(d.task.cycle).toBe(2);
    expect(d.events.find((e: any) => e.type === "edited").data.changes.assignee_id).toEqual({ from: "u_hussein", to: "u_sama" });
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_hussein' and kind = 'reassigned_away' and url is null", id)).toHaveLength(1);
  });

  it("§14.19 archived tasks disappear for everyone but the owner", async () => {
    const id = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_hussein" });
    expect((await act(T.ammar, id, "archive")).status).toBe(403);
    expect((await act(T.mohammed, id, "archive")).status).toBe(200);
    expect((await T.hussein.get(`/api/tasks/${id}`)).status).toBe(404);
    expect((await T.mohammed.get(`/api/tasks/${id}`)).status).toBe(200);
  });
});

describe("role dashboards, escalation by hand, edits and admin settings", () => {
  it("§14.7 Today sections follow the spec order for each role", async () => {
    const keys = async (b: typeof T.sama) => (await b.get("/api/today")).body.sections.map((s: any) => s.key);
    expect(await keys(T.hussein)).toEqual(["waiting_ack", "today", "questions", "later", "submitted"]);
    expect(await keys(T.mohammed)).toEqual(["waiting_ack", "overdue", "at_risk", "awaiting_me", "blocked"]);
    expect(await keys(T.sama)).toEqual(["mine", "from_photographer", "awaiting_me", "submitted"]);
    expect(await keys(T.ammar)).toEqual(["awaiting_me", "mine", "follow", "open"]);
    const ward = (await T.ammar.get("/api/today?client=c_ward")).body;
    for (const s of ward.sections) for (const t of s.tasks) expect(t.client.id).toBe("c_ward");
  });

  it("§14.3 Sama escalates to Ammar without changing the owner", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    expect((await act(T.sama, id, "escalate", { reason: "حسين لم يرد منذ الصباح" })).status).toBe(200);
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_ammar' and kind = 'escalated'", id)).toHaveLength(1);
    expect((await task(T.sama, id)).task.assignee.id).toBe("u_hussein");
    expect((await act(T.hussein, id, "escalate", { reason: "x".repeat(5) })).status).toBe(403);
    expect((await act(T.mohammed, id, "escalate", { reason: "x".repeat(5) })).status).toBe(403);
  });

  it("§14.16 editing one field leaves the others alone", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", ref_url: "https://brief.example/1", description: "وصف" });
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, title: "عنوان جديد" })).status).toBe(200);
    const d = (await task(T.sama, id)).task;
    expect(d).toMatchObject({ title: "عنوان جديد", ref_url: "https://brief.example/1", description: "وصف", version: v + 1 });
  });

  it("§14.6 only Mohammed changes work hours and reminder rules, and bad values are refused", async () => {
    const ov = (await T.mohammed.get("/api/admin/overview")).body;
    const rules = ov.settings.rules.value;
    const wh = { tz: "Asia/Baghdad", days: [0, 1, 2, 3, 4], start: "09:00", end: "18:00" };
    expect((await T.mohammed.json("PUT", "/api/admin/settings", { work_hours: { ...wh, end: "08:00" }, rules })).status).toBe(400);
    expect((await T.mohammed.json("PUT", "/api/admin/settings", { work_hours: { ...wh, tz: "Mars/Olympus" }, rules })).status).toBe(400);
    expect((await T.mohammed.json("PUT", "/api/admin/settings", { work_hours: wh, rules: { ...rules, ack: { ...rules.ack, normal: [60, 30, 240, 480] } } })).status).toBe(400);
    expect((await T.mohammed.json("PUT", "/api/admin/settings", { work_hours: { ...wh, start: "08:30" }, rules })).status).toBe(200);
    expect((await T.mohammed.get("/api/account/me")).body.work_hours).toMatchObject({ start: "08:30", assumed: false });
    expect(await rows("select * from events where type = 'settings_changed'")).toHaveLength(1);
    expect((await T.mohammed.json("PUT", "/api/admin/settings", { work_hours: wh, rules })).status).toBe(200);
  });

  it("§14.7 the CSV export neutralises spreadsheet formulas", async () => {
    await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar", title: '=HYPERLINK("http://x","y")' });
    const bytes = new Uint8Array(await (await T.mohammed.raw("GET", "/api/admin/export?format=csv")).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM so Excel reads the Arabic as UTF-8
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});
