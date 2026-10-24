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

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

export type PushResult = { devices: number; sent: number; failed: number; gone: number; errors: string[]; retryable: boolean };

/** Send one message to every active device of a member. */
export async function sendToUser(ctx: Ctx, userId: string, data: PushData, origin: string, urgency: "normal" | "high" = "normal"): Promise<PushResult> {
  const out: PushResult = { devices: 0, sent: 0, failed: 0, gone: 0, errors: [], retryable: false };
  if (!pushConfigured(ctx.env)) {
    out.errors.push("push_not_configured");
    return out;
  }
  const { results } = await ctx.db.prepare("select id, endpoint, p256dh, auth from push_subscriptions where user_id = ? and revoked_at is null").bind(userId).all<SubRow>();
  out.devices = results.length;
  const vapid = { subject: origin, publicKey: ctx.env.VAPID_PUBLIC_KEY, privateKey: ctx.env.VAPID_PRIVATE_KEY };
  const nowIso = ctx.now.toISOString();
  for (const s of results) {
    try {
      const payload = await buildPushPayload(
        { data, options: { ttl: 12 * 3600, urgency, topic: data.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "n" } },
        { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
        vapid,
      );
      const res = await fetch(s.endpoint, { method: "POST", headers: payload.headers, body: payload.body });
      if (res.status === 201 || res.status === 202 || res.status === 200) {
        out.sent++;
        await ctx.db.prepare("update push_subscriptions set last_success_at = ?, failures = 0, last_error = null where id = ?").bind(nowIso, s.id).run();
      } else if (res.status === 404 || res.status === 410) {
        out.gone++;
        await ctx.db.prepare("update push_subscriptions set revoked_at = ?, last_error = ? where id = ?").bind(nowIso, `expired ${res.status}`, s.id).run();
      } else {
        out.failed++;
        if (res.status === 429 || res.status >= 500) out.retryable = true;
        const detail = (await res.text().catch(() => "")).slice(0, 120);
        out.errors.push(`${res.status} ${detail}`);
        await ctx.db.prepare("update push_subscriptions set failures = failures + 1, last_error = ? where id = ?").bind(`${res.status} ${detail}`.slice(0, 200), s.id).run();
      }
    } catch (e) {
      out.failed++;
      out.retryable = true;
      out.errors.push(String((e as Error).message ?? e).slice(0, 120));
    }
  }
  return out;
}
