// End-to-end trial walk-through in a real browser (Chromium via Playwright).
//   BASE_URL=http://localhost:5173 LINKS=links.txt OUT=shots node e2e/run.mjs
// LINKS is the file written by scripts/setup-links.mjs. The passwords this
// script chooses are random, kept in memory only, and never printed.
// Every check prints PASS/FAIL; the exit code is non-zero if any failed.

import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";

// Resolved through NODE_PATH as well, so a globally installed Playwright works.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = (process.env.BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
const OUT = process.env.OUT ?? "e2e-shots";
mkdirSync(OUT, { recursive: true });
const links = Object.fromEntries(
  readFileSync(process.env.LINKS, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t")),
);

const results = [];
// A setup token travels after '#'. Output goes to CI logs, so a URL in an
// error line (e.g. a failed goto) must never carry one.
const redact = (s) => String(s).replace(/#[A-Za-z0-9_-]{16,}/g, "#…");
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(redact(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`));
};
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
const phone = { ...devices["iPhone 13"], locale: "ar-IQ", timezoneId: "Asia/Baghdad" };
const desktop = { viewport: { width: 1280, height: 860 }, locale: "ar-IQ", timezoneId: "Asia/Baghdad" };
const pw = {};
const ctx = {};

async function setup(who, profile) {
  const c = await browser.newContext(profile);
  const p = await c.newPage();
  await p.goto(links[who]);
  await p.getByText("اسم المستخدم الخاص بك").waitFor({ timeout: 15000 });
  check(`${who}: setup link opens and removes the token from the address bar`, !p.url().includes("#"), p.url());
  pw[who] = `Trial-${randomBytes(9).toString("base64url")}`;
  await p.locator("#p1").fill(pw[who]);
  await p.locator("#p2").fill(pw[who]);
  await p.getByRole("button", { name: "حفظ والدخول" }).click();
  await p.waitForURL(/\/account/, { timeout: 15000 });
  check(`${who}: sets a password and is signed in`, /\/account/.test(p.url()));
  ctx[who] = { c, p };
  return p;
}

try {
  const m = await setup("mohammed", desktop);
  const a = await setup("ammar", desktop);
  const s = await setup("sama", phone);
  const h = await setup("hussein", phone);
  // Environments without the cron (staging) get the demo set from Mohammed's admin action.
  const seeded = await m.request.post(`${BASE}/api/admin/demo/seed`, { headers: { origin: BASE, "content-type": "application/json" }, data: {} });
  check("mohammed: demo examples available", seeded.ok(), `status ${seeded.status()}`);

  // Used link cannot be reused.
  {
    const c = await browser.newContext(phone);
    const p = await c.newPage();
    await p.goto(links.sama);
    await p.getByText("الرابط غير صالح").waitFor({ timeout: 15000 });
    check("setup link is single-use", true);
    await c.close();
  }

  // Today screens per role.
  for (const [who, p] of [["mohammed", m], ["ammar", a], ["sama", s], ["hussein", h]]) {
    await p.goto(`${BASE}/`);
    await p.locator("h1").first().waitFor();
    await p.waitForTimeout(800);
    await shot(p, `today-${who}`);
  }
  check("mohammed: Today answers the five questions", (await m.getByRole("heading", { name: /لم تُستلم بعد/ }).count()) > 0 && (await m.getByRole("heading", { name: /متأخرة/ }).count()) > 0 && (await m.getByRole("heading", { name: /بانتظار قراري/ }).count()) > 0 && (await m.getByRole("heading", { name: /متوقفة بعائق/ }).count()) > 0 && (await m.getByRole("heading", { name: /تعارضات وقت حسين/ }).count()) > 0);
  const hussHeads = await h.locator("h2").allInnerTexts();
  const order = ["بحاجة لاستلامي", "عمل اليوم", "حجوزاتي", "توضيحات أنتظرها"].map((x) => hussHeads.findIndex((t) => t.includes(x)));
  check("hussein: Today sections in the required order", order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), hussHeads.join(" | "));
  const samaText = await s.locator("main").innerText();
  check("sama: Today shows no Ward task", !samaText.includes("مستشفى ورد"));

  // Sama creates a shoot request for Hussein.
  await s.goto(`${BASE}/tasks/new`);
  await s.getByRole("button", { name: "طلب تصوير" }).click();
  await s.locator("#client").selectOption("c_obesity");
  await s.getByRole("button", { name: "طلب تصوير" }).click();
  await s.getByRole("button", { name: "طلب تصوير" }).click();
  await s.locator("#title").fill("تصوير لقطات غرفة الانتظار");
  await s.locator("#assignee").selectOption("u_hussein");
  const due = new Date(Date.now() + 26 * 3600_000);
  const z = (n) => String(n).padStart(2, "0");
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(due);
  await s.locator("#due").fill(`${local}T${z(12)}:00`);
  await shot(s, "new-task-sama");
  await s.getByRole("button", { name: "إنشاء وإرسال" }).click();
  await s.waitForURL(/\/tasks\/t_/, { timeout: 15000 });
  const taskUrl = s.url().split("?")[0];
  check("sama: creates a shoot request for hussein", /\/tasks\/t_/.test(taskUrl));
  await s.getByText("جديدة").first().waitFor();
  await shot(s, "task-new-sama");

  // Long Arabic text (spec §14): a 140-character title with one long unbroken
  // word, and long description and acceptance, must not make Today or the
  // task page scroll sideways, on the phone (Sama) or the desktop (Mohammed).
  {
    const word = "تصويرومونتاجونشرلحملةالعيادة".repeat(2); // 56 letters, nowhere to break
    const head = "عنوان طويل للتجربة";
    const longTitle = `${head} ${word} ${"يبقى داخل البطاقة على الهاتف والحاسوب ".repeat(3)}`.slice(0, 140).trim(); // exactly 140
    const r = await s.request.post(`${BASE}/api/tasks`, {
      headers: { origin: BASE, "content-type": "application/json", "idempotency-key": `e2e-long-${randomBytes(6).toString("hex")}` },
      data: {
        client_id: "c_obesity",
        assignee_id: "u_hussein",
        title: longTitle,
        description: `${"وصف طويل يشرح المطلوب بالتفصيل مع ملاحظات العميل والمواعيد. ".repeat(20)}${word}${word}`,
        acceptance: `${word}${word} ${"يُقبل العمل بعد مراجعة العميل. ".repeat(10)}`,
        priority: "normal",
        due_at: due.toISOString(),
      },
    });
    const longId = r.status() === 201 ? (await r.json()).id : null;
    for (const [label, p] of [["phone", s], ["desktop", m]]) {
      let ok = !!longId;
      const seen = [longId ? `title ${longTitle.length} chars` : `create status ${r.status()}`];
      if (longId) {
        for (const [page, path] of [["today", "/"], ["task", `/tasks/${longId}`]]) {
          try {
            await p.goto(`${BASE}${path}`);
            await p.getByText(head).first().waitFor({ timeout: 15000 });
            // clientWidth, not innerWidth: under mobile emulation the layout
            // viewport grows with overflowing content, so innerWidth would hide it.
            const [sw, iw] = await p.evaluate(async () => {
              await document.fonts.ready;
              return [document.documentElement.scrollWidth, document.documentElement.clientWidth];
            });
            seen.push(`${page} ${sw}/${iw}`);
            ok &&= sw <= iw + 1;
            await shot(p, `long-text-${page}-${label}`);
          } catch (e) {
            seen.push(`${page}: ${String(e?.message ?? e).split("\n")[0]}`);
            ok = false;
          }
        }
      }
      check(`long Arabic text: no sideways scroll on the ${label} (Today and task page)`, ok, seen.join(", "));
    }
  }

  // Hussein receives, acknowledges, starts, submits.
  // During working hours the notification is delivered at once; outside them
  // it is held until the next working start, while the task already shows on Today.
  const hours = await (await h.request.get(`${BASE}/api/account/me`)).json();
  const nowLocal = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: hours.work_hours.tz, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(nowLocal.weekday);
  const hm = `${nowLocal.hour}:${nowLocal.minute}`;
  const inHours = hours.work_hours.days.includes(dayIdx) && hm >= hours.work_hours.start && hm < hours.work_hours.end;
  await h.goto(`${BASE}/notifications`);
  await h.waitForTimeout(1200);
  const hasNote = (await h.getByText("تصوير لقطات غرفة الانتظار").count()) > 0;
  check(inHours ? "hussein: in-app notification for the new task (working hours)" : "hussein: new-task notification held until the next working start (outside hours)", inHours ? hasNote : !hasNote);
  await shot(h, "notifications-hussein");
  await h.goto(`${BASE}/`);
  await h.getByText("تصوير لقطات غرفة الانتظار").first().waitFor({ timeout: 15000 });
  check("hussein: the new task is on Today under «بحاجة لاستلامي»", true);
  await h.getByText("تصوير لقطات غرفة الانتظار").first().click();
  await h.waitForURL(/\/tasks\/t_/);
  await h.getByRole("button", { name: "استلمت" }).click();
  await h.getByText("مستلمة").first().waitFor({ timeout: 10000 });
  check("hussein: «استلمت» records acknowledgement", true);
  await h.getByRole("button", { name: "بدأت" }).click();
  await h.getByText("قيد التنفيذ").first().waitFor({ timeout: 10000 });
  await h.getByRole("button", { name: "سلّمت للمراجعة" }).click();
  await h.locator("#se").fill("تجربة: 12 صورة في مجلد العيادة");
  await shot(h, "submit-sheet-hussein");
  await h.getByRole("button", { name: "تسليم للمراجعة" }).click();
  await h.getByText("بانتظار المراجعة").first().waitFor({ timeout: 10000 });
  check("hussein: submits with evidence → بانتظار المراجعة", true);
  check("hussein: has no approve button on his own work", (await h.getByRole("button", { name: "اعتماد وإكمال" }).count()) === 0);
  await shot(h, "task-in-review-hussein");

  // Sama approves.
  await s.goto(taskUrl);
  await s.getByRole("button", { name: "اعتماد وإكمال" }).first().click();
  await s.locator(".sheet").getByRole("button", { name: "اعتماد وإكمال" }).click();
  await s.getByText("مكتملة").first().waitFor({ timeout: 10000 });
  check("sama: approves → مكتملة", true);
  await shot(s, "task-done-sama");

  // Sama cannot open a Ward task by URL.
  await s.goto(`${BASE}/tasks/t_demo_01`);
  await s.getByText("غير موجودة أو لم تعد ضمن صلاحياتك").waitFor({ timeout: 10000 });
  check("sama: Ward task URL shows not-available", !(await s.locator("main").innerText()).includes("خطة محتوى أسبوع"));

  // Calendar: Sama sees Ward bookings as busy only.
  await s.goto(`${BASE}/calendar`);
  await s.locator("h1").waitFor();
  await s.waitForTimeout(800);
  const cal = await s.locator("main").innerText();
  check("sama: calendar shows other client's slot as «مشغول» only", cal.includes("مشغول") && !cal.includes("جولة مدخل مستشفى ورد"));
  await shot(s, "calendar-sama");
  await h.goto(`${BASE}/calendar`);
  await h.waitForTimeout(800);
  await shot(h, "calendar-hussein");

  // Booking conflict is refused with a suggestion.
  await s.getByRole("button", { name: "حجز" }).first().click();
  await s.locator("#bc").selectOption("c_obesity");
  await s.locator("#bti").fill("تجربة تعارض");
  const ward = await (await s.request.get(`${BASE}/api/bookings`)).json();
  const busy = ward.bookings.find((b) => b.busy_only);
  if (busy) {
    const toLocal = (iso) => {
      const d = new Date(iso);
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Baghdad", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    };
    await s.locator("#bs").fill(toLocal(busy.starts_at));
    await s.locator("#be").fill(toLocal(busy.ends_at));
    await s.getByText("يتعارض مع حجز آخر").waitFor({ timeout: 10000 });
    check("booking form warns about a conflict and offers the nearest free time", (await s.getByRole("button", { name: /استخدم أقرب وقت متاح/ }).count()) > 0);
    await shot(s, "booking-conflict-sama");
  } else check("booking conflict scenario has a busy slot to test", false);
  await s.keyboard.press("Escape");

  // Deep link without a session → login → back to the task.
  {
    const c = await browser.newContext(phone);
    const p = await c.newPage();
    await p.goto(taskUrl);
    await p.waitForURL(/\/login\?next=/, { timeout: 15000 });
    await p.locator("#u").fill("hussein");
    await p.locator("#p").fill(pw.hussein);
    await p.getByRole("button", { name: "دخول" }).click();
    await p.waitForURL(taskUrl, { timeout: 15000 });
    await p.getByText("تصوير لقطات غرفة الانتظار").first().waitFor();
    check("deep link without a session goes to login and returns to the task", true);
    await p.reload();
    await p.getByText("تصوير لقطات غرفة الانتظار").first().waitFor();
    check("task link survives a page refresh", true);
    // Wrong password shows the generic message.
    await c.clearCookies();
    await p.goto(`${BASE}/login`);
    await p.locator("#u").fill("hussein");
    await p.locator("#p").fill("not-the-password");
    await p.getByRole("button", { name: "دخول" }).click();
    await p.getByText("اسم المستخدم أو كلمة المرور غير صحيحة").waitFor({ timeout: 10000 });
    check("wrong password shows a generic error", true);
    await c.close();
  }

  // Offline: a write must not show success.
  await h.goto(taskUrl);
  await h.getByText("النقاش").waitFor();
  await ctx.hussein.c.setOffline(true);
  await h.locator("textarea[aria-label='تعليق جديد']").fill("تجربة دون شبكة");
  await h.getByRole("button", { name: "إرسال التعليق" }).click();
  await h.getByText("تعذّر الاتصال بالخادم").first().waitFor({ timeout: 10000 });
  const offlineText = await h.locator("body").innerText();
  check("offline write shows a failure, never a success", offlineText.includes("لم يُحفظ") && !offlineText.includes("تم الحفظ"));
  await shot(h, "offline-hussein");
  await ctx.hussein.c.setOffline(false);

  // Admin and account pages.
  await m.goto(`${BASE}/admin`);
  await m.getByText("حالة التنبيهات").waitFor();
  await m.waitForTimeout(500);
  await shot(m, "admin-mohammed");
  // Staging deliberately has no Cron Trigger. Match the displayed state to
  // the real overview instead of requiring a successful run in every environment.
  // Production still has its separate gate requiring two successful Cron runs.
  const schedulerResponse = await m.request.get(`${BASE}/api/admin/overview`);
  const schedulerOverview = schedulerResponse.ok() ? await schedulerResponse.json() : null;
  const hasSchedulerState = !!schedulerOverview?.scheduler && Object.hasOwn(schedulerOverview.scheduler, "last_ok");
  const lastSchedulerRun = schedulerOverview?.scheduler?.last_ok;
  const schedulerLabel = lastSchedulerRun ? "آخر تشغيل ناجح للمجدول" : "لم يعمل المجدول بعد.";
  check(
    "mohammed: admin accurately shows the scheduler's actual state",
    schedulerResponse.ok() && hasSchedulerState && (await m.getByText(schedulerLabel).count()) > 0,
    lastSchedulerRun ? `last success ${lastSchedulerRun.started_at}` : "no successful run; the page reports this explicitly",
  );
  await a.goto(`${BASE}/admin`);
  await a.waitForTimeout(800);
  check("ammar: no admin page", (await a.getByText("حالة التنبيهات").count()) === 0);
  await h.goto(`${BASE}/account`);
  await h.getByRole("heading", { name: "إشعارات هذا الجهاز" }).waitFor();
  await shot(h, "account-hussein");
  await m.goto(`${BASE}/tasks/t_demo_06`);
  await m.getByText("بانتظار العميل").first().waitFor();
  await shot(m, "task-client-wait-mohammed");

  // Data persists across sign-out and a second device.
  {
    await h.goto(`${BASE}/account`);
    await h.getByRole("button", { name: "تسجيل الخروج من هذا الجهاز" }).click();
    await h.waitForURL(/\/login/, { timeout: 15000 });
    const c = await browser.newContext(desktop);
    const p = await c.newPage();
    await p.goto(`${BASE}/login?next=${encodeURIComponent(new URL(taskUrl).pathname)}`);
    await p.locator("#u").fill("hussein");
    await p.locator("#p").fill(pw.hussein);
    await p.getByRole("button", { name: "دخول" }).click();
    await p.waitForURL(/\/tasks\//);
    await p.getByText("تجربة: 12 صورة في مجلد العيادة").waitFor({ timeout: 10000 });
    check("data persists after sign-out and on another device", true);
    await c.close();
  }
} catch (e) {
  check("scenario ran to the end", false, String(e?.message ?? e).split("\n")[0]);
  for (const [who, { p }] of Object.entries(ctx)) await shot(p, `error-${who}`).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
