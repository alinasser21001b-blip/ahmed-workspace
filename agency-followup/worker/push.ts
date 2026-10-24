// Web Push delivery (RFC 8291 encryption, RFC 8292 VAPID) on Web Crypto.
// The private VAPID key is a Worker secret; it never leaves the Worker.

import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { Ctx } from "./db";

export type PushData = { title: string; body: string; url: string; tag: string };

export function pushConfigured(env: Env): boolean {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// Known browser push services. Endpoints elsewhere are refused, so a
// subscription cannot point the Worker at an arbitrary URL.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/, /^web\.push\.apple\.com$/];

export function allowedEndpoint(endpoint: string, extraHosts: string[] = []): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return false;
    return PUSH_HOSTS.some((r) => r.test(u.hostname)) || extraHosts.includes(u.host);
  } catch {
    return false;
  }
}

export type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushResult = { devices: number; sent: number; failed: number; gone: number; errors: string[]; retryable: boolean };

// A subscription that keeps failing (including payloads that cannot be built) is dropped.
const MAX_FAILURES = 10;

/**
 * Send one message to the given devices. Returns the outcome and the
 * bookkeeping writes for the caller to batch; it does not touch D1 itself.
 */
export async function deliver(ctx: Ctx, subs: SubRow[], data: PushData, origin: string, urgency: "normal" | "high" = "normal"): Promise<{ result: PushResult; stmts: D1PreparedStatement[] }> {
  const out: PushResult = { devices: subs.length, sent: 0, failed: 0, gone: 0, errors: [], retryable: false };
  const stmts: D1PreparedStatement[] = [];
  if (!pushConfigured(ctx.env)) {
    out.errors.push("push_not_configured");
    return { result: out, stmts };
  }
  const vapid = { subject: origin, publicKey: ctx.env.VAPID_PUBLIC_KEY, privateKey: ctx.env.VAPID_PRIVATE_KEY };
  const nowIso = ctx.now.toISOString();
  const failure = (id: string, err: string) =>
    stmts.push(
      ctx.db
        .prepare("update push_subscriptions set failures = failures + 1, last_error = ?, revoked_at = case when failures + 1 >= ? then ? else revoked_at end where id = ?")
        .bind(err.slice(0, 200), MAX_FAILURES, nowIso, id),
    );
  for (const s of subs) {
    try {
      const payload = await buildPushPayload(
        { data, options: { ttl: 12 * 3600, urgency, topic: data.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "n" } },
        { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
        vapid,
      );
      const res = await fetch(s.endpoint, { method: "POST", headers: payload.headers, body: payload.body });
      if (res.status === 201 || res.status === 202 || res.status === 200) {
        out.sent++;
        stmts.push(ctx.db.prepare("update push_subscriptions set last_success_at = ?, failures = 0, last_error = null where id = ?").bind(nowIso, s.id));
      } else if (res.status === 404 || res.status === 410) {
        out.gone++;
        stmts.push(ctx.db.prepare("update push_subscriptions set revoked_at = ?, last_error = ? where id = ?").bind(nowIso, `expired ${res.status}`, s.id));
      } else {
        out.failed++;
        if (res.status === 429 || res.status >= 500) out.retryable = true;
        const detail = `${res.status} ${(await res.text().catch(() => "")).slice(0, 120)}`;
        out.errors.push(detail);
        failure(s.id, detail);
      }
    } catch (e) {
      out.failed++;
      out.retryable = true;
      const detail = String((e as Error).message ?? e).slice(0, 120);
      out.errors.push(detail);
      failure(s.id, detail);
    }
  }
  return { result: out, stmts };
}

/** Send one message to every active device of a member. */
export async function sendToUser(ctx: Ctx, userId: string, data: PushData, origin: string, urgency: "normal" | "high" = "normal"): Promise<PushResult> {
  const { results } = await ctx.db.prepare("select id, endpoint, p256dh, auth from push_subscriptions where user_id = ? and revoked_at is null").bind(userId).all<SubRow>();
  const { result, stmts } = await deliver(ctx, results, data, origin, urgency);
  if (stmts.length) await ctx.db.batch(stmts);
  return result;
}
