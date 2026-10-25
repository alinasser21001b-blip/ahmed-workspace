// One scheduler minute: reminders, escalation and push delivery, then the
// one-time demo seed. Shared by the Cron entry point and the minute clock.

import { loadCtx } from "./db";
import { seedDemo } from "./demo";
import { runScheduler } from "./scheduler";

export async function cronWork(env: Env, now = new Date()): Promise<void> {
  // Reminders first: the one-time demo seed below must never be able to
  // stop them. A failed seed is logged and tried again next minute.
  await runScheduler(env, now);
  try {
    const flag = await env.DB.prepare("select value from settings where key = 'demo_seed'").first<{ value: string }>();
    if (flag?.value === "pending") {
      await seedDemo(await loadCtx(env));
      await env.DB.prepare("update settings set value = 'done', updated_at = ? where key = 'demo_seed'").bind(new Date().toISOString()).run();
    }
  } catch (e) {
    console.error("demo seed failed", e);
  }
}
