// Regression tests for the security review findings (M1–M3, L1–L7) and the
// rewritten outbox drain. Each test name starts with the finding it guards.

import { createExecutionContext, env } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OPEN_STATUSES } from "../shared/domain";
import { loadCtx } from "../worker/db";
import { app } from "../worker/index";
import { b64url, hashPassword } from "../worker/lib/crypto";
import { sendToUser } from "../worker/push";
import { drainOutbox, FETCH_BUDGET, runScheduler } from "../worker/scheduler";
import { act, baseSunday, Browser, createTask, ensurePasswords, key, noteCounts, ORIGIN, PASSWORDS, plus, rows, signIn, sql, task, team } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
const B = baseSunday(3); // Sunday 09:00 Baghdad, weeks ahead of the real clock
const run = (minutes: number) => runScheduler(env, plus(B, minutes), { push: false });
const future = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const only = (c: Record<string, number>, kinds: string[]) => Object.fromEntries(Object.entries(c).filter(([k]) => kinds.includes(k.split(":")[1])));
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- push test doubles ----------

const PUSH_HOST = "https://fcm.googleapis.com/";
let envK: Env;
let captured: string[] = [];
let respond: (url: string) => number = () => 201;

async function newDevice() {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  return { endpoint: `${PUSH_HOST}fcm/send/rf-${crypto.randomUUID()}`, keys: { p256dh: b64url(pub), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
}
type Device = Awaited<ReturnType<typeof newDevice>>;
const subscribe = (as: Browser, d: Device) => as.post("/api/push/subscribe", d);
const revokeDevices = (userId?: string) =>
  userId
    ? sql("update push_subscriptions set revoked_at = ? where user_id = ? and revoked_at is null", new Date().toISOString(), userId)
    : sql("update push_subscriptions set revoked_at = ? where revoked_at is null", new Date().toISOString());

/**
 * A D1 handle that counts round trips (each run/all/first/raw, and each batch
 * as one) and can hold a batch back before it runs, so two requests can both
 * read before either writes.
 */
function instrumentedDb(db: D1Database, beforeBatch: (sqls: string[]) => Promise<void> = async () => {}) {
  const real = new WeakMap<object, D1PreparedStatement>();
  const sqlOf = new WeakMap<object, string>();
  let trips = 0;
  const wrap = (s: D1PreparedStatement, q: string): D1PreparedStatement => {
    const p = new Proxy(s, {
      get(target, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrap(target.bind(...args), q);
        if (prop === "all" || prop === "first" || prop === "run" || prop === "raw")
          return (...args: unknown[]) => {
            trips++;
            return (target as any)[prop](...args);
          };
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    real.set(p, s);
    sqlOf.set(p, q);
    return p;
  };
  const proxy = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (q: string) => wrap(target.prepare(q), q);
      if (prop === "batch")
        return async (stmts: D1PreparedStatement[]) => {
          trips++;
          await beforeBatch(stmts.map((s) => sqlOf.get(s) ?? ""));
          return target.batch(stmts.map((s) => real.get(s) ?? s));
        };
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: proxy, trips: () => trips };
}

/** The same request a Browser would send, run through the Worker's app with a chosen D1 handle. */
async function viaApp(as: Browser, method: string, path: string, body: unknown, db: D1Database) {
  const headers: Record<string, string> = { "cf-connecting-ip": as.ip, origin: ORIGIN, "content-type": "application/json", cookie: [...as.cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
  const res = await app.fetch(new Request(ORIGIN + path, { method, headers, body: JSON.stringify(body) }), { ...env, DB: db }, createExecutionContext());
  return { status: res.status, body: (await res.json()) as any };
}

// ---------- sign-in helpers ----------

const signInAs = (ip: string, username: string, password: string) => new Browser(ip).post("/api/auth/sign-in/username", { username, password });

/** The login counters use fixed 15-minute windows; start a counting test well inside one. */
async function inFreshLoginWindow(marginMs = 45_000) {
  const left = 900_000 - (Date.now() % 900_000);
  if (left < marginMs) await pause(left + 1_000);
}

beforeAll(async () => {
  T = await team();
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  envK = { ...env, VAPID_PUBLIC_KEY: b64url(raw), VAPID_PRIVATE_KEY: jwk.d! };
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(PUSH_HOST)) return realFetch(input as RequestInfo, init);
    captured.push(url);
    const status = respond(url);
    if (status === 0) throw new TypeError("Network connection lost."); // 0 stands for "no answer at all"
    return new Response(null, { status });
  });
});

afterEach(() => {
  captured = [];
  respond = () => 201;
});

afterAll(() => {
  vi.restoreAllMocks();
});

// ---------- M1 ----------

describe("M1 people who lose access to a task are not told about it any more", () => {
  it("M1 after reassignment the old assignee hears nothing more: not the answers to his questions, not the decision on his date, not the reason it moved", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "M1-CLINIC-TITLE" });
    expect((await act(T.hussein, id, "clarify", { question: "أي مدخل نصوّر؟" })).status).toBe(200);
    expect((await act(T.hussein, id, "block", { kind: "internal", reason: "الإضاءة غير متوفرة" })).status).toBe(200);
    expect((await act(T.hussein, id, "propose_due", { proposed_due_at: future(40 * 24), reason: "أحتاج وقتاً إضافياً" })).status).toBe(200);
    const before = await task(T.sama, id);
    expect(before.blockers.map((b: any) => [b.kind, b.resolver_id, b.opened_by])).toEqual([
      ["clarification", "u_sama", "u_hussein"],
      ["internal", "u_sama", "u_hussein"],
    ]);

    const [question, blocker] = before.blockers;

    const moved = await T.sama.patch(`/api/tasks/${id}`, { version: before.task.version, assignee_id: "u_sama", reviewer_id: "u_ammar", reason: "M1-REASON سأنفذها بنفسي" });
    expect(moved.status).toBe(200);
    expect((await T.hussein.get(`/api/tasks/${id}`)).status).toBe(404);

    // His question closed with the reassignment (it would otherwise pause Sama's acknowledgement clock), so it cannot be answered again…
    const after = await task(T.sama, id);
    const closed = after.blockers.find((b: any) => b.id === question.id);
    expect(closed).toMatchObject({ resolved_by: "u_sama", resolution: "أُغلق مع إعادة إسناد المهمة" });
    expect(closed.resolved_at).toBeTruthy();
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: question.id, resolution: "M1-ANSWER المدخل الرئيسي" })).status).toBe(400);
    // …and his internal blocker, which named Sama (now the assignee), went to the reviewer. Sama clears it: it was opened by Hussein.
    expect(after.blockers.find((b: any) => b.id === blocker.id)).toMatchObject({ resolver_id: "u_ammar", resolved_at: null });
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: blocker.id, resolution: "M1-ANSWER الإضاءة وصلت" })).status).toBe(200);
    // A proposal of his still pending from before the fix: deciding it does not reach him either.
    const p = before.due_proposals[0];
    await sql("update due_proposals set status = 'pending', decided_by = null, decided_at = null, decision_note = null where id = ?", p.id);
    expect((await act(T.sama, id, "decide_due", { proposal_id: p.id, accept: false, note: "M1-DECISION-NOTE" })).status).toBe(200);
    expect((await T.sama.post(`/api/tasks/${id}/comments`, { body: "M1-COMMENT", client_key: key() })).status).toBe(201);

    const his = await rows<{ kind: string; title: string; body: string }>("select kind, title, body from notifications where task_id = ? and user_id = 'u_hussein' order by kind", id);
    expect(his.map((n) => n.kind)).toEqual(["assigned", "reassigned_away"]);
    const away = his.find((n) => n.kind === "reassigned_away")!;
    expect(away.body).not.toContain("M1-REASON");
    expect(away.title).not.toContain("سما");
    const inbox = JSON.stringify((await T.hussein.get("/api/notifications")).body);
    for (const s of ["M1-ANSWER", "M1-DECISION-NOTE", "M1-REASON", "M1-COMMENT", "أُغلق مع إعادة إسناد"]) expect(inbox).not.toContain(s);
  });

  it("M1 what the old assignee held moves on with the task and is followed up there; the new assignee is chased again once it is cleared", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "M1-HELD" });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    // Nobody can hand the assignee an internal blocker any more (R2); a row from before that rule still names him.
    expect((await act(T.sama, id, "block", { kind: "internal", reason: "يحضر حسين معدات الإضاءة", resolver_id: "u_hussein" })).status).toBe(400);
    const heldId = `b_held_${key()}`;
    await sql("insert into blockers (id, task_id, kind, reason, resolver_id, opened_by, opened_at) values (?, ?, 'internal', 'يحضر حسين معدات الإضاءة', 'u_hussein', 'u_sama', ?)", heldId, id, new Date().toISOString());
    expect((await act(T.hussein, id, "propose_due", { proposed_due_at: future(40 * 24), reason: "أحتاج وقتاً" })).status).toBe(200);
    const before = await task(T.sama, id);
    const held = before.blockers.find((b: any) => b.id === heldId);
    const proposal = before.due_proposals[0];
    expect(held.resolver_id).toBe("u_hussein");

    expect((await T.sama.patch(`/api/tasks/${id}`, { version: before.task.version, assignee_id: "u_sama", reviewer_id: "u_ammar", reason: "سأنفذها بنفسي" })).status).toBe(200);
    const after = await task(T.sama, id);
    // The requester is now the assignee, so the blocker goes to the reviewer; his proposal is closed.
    expect(after.blockers.find((b: any) => b.id === held.id)).toMatchObject({ resolver_id: "u_ammar", resolved_at: null });
    expect(after.due_proposals.find((x: any) => x.id === proposal.id)).toMatchObject({ status: "rejected", decided_by: "u_sama", decision_note: "أُعيد إسناد المهمة" });
    expect((await act(T.sama, id, "decide_due", { proposal_id: proposal.id, accept: true })).status).toBe(400);
    expect((await task(T.ammar, id)).can.resolve_blocker).toContain(held.id);

    // A blocker row from before the fix that still names Hussein: the scheduler follows it up with the requester.
    const legacy = `b_legacy_${key()}`;
    await sql("insert into blockers (id, task_id, kind, reason, resolver_id, opened_by, opened_at) values (?, ?, 'internal', 'M1-LEGACY', 'u_hussein', 'u_hussein', ?)", legacy, id, B.toISOString());
    await sql("update blockers set opened_at = ? where id = ?", B.toISOString(), held.id);
    await run(300);
    expect(only(await noteCounts(id), ["blocker_follow", "blocker_escalation"])).toEqual({
      "ammar:blocker_follow": 1, // the moved blocker, with its new resolver
      "mohammed:blocker_escalation": 1, // above Ammar
      "sama:blocker_follow": 1, // the legacy row, with the requester
      "ammar:blocker_escalation": 1, // above Sama
    });

    // Once both are cleared the due date chases the new assignee.
    expect((await act(T.ammar, id, "resolve_blocker", { blocker_id: held.id, resolution: "أحضرتها" })).status).toBe(200);
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: legacy, resolution: "لم يعد قائماً" })).status).toBe(200);
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, due_at: plus(B, 320).toISOString(), reason: "موعد جديد" })).status).toBe(200);
    await run(330);
    expect(only(await noteCounts(id), ["due_soon", "overdue", "overdue_escalation"])).toEqual({ "sama:overdue": 1, "ammar:overdue_escalation": 1 });

    // Hussein heard nothing of any of this.
    expect((await rows<{ kind: string }>("select kind from notifications where task_id = ? and user_id = 'u_hussein' order by kind", id)).map((r) => r.kind)).toEqual(["assigned", "reassigned_away"]);
  });
});

