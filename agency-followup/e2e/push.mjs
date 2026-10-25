// Real Web Push check in Google Chrome (not Chromium: Chromium builds have no
// push service). Run headed under Xvfb, e.g. in CI:
//   BASE_URL=https://... LINK="<setup link for hussein>" SECOND_LINK="<setup link for sama>" xvfb-run -a node e2e/push.mjs
// Prints PASS/FAIL only; passwords are random and never printed.

import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE_URL.replace(/\/$/, "");
const results = [];
// A setup token travels after '#'. Output goes to CI logs, so a URL in an
// error line (e.g. a failed goto) must never carry one.
const redact = (s) => String(s).replace(/#[A-Za-z0-9_-]{16,}/g, "#…");
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(redact(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`));
};

// Push is unavailable in Chrome incognito contexts (browser.newContext).
// An empty userDataDir creates an isolated temporary regular profile, removed
// when this context closes. Never use a real person\'s Chrome profile.
const context = await chromium.launchPersistentContext("", {
  channel: "chrome", headless: false, locale: "ar-IQ", timezoneId: "Asia/Baghdad",
});
await context.grantPermissions(["notifications"], { origin: BASE });
const page = await context.newPage();

async function setup(link) {
  const pw = `Push-${randomBytes(9).toString("base64url")}`;
  await page.goto(link);
  await page.locator("#p1").waitFor({ timeout: 20000 });
  await page.locator("#p1").fill(pw);
  await page.locator("#p2").fill(pw);
  await page.getByRole("button", { name: "حفظ والدخول" }).click();
  await page.waitForURL(/\/account/, { timeout: 20000 });
  return pw;
}
const notifications = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, url: n.data?.url })));

try {
  const husseinPw = await setup(process.env.LINK);
  await page.getByRole("button", { name: "فعّل إشعارات جهازي" }).click({ timeout: 20000 });
  await page.getByText("الإشعارات مفعّلة على هذا الجهاز").waitFor({ timeout: 30000 });
  check("Chrome subscribes and the server binds the device to the signed-in member", true);
  await page.getByRole("button", { name: "أرسل إشعار اختبار لي" }).click();
  await page.getByText(/أرسل الخادم الإشعار إلى 1/).waitFor({ timeout: 30000 });
  check("server accepted by the push service (201)", true);
  let shown = [];
  for (let i = 0; i < 30 && !shown.length; i++) {
    await page.waitForTimeout(1000);
    shown = await notifications();
  }
  check("notification arrives on the device and is shown by the service worker", shown.some((n) => n.body.includes("إشعار تجريبي")), JSON.stringify(shown[0] ?? {}));
  check("lock-screen text is generic (no client or task names)", shown.every((n) => !/عيادة|مستشفى|تجريبي:/.test(n.body)));

  // Sign out: the device must stop receiving this account's notifications.
  await page.getByRole("button", { name: "تسجيل الخروج من هذا الجهاز" }).click();
  await page.waitForURL(/\/login/, { timeout: 20000 });
  const afterLogout = await page.evaluate(async () => !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()));
  check("sign-out removes the device subscription", !afterLogout);

  // Next person on the same device.
  if (process.env.SECOND_LINK) {
    await setup(process.env.SECOND_LINK);
    await page.getByRole("button", { name: "فعّل إشعارات جهازي" }).click({ timeout: 20000 });
    await page.getByText("الإشعارات مفعّلة على هذا الجهاز").waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "تسجيل الخروج من هذا الجهاز" }).click();
    await page.waitForURL(/\/login/);
    await page.locator("#u").fill("hussein");
    await page.locator("#p").fill(husseinPw);
    await page.getByRole("button", { name: "دخول" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
    const status = await page.evaluate(async () => (await fetch("/api/push/status")).json());
    check("the previous account has no device bound after another member used it", status.devices.length === 0, `devices=${status.devices.length}`);
  }

  // A notification link cannot bypass permissions: hussein opening a task he cannot see.
  await page.goto(`${BASE}/tasks/t_demo_01`);
  await page.getByText("غير موجودة أو لم تعد ضمن صلاحياتك").waitFor({ timeout: 20000 });
  check("a task link outside the member's scope opens nothing", true);
} catch (e) {
  const state = await page.evaluate(() => ({ permission: Notification.permission, controlled: !!navigator.serviceWorker.controller })).catch(() => null);
  const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  check("push scenario ran to the end", false, `${String(e?.message ?? e).split("\n")[0]}; state=${JSON.stringify(state)}; alerts=${JSON.stringify(alerts)}`);
} finally {
  await context.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} push checks passed`);
process.exit(failed ? 1 : 0);
