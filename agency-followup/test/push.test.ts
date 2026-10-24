import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCtx } from "../worker/db";
import { b64url, fromB64url } from "../worker/lib/crypto";
import { PUSH_TEXT } from "../worker/notify";
import { sendToUser } from "../worker/push";
import { drainOutbox } from "../worker/scheduler";
import { act, baseSunday, Browser, createTask, plus, rows, signIn, sql, task, team } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
const B = baseSunday(2);
let vapid: { publicKey: string; privateKey: string; verifyKey: CryptoKey };
let envK: Env;
const realFetch = globalThis.fetch;

type Device = { endpoint: string; p256dh: string; auth: string; priv: CryptoKey; pubRaw: Uint8Array; authRaw: Uint8Array };
type Captured = { url: string; headers: Record<string, string>; body: Uint8Array };
let captured: Captured[] = [];
let respond: (url: string) => number = () => 201;

async function newDevice(): Promise<Device> {
  const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pubRaw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const authRaw = crypto.getRandomValues(new Uint8Array(16));
  return { endpoint: `https://fcm.googleapis.com/fcm/send/dev-${crypto.randomUUID()}`, p256dh: b64url(pubRaw), auth: b64url(authRaw), priv: kp.privateKey, pubRaw, authRaw };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const te = new TextEncoder();

/** RFC 8291 / RFC 8188 aes128gcm decryption, as the browser does it. */
async function decrypt(d: Device, body: Uint8Array): Promise<any> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, d.priv, 256));
  const ikm = await hkdf(d.authRaw, ecdh, cat(te.encode("WebPush: info\0"), d.pubRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, ciphertext));
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  expect(plain[end]).toBe(2); // last-record delimiter
  return JSON.parse(new TextDecoder().decode(plain.slice(0, end)));
}

async function verifyVapid(authorization: string, endpoint: string) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(authorization)!;
  expect(m).toBeTruthy();
  expect(m[2]).toBe(vapid.publicKey);
  const [h, p, s] = m[1].split(".");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapid.verifyKey, fromB64url(s) as BufferSource, te.encode(`${h}.${p}`));
  expect(ok).toBe(true);
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  expect(claims.aud).toBe(new URL(endpoint).origin);
  expect(claims.sub).toBe("https://agency.test");
  expect(claims.exp * 1000).toBeGreaterThan(Date.now());
}

async function subscribe(as: Browser, d: Device) {
  return as.post("/api/push/subscribe", { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } });
}

beforeAll(async () => {
  T = await team();
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
  const jwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
  vapid = { publicKey: b64url(raw), privateKey: jwk.d!, verifyKey: kp.publicKey };
  envK = { ...env, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://fcm.googleapis.com/")) return realFetch(input as RequestInfo, init);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    captured.push({ url, headers, body: new Uint8Array(init?.body as Uint8Array) });
    return new Response(null, { status: respond(url) });
  });
});

afterEach(() => {
  captured = [];
  respond = () => 201;
});