// ---------- M2 ----------

describe("M2 single-task access ends with the assignment it came with", () => {
  it("M2 reassignment revokes the old assignee's grant; assigning her again grants it again and she is told", async () => {
    const id = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_sama", title: "M2-WARD-SECRET" });
    expect(await rows("select user_id from task_grants where task_id = ?", id)).toEqual([{ user_id: "u_sama" }]);
    expect((await T.sama.get(`/api/tasks/${id}`)).status).toBe(200);

    const v1 = (await task(T.mohammed, id)).task.version;
    expect((await T.mohammed.patch(`/api/tasks/${id}`, { version: v1, assignee_id: "u_ammar", reason: "نقل المهمة" })).status).toBe(200);
    expect(await rows("select * from task_grants where task_id = ?", id)).toEqual([]);
    const revoked = await rows<{ actor_id: string; data: string }>("select actor_id, data from events where task_id = ? and type = 'grant_revoked'", id);
    expect(revoked.map((e) => ({ actor: e.actor_id, ...JSON.parse(e.data) }))).toEqual([{ actor: "u_mohammed", user: "u_sama", reason: "إعادة الإسناد" }]);

    expect((await T.ammar.post(`/api/tasks/${id}/comments`, { body: "M2-LATER-COMMENT", client_key: key() })).status).toBe(201);
    expect((await T.sama.get(`/api/tasks/${id}`)).status).toBe(404);
    expect(JSON.stringify((await T.sama.get("/api/tasks?status=all")).body)).not.toContain("M2-WARD-SECRET");
    expect(JSON.stringify((await T.sama.get("/api/today")).body)).not.toContain("M2-WARD-SECRET");
    const v2 = (await task(T.mohammed, id)).task.version;
    expect((await T.sama.post(`/api/tasks/${id}/actions/escalate`, { version: v2, reason: "تصعيد من خارج الفريق" })).status).toBe(404);
    expect((await T.sama.post(`/api/tasks/${id}/comments`, { body: "تعليق", client_key: key() })).status).toBe(404);
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_sama' and kind = 'comment'", id)).toHaveLength(0);

    // Back to her: a fresh grant, and the notice is checked against the task as it now stands (with that grant).
    expect((await T.mohammed.patch(`/api/tasks/${id}`, { version: v2, assignee_id: "u_sama", reason: "أعدتها إليها" })).status).toBe(200);
    expect(await rows("select user_id from task_grants where task_id = ?", id)).toEqual([{ user_id: "u_sama" }]);
    expect((await T.sama.get(`/api/tasks/${id}`)).status).toBe(200);
    expect(await rows("select task_cycle from notifications where task_id = ? and user_id = 'u_sama' and kind = 'reassigned'", id)).toEqual([{ task_cycle: 3 }]);
  });
});

// ---------- M3 ----------

describe("M3 sign-in limits cannot be used to lock a member out", () => {
  it("M3 failed attempts for a username from many other addresses do not stop the member signing in", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    for (let a = 1; a <= 6; a++) {
      for (let i = 0; i < 8; i++) expect((await signInAs(`198.51.100.${a}`, "ammar", "wrong-password-xx")).status).toBe(401);
    }
    expect((await signInAs("203.0.113.77", "ammar", PASSWORDS.ammar)).status).toBe(200);
    // Nothing is counted against the username alone.
    const keys = (await rows<{ key: string }>("select key from request_limits where key like 'login:%'")).map((r) => r.key);
    expect(keys.filter((k) => !/^login:ip:/.test(k) && !/^login:u:[^:]+:.+$/.test(k))).toEqual([]);
    // What is held back is the attacking address, for that username only.
    expect((await signInAs("198.51.100.1", "ammar", PASSWORDS.ammar)).status).toBe(429);
    expect((await signInAs("198.51.100.1", "sama", PASSWORDS.sama)).status).toBe(200);
  });

  it("M3 one address gets 30 attempts per window, successful ones included", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    const ip = "198.51.100.40";
    for (let i = 0; i < 25; i++) expect((await signInAs(ip, `ghost_${i}`, "wrong-password-xx")).status).toBe(401);
    for (let i = 0; i < 5; i++) expect((await signInAs(ip, "sama", PASSWORDS.sama)).status).toBe(200);
    const over = await signInAs(ip, "sama", PASSWORDS.sama);
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("rate_limited");
    expect((await signInAs("198.51.100.41", "sama", PASSWORDS.sama)).status).toBe(200);
  });

  it("M3 one address gets 8 failed attempts per username however it is spelled; other usernames from it are unaffected", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    const ip = "198.51.100.50";
    const spellings = ["hussein", "HUSSEIN", " Hussein ", "Hussein"];
    for (let i = 0; i < 8; i++) expect((await signInAs(ip, spellings[i % 4], `wrong-${i}-password`)).status).toBe(401);
    expect((await signInAs(ip, "hussein", "wrong-8-password")).status).toBe(429);
    expect((await signInAs(ip, "hussein", PASSWORDS.hussein)).status).toBe(429);
    expect((await signInAs(ip, "sama", PASSWORDS.sama)).status).toBe(200);
    expect((await signInAs("198.51.100.51", "hussein", PASSWORDS.hussein)).status).toBe(200);
  });

  it("M3 a successful sign-in clears that address's failures for the username", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    const ip = "198.51.100.60";
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 7; i++) expect((await signInAs(ip, "sama", `wrong-${round}-${i}-password`)).status, `round ${round} attempt ${i}`).toBe(401);
      expect((await signInAs(ip, "sama", PASSWORDS.sama)).status).toBe(200);
      expect(await rows("select * from request_limits where key = ?", `login:u:sama:${ip}`)).toHaveLength(0);
    }
  });

  it("M3 parallel attempts from one address get no more than 8 guesses at a username", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    const ip = "198.51.100.70";
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => signInAs(ip, "mohammed", `wrong-${i}-password`)));
    const statuses = res.map((r) => r.status);
    expect(statuses.every((s) => s === 401 || s === 429), statuses.join(",")).toBe(true);
    expect(statuses.filter((s) => s === 401).length, `password checks let through: ${statuses.join(",")}`).toBeLessThanOrEqual(8);
    expect((await signInAs(ip, "mohammed", PASSWORDS.mohammed)).status).toBe(429);
  });
});

// ---------- L1 ----------

describe("L1 changing the reviewer during review", () => {
  it("L1 a reviewer named during review is told, reminded and escalated on his own account; the old reviewer's queued reminder is withdrawn", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", reviewer_id: "u_sama", title: "L1-REVIEW" });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    expect((await act(T.hussein, id, "submit", { url: "https://drive.example/l1" })).status).toBe(200);
    await sql("update tasks set submitted_at = ? where id = ?", B.toISOString(), id);
    const R = ["submitted", "review_reminder", "review_escalation"];
    await run(130);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1 });

    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, reviewer_id: "u_ammar" })).status).toBe(200);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1 });
    const told = (await rows<{ title: string; dedupe_key: string }>("select title, dedupe_key from notifications where task_id = ? and user_id = 'u_ammar' and kind = 'submitted'", id))[0];
    expect(told.dedupe_key).toBe(`submitted:${id}:1:1:u_ammar`);
    expect(told.title).toContain("L1-REVIEW");
    const samaQueued = await rows<{ status: string }>("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.user_id = 'u_sama' and n.kind = 'review_reminder'", id);
    expect(samaQueued.map((r) => r.status)).toEqual(["cancelled"]);

    await run(250);
    await run(400);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1, "ammar:review_reminder": 1, "mohammed:review_escalation": 1 });
    expect((await rows<{ dedupe_key: string }>("select dedupe_key from notifications where task_id = ? and kind = 'review_reminder' order by dedupe_key", id)).map((r) => r.dedupe_key.replace(/:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z:/, ":"))).toEqual([
      `review:${id}:1:1:u_ammar:0`,
      `review:${id}:1:1:u_sama:0`,
    ]);
    expect((await act(T.ammar, id, "approve")).status).toBe(200);
  });
});

