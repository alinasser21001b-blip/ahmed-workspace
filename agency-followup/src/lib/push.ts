// Device notifications. The state names match what the member sees on the
// account page: supported, needs permission, denied, needs install, unsupported.

import { api } from "./api";

export type PushState = "unsupported" | "needs_install" | "needs_permission" | "denied" | "enabled" | "server_off";

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
}

export async function currentState(serverConfigured: boolean): Promise<{ state: PushState; subscribed: boolean }> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return { state: isIOS() && !isStandalone() ? "needs_install" : "unsupported", subscribed: false };
  if (isIOS() && !isStandalone()) return { state: "needs_install", subscribed: false };
  if (!serverConfigured) return { state: "server_off", subscribed: false };
  if (Notification.permission === "denied") return { state: "denied", subscribed: false };
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (Notification.permission === "granted" && sub) {
    // The browser may still hold a subscription the server has dropped
    // (expired, replaced, or the session ended): then it needs re-linking.
    const r = await api<{ active: boolean }>("/api/push/check", { body: { endpoint: sub.endpoint } }).catch(() => ({ active: true }));
    if (r.active) return { state: "enabled", subscribed: true };
  }
  return { state: "needs_permission", subscribed: false };
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Ask permission (must run from a tap), subscribe, and bind the subscription to this signed-in member on the server. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "dismissed");
  const reg = await registration();
  if (!reg) throw new Error("no_sw");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription the server has dropped (the push service refused it) is
  // replaced with a fresh one rather than sent back.
  if (sub) {
    const r = await api<{ active: boolean }>("/api/push/check", { body: { endpoint: sub.endpoint } }).catch(() => ({ active: true }));
    if (!r.active) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  // A subscription made with another key cannot be reused.
  if (sub) {
    const existing = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    const wanted = keyBytes(publicKey);
    if (!existing || existing.length !== wanted.length || existing.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  await api("/api/push/subscribe", { body: { endpoint: json.endpoint, keys: json.keys } });
}

/** On sign-out: stop this device receiving the account's notifications. */
export async function disablePushOnThisDevice(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* the server also unbinds the session's subscription on sign-out */
  }
}
