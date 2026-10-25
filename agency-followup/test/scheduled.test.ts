// The Cron entry point: reminders run every minute whatever happens to the
// one-time demo seed that shares the first run.

import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../worker/index";
import { rows, sql } from "./helpers";

const runs = async () => (await rows<{ n: number }>("select count(*) as n from scheduler_runs"))[0].n;
const seedFlag = async () => (await rows<{ value: string }>("select value from settings where key = 'demo_seed'"))[0].value;
const demoTasks = async () => (await rows<{ n: number }>("select count(*) as n from tasks where is_demo = 1"))[0].n;

/** One Cron firing, waiting for the work the handler hands to waitUntil. */
async function cron() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: new Date(), cron: "* * * * *" }), env, ctx);
  await waitOnExecutionContext(ctx);
}

describe("§8 the scheduled run", () => {
  it("§8 a failed demo seed never stops the scheduler, and the seed is retried on the next run", async () => {
    await sql("update settings set value = 'pending' where key = 'demo_seed'");
    await sql("delete from scheduler_runs");
    // Make the seed fail the way any database error would.
    await sql("create trigger fail_demo_seed before insert on tasks when new.id like 't_demo_%' begin select raise(abort, 'seed blocked for the test'); end");
    try {
      await cron();
      expect(await runs()).toBe(1);
      expect(await seedFlag()).toBe("pending");
      expect(await demoTasks()).toBe(0);
    } finally {
      await sql("drop trigger fail_demo_seed");
    }

    await sql("delete from scheduler_runs");
    await cron();
    expect(await runs()).toBe(1);
    expect(await seedFlag()).toBe("done");
    expect(await demoTasks()).toBeGreaterThan(0);
  });
});