// ---------- L2 ----------

describe("L2 the assignee cannot stop his own clocks", () => {
  it("L2 withdrawing one's own question does not restart the acknowledgement clock; an answer from the requester does", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    const from = new Date(Date.now() - 6 * 3_600_000).toISOString();
    await sql("update tasks set ack_clock_from = ? where id = ?", from, id);
    const state = async () => (await rows<{ ack_epoch: number; ack_clock_from: string; status: string }>("select ack_epoch, ack_clock_from, status from tasks where id = ?", id))[0];

    expect((await act(T.hussein, id, "clarify", { question: "سؤال شكلي" })).status).toBe(200);
    let d = await task(T.hussein, id);
    expect(d.can.resolve_blocker).toContain(d.blockers[0].id); // he may withdraw it…
    expect((await act(T.hussein, id, "resolve_blocker", { blocker_id: d.blockers[0].id, resolution: "سحبت السؤال" })).status).toBe(200);
    expect(await state()).toEqual({ ack_epoch: 0, ack_clock_from: from, status: "new" }); // …but the clock keeps running

    expect((await act(T.hussein, id, "clarify", { question: "ما المقاس المطلوب؟" })).status).toBe(200);
    d = await task(T.sama, id);
    const open = d.blockers.find((b: any) => !b.resolved_at);
    expect((await act(T.sama, id, "resolve_blocker", { blocker_id: open.id, resolution: "مربع ومستطيل" })).status).toBe(200);
    const after = await state();
    expect(after.ack_epoch).toBe(1);
    expect(after.ack_clock_from > from).toBe(true);
  });

  it("L2 the assignee cannot name himself to clear his own internal blocker, so someone above hears about it", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    const self = await act(T.hussein, id, "block", { kind: "internal", reason: "عائق عندي", resolver_id: "u_hussein" });
    expect(self.status).toBe(400);
    expect(await rows("select * from blockers where task_id = ?", id)).toHaveLength(0);

    expect((await act(T.hussein, id, "block", { kind: "internal", reason: "عائق عندي" })).status).toBe(200);
    const b = (await task(T.sama, id)).blockers[0];
    expect(b).toMatchObject({ resolver_id: "u_sama", opened_by: "u_hussein" });
    await sql("update blockers set opened_at = ? where id = ?", B.toISOString(), b.id);
    await run(250);
    expect(only(await noteCounts(id), ["blocker_follow", "blocker_escalation"])).toEqual({ "sama:blocker_follow": 1, "ammar:blocker_escalation": 1 });

    // The same holds for an account manager doing the work herself…
    const own = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama" });
    expect((await act(T.sama, own, "block", { kind: "internal", reason: "عائق عندي", resolver_id: "u_sama" })).status).toBe(400);
    // …and nobody else may hand the assignee an internal blocker either, whoever asks: it would pause his reminders just the same.
    expect((await act(T.sama, id, "block", { kind: "internal", reason: "يحضر المعدات", resolver_id: "u_hussein" })).status).toBe(400);
    expect((await act(T.mohammed, id, "block", { kind: "internal", reason: "يحضر المعدات", resolver_id: "u_hussein" })).status).toBe(400);
    // The requester may still name someone else who can open the task.
    expect((await act(T.sama, id, "block", { kind: "internal", reason: "يحضر عمار المعدات", resolver_id: "u_ammar" })).status).toBe(200);
    expect((await rows<{ resolver_id: string }>("select resolver_id from blockers where task_id = ? order by resolver_id", id)).map((r) => r.resolver_id)).toEqual(["u_ammar", "u_sama"]);
  });
});

// ---------- L3 ----------

describe("L3 action names", () => {
  it("L3 names of Object.prototype members are unknown actions (404), not server errors", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    for (const a of ["constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__", "__lookupGetter__", "nope"]) {
      const r = await T.sama.post(`/api/tasks/${id}/actions/${a}`, { version: 1 });
      expect(r.status, a).toBe(404);
      expect(r.body.error, a).toBe("not_found");
    }
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
  });
});

// ---------- L4 ----------

describe("L4 indexes", () => {
  it("L4 the task-notification, task-booking and device-session lookups are indexed", async () => {
    const expected: [string, string, string[]][] = [
      ["bookings_task_idx", "bookings", ["task_id", "status"]],
      ["notifications_task_idx", "notifications", ["task_id", "kind"]],
      ["push_subscriptions_session_idx", "push_subscriptions", ["session_id"]],
    ];
    const idx = await rows<{ name: string; tbl_name: string }>(
      "select name, tbl_name from sqlite_master where type = 'index' and name in ('bookings_task_idx', 'notifications_task_idx', 'push_subscriptions_session_idx') order by name",
    );
    expect(idx.map((i) => [i.name, i.tbl_name])).toEqual(expected.map(([n, t]) => [n, t]));
    for (const [name, , cols] of expected) {
      const info = await rows<{ name: string }>("select name from pragma_index_info(?) order by seqno", name);
      expect(info.map((c) => c.name), name).toEqual(cols);
    }
  });
});

// ---------- L5 ----------

describe("L5 bookings and due proposals refuse stale changes", () => {
  const slot = (from: number, to: number) => ({ starts_at: plus(B, from).toISOString(), ends_at: plus(B, to).toISOString() });
  async function book(s: { starts_at: string; ends_at: string }, title = "حجز تصوير") {
    const r = await T.sama.post("/api/bookings", { client_id: "c_obesity", title, ...s, create_key: key() });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }
  const bookingEvents = async (id: string) =>
    (await rows<{ type: string }>("select type from events where json_extract(data, '$.booking') = ? and type in ('booking_rescheduled', 'booking_cancelled') order by id", id)).map((e) => e.type);

  it("L5 a booking cannot be moved into the past", async () => {
    const s = slot(60, 120);
    const id = await book(s);
    const r = await T.sama.patch(`/api/bookings/${id}`, { starts_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), ends_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), reason: "نقل إلى الخلف" });
    expect(r.status).toBe(400);
    expect((await rows("select starts_at, ends_at, status from bookings where id = ?", id))[0]).toEqual({ ...s, status: "active" });
    expect(await bookingEvents(id)).toEqual([]);
  });

  it("L5 two cancels that both found the booking active: one goes through, the other is refused, one cancellation is recorded", async () => {
    const id = await book(slot(180, 240));
    // Every write batch waits, so both requests load the still-active booking before either cancels it.
    const { db } = instrumentedDb(env.DB, () => pause(60));
    const res = await Promise.all([
      viaApp(T.sama, "POST", `/api/bookings/${id}/cancel`, { reason: "أُلغي الموعد" }, db),
      viaApp(T.ammar, "POST", `/api/bookings/${id}/cancel`, { reason: "أُلغي الموعد" }, db),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(res.find((r) => r.status === 409)!.body.error).toBe("booking_gone");
    expect(await bookingEvents(id)).toEqual(["booking_cancelled"]);
  });

  it("L5 a reschedule that loaded the booking before it was cancelled is refused, records nothing and tells no one", async () => {
    const s = slot(1440, 1500);
    const id = await book(s);
    // Both load the active booking; the cancel writes first, the reschedule after it.
    const { db } = instrumentedDb(env.DB, (sqls) => pause(sqls.some((q) => q.startsWith("update bookings set starts_at")) ? 150 : 30));
    const [moved, cancelled] = await Promise.all([
      viaApp(T.sama, "PATCH", `/api/bookings/${id}`, { ...slot(1560, 1620), reason: "طلب العيادة" }, db),
      viaApp(T.ammar, "POST", `/api/bookings/${id}/cancel`, { reason: "أُلغي الموعد" }, db),
    ]);
    expect(cancelled.status).toBe(200);
    expect(moved.status).toBe(409);
    expect(await bookingEvents(id)).toEqual(["booking_cancelled"]);
    expect(await rows("select * from notifications where kind = 'booking_changed' and ref_id = ?", id)).toHaveLength(0);
    expect((await rows("select starts_at, ends_at, status from bookings where id = ?", id))[0]).toEqual({ ...s, status: "cancelled" });
  });

  it("L5 a due date cannot be proposed in the past, and a proposal whose date has passed can be rejected but not accepted", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", due_at: future(24 * 10) });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    const past = await act(T.hussein, id, "propose_due", { proposed_due_at: new Date(Date.now() - 3_600_000).toISOString(), reason: "كان يجب أمس" });
    expect(past.status).toBe(400);
    expect(past.body.field).toBe("proposed_due_at");
    expect(await rows("select * from due_proposals where task_id = ?", id)).toHaveLength(0);

    expect((await act(T.hussein, id, "propose_due", { proposed_due_at: future(48), reason: "أحتاج يومين" })).status).toBe(200);
    const p = (await task(T.sama, id)).due_proposals[0];
    await sql("update due_proposals set proposed_due_at = ? where id = ?", new Date(Date.now() - 3_600_000).toISOString(), p.id); // the date went by before anyone decided
    const dueBefore = (await task(T.sama, id)).task.due_at;
    expect((await act(T.sama, id, "decide_due", { proposal_id: p.id, accept: true })).status).toBe(400);
    expect((await rows("select status from due_proposals where id = ?", p.id))[0].status).toBe("pending");
    expect((await task(T.sama, id)).task.due_at).toBe(dueBefore);
    expect((await act(T.sama, id, "decide_due", { proposal_id: p.id, accept: false, note: "فات الموعد" })).status).toBe(200);
    expect((await rows("select status from due_proposals where id = ?", p.id))[0].status).toBe("rejected");
  });
});

