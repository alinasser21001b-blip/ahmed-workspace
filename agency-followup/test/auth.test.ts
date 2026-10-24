import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, randomToken, sha256 } from "../worker/lib/crypto";
import { Browser, ensurePasswords, IDS, PASSWORDS, rows, signIn, sql, type Who } from "./helpers";

const GENERIC = "اسم المستخدم أو كلمة المرور غير صحيحة";

async function setPassword(who: Who, password: string) {
  const now = new Date().toISOString();
  await sql(`delete from "account" where "userId" = ?`, IDS[who]);
  await sql(`insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") values (?, ?, 'credential', ?, ?, ?, ?)`, `a_${who}_${Date.now()}`, IDS[who], IDS[who], await hashPassword(password, 100_000), now, now);
}

async function insertToken(who: Who, expiresInHours = 72) {
  const token = randomToken(32);
  const now = new Date();
  await sql("insert into setup_tokens (id, user_id, token_hash, expires_at, created_at) values (?, ?, ?, ?, ?)", `st_${Math.random().toString(36).slice(2)}`, IDS[who], await sha256(token), new Date(now.getTime() + expiresInHours * 3_600_000).toISOString(), now.toISOString());
  return token;
}

beforeAll(async () => {
  await ensurePasswords();
});

describe("§14.17 sign-in, sign-out and sessions", () => {
  it("§14.17 wrong password and unknown user get the same generic answer and no cookie", async () => {
    const b = new Browser();
    const wrong = await b.post("/api/auth/sign-in/username", { username: "sama", password: "not-the-password" });
    const unknown = await b.post("/api/auth/sign-in/username", { username: "nobody", password: "not-the-password" });
    for (const r of [wrong, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: "invalid_credentials", message: GENERIC });
    }
    expect(b.cookies.size).toBe(0);
  });

  it("§14.17 the session cookie is HttpOnly, Secure and SameSite=Lax", async () => {
    const b = new Browser();
    const res = await b.raw("POST", "/api/auth/sign-in/username", { username: "ammar", password: PASSWORDS.ammar });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session_token"))!;
    expect(cookie).toMatch(/^__Secure-/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("§14.17 repeated failures from one address are rate limited, other addresses are not", async () => {
    const b = new Browser("203.0.113.7");
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await b.post("/api/auth/sign-in/username", { username: "sama", password: `wrong-${i}-password` })).status);
    const first = statuses.indexOf(429);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(8);
    expect(statuses.slice(0, first).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(first).every((s) => s === 429)).toBe(true);
    expect((await b.post("/api/auth/sign-in/username", { username: "sama", password: PASSWORDS.sama })).status).toBe(429);
    expect((await signIn("sama")).cookies.size).toBeGreaterThan(0);
  });

  it("§14.17 sign-out ends the session; a copied cookie no longer works", async () => {
    const b = await signIn("hussein");
    const copy = new Browser();
    copy.cookies = new Map(b.cookies);
    expect((await copy.get("/api/account/me")).status).toBe(200);
    expect((await b.post("/api/auth/sign-out")).status).toBe(200);
    expect((await b.get("/api/account/me")).status).toBe(401);
    expect((await copy.get("/api/account/me")).status).toBe(401);
  });

  it("§14.17 changing the password signs out every other device and the old password stops working", async () => {
    const a = await signIn("ammar");
    const other = await signIn("ammar");
    expect((await a.post("/api/account/password", { current: "wrong-current-pw", next: "Brand-New-Pass-88" })).status).toBe(400);
    expect((await a.post("/api/account/password", { current: PASSWORDS.ammar, next: "short" })).status).toBe(400);
    expect((await a.post("/api/account/password", { current: PASSWORDS.ammar, next: "aaaaaaaaaaaa" })).status).toBe(400);
    expect((await a.post("/api/account/password", { current: PASSWORDS.ammar, next: "Brand-New-Pass-88" })).status).toBe(200);
    expect((await other.get("/api/account/me")).status).toBe(401);
    expect((await a.get("/api/account/me")).status).toBe(200);
    expect((await new Browser().post("/api/auth/sign-in/username", { username: "ammar", password: PASSWORDS.ammar })).status).toBe(401);
    expect((await new Browser().post("/api/auth/sign-in/username", { username: "ammar", password: "Brand-New-Pass-88" })).status).toBe(200);
    expect(await rows("select * from events where actor_id = 'u_ammar' and type = 'password_changed'")).toHaveLength(1);
    await setPassword("ammar", PASSWORDS.ammar);
  });

  it("§14.17 a temporary password must be changed first, enforced on the server", async () => {
    const s = await signIn("sama");
    await sql("update members set must_change_password = 1 where user_id = 'u_sama'");
    for (const p of ["/api/tasks", "/api/today", "/api/notifications", "/api/bookings"]) {
      const r = await s.get(p);
      expect(r.status, p).toBe(403);
      expect(r.body.error).toBe("password_change_required");
    }
    expect((await s.post("/api/tasks", { client_id: "c_obesity", assignee_id: "u_hussein", title: "قبل التغيير" }, { "idempotency-key": "gate-1" })).status).toBe(403);
    const me = await s.get("/api/account/me");
    expect(me.status).toBe(200);
    expect(me.body.user.must_change_password).toBe(true);
    expect((await s.post("/api/account/password", { current: PASSWORDS.sama, next: "Chosen-Pass-For-S-61" })).status).toBe(200);
    expect((await s.get("/api/tasks")).status).toBe(200);
    expect((await rows("select must_change_password from members where user_id = 'u_sama'"))[0].must_change_password).toBe(0);
    await setPassword("sama", PASSWORDS.sama);
  });

  it("§14.17 an inactive member cannot sign in and loses existing sessions", async () => {
    const s = await signIn("sama");
    await sql("update members set active = 0 where user_id = 'u_sama'");
    expect((await s.get("/api/account/me")).status).toBe(401);
    const r = await new Browser().post("/api/auth/sign-in/username", { username: "sama", password: PASSWORDS.sama });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC);
    await sql("update members set active = 1 where user_id = 'u_sama'");
  });
});