describe("§14.18 device subscriptions follow the signed-in account", () => {
  it("§14.18 a subscription binds to the current member and session; unknown push hosts are refused", async () => {
    const d = await newDevice();
    expect((await subscribe(T.sama, d)).status).toBe(200);
    const row = (await rows("select * from push_subscriptions where endpoint = ?", d.endpoint))[0];
    expect(row.user_id).toBe("u_sama");
    expect((await rows(`select id from "session" where id = ? and "userId" = 'u_sama'`, row.session_id)).length).toBe(1);
    const status = await T.sama.get("/api/push/status");
    expect(status.body.devices.find((x: any) => x.id === row.id).this_session).toBe(1);
    for (const endpoint of ["https://evil.example/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.example/x", "not a url"]) {
      expect((await T.sama.post("/api/push/subscribe", { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } })).status, endpoint).toBe(400);
    }
  });

  it("§14.18 signing out stops that device receiving the account's notifications", async () => {
    const s = await signIn("sama");
    const d = await newDevice();
    await subscribe(s, d);
    await s.post("/api/auth/sign-out");
    expect((await rows("select revoked_at from push_subscriptions where endpoint = ?", d.endpoint))[0].revoked_at).toBeTruthy();
    const r = await sendToUser(await loadCtx(envK), "u_sama", { title: "t", body: "b", url: "/", tag: "x" }, "https://agency.test");
    expect(captured.find((c) => c.url === d.endpoint)).toBeUndefined();
    expect(r.devices).toBe((await rows("select * from push_subscriptions where user_id = 'u_sama' and revoked_at is null")).length);
  });

  it("§14.18 when another member signs in on the same device the subscription moves to him", async () => {
    const d = await newDevice();
    await subscribe(T.sama, d);
    await subscribe(T.hussein, d);
    const row = (await rows("select user_id, revoked_at from push_subscriptions where endpoint = ?", d.endpoint))[0];
    expect(row).toEqual({ user_id: "u_hussein", revoked_at: null });
    const ctx = await loadCtx(envK);
    await sendToUser(ctx, "u_sama", { title: "t", body: "b", url: "/", tag: "x" }, "https://agency.test");
    expect(captured.filter((c) => c.url === d.endpoint)).toHaveLength(0);
    await sendToUser(ctx, "u_hussein", { title: "t", body: "b", url: "/", tag: "x" }, "https://agency.test");
    expect(captured.filter((c) => c.url === d.endpoint)).toHaveLength(1);
    expect((await T.hussein.post("/api/push/unsubscribe", { endpoint: d.endpoint })).status).toBe(200);
    expect((await rows("select revoked_at from push_subscriptions where endpoint = ?", d.endpoint))[0].revoked_at).toBeTruthy();
  });
});