// ---------- L6 ----------

describe("L6 push subscriptions cannot pile up", () => {
  const active = async (userId: string) => new Set((await rows<{ endpoint: string }>("select endpoint from push_subscriptions where user_id = ? and revoked_at is null", userId)).map((r) => r.endpoint));

  it("L6 a member keeps at most five active devices; the oldest are dropped and other members are untouched", async () => {
    await revokeDevices("u_mohammed");
    const other = await newDevice();
    expect((await subscribe(T.sama, other)).status).toBe(200);
    const ds: Device[] = [];
    for (let i = 0; i < 7; i++) {
      const d = await newDevice();
      ds.push(d);
      expect((await subscribe(T.mohammed, d)).status).toBe(200);
      await pause(5);
    }
    expect(await active("u_mohammed")).toEqual(new Set(ds.slice(2).map((d) => d.endpoint)));
    // Subscribing an old device again brings it back and drops the then-oldest.
    expect((await subscribe(T.mohammed, ds[0])).status).toBe(200);
    expect(await active("u_mohammed")).toEqual(new Set([ds[0], ...ds.slice(3)].map((d) => d.endpoint)));
    // A burst of parallel subscriptions still leaves five.
    await Promise.all(Array.from({ length: 6 }, async () => expect((await subscribe(T.mohammed, await newDevice())).status).toBe(200)));
    expect((await active("u_mohammed")).size).toBe(5);
    expect((await rows("select revoked_at from push_subscriptions where endpoint = ?", other.endpoint))[0].revoked_at).toBeNull();
  });

  it("L6 a device whose message cannot even be built counts as failing, and any failing device is dropped after ten failures", async () => {
    await revokeDevices("u_hussein");
    const broken = { endpoint: `${PUSH_HOST}fcm/send/broken-${crypto.randomUUID()}`, keys: { p256dh: b64url(crypto.getRandomValues(new Uint8Array(16))), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
    const refusing = await newDevice();
    expect((await subscribe(T.hussein, broken)).status).toBe(200);
    expect((await subscribe(T.hussein, refusing)).status).toBe(200);
    respond = (u) => (u === refusing.endpoint ? 400 : 201);
    const ctx = await loadCtx(envK);
    const state = async (d: Device) => (await rows<{ failures: number; revoked_at: string | null }>("select failures, revoked_at from push_subscriptions where endpoint = ?", d.endpoint))[0];
    const msg = { title: "t", body: "b", url: "/", tag: "x" };
    for (let i = 1; i <= 10; i++) {
      expect(await sendToUser(ctx, "u_hussein", msg, "https://agency.test")).toMatchObject({ devices: 2, sent: 0, failed: 2 });
      for (const d of [broken, refusing]) {
        const s = await state(d);
        expect(s.failures, `${d.endpoint} after ${i}`).toBe(i);
        expect(s.revoked_at === null, `${d.endpoint} after ${i}`).toBe(i < 10);
      }
    }
    expect((await sendToUser(ctx, "u_hussein", msg, "https://agency.test")).devices).toBe(0);
    expect(captured.filter((u) => u === broken.endpoint)).toHaveLength(0);
    expect(captured.filter((u) => u === refusing.endpoint)).toHaveLength(10);
  });
});

// ---------- L7 ----------

describe("L7 devices follow their session", () => {
  it("L7 the scheduler revokes devices whose session expired or is gone, and keeps the rest", async () => {
    const [expiring, gone, live] = [await signIn("sama"), await signIn("sama"), await signIn("sama")];
    const [de, dg, dl] = [await newDevice(), await newDevice(), await newDevice()];
    for (const [b, d] of [
      [expiring, de],
      [gone, dg],
      [live, dl],
    ] as const)
      expect((await subscribe(b, d)).status).toBe(200);
    const sub = async (d: Device) => (await rows<{ session_id: string; revoked_at: string | null }>("select session_id, revoked_at from push_subscriptions where endpoint = ?", d.endpoint))[0];
    const expiredSid = (await sub(de)).session_id;
    await sql(`update "session" set "expiresAt" = ? where id = ?`, "2000-01-01T00:00:00.000Z", expiredSid);
    await sql(`delete from "session" where id = ?`, (await sub(dg)).session_id);
    expect((await sub(de)).revoked_at).toBeNull();

    // Housekeeping runs at most once an hour; make this run the one that does it.
    await sql("delete from settings where key = 'housekeeping_at'");
    await run(0);
    expect(await rows(`select id from "session" where id = ?`, expiredSid)).toHaveLength(0);
    expect((await sub(de)).revoked_at).toBeTruthy();
    expect((await sub(dg)).revoked_at).toBeTruthy();
    expect((await sub(dl)).revoked_at).toBeNull();
    expect((await live.get("/api/account/me")).status).toBe(200);
  });
});

// ---------- outbox drain ----------

describe("drainOutbox", () => {
  it("drainOutbox delivers several due rows in one run, each to its own outcome, in a small bounded number of D1 round trips", async () => {
    // Start from an empty queue and no devices, so the run sees exactly the rows made here.
    await sql("update outbox set status = 'cancelled', last_error = 'test_reset' where status = 'pending'");
    await revokeDevices();
    const [hd, ad, md] = [await newDevice(), await newDevice(), await newDevice()];
    expect((await subscribe(T.hussein, hd)).status).toBe(200); // accepts
    expect((await subscribe(T.ammar, ad)).status).toBe(200); // temporarily unavailable
    expect((await subscribe(T.mohammed, md)).status).toBe(200); // refuses for good
    respond = (u) => (u === ad.endpoint ? 503 : u === md.endpoint ? 400 : 201);

    const toSend = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    const toRetry = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar" });
    expect((await act(T.ammar, toRetry, "escalate", { reason: "أحتاج قراراً" })).status).toBe(200); // → Mohammed
    const toSkip = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama" }); // Sama has no device
    const toCancel = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await sql("update tasks set status = 'acknowledged' where id = ?", toCancel); // bypass the action's own cancellation
    expect(await rows("select count(*) as n from outbox where status = 'pending'")).toEqual([{ n: 5 }]);

    type Row = { status: string; attempts: number; last_error: string | null; sent_at: string | null; next_attempt_at: string };
    const row = async (taskId: string, kind: string) =>
      (await rows<Row>("select o.status, o.attempts, o.last_error, o.sent_at, o.next_attempt_at from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind = ?", taskId, kind))[0];

    const t1 = plus(B, 10);
    const c1 = instrumentedDb(env.DB);
    expect(await drainOutbox({ ...(await loadCtx(envK, t1)), db: c1.db })).toEqual({ sent: 1, skipped: 1, failed: 1, cancelled: 1, retried: 1 });
    expect(await row(toSend, "assigned")).toMatchObject({ status: "sent", attempts: 1, last_error: null, sent_at: t1.toISOString() });
    const retry = await row(toRetry, "assigned");
    expect(retry).toMatchObject({ status: "pending", attempts: 1, sent_at: null, next_attempt_at: plus(t1, 1).toISOString() });
    expect(retry.last_error).toContain("503");
    const failed = await row(toRetry, "escalated");
    expect(failed).toMatchObject({ status: "failed", attempts: 1, sent_at: null });
    expect(failed.last_error).toContain("400");
    expect(await row(toSkip, "assigned")).toMatchObject({ status: "skipped", attempts: 1, last_error: "no_device" });
    expect(await row(toCancel, "assigned")).toMatchObject({ status: "cancelled", attempts: 1, last_error: "already_acknowledged" });
    expect([...captured].sort()).toEqual([hd, ad, md].map((d) => d.endpoint).sort());
    expect((await rows<{ last_success_at: string | null }>("select last_success_at from push_subscriptions where endpoint = ?", hd.endpoint))[0].last_success_at).toBe(t1.toISOString());
    // An outage (503) is not the device's fault and never counts against it; a refusal (400) does.
    const dev = async (d: Device) => (await rows<{ failures: number; last_error: string | null; revoked_at: string | null }>("select failures, last_error, revoked_at from push_subscriptions where endpoint = ?", d.endpoint))[0];
    expect(await dev(ad)).toMatchObject({ failures: 0, revoked_at: null });
    expect((await dev(ad)).last_error).toContain("503");
    expect(await dev(md)).toMatchObject({ failures: 1, revoked_at: null });
    expect((await dev(md)).last_error).toContain("400");

    // Two minutes later only the retry is due, and this time it goes through.
    respond = () => 201;
    const t2 = plus(t1, 2);
    const c2 = instrumentedDb(env.DB);
    expect(await drainOutbox({ ...(await loadCtx(envK, t2)), db: c2.db })).toEqual({ sent: 1, skipped: 0, failed: 0, cancelled: 0, retried: 0 });
    expect(await row(toRetry, "assigned")).toMatchObject({ status: "sent", attempts: 2, last_error: null, sent_at: t2.toISOString() });
    expect(await row(toRetry, "escalated")).toMatchObject({ status: "failed", attempts: 1 });
    // Statuses are written every few rows, so round trips grow by one per three rows at most.
    expect(c2.trips()).toBeLessThanOrEqual(c1.trips());
    expect(c1.trips()).toBeLessThanOrEqual(10);

    // Nothing due: two statements (give up on rows that kept dying, then the claim) and done.
    const c3 = instrumentedDb(env.DB);
    expect(await drainOutbox({ ...(await loadCtx(envK, t2)), db: c3.db })).toEqual({ sent: 0, skipped: 0, failed: 0, cancelled: 0, retried: 0 });
    expect(c3.trips()).toBe(2);
  });
});

// =====================================================================
// Round 2: the changes made after the adversarial review of the fixes.
// Every test name starts with "R2.".
// =====================================================================

/** Reset the device queue so a drain sees only the rows a test makes. */
const resetOutbox = () => sql("update outbox set status = 'cancelled', last_error = 'test_reset' where status = 'pending'");
const pendingCount = async () => (await rows<{ n: number }>("select count(*) as n from outbox where status = 'pending'"))[0].n;
type OutRow = { task_id: string; status: string; attempts: number; next_attempt_at: string; last_error: string | null };
const assignedRows = (taskIds: string[]) =>
  rows<OutRow>(
    "select n.task_id, o.status, o.attempts, o.next_attempt_at, o.last_error from outbox o join notifications n on n.id = o.notification_id where n.kind = 'assigned' and n.task_id in (select value from json_each(?))",
    JSON.stringify(taskIds),
  );
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
/** A slot on the real clock, `daysAhead` days from now on a quarter hour, so API "not in the past" checks pass. */
const realSlot = (daysAhead: number, minutes = 0, length = 60) => {
  const s = new Date(Math.ceil((Date.now() + daysAhead * 86_400_000) / 900_000) * 900_000 + minutes * 60_000);
  return { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + length * 60_000).toISOString() };
};
const createBooking = async (as: Browser, fields: Record<string, unknown>) => {
  const r = await as.post("/api/bookings", { client_id: "c_obesity", title: "حجز تصوير", create_key: key(), ...fields });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};

describe("R2 the follow-up clocks restart when the work changes hands", () => {
  const F = ["blocker_follow", "blocker_escalation"];

  it("R2. a blocker handed over on reassignment tells its new holder, and his follow-up clock starts at the handover, keyed to him", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-HANDOVER" });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    // A blocker Hussein holds (a row from before the round-2 rule), open since Sunday 09:00.
    const b = `b_r2_${key()}`;
    await sql("insert into blockers (id, task_id, kind, reason, resolver_id, opened_by, opened_at) values (?, ?, 'internal', 'R2-HELD', 'u_hussein', 'u_sama', ?)", b, id, B.toISOString());
    await run(130);
    expect(only(await noteCounts(id), F)).toEqual({ "hussein:blocker_follow": 1 });

    const t0 = new Date().toISOString();
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, assignee_id: "u_sama", reviewer_id: "u_ammar", reason: "سأنفذها بنفسي" })).status).toBe(200);
    const t1 = new Date().toISOString();

    // Hussein lost the task, Sama is now the assignee, so it goes to the reviewer, from now.
    const row = (await rows<{ resolver_id: string; resolver_since: string; opened_at: string }>("select resolver_id, resolver_since, opened_at from blockers where id = ?", b))[0];
    expect(row.resolver_id).toBe("u_ammar");
    expect(row.resolver_since >= t0 && row.resolver_since <= t1, `${row.resolver_since} not in [${t0}, ${t1}]`).toBe(true);
    expect(row.opened_at).toBe(B.toISOString());
    const ev = await rows<{ actor_id: string; data: string }>("select actor_id, data from events where task_id = ? and type = 'blocker_handed_over'", id);
    expect(ev.map((e) => ({ actor: e.actor_id, ...JSON.parse(e.data) }))).toEqual([{ actor: "u_sama", blocker: b, from: "u_hussein", to: "u_ammar" }]);
    const told = await rows<{ user_id: string; ref_id: string; dedupe_key: string; title: string }>("select user_id, ref_id, dedupe_key, title from notifications where task_id = ? and kind = 'blocker_opened'", id);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ user_id: "u_ammar", ref_id: b, dedupe_key: `blocker_handover:${b}:u_ammar:2` });
    expect(told[0].title).toContain("R2-HANDOVER");
    expect(await rows("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind = 'blocker_opened' and n.user_id = 'u_ammar'", id)).toHaveLength(1);

    // On the scheduler's clock the handover happened at 12:20 (B + 200).
    await sql("update blockers set resolver_since = ? where id = ?", plus(B, 200).toISOString(), b);
    await run(210); // 210 minutes since it opened, but only 10 since it reached Ammar
    await run(319);
    expect(only(await noteCounts(id), F)).toEqual({ "hussein:blocker_follow": 1 });
    await run(320); // 120 business minutes after the handover
    expect(only(await noteCounts(id), F)).toEqual({ "hussein:blocker_follow": 1, "ammar:blocker_follow": 1 });
    await run(439);
    expect(only(await noteCounts(id), F)).toEqual({ "hussein:blocker_follow": 1, "ammar:blocker_follow": 1 });
    await run(440); // twice the follow-up time after the handover: the person above Ammar
    expect(only(await noteCounts(id), F)).toEqual({ "hussein:blocker_follow": 1, "ammar:blocker_follow": 1, "mohammed:blocker_escalation": 1 });
    expect((await rows<{ dedupe_key: string }>("select dedupe_key from notifications where task_id = ? and kind in ('blocker_follow', 'blocker_escalation') order by dedupe_key", id)).map((r) => r.dedupe_key.replace(/:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z:/, ":"))).toEqual([
      `blocker_follow:${b}:u_ammar:1`,
      `blocker_follow:${b}:u_ammar:2`,
      `blocker_follow:${b}:u_hussein:1`,
    ]);
  });

  it("R2. a reviewer named during review is reminded from when he took over, not from the submission; the old reviewer's queued notice is withdrawn", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", reviewer_id: "u_sama", title: "R2-REVIEW" });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    expect((await act(T.hussein, id, "submit", { url: "https://drive.example/r2" })).status).toBe(200);
    await sql("update tasks set submitted_at = ? where id = ?", B.toISOString(), id);
    const R = ["submitted", "review_reminder", "review_escalation"];
    await run(130);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1 });
    const samaSubmitted = () =>
      rows<{ status: string; last_error: string | null }>("select o.status, o.last_error from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.user_id = 'u_sama' and n.kind = 'submitted'", id);
    expect((await samaSubmitted()).map((r) => r.status)).toEqual(["pending"]);

    const t0 = new Date().toISOString();
    const v = (await task(T.sama, id)).task.version;
    expect((await T.sama.patch(`/api/tasks/${id}`, { version: v, reviewer_id: "u_ammar" })).status).toBe(200);
    const t1 = new Date().toISOString();
    const since = (await rows<{ reviewer_since: string }>("select reviewer_since from tasks where id = ?", id))[0].reviewer_since;
    expect(since >= t0 && since <= t1, `${since} not in [${t0}, ${t1}]`).toBe(true);
    expect(await samaSubmitted()).toEqual([{ status: "cancelled", last_error: "superseded" }]);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1 });

    // On the scheduler's clock Ammar took over at 12:20 (B + 200).
    await sql("update tasks set reviewer_since = ? where id = ?", plus(B, 200).toISOString(), id);
    await run(210);
    await run(319);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1 });
    await run(320);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1, "ammar:review_reminder": 1 });
    await run(439);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1, "ammar:review_reminder": 1 });
    await run(440);
    expect(only(await noteCounts(id), R)).toEqual({ "sama:submitted": 1, "sama:review_reminder": 1, "ammar:submitted": 1, "ammar:review_reminder": 1, "mohammed:review_escalation": 1 });
    expect((await act(T.ammar, id, "approve")).status).toBe(200);
  });
});

