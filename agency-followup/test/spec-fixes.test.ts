import { beforeAll, describe, expect, it } from "vitest";
import { loadCtx } from "../worker/db";
import { seedDemo } from "../worker/demo";
import { localParts } from "../worker/lib/time";
import { act, baseSunday, createTask, env, key, plus, rows, sql, task, team } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
// Bookings in this file sit in this week; the demo seeds run weeks later so they never meet.
const B = baseSunday(2);

beforeAll(async () => {
  T = await team();
});

const LATIN = /[A-Za-z]/;
const ARABIC = /[\u0600-\u06FF]/;

describe("validation messages are Arabic", () => {
  it("an English Zod message never reaches the client: our Arabic message or the generic one", async () => {
    const post = (fields: Record<string, unknown>) => T.mohammed.post("/api/tasks", { title: "مهمة اختبار", client_id: "c_ward", assignee_id: "u_ammar", ...fields }, { "idempotency-key": key() });
    // Zod's own "Too small…" / "Too big…" messages used to pass through.
    for (const fields of [{ client_id: "" }, { assignee_id: "x".repeat(65) }, { requires_publish: "yes" }]) {
      const r = await post(fields);
      expect(r.status).toBe(400);
      expect(r.body.message).toBe("بيانات ناقصة أو غير صحيحة");
    }
    // Our own Arabic messages still come through as written.
    const short = await post({ title: "اب" });
    expect(short.status).toBe(400);
    expect(short.body.message).toBe("العنوان مطلوب (3 أحرف على الأقل)");
  });

  it("an out-of-range settings value names the field and its bound in Arabic, and saves nothing", async () => {
    const overview = (await T.mohammed.get("/api/admin/overview")).body;
    const before = { work_hours: overview.settings.work_hours.updated_at, rules: overview.settings.rules.updated_at };
    const valid = () => {
      const wh = overview.settings.work_hours.value;
      return { work_hours: { tz: wh.tz, days: wh.days, start: wh.start, end: wh.end }, rules: structuredClone(overview.settings.rules.value) };
    };
    const put = (change: (s: ReturnType<typeof valid>) => void) => {
      const s = valid();
      change(s);
      return T.mohammed.json("PUT", "/api/admin/settings", s);
    };
    const cases: [(s: any) => void, string, string][] = [
      [(s) => (s.rules.dueSoonMinutes.normal = 3), "rules.dueSoonMinutes.normal", "تذكير قبل الموعد — عادية: القيمة بين 5 و1440 دقيقة"],
      [(s) => (s.rules.dueSoonMinutes.urgent = 2000), "rules.dueSoonMinutes.urgent", "تذكير قبل الموعد — عاجلة: القيمة بين 5 و1440 دقيقة"],
      [(s) => (s.rules.blockerFollowMinutes.normal = null), "rules.blockerFollowMinutes.normal", "متابعة العائق بعد — عادية: أدخل رقماً"],
      [(s) => (s.rules.blockerFollowMinutes.urgent = 30.5), "rules.blockerFollowMinutes.urgent", "متابعة العائق بعد — عاجلة: أدخل رقماً صحيحاً"],
      [(s) => (s.work_hours.days = []), "work_hours.days", "اختر يوم عمل واحداً على الأقل"],
      [(s) => (s.rules.ack.normal = [60, 120, 240]), "rules.ack.normal", "عدم الاستلام — عادية: أدخل أربع قيم مفصولة بفواصل"],
      [(s) => (s.rules.ack.urgent = [15, 30, 60, 3]), "rules.ack.urgent.3", "عدم الاستلام — عاجلة: القيمة بين 5 و6000 دقيقة"],
      [(s) => (s.rules.reviewMinutes.urgent = [30]), "rules.reviewMinutes.urgent", "انتظار المراجعة — عاجلة: أدخل قيمتين مفصولة بفواصل"],
      [(s) => (s.rules.reviewMinutes.normal = [240, 120]), "rules.reviewMinutes.normal", "انتظار المراجعة — عادية: المراحل تصاعدية"],
    ];
    for (const [change, field, message] of cases) {
      const r = await put(change);
      expect(r.status, field).toBe(400);
      expect(r.body.message, field).toBe(message);
      expect(r.body.field).toBe(field);
      expect(ARABIC.test(r.body.message) && !LATIN.test(r.body.message), field).toBe(true);
    }
    const after = (await T.mohammed.get("/api/admin/overview")).body.settings;
    expect({ work_hours: after.work_hours.updated_at, rules: after.rules.updated_at }).toEqual(before);
  });
});