describe("§14.17 one-time setup links", () => {
  it("§14.17 the link sets a password once, signs in, and revokes earlier sessions", async () => {
    const before = await signIn("hussein");
    const token = await insertToken("hussein");
    const anon = new Browser();
    expect((await anon.post("/api/setup/check", { token: "x".repeat(43) })).body).toEqual({ valid: false });
    const check = await anon.post("/api/setup/check", { token });
    expect(check.body).toMatchObject({ valid: true, username: "hussein" });
    expect((await anon.post("/api/setup/complete", { token, password: "short" })).status).toBe(400);
    expect((await anon.post("/api/setup/complete", { token, password: "hussein-is-me-123" })).status).toBe(400);
    const done = await anon.post("/api/setup/complete", { token, password: "Camera-Ready-2026" });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ ok: true, username: "hussein", signed_in: true });
    expect((await anon.get("/api/account/me")).body.user.username).toBe("hussein");
    expect((await before.get("/api/account/me")).status).toBe(401);
    expect((await new Browser().post("/api/setup/complete", { token, password: "Another-Pass-2026" })).status).toBe(400);
    expect((await new Browser().post("/api/setup/check", { token })).body.valid).toBe(false);
    expect((await new Browser().post("/api/auth/sign-in/username", { username: "hussein", password: PASSWORDS.hussein })).status).toBe(401);
    expect((await new Browser().post("/api/auth/sign-in/username", { username: "hussein", password: "Camera-Ready-2026" })).status).toBe(200);
    expect(await rows("select token_hash from setup_tokens where token_hash = ?", token)).toHaveLength(0); // only the hash is stored
    await setPassword("hussein", PASSWORDS.hussein);
  });

  it("§14.17 an expired link does nothing", async () => {
    const token = await insertToken("hussein", -1);
    expect((await new Browser().post("/api/setup/check", { token })).body.valid).toBe(false);
    expect((await new Browser().post("/api/setup/complete", { token, password: "Camera-Ready-2026" })).status).toBe(400);
  });

  it("§14.17 Mohammed's reset gives a fresh link, cuts the old password and sessions, and is logged without the token", async () => {
    const mohammed = await signIn("mohammed");
    const hussein = await signIn("hussein");
    expect((await mohammed.post("/api/admin/members/u_mohammed/reset")).status).toBe(400);
    const r = await mohammed.post("/api/admin/members/u_hussein/reset");
    expect(r.status).toBe(200);
    expect(r.body.link).toMatch(/^https:\/\/agency\.test\/setup#[A-Za-z0-9_-]{40,}$/);
    const token = r.body.link.split("#")[1];
    expect((await hussein.get("/api/account/me")).status).toBe(401);
    expect((await new Browser().post("/api/auth/sign-in/username", { username: "hussein", password: PASSWORDS.hussein })).status).toBe(401);
    const ev = await rows<{ data: string }>("select data from events where type = 'member_reset' order by id desc limit 1");
    expect(ev[0].data).not.toContain(token);
    const second = await mohammed.post("/api/admin/members/u_hussein/reset");
    expect((await new Browser().post("/api/setup/check", { token })).body.valid).toBe(false); // the earlier link is revoked
    const t2 = second.body.link.split("#")[1];
    expect((await new Browser().post("/api/setup/complete", { token: t2, password: "Fresh-Start-2026" })).body.signed_in).toBe(true);
    const ov = await mohammed.get("/api/admin/overview");
    expect(ov.body.members.find((m: any) => m.id === "u_hussein")).toMatchObject({ has_password: true, setup_link_pending_until: null });
    expect(JSON.stringify(ov.body)).not.toMatch(/pbkdf2|token_hash/);
    await setPassword("hussein", PASSWORDS.hussein);
  });
});