describe("R2 who may hold a blocker", () => {
  it("R2. the owner doing his own task may hold its internal blocker himself (the default), and keeps one that names him when he takes a task over", async () => {
    const own = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_mohammed", title: "R2-OWNER-SELF" });
    const d = await task(T.mohammed, own);
    expect(d.task.reviewer.id).toBe("u_mohammed");
    expect((await act(T.mohammed, own, "block", { kind: "internal", reason: "أنتظر قراراً من الإدارة" })).status).toBe(200);
    expect((await act(T.mohammed, own, "block", { kind: "internal", reason: "عائق ثانٍ عندي", resolver_id: "u_mohammed" })).status).toBe(200);
    expect((await act(T.mohammed, own, "block", { kind: "client_wait", reason: "بانتظار المستشفى", resolver_id: "u_mohammed" })).status).toBe(200);
    expect((await rows<{ kind: string; resolver_id: string; opened_by: string }>("select kind, resolver_id, opened_by from blockers where task_id = ? order by opened_at, kind", own)).map((b) => [b.kind, b.resolver_id, b.opened_by])).toEqual([
      ["internal", "u_mohammed", "u_mohammed"],
      ["internal", "u_mohammed", "u_mohammed"],
      ["client_wait", "u_mohammed", "u_mohammed"],
    ]);

    // He takes over a task whose internal blocker names him: it stays with him, nothing is handed over.
    const id = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_hussein", title: "R2-OWNER-TAKEOVER" });
    expect((await act(T.hussein, id, "block", { kind: "internal", reason: "عائق عند حسين" })).status).toBe(200);
    const held = (await task(T.mohammed, id)).blockers[0];
    expect(held.resolver_id).toBe("u_mohammed");
    const v = (await task(T.mohammed, id)).task.version;
    expect((await T.mohammed.patch(`/api/tasks/${id}`, { version: v, assignee_id: "u_mohammed", reason: "سأنجزها بنفسي" })).status).toBe(200);
    expect((await rows("select resolver_id, resolver_since, resolved_at from blockers where id = ?", held.id))[0]).toEqual({ resolver_id: "u_mohammed", resolver_since: null, resolved_at: null });
    expect(await rows("select * from events where task_id = ? and type = 'blocker_handed_over'", id)).toHaveLength(0);
  });

  it("R2. waiting on the client stays with the client's account manager: Sama may hold it on her own task, Hussein never", async () => {
    const own = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama", title: "R2-AM-OWN" });
    expect((await act(T.sama, own, "block", { kind: "client_wait", reason: "بانتظار موافقة العيادة", resolver_id: "u_sama" })).status).toBe(200);
    expect((await act(T.sama, own, "block", { kind: "client_wait", reason: "بانتظار صور العيادة" })).status).toBe(200);
    expect((await act(T.sama, own, "block", { kind: "internal", reason: "عائق عندي", resolver_id: "u_sama" })).status).toBe(400);
    expect((await rows<{ resolver_id: string }>("select resolver_id from blockers where task_id = ?", own)).map((r) => r.resolver_id)).toEqual(["u_sama", "u_sama"]);

    // On another client's task (shared with her) she is not its account manager, so its client wait is not hers to hold.
    const ward = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_sama", title: "R2-AM-WARD" });
    expect((await act(T.sama, ward, "block", { kind: "client_wait", reason: "بانتظار المستشفى", resolver_id: "u_sama" })).status).toBe(400);
    expect((await act(T.sama, ward, "block", { kind: "client_wait", reason: "بانتظار المستشفى" })).status).toBe(200);
    expect(await rows("select resolver_id from blockers where task_id = ?", ward)).toEqual([{ resolver_id: "u_ammar" }]);

    // Hussein is never the one waiting on the client, whoever names him.
    const shoot = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-AM-SHOOT" });
    expect((await act(T.hussein, shoot, "block", { kind: "client_wait", reason: "بانتظار العيادة", resolver_id: "u_hussein" })).status).toBe(400);
    expect((await act(T.sama, shoot, "block", { kind: "client_wait", reason: "بانتظار العيادة", resolver_id: "u_hussein" })).status).toBe(400);
    expect((await act(T.mohammed, shoot, "block", { kind: "client_wait", reason: "بانتظار العيادة", resolver_id: "u_hussein" })).status).toBe(400);
    expect((await act(T.hussein, shoot, "block", { kind: "client_wait", reason: "بانتظار العيادة" })).status).toBe(200);
    expect(await rows("select resolver_id from blockers where task_id = ?", shoot)).toEqual([{ resolver_id: "u_sama" }]);
  });
});

