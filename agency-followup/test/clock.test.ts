// The minute clock (worker/clock.ts) that replaces the Cron Trigger: it runs
// the scheduler on every alarm and always sets the next one.

import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nextMinute, type SchedulerClock } from "../worker/clock";
import { rows, sql } from "./helpers";

const runs = async () => (await rows<{ n: number }>("select count(*) as n from scheduler_runs"))[0].n;
const clock = (name: string) => env.CLOCK!.get(env.CLOCK!.idFromName(name)) as DurableObjectStub<SchedulerClock>;
const alarmOf = (stub: DurableObjectStub<SchedulerClock>) => runInDurableObject(stub, (_o, state) => state.storage.getAlarm());

describe("§8 the minute clock", () => {
  it("§8 arms itself once, at the next whole minute", async () => {
    const stub = clock("arm-test");
    expect(await alarmOf(stub)).toBeNull();
    const before = Date.now();
    expect(await stub.ensure()).toBe(true);
    const at = await alarmOf(stub);
    expect(at).toBe(nextMinute(before));
    expect(await stub.ensure()).toBe(false);
    expect(await alarmOf(stub)).toBe(at);
  });

  it("§8 every alarm runs the scheduler and sets the next minute, even when a run fails", async () => {
    const stub = clock("run-test");
    await stub.ensure();
    await sql("delete from scheduler_runs");
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runs()).toBe(1);
    expect(await alarmOf(stub)).toBeGreaterThan(Date.now());

    // A run that throws (here: its own bookkeeping table is missing) still re-arms the clock.
    await sql("alter table scheduler_runs rename to scheduler_runs_hidden");
    try {
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect(await alarmOf(stub)).toBeGreaterThan(Date.now());
    } finally {
      await sql("alter table scheduler_runs_hidden rename to scheduler_runs");
    }
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runs()).toBe(2);
  });

  it("§8 a request does not start the clock where it is switched off (tests, staging)", async () => {
    // vitest.config.ts sets SCHEDULER_CLOCK to "off"; staging has no CLOCK binding at all.
    expect(env.SCHEDULER_CLOCK).not.toBe("on");
    expect((await SELF.fetch("https://agency.test/api/health")).status).toBe(200);
    expect(await alarmOf(clock("main"))).toBeNull();
  });
});