describe("archived tasks are the owner's only, also through links", () => {
  it("a non-owner opening a live subtask of an archived parent gets no parent id or title", async () => {
    const parentTitle = "أصل سيؤرشف-" + key();
    const parent = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein", title: parentTitle });
    const sub = await createTask(T.ammar, { client_id: "c_ward", parent_id: parent, assignee_id: "u_hussein", title: "مهمة فرعية حية" });
    expect((await task(T.hussein, sub)).parent).toEqual({ id: parent, title: parentTitle });

    expect((await act(T.mohammed, parent, "archive")).status).toBe(200);
    for (const who of [T.hussein, T.ammar]) {
      const r = await who.get(`/api/tasks/${sub}`);
      expect(r.status).toBe(200);
      expect(r.body.parent).toBeNull();
      expect(JSON.stringify(r.body)).not.toContain(parent);
      expect(JSON.stringify(r.body)).not.toContain(parentTitle);
      expect((await who.get(`/api/tasks/${parent}`)).status).toBe(404);
    }
    // The owner still follows the link, and the archived parent still lists its live subtask for him.
    expect((await task(T.mohammed, sub)).parent).toEqual({ id: parent, title: parentTitle });
    expect((await task(T.mohammed, parent)).subtasks.map((s: any) => s.id)).toEqual([sub]);
  });

  it("an archived task's booking keeps its time but shows no task link to a non-owner", async () => {
    const t = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein", title: "مهمة بحجز ستؤرشف" });
    const b = await T.ammar.post("/api/bookings", { client_id: "c_ward", task_id: t, title: "حجز مهمة مؤرشفة", starts_at: plus(B, 60).toISOString(), ends_at: plus(B, 120).toISOString(), create_key: key() });
    expect(b.status).toBe(201);
    const range = `/api/bookings?from=${plus(B, -60).toISOString()}&to=${plus(B, 600).toISOString()}`;
    const linkFor = async (who: typeof T.ammar) => (await who.get(range)).body.bookings.find((x: any) => x.id === b.body.id);
    expect((await linkFor(T.ammar)).task_id).toBe(t);
    expect((await linkFor(T.hussein)).task_id).toBe(t);

    expect((await act(T.mohammed, t, "archive")).status).toBe(200);
    for (const who of [T.ammar, T.hussein]) {
      const shown = await linkFor(who);
      expect(shown).toMatchObject({ busy_only: false, title: "حجز مهمة مؤرشفة", task_id: null });
    }
    expect((await linkFor(T.mohammed)).task_id).toBe(t);
  });
});

describe("reviewer options follow validReviewer", () => {
  const reviewers = async (who: typeof T.ammar, client: string) => {
    const me = (await who.get("/api/account/me")).body;
    return me.assignment.find((a: any) => a.client.id === client).reviewers.map((r: any) => r.id).sort();
  };

  it("Mohammed on a مستشفى ورد task is not offered سما; every reviewer offered is accepted by the server", async () => {
    const ward = await reviewers(T.mohammed, "c_ward");
    expect(ward).not.toContain("u_sama");
    expect(ward).not.toContain("u_hussein");
    expect(ward).toEqual(["u_ammar", "u_mohammed"]);
    for (const reviewer_id of ward) await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_hussein", reviewer_id });
    const sama = await T.mohammed.post("/api/tasks", { title: "مهمة اختبار", client_id: "c_ward", assignee_id: "u_hussein", reviewer_id: "u_sama" }, { "idempotency-key": key() });
    expect(sama.status).toBe(400);

    expect(await reviewers(T.mohammed, "c_obesity")).toEqual(["u_ammar", "u_mohammed", "u_sama"]);
    expect(await reviewers(T.ammar, "c_ward")).toEqual(["u_ammar", "u_mohammed"]);
    expect(await reviewers(T.sama, "c_obesity")).toEqual(["u_ammar", "u_mohammed", "u_sama"]);
  });
});