describe("R2 device delivery", () => {
  it("R2. an outage (503, 429, no answer) never counts against a device, while a device that keeps refusing (400) is dropped after ten", async () => {
    await revokeDevices("u_ammar");
    const [down, busy, offline, refusing] = [await newDevice(), await newDevice(), await newDevice(), await newDevice()];
    for (const d of [down, busy, offline, refusing]) expect((await subscribe(T.ammar, d)).status).toBe(200);
    respond = (u) => (u === down.endpoint ? 503 : u === busy.endpoint ? 429 : u === offline.endpoint ? 0 : u === refusing.endpoint ? 400 : 201);
    const state = async (d: Device) => (await rows<{ failures: number; revoked_at: string | null; last_error: string | null }>("select failures, revoked_at, last_error from push_subscriptions where endpoint = ?", d.endpoint))[0];
    const ctx = await loadCtx(envK);
    const msg = { title: "t", body: "b", url: "/", tag: "x" };
    for (let i = 1; i <= 12; i++) {
      const live = i <= 10 ? 4 : 3;
      expect(await sendToUser(ctx, "u_ammar", msg, "https://agency.test"), `send ${i}`).toMatchObject({ devices: live, sent: 0, failed: live, retryable: true });
      for (const d of [down, busy, offline]) expect(await state(d), `${d.endpoint} after ${i}`).toMatchObject({ failures: 0, revoked_at: null });
      const r = await state(refusing);
      expect(r.failures, `refusing after ${i}`).toBe(Math.min(i, 10));
      expect(r.revoked_at === null, `refusing after ${i}`).toBe(i < 10);
    }
    expect((await state(down)).last_error).toContain("503");
    expect((await state(busy)).last_error).toContain("429");
    expect((await state(offline)).last_error).toContain("Network connection lost");
    expect(tally(captured)).toEqual({ [down.endpoint]: 12, [busy.endpoint]: 12, [offline.endpoint]: 12, [refusing.endpoint]: 10 });
  });

  it("R2. one run makes at most FETCH_BUDGET push requests; rows past it stay pending with their attempts unchanged and go out on the next runs", async () => {
    await resetOutbox();
    await revokeDevices("u_hussein");
    const ds = [await newDevice(), await newDevice(), await newDevice()];
    for (const d of ds) expect((await subscribe(T.hussein, d)).status).toBe(200);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: `R2-BUDGET-${i}` }));
    expect(await pendingCount()).toBe(5);
    // Three devices per row: as many whole rows as fit in the budget go out per run.
    const perRun = Math.floor(FETCH_BUDGET / 3);
    expect(perRun).toBeGreaterThanOrEqual(1);

    let t = plus(B, 20);
    let sent = 0;
    for (let run = 1; sent < 5; run++) {
      captured = [];
      const r = await drainOutbox(await loadCtx(envK, t));
      expect(r.sent, `run ${run}`).toBe(Math.min(perRun, 5 - sent));
      expect(captured.length, `run ${run}`).toBeLessThanOrEqual(FETCH_BUDGET);
      expect(captured, `run ${run}`).toHaveLength(r.sent * 3);
      sent += r.sent;
      const out = await assignedRows(ids);
      expect(tally(out.map((o) => `${o.status}:${o.attempts}`)), `run ${run}`).toEqual(sent < 5 ? { "sent:1": sent, "pending:0": 5 - sent } : { "sent:1": 5 });
      for (const o of out.filter((x) => x.status === "pending")) expect(o).toMatchObject({ next_attempt_at: t.toISOString(), last_error: null });
      t = plus(t, 1);
      expect(run).toBeLessThan(10);
    }
  });

  it("R2. a drain that dies part-way keeps the statuses it already wrote; only the rows after the last write go out again", async () => {
    await resetOutbox();
    await revokeDevices("u_hussein");
    const d = await newDevice();
    expect((await subscribe(T.hussein, d)).status).toBe(200);
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: `R2-FLUSH-${i}` }));
    // Two writes per row (device + row status): writes go out after every third row; the second write batch fails.
    let batches = 0;
    const c = instrumentedDb(env.DB, async () => {
      if (++batches === 2) throw new Error("R2 simulated crash");
    });
    const t1 = plus(B, 30);
    await expect(drainOutbox({ ...(await loadCtx(envK, t1)), db: c.db })).rejects.toThrow("R2 simulated crash");
    expect(captured).toHaveLength(6); // rows 1-6 were pushed; the run died before row 7
    let out = await assignedRows(ids);
    expect(tally(out.map((o) => `${o.status}:${o.attempts}`))).toEqual({ "sent:1": 3, "pending:1": 5 });
    const lease = plus(t1, 3).toISOString();
    for (const o of out.filter((x) => x.status === "pending")) expect(o.next_attempt_at).toBe(lease);

    // Still leased a minute later; after the lease the five go out (rows 4-6 again: at least once).
    captured = [];
    expect(await drainOutbox(await loadCtx(envK, plus(t1, 1)))).toEqual({ sent: 0, skipped: 0, failed: 0, cancelled: 0, retried: 0 });
    expect(await drainOutbox(await loadCtx(envK, plus(t1, 3)))).toEqual({ sent: 5, skipped: 0, failed: 0, cancelled: 0, retried: 0 });
    expect(captured).toHaveLength(5);
    out = await assignedRows(ids);
    expect(tally(out.map((o) => `${o.status}:${o.attempts}`))).toEqual({ "sent:1": 3, "sent:2": 5 });
  });

  it("R2. a delivery whose attempts reached MAX_ATTEMPTS + 2 (it kept dying mid-run) is failed without another push", async () => {
    await resetOutbox();
    await revokeDevices("u_hussein");
    const d = await newDevice();
    expect((await subscribe(T.hussein, d)).status).toBe(200);
    const [six, seven, five] = [
      await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-ATTEMPTS-6" }),
      await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-ATTEMPTS-7" }),
      await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-ATTEMPTS-5" }),
    ];
    const setAttempts = (taskId: string, n: number, err: string | null) =>
      sql("update outbox set attempts = ?, last_error = ? where notification_id in (select id from notifications where task_id = ? and kind = 'assigned')", n, err, taskId);
    await setAttempts(six, 6, null);
    await setAttempts(seven, 7, "503 earlier");
    await setAttempts(five, 5, null);

    expect(await drainOutbox(await loadCtx(envK, plus(B, 40)))).toEqual({ sent: 1, skipped: 0, failed: 0, cancelled: 0, retried: 0 });
    const by = Object.fromEntries((await assignedRows([six, seven, five])).map((o) => [o.task_id, { status: o.status, attempts: o.attempts, last_error: o.last_error }]));
    expect(by).toEqual({
      [six]: { status: "failed", attempts: 6, last_error: "too_many_attempts" },
      [seven]: { status: "failed", attempts: 7, last_error: "503 earlier" },
      [five]: { status: "sent", attempts: 6, last_error: null },
    });
    expect(captured).toEqual([d.endpoint]);
  });

  it("R2. POST /api/push/check tells a browser whether the server still sends to its subscription, for the signed-in member only", async () => {
    const d = await newDevice();
    const other = await newDevice();
    const check = async (as: Browser, endpoint: string) => {
      const r = await as.post("/api/push/check", { endpoint });
      expect(r.status).toBe(200);
      return r.body;
    };
    expect(await check(T.sama, d.endpoint)).toEqual({ active: false });
    expect((await subscribe(T.sama, d)).status).toBe(200);
    expect(await check(T.sama, d.endpoint)).toEqual({ active: true });
    // The server dropped it (its session ended, or it kept failing): the page offers to re-link.
    await sql("update push_subscriptions set revoked_at = ? where endpoint = ?", new Date().toISOString(), d.endpoint);
    expect(await check(T.sama, d.endpoint)).toEqual({ active: false });
    expect((await subscribe(T.sama, d)).status).toBe(200);
    expect(await check(T.sama, d.endpoint)).toEqual({ active: true });
    // Another member's subscription is not hers.
    expect((await subscribe(T.hussein, other)).status).toBe(200);
    expect(await check(T.sama, other.endpoint)).toEqual({ active: false });
    expect(await check(T.hussein, other.endpoint)).toEqual({ active: true });
    // The device moves to whoever signs in on it next.
    expect((await subscribe(T.ammar, d)).status).toBe(200);
    expect(await check(T.sama, d.endpoint)).toEqual({ active: false });
    expect(await check(T.ammar, d.endpoint)).toEqual({ active: true });
    expect((await T.ammar.post("/api/push/unsubscribe", { endpoint: d.endpoint })).status).toBe(200);
    expect(await check(T.ammar, d.endpoint)).toEqual({ active: false });
    expect((await T.sama.post("/api/push/check", {})).status).toBe(400);
  });
});

