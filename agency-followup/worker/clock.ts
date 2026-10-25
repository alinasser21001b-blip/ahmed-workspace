// The minute clock behind reminders, escalation and push delivery.
// A Durable Object alarm instead of a Cron Trigger: the Cloudflare account
// had used the five Cron Triggers of the Workers Free plan. The alarm
// re-arms itself every minute whether or not anyone opens the app; a
// request only makes sure the clock is running after a deploy.

import { DurableObject } from "cloudflare:workers";
import { cronWork } from "./cron";

const MINUTE = 60_000;
/** The start of the next minute, like a Cron firing. */
export const nextMinute = (now: number) => Math.floor(now / MINUTE) * MINUTE + MINUTE;

export class SchedulerClock extends DurableObject<Env> {
  /** Starts the clock if it is not running. Returns whether it had to. */
  async ensure(): Promise<boolean> {
    if ((await this.ctx.storage.getAlarm()) !== null) return false;
    await this.ctx.storage.setAlarm(nextMinute(Date.now()));
    return true;
  }

  async alarm(): Promise<void> {
    try {
      await cronWork(this.env, new Date());
    } catch (e) {
      // runScheduler has already recorded the failure in scheduler_runs.
      console.error("scheduler run failed", e);
    }
    // Always the next minute, so one failed run never stops the clock.
    await this.ctx.storage.setAlarm(nextMinute(Date.now()));
  }
}