describe("demo seed creates no expired dates", () => {
  const TZ = "Asia/Baghdad";
  // Sunday 09:00 Baghdad, weeks after the bookings above.
  const S = baseSunday(6);

  async function seedAt(now: Date) {
    // Fixed ids: clear the previous seed so this one inserts afresh (events are append-only and stay).
    await sql("delete from deliverables where task_id like 't_demo_%'");
    await sql("delete from blockers where task_id like 't_demo_%'");
    await sql("delete from bookings where id like 'bk_demo_%'");
    await sql("delete from tasks where id like 't_demo_%' and parent_id is not null");
    await sql("delete from tasks where id like 't_demo_%'");
    expect(await seedDemo(await loadCtx(env, now))).toBe(10);
    const tasks = await rows<{ id: string; status: string; due_at: string | null }>("select id, status, due_at from tasks where id like 't_demo_%'");
    const bookings = await rows<{ id: string; starts_at: string; ends_at: string }>("select id, starts_at, ends_at from bookings where id like 'bk_demo_%' and status = 'active'");
    const blockers = await rows<{ expected_at: string }>("select expected_at from blockers where task_id like 't_demo_%'");
    return { tasks, bookings, blockers, due: (id: string) => tasks.find((t) => t.id === id)!.due_at! };
  }

  const local = (iso: string) => {
    const p = localParts(new Date(iso), TZ);
    return { weekday: p.weekday, date: `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, time: `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}` };
  };
  const dateOf = (t: Date, days = 0) => local(new Date(t.getTime() + days * 86_400_000).toISOString()).date;

  function expectNothingExpired(seed: Awaited<ReturnType<typeof seedAt>>, now: Date) {
    const nowIso = now.toISOString();
    const open = seed.tasks.filter((t) => !["done", "cancelled"].includes(t.status));
    expect(open).toHaveLength(9);
    for (const t of open) expect(t.due_at! > nowIso, `${t.id} due ${t.due_at}`).toBe(true);
    expect(seed.bookings).toHaveLength(2);
    for (const b of seed.bookings) expect(b.starts_at > nowIso, `${b.id} starts ${b.starts_at}`).toBe(true);
    for (const b of seed.blockers) expect(b.expected_at > nowIso).toBe(true);
    // Working days only: nothing lands on a Friday or Saturday.
    for (const iso of [...seed.tasks.map((t) => t.due_at!), ...seed.bookings.map((b) => b.starts_at), ...seed.blockers.map((b) => b.expected_at)]) expect([5, 6]).not.toContain(local(iso).weekday);
    // The planted conflict is still there: t_demo_08 falls due inside the Ward booking.
    const ward = seed.bookings.find((b) => b.id === "bk_demo_04")!;
    expect(seed.due("t_demo_08") > ward.starts_at && seed.due("t_demo_08") < ward.ends_at).toBe(true);
  }

  it("before 10:00 on a working day the trial day is today", async () => {
    const now = plus(S, 30); // Sunday 09:30
    const seed = await seedAt(now);
    expectNothingExpired(seed, now);
    expect(local(seed.due("t_demo_03"))).toMatchObject({ date: dateOf(S), time: "16:00" });
    expect(local(seed.due("t_demo_02")).date).toBe(dateOf(S, 1)); // D+1 Monday
    expect(local(seed.due("t_demo_10")).date).toBe(dateOf(S, -3)); // D-1 is the previous Thursday
  });

  it("at 11:00 on a Sunday the trial day moves to Monday", async () => {
    const now = plus(S, 120); // Sunday 11:00
    const seed = await seedAt(now);
    expectNothingExpired(seed, now);
    expect(local(seed.due("t_demo_03"))).toMatchObject({ date: dateOf(S, 1), time: "16:00" });
    expect(local(seed.due("t_demo_06"))).toMatchObject({ date: dateOf(S, 2), time: "15:00" });
    expect(local(seed.bookings.find((b) => b.id === "bk_demo_03")!.starts_at)).toMatchObject({ date: dateOf(S, 1), time: "10:00" });
  });

  it("at 17:59 on a Thursday the trial day is Sunday and D+N skips the weekend", async () => {
    const now = plus(S, 4 * 1440 + 539); // Thursday 17:59
    const seed = await seedAt(now);
    expectNothingExpired(seed, now);
    expect(local(seed.due("t_demo_03")).date).toBe(dateOf(S, 7)); // D+0 next Sunday
    expect(local(seed.due("t_demo_02")).date).toBe(dateOf(S, 8)); // D+1 Monday
    expect(local(seed.due("t_demo_01")).date).toBe(dateOf(S, 9)); // D+2 Tuesday
    expect(local(seed.due("t_demo_10")).date).toBe(dateOf(S, 4)); // D-1 is that Thursday
  });

  it("on a Friday the trial day is Sunday", async () => {
    const now = plus(S, 5 * 1440 + 120); // Friday 11:00
    const seed = await seedAt(now);
    expectNothingExpired(seed, now);
    expect(local(seed.due("t_demo_03")).date).toBe(dateOf(S, 7));
  });
});