describe("§14.18 delivery", () => {
  it("§14.18 the outbox sends an encrypted, VAPID-signed push with a terse lock-screen text and the task link", async () => {
    const d = await newDevice();
    await subscribe(T.hussein, d);
    const id = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein", title: "عنوان-حساس-لا-يظهر" });
    const stats = await drainOutbox(await loadCtx(envK, plus(B, 1)));
    expect(stats.sent).toBeGreaterThanOrEqual(1);
    const req = captured.find((c) => c.url === d.endpoint)!;
    expect(req).toBeTruthy();
    expect(req.headers["content-encoding"]).toBe("aes128gcm");
    expect(req.headers.urgency).toBe("high");
    expect(Number(req.headers.ttl)).toBeGreaterThan(0);
    await verifyVapid(req.headers.authorization, d.endpoint);
    const payload = await decrypt(d, req.body);
    expect(payload).toEqual({ title: "متابعة الوكالة", body: PUSH_TEXT.assigned, url: `/tasks/${id}`, tag: id });
    expect(JSON.stringify(payload)).not.toContain("عنوان-حساس");
    expect(JSON.stringify(payload)).not.toContain("عيادة");
    const o = await rows("select o.status from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind = 'assigned'", id);
    expect(o[0].status).toBe("sent");
    expect((await rows("select last_success_at from push_subscriptions where endpoint = ?", d.endpoint))[0].last_success_at).toBeTruthy();
  });

  it("§14.18 an expired subscription (410) is dropped; a server error is retried, then marked failed", async () => {
    const gone = await newDevice();
    await subscribe(T.ammar, gone);
    respond = () => 410;
    const r = await sendToUser(await loadCtx(envK), "u_ammar", { title: "t", body: "b", url: "/", tag: "x" }, "https://agency.test");
    expect(r.gone).toBe(1);
    expect((await rows("select revoked_at from push_subscriptions where endpoint = ?", gone.endpoint))[0].revoked_at).toBeTruthy();

    const flaky = await newDevice();
    await subscribe(T.ammar, flaky);
    const id = await createTask(T.mohammed, { client_id: "c_ward", assignee_id: "u_ammar" });
    respond = (u) => (u === flaky.endpoint ? 503 : 201);
    const q = "select o.status, o.attempts from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind = 'assigned'";
    let t = plus(B, 2);
    await drainOutbox(await loadCtx(envK, t));
    expect((await rows(q, id))[0]).toEqual({ status: "pending", attempts: 1 });
    for (let i = 0; i < 4; i++) {
      t = plus(t, 30);
      await drainOutbox(await loadCtx(envK, t));
    }
    expect((await rows(q, id))[0]).toEqual({ status: "failed", attempts: 4 });
    expect(captured.filter((c) => c.url === flaky.endpoint)).toHaveLength(4);
  });

  it("§14.18 a queued push is re-checked before it leaves: acknowledged or no longer visible means it is not sent", async () => {
    const d = await newDevice();
    await subscribe(T.hussein, d);
    const acked = await createTask(T.sama, { client_id: "c_obesity", assignee_id: "u_hussein" });
    await sql("update tasks set status = 'acknowledged' where id = ?", acked); // bypass the action's own cancellation
    const moved = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein" });
    await sql("update tasks set assignee_id = 'u_ammar' where id = ?", moved);
    await drainOutbox(await loadCtx(envK, plus(B, 3)));
    const q = "select o.status, o.last_error from outbox o join notifications n on n.id = o.notification_id where n.task_id = ? and n.kind = 'assigned'";
    expect((await rows(q, acked))[0]).toEqual({ status: "cancelled", last_error: "already_acknowledged" });
    expect((await rows(q, moved))[0]).toEqual({ status: "cancelled", last_error: "no_longer_visible" });
    expect(captured.filter((c) => c.url === d.endpoint)).toHaveLength(0);
  });

  it("§14.18 a member with no device gets the in-app notification and the delivery is recorded as skipped", async () => {
    await sql("update push_subscriptions set revoked_at = ? where user_id = 'u_sama'", new Date().toISOString());
    const id = await createTask(T.mohammed, { client_id: "c_obesity", assignee_id: "u_sama" });
    await drainOutbox(await loadCtx(envK, plus(B, 4)));
    const o = await rows("select o.status, o.last_error from outbox o join notifications n on n.id = o.notification_id where n.task_id = ?", id);
    expect(o[0]).toEqual({ status: "skipped", last_error: "no_device" });
    expect(await rows("select * from notifications where task_id = ? and user_id = 'u_sama' and kind = 'assigned'", id)).toHaveLength(1);
  });

  it("§14.18 «أرسل إشعار اختبار لي» reports what happened and leaves an in-app notification", async () => {
    const d = await newDevice();
    const s = await signIn("mohammed");
    await subscribe(s, d);
    const r = await s.post("/api/push/test");
    expect(r.status).toBe(200);
    expect(typeof r.body.configured).toBe("boolean");
    expect(r.body.devices).toBe((await rows("select * from push_subscriptions where user_id = 'u_mohammed' and revoked_at is null")).length);
    if (r.body.configured) expect(r.body.sent).toBeGreaterThanOrEqual(1);
    else expect(r.body.sent).toBe(0);
    expect(await rows("select * from notifications where user_id = 'u_mohammed' and kind = 'test'")).toHaveLength(1);
    expect((await T.mohammed.get("/api/notifications")).body.notifications.some((n: any) => n.kind === "test")).toBe(true);
  });

  it("§14.19 opening a pushed link re-checks permission: the old assignee cannot open a reassigned task", async () => {
    const id = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein" });
    const v = (await task(T.ammar, id)).task.version;
    await T.ammar.patch(`/api/tasks/${id}`, { version: v, assignee_id: "u_ammar", reviewer_id: "u_mohammed", reason: "سأنفذها بنفسي" });
    expect((await T.hussein.get(`/api/tasks/${id}`)).status).toBe(404);
    expect((await act(T.ammar, id, "ack")).status).toBe(200);
  });
});