describe("§14.20 the API answers in JSON and only to same-origin JSON writes", () => {
  it("§14.20 unknown routes are JSON: 401 without a session, 404 with one", async () => {
    const anon = new Browser();
    const r1 = await anon.raw("GET", "/api/does-not-exist");
    expect(r1.status).toBe(401);
    expect(r1.headers.get("content-type")).toContain("application/json");
    expect(r1.headers.get("cache-control")).toBe("no-store");
    const s = await signIn("sama");
    const r2 = await s.raw("GET", "/api/does-not-exist/deeper");
    expect(r2.status).toBe(404);
    expect(r2.headers.get("content-type")).toContain("application/json");
    expect((await s.json("DELETE", "/api/tasks")).status).toBe(404);
    expect((await anon.get("/api/health")).body).toEqual({ ok: true });
  });

  it("§14.20 only sign-in and sign-out of the auth library are exposed", async () => {
    const anon = new Browser();
    for (const [m, p] of [
      ["GET", "/api/auth/get-session"],
      ["POST", "/api/auth/sign-up/email"],
      ["POST", "/api/auth/sign-in/email"],
      ["POST", "/api/auth/request-password-reset"],
      ["POST", "/api/auth/change-password"],
      ["GET", "/api/auth/list-sessions"],
      ["POST", "/api/auth/update-user"],
    ] as const) {
      const r = await anon.json(m, p, m === "GET" ? undefined : { email: "x@y.invalid", password: "Aaaaaaaaaa1!", name: "x" });
      expect(r.status, p).toBe(404);
      expect(r.body.error).toBe("not_found");
    }
    expect(await rows(`select * from "user" where email = 'x@y.invalid'`)).toHaveLength(0);
  });

  it("§14.20 writes need the app's own Origin and a JSON body", async () => {
    const s = await signIn("sama");
    const foreign = await s.post("/api/tasks", { client_id: "c_obesity", assignee_id: "u_hussein", title: "CSRF" }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe("bad_origin");
    const noOrigin = await s.raw("POST", "/api/tasks", { title: "x" }, { origin: "" });
    expect(noOrigin.status).toBe(403);
    const form = await s.post("/api/tasks", { title: "x" }, { "content-type": "application/x-www-form-urlencoded" });
    expect(form.status).toBe(400);
    expect(form.body.error).toBe("bad_content_type");
    const login = await new Browser().post("/api/auth/sign-in/username", { username: "sama", password: PASSWORDS.sama }, { origin: "https://evil.example" });
    expect(login.status).toBe(403);
    expect(await rows("select * from tasks where title = 'CSRF'")).toHaveLength(0);
  });
});
