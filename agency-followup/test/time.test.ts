import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, DEFAULT_WORK_HOURS as WH, isBusinessTime, nextBusinessStart } from "../worker/lib/time";

// Baghdad is UTC+3 all year. 2026-10-25 is a Sunday; Fri 10-30 and Sat 10-31 are off.
const z = (s: string) => new Date(s);

describe("business hours (Asia/Baghdad, Sun–Thu 09:00–18:00)", () => {
  it("isBusinessTime: start inclusive, end exclusive, weekend off", () => {
    expect(isBusinessTime(z("2026-10-25T06:00:00Z"), WH)).toBe(true); // Sun 09:00
    expect(isBusinessTime(z("2026-10-25T05:59:00Z"), WH)).toBe(false); // Sun 08:59
    expect(isBusinessTime(z("2026-10-25T15:00:00Z"), WH)).toBe(false); // Sun 18:00
    expect(isBusinessTime(z("2026-10-30T09:00:00Z"), WH)).toBe(false); // Fri noon
    expect(isBusinessTime(z("2026-10-31T09:00:00Z"), WH)).toBe(false); // Sat noon
    expect(isBusinessTime(z("2026-10-29T14:59:00Z"), WH)).toBe(true); // Thu 17:59
  });

  it("nextBusinessStart", () => {
    expect(nextBusinessStart(z("2026-10-25T03:00:00Z"), WH).toISOString()).toBe("2026-10-25T06:00:00.000Z");
    expect(nextBusinessStart(z("2026-10-25T08:30:00Z"), WH).toISOString()).toBe("2026-10-25T08:30:00.000Z");
    expect(nextBusinessStart(z("2026-10-29T15:30:00Z"), WH).toISOString()).toBe("2026-11-01T06:00:00.000Z"); // Thu 18:30 → Sun
    expect(nextBusinessStart(z("2026-10-30T09:00:00Z"), WH).toISOString()).toBe("2026-11-01T06:00:00.000Z"); // Fri → Sun
  });

  it("businessMinutesBetween skips nights and the Fri/Sat weekend", () => {
    expect(businessMinutesBetween(z("2026-10-25T06:00:00Z"), z("2026-10-25T07:00:00Z"), WH)).toBe(60);
    expect(businessMinutesBetween(z("2026-10-29T14:00:00Z"), z("2026-11-01T07:00:00Z"), WH)).toBe(120); // Thu 17:00 → Sun 10:00
    expect(businessMinutesBetween(z("2026-10-30T06:00:00Z"), z("2026-10-31T15:00:00Z"), WH)).toBe(0);
    expect(businessMinutesBetween(z("2026-10-25T03:00:00Z"), z("2026-10-25T20:00:00Z"), WH)).toBe(540);
    expect(businessMinutesBetween(z("2026-10-25T07:00:00Z"), z("2026-10-25T06:00:00Z"), WH)).toBe(0);
    expect(businessMinutesBetween(z("2026-10-25T06:00:00Z"), z("2026-11-01T06:00:00Z"), WH)).toBe(5 * 540);
  });

  it("addBusinessMinutes carries over nights and weekends", () => {
    expect(addBusinessMinutes(z("2026-10-25T06:00:00Z"), 60, WH).toISOString()).toBe("2026-10-25T07:00:00.000Z");
    expect(addBusinessMinutes(z("2026-10-29T14:30:00Z"), 60, WH).toISOString()).toBe("2026-11-01T06:30:00.000Z"); // Thu 17:30 + 1h → Sun 09:30
    expect(addBusinessMinutes(z("2026-10-30T10:00:00Z"), 15, WH).toISOString()).toBe("2026-11-01T06:15:00.000Z");
    expect(addBusinessMinutes(z("2026-10-25T06:00:00Z"), 540, WH).toISOString()).toBe("2026-10-25T15:00:00.000Z");
  });

  it("other working calendars", () => {
    const wh = { tz: "Asia/Baghdad", days: [6, 0, 1, 2, 3], start: "08:00", end: "16:00" };
    expect(isBusinessTime(z("2026-10-31T06:00:00Z"), wh)).toBe(true); // Sat 09:00 is a workday here
    expect(isBusinessTime(z("2026-10-29T06:00:00Z"), wh)).toBe(false); // Thu off here
  });
});