describe("R2 limits", () => {
  it("R2. password changes are limited per member (5 per 15 minutes), whichever address or session they come from", { timeout: 120_000 }, async () => {
    await inFreshLoginWindow();
    const [s1, s2, h] = [await signIn("ammar"), await signIn("ammar"), await signIn("hussein")];
    const attempt = (b: Browser, ip: string) => {
      b.ip = ip;
      return b.post("/api/account/password", { current: "not-the-password-0", next: "Fresh-Strong-Pass-77" });
    };
    for (let i = 1; i <= 5; i++) {
      const r = await attempt(s1, `192.0.2.${i}`);
      expect(r.status, `attempt ${i}`).toBe(400);
      expect(r.body.field).toBe("current");
    }
    const over = await attempt(s2, "192.0.2.99");
    expect(over.status).toBe(429);
    expect(over.body.error).toBe("rate_limited");
    expect((await attempt(s1, "203.0.113.5")).status).toBe(429);
    // Another member is not affected.
    expect((await attempt(h, "192.0.2.1")).status).toBe(400);
    expect(await rows("select key, count from request_limits where key like 'pw:%' order by key")).toEqual([
      { key: "pw:u_ammar", count: 7 },
      { key: "pw:u_hussein", count: 1 },
    ]);
  });

  it("R2. IPv6 addresses in the same /64 share the sign-in and setup limits, however they are written", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    const net = "2001:db8:5:7";
    const same = [`${net}::1`, `${net}::2`, "2001:0db8:0005:0007:0000:0000:0000:0003", "2001:DB8:5:7:FFFF:FFFF:FFFF:FFFF", `${net}:1:2:3:4`, `${net}::abcd`, `${net}:0:0:0:5`, "2001:db8:5:7::6"];
    for (const [i, ip] of same.entries()) expect((await signInAs(ip, "hussein", `wrong-${i}-password`)).status, ip).toBe(401);
    expect((await signInAs(`${net}::99`, "hussein", PASSWORDS.hussein)).status).toBe(429);
    expect((await signInAs("2001:db8:5:8::1", "hussein", PASSWORDS.hussein)).status).toBe(200); // the next /64
    expect(await rows("select key, count from request_limits where key in (?, ?) order by key", `login:ip:${net}::/64`, `login:u:hussein:${net}::/64`)).toEqual([
      // The ninth try was refused by Hussein's own limit before it reached the shared one.
      { key: `login:ip:${net}::/64`, count: 8 },
      { key: `login:u:hussein:${net}::/64`, count: 9 },
    ]);
    // The per-address allowance (30) is shared by the whole /64 as well.
    for (let i = 0; i < 22; i++) expect((await signInAs(`${net}::${(0x100 + i).toString(16)}`, `ghost_v6_${i}`, "wrong-password-xx")).status).toBe(401);
    expect((await signInAs(`${net}::beef`, "sama", PASSWORDS.sama)).status).toBe(429);
    expect((await signInAs("2001:db8:5:8::2", "sama", PASSWORDS.sama)).status).toBe(200);

    // Setup links: 20 checks per /64 per window.
    const setupNet = "2001:db8:5:9";
    const token = "x".repeat(40);
    for (let i = 1; i <= 20; i++) expect((await new Browser(`${setupNet}::${i.toString(16)}`).post("/api/setup/check", { token })).body).toEqual({ valid: false });
    expect((await new Browser(`${setupNet}:ffff::1`).post("/api/setup/check", { token })).status).toBe(429);
    expect((await new Browser("2001:db8:5:a::1").post("/api/setup/check", { token })).status).toBe(200);
  });
});

describe("R2 bookings", () => {
  it("R2. /api/today, /api/bookings and /api/bookings/check never link a booking to a task the viewer cannot open", async () => {
    const hidden = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_sama", title: "R2-HIDDEN-TASK" });
    const his = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-HIS-TASK" });
    expect((await T.hussein.get(`/api/tasks/${hidden}`)).status).toBe(404);
    const s1 = realSlot(3, 0);
    const s2 = realSlot(3, 120);
    const b1 = await createBooking(T.sama, { task_id: hidden, ...s1 });
    const b2 = await createBooking(T.sama, { task_id: his, ...s2 });
    const links = (list: any[]) => Object.fromEntries(list.filter((b) => b.id === b1 || b.id === b2).map((b) => [b.id, b.task_id]));
    const checkUrl = `/api/bookings/check?starts_at=${encodeURIComponent(s1.starts_at)}&ends_at=${encodeURIComponent(s2.ends_at)}`;

    // Hussein sees every booking of his time in full, but only his own task's link.
    const today = await T.hussein.get("/api/today");
    expect(today.status).toBe(200);
    expect(links(today.body.bookings)).toEqual({ [b1]: null, [b2]: his });
    expect(JSON.stringify(today.body)).not.toContain(hidden);
    const list = await T.hussein.get("/api/bookings");
    expect(links(list.body.bookings)).toEqual({ [b1]: null, [b2]: his });
    expect(JSON.stringify(list.body)).not.toContain(hidden);
    const check = await T.hussein.get(checkUrl);
    expect(check.status).toBe(200);
    expect(check.body.free).toBe(false);
    expect(links(check.body.conflicts)).toEqual({ [b1]: null, [b2]: his });
    expect(JSON.stringify(check.body)).not.toContain(hidden);

    // Sama can open both, so she gets both links.
    expect(links((await T.sama.get(checkUrl)).body.conflicts)).toEqual({ [b1]: hidden, [b2]: his });
    expect(links((await T.sama.get("/api/today")).body.bookings)).toEqual({ [b1]: hidden, [b2]: his });
  });

  it("R2. a booking no longer links its task once the task is archived, since only the owner can open an archived task", async () => {
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R2-ARCHIVED" });
    const bk = await createBooking(T.sama, { task_id: id, ...realSlot(4, 0) });
    expect((await act(T.mohammed, id, "archive")).status).toBe(200);
    expect((await T.hussein.get(`/api/tasks/${id}`)).status).toBe(404);
    expect((await T.sama.get(`/api/tasks/${id}`)).status).toBe(404);
    const linkFor = async (as: Browser) => ((await as.get("/api/bookings")).body.bookings as any[]).find((b) => b.id === bk)?.task_id;
    expect(await linkFor(T.mohammed)).toBe(id);
    expect(await linkFor(T.hussein)).toBeNull();
    expect(await linkFor(T.sama)).toBeNull();
  });

  it("R2. a booking already under way can have its end moved later, but its start cannot be moved and its end cannot be put in the past", async () => {
    const id = await createBooking(T.sama, realSlot(0, 30));
    const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const ahead = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
    const started = ago(90);
    await sql("update bookings set starts_at = ?, ends_at = ? where id = ?", started, ahead(30), id);
    const later = ahead(90);
    expect((await T.sama.patch(`/api/bookings/${id}`, { starts_at: started, ends_at: later, reason: "التصوير أطول من المتوقع" })).status).toBe(200);
    expect((await rows("select starts_at, ends_at, status from bookings where id = ?", id))[0]).toEqual({ starts_at: started, ends_at: later, status: "active" });
    // Its start is in the past: moving it (even within the past) is refused…
    expect((await T.sama.patch(`/api/bookings/${id}`, { starts_at: ago(60), ends_at: later, reason: "تصحيح البداية" })).status).toBe(400);
    // …and so is ending it in the past.
    expect((await T.sama.patch(`/api/bookings/${id}`, { starts_at: started, ends_at: ago(1), reason: "انتهى التصوير" })).status).toBe(400);
    expect((await rows("select starts_at, ends_at from bookings where id = ?", id))[0]).toEqual({ starts_at: started, ends_at: later });
    expect((await rows<{ type: string }>("select type from events where json_extract(data, '$.booking') = ? and type = 'booking_rescheduled'", id)).length).toBe(1);
  });

  it("R2. rescheduling a booking that was cancelled meanwhile returns 409 booking_gone, and once cancelled it cannot be loaded to reschedule (404)", async () => {
    const slot = (from: number, to: number) => ({ starts_at: plus(B, from).toISOString(), ends_at: plus(B, to).toISOString() });
    const s = slot(2880, 2940);
    const id = await createBooking(T.sama, s);
    const { db } = instrumentedDb(env.DB, (sqls) => pause(sqls.some((q) => q.startsWith("update bookings set starts_at")) ? 150 : 30));
    const [moved, cancelled] = await Promise.all([
      viaApp(T.sama, "PATCH", `/api/bookings/${id}`, { ...slot(3000, 3060), reason: "طلب العيادة" }, db),
      viaApp(T.ammar, "POST", `/api/bookings/${id}/cancel`, { reason: "أُلغي الموعد" }, db),
    ]);
    expect(cancelled.status).toBe(200);
    expect(moved.status).toBe(409);
    expect(moved.body.error).toBe("booking_gone");
    expect(moved.body.conflicts).toBeUndefined();
    const late = await T.sama.patch(`/api/bookings/${id}`, { ...slot(3000, 3060), reason: "طلب العيادة" });
    expect(late.status).toBe(404);
    expect((await rows("select starts_at, ends_at, status from bookings where id = ?", id))[0]).toEqual({ ...s, status: "cancelled" });
    expect(await rows("select * from notifications where kind = 'booking_changed' and ref_id = ?", id)).toHaveLength(0);
  });
});

describe("R2 the minute-by-minute cron stays cheap", () => {
  const plan = async (q: string, ...params: unknown[]) => (await rows<{ detail: string }>(`explain query plan ${q}`, ...params)).map((r) => r.detail);

  it("R2. EXPLAIN QUERY PLAN: the scheduler's open-task query and the scheduler_runs cleanup use an index, not a full scan", async () => {
    // The exact statements worker/scheduler.ts runs.
    const open = await plan(`select * from tasks where archived_at is null and status in (${OPEN_STATUSES.map(() => "?").join(",")})`, ...OPEN_STATUSES);
    expect(open.some((d) => /^SEARCH tasks USING INDEX tasks_open_idx\b/.test(d)), open.join(" | ")).toBe(true);
    expect(open.filter((d) => /^SCAN tasks\b/.test(d)), open.join(" | ")).toEqual([]);
    const cleanup = await plan("delete from scheduler_runs where started_at < ?", new Date().toISOString());
    expect(cleanup.some((d) => /^SEARCH scheduler_runs USING (COVERING )?INDEX scheduler_runs_started_idx\b/.test(d)), cleanup.join(" | ")).toBe(true);
    expect(cleanup.filter((d) => /^SCAN scheduler_runs\b/.test(d)), cleanup.join(" | ")).toEqual([]);
    // The outbox statements every drain runs, too.
    const nowIso = new Date().toISOString();
    for (const [q, p] of [
      ["update outbox set status = 'failed', last_error = coalesce(last_error, 'too_many_attempts') where status = 'pending' and attempts >= ?", [6]],
      ["select id from outbox where status = 'pending' and next_attempt_at <= ? order by next_attempt_at limit ?", [nowIso, 20]],
    ] as const) {
      const d = await plan(q, ...p);
      expect(d.filter((x) => /^SCAN outbox\b/.test(x)), `${q}: ${d.join(" | ")}`).toEqual([]);
    }
  });

  it("R2. housekeeping runs at most once an hour and keeps one day of scheduler runs", async () => {
    await sql("delete from settings where key = 'housekeeping_at'");
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const insertRun = async (startedAt: string) => (await env.DB.prepare("insert into scheduler_runs (started_at, ok) values (?, 1) returning id").bind(startedAt).first<{ id: number }>())!.id;
    const exists = async (id: number) => (await rows("select id from scheduler_runs where id = ?", id)).length === 1;
    const stamp = async () => (await rows<{ value: string }>("select value from settings where key = 'housekeeping_at'"))[0]?.value;
    const old = await insertRun(ago(25));
    const recent = await insertRun(ago(23));
    await run(0);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    const first = await stamp();
    expect(Math.abs(Date.now() - Date.parse(first))).toBeLessThan(60_000);

    // Within the hour nothing is cleaned again.
    const older = await insertRun(ago(30));
    await run(1);
    expect(await exists(older)).toBe(true);
    expect(await stamp()).toBe(first);

    // An hour after the last housekeeping it runs again.
    await sql("update settings set value = ? where key = 'housekeeping_at'", ago(1.01));
    await run(2);
    expect(await exists(older)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(Date.parse((await stamp())!)).toBeGreaterThan(Date.parse(first));
  });
});

describe("R2 sign-in attempts are reserved before the password check", () => {
  it("R2. a correct password for a deactivated member still counts against that address; only a complete sign-in clears it", { timeout: 120_000 }, async () => {
    await ensurePasswords();
    await inFreshLoginWindow();
    const uid = "u_r2ghost";
    const pw = "R2-Ghost-Pass-61";
    const nowIso = new Date().toISOString();
    await sql(
      `insert into "user" ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt", "username", "displayUsername") values (?, 'شبح', 'r2ghost@team.agency-followup.invalid', 0, null, ?, ?, 'r2ghost', 'r2ghost')`,
      uid,
      nowIso,
      nowIso,
    );
    await sql("insert into members (user_id, username, display_name, role, rank, title, must_change_password, active, created_at) values (?, 'r2ghost', 'شبح', 'account_manager', 1, 'اختبار', 0, 0, ?)", uid, nowIso);
    await sql(`insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") values ('a_r2ghost', ?, 'credential', ?, ?, ?, ?)`, uid, uid, await hashPassword(pw, 100_000), nowIso, nowIso);
    try {
      const ip = "198.51.100.90";
      const pairKey = `login:u:r2ghost:${ip}`;
      for (let i = 0; i < 3; i++) expect((await signInAs(ip, "r2ghost", pw)).status).toBe(401);
      expect(await rows("select count from request_limits where key = ?", pairKey)).toEqual([{ count: 3 }]);
      expect(await rows(`select id from "session" where "userId" = ?`, uid)).toHaveLength(0);

      await sql("update members set active = 1 where user_id = ?", uid);
      expect((await signInAs(ip, "r2ghost", pw)).status).toBe(200);
      expect(await rows("select count from request_limits where key = ?", pairKey)).toHaveLength(0);
    } finally {
      await sql("update members set active = 0 where user_id = ?", uid);
      await sql(`delete from "session" where "userId" = ?`, uid);
    }
  });
});

describe("R3 escalation lands above both people", () => {
  it("R3. a blocker held by someone ranked below the assignee escalates above the assignee, not to him", async () => {
    const T = await team();
    const B = baseSunday();
    // Ammar's own clinic task, reviewer Sama: an internal blocker defaults to Sama, who ranks below him.
    const id = await createTask(T.ammar, { client_id: "c_obesity", assignee_id: "u_ammar", reviewer_id: "u_sama", title: "R3-ABOVE", due_at: plus(B, 60 * 24 * 30).toISOString() });
    expect((await act(T.ammar, id, "ack")).status).toBe(200);
    const r = await act(T.ammar, id, "block", { kind: "internal", reason: "R3 waiting on Sama" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [b] = await rows<{ id: string; resolver_id: string }>("select id, resolver_id from blockers where task_id = ? and resolved_at is null", id);
    expect(b.resolver_id).toBe("u_sama");
    await sql("update blockers set opened_at = ? where id = ?", B.toISOString(), b.id);
    for (const m of [121, 241, 300]) await runScheduler(env, plus(B, m), { push: false });
    const esc = await rows<{ user_id: string }>("select user_id from notifications where task_id = ? and kind = 'blocker_escalation'", id);
    expect(esc.map((e) => e.user_id)).toEqual(["u_mohammed"]);
  });

  it("R3. an account manager waiting on her own client is still chased for the due date, and her supervisor hears when it passes", async () => {
    const T = await team();
    const B = baseSunday();
    const id = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama", title: "R3-AM-SELF", due_at: plus(B, 60 * 24 * 30).toISOString() });
    expect((await act(T.sama, id, "ack")).status).toBe(200);
    expect((await act(T.sama, id, "block", { kind: "client_wait", reason: "R3 clinic has not confirmed" })).status).toBe(200);
    await sql("update tasks set due_at = ? where id = ?", plus(B, 60).toISOString(), id);
    await runScheduler(env, plus(B, 61), { push: false });
    const got = await rows<{ user_id: string; kind: string }>("select user_id, kind from notifications where task_id = ? and kind in ('overdue', 'overdue_escalation') order by kind", id);
    expect(got).toEqual([
      { user_id: "u_sama", kind: "overdue" },
      { user_id: "u_ammar", kind: "overdue_escalation" },
    ]);
  });

  it("R3. reassignment hands a client wait that would land on a non-manager assignee to the account manager, and logs what it closed", async () => {
    const T = await team();
    const id = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_hussein", title: "R3-CW-MOVE" });
    expect((await act(T.hussein, id, "ack")).status).toBe(200);
    expect((await act(T.mohammed, id, "block", { kind: "client_wait", reason: "R3 client", resolver_id: "u_ammar" })).status).toBe(200);
    expect((await act(T.hussein, id, "clarify", { question: "R3 which entrance?" })).status).toBe(200);
    expect((await act(T.hussein, id, "propose_due", { proposed_due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), reason: "R3 later" })).status).toBe(200);
    const t = await task(T.mohammed, id);
    expect((await T.mohammed.patch(`/api/tasks/${id}`, { version: t.task.version, assignee_id: "u_ammar", reason: "R3 Ammar takes it" })).status).toBe(200);
    const [cw] = await rows<{ resolver_id: string }>("select resolver_id from blockers where task_id = ? and kind = 'client_wait' and resolved_at is null", id);
    expect(cw.resolver_id).toBe("u_sama");
    const types = (await rows<{ type: string }>("select type from events where task_id = ? order by id", id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["blocker_resolved", "due_proposal_rejected", "blocker_handed_over"]));
  });

  it("R3. IPv4-mapped IPv6 addresses count as their IPv4 address", async () => {
    const { limitAddress } = await import("../worker/http");
    expect(limitAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(limitAddress("0:0:0:0:0:ffff:c000:201")).toBe("192.0.2.1");
    expect(limitAddress("203.0.113.5")).toBe("203.0.113.5");
    expect(limitAddress("2001:0db8:aaaa:0001::5")).toBe("2001:db8:aaaa:1::/64");
    expect(limitAddress(":::::")).toBe(":::::");
  });
});
