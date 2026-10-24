// Business-hours arithmetic. Every instant is a UTC Date; the work calendar is
// interpreted in the configured IANA time zone (Asia/Baghdad by default).

export type WorkHours = {
  tz: string;
  days: number[]; // 0 = Sunday … 6 = Saturday, in the configured time zone
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  assumed?: boolean;
};

export const DEFAULT_WORK_HOURS: WorkHours = { tz: "Asia/Baghdad", days: [0, 1, 2, 3, 4], start: "09:00", end: "18:00", assumed: true };

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export type LocalParts = { y: number; m: number; d: number; h: number; mi: number; s: number; weekday: number };

export function localParts(t: Date, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(t)) parts[p.type] = p.value;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    mi: Number(parts.minute),
    s: Number(parts.second),
    weekday: WEEKDAY[parts.weekday] ?? 0,
  };
}

function offsetMinutes(t: Date, tz: string): number {
  const p = localParts(t, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(t.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant for a wall-clock time in the zone. */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = offsetMinutes(new Date(guess), tz);
  let utc = guess - off * 60000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off) {
    off = off2;
    utc = guess - off * 60000;
  }
  return new Date(utc);
}

function hm(s: string): [number, number] {
  const [h, m] = s.split(":").map(Number);
  return [h || 0, m || 0];
}

/** Work window [start, end) of the local calendar day that is `offsetDays` after the local day of `t`. */
function windowFor(t: Date, offsetDays: number, wh: WorkHours): { start: Date; end: Date; workday: boolean } {
  const p = localParts(t, wh.tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + offsetDays));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + 1;
  const d = base.getUTCDate();
  const [sh, sm] = hm(wh.start);
  const [eh, em] = hm(wh.end);
  const start = zonedToUtc(y, m, d, sh, sm, wh.tz);
  const end = zonedToUtc(y, m, d, eh, em, wh.tz);
  const weekday = localParts(new Date(start.getTime() + 60000), wh.tz).weekday;
  return { start, end, workday: wh.days.includes(weekday) && end > start };
}

export function isBusinessTime(t: Date, wh: WorkHours): boolean {
  const w = windowFor(t, 0, wh);
  return w.workday && t >= w.start && t < w.end;
}

/** `t` itself when inside working hours, otherwise the start of the next working window. */
export function nextBusinessStart(t: Date, wh: WorkHours): Date {
  for (let i = 0; i < 15; i++) {
    const w = windowFor(t, i, wh);
    if (!w.workday) continue;
    if (t < w.end) return t > w.start ? t : w.start;
  }
  return t;
}

/** Working minutes elapsed between a and b (0 when b <= a). */
export function businessMinutesBetween(a: Date, b: Date, wh: WorkHours): number {
  if (b <= a) return 0;
  let total = 0;
  const spanDays = Math.min(Math.ceil((b.getTime() - a.getTime()) / 86_400_000) + 2, 120);
  for (let i = 0; i <= spanDays; i++) {
    const w = windowFor(a, i, wh);
    if (w.start > b) break;
    if (!w.workday) continue;
    const s = Math.max(a.getTime(), w.start.getTime());
    const e = Math.min(b.getTime(), w.end.getTime());
    if (e > s) total += (e - s) / 60000;
  }
  return Math.floor(total);
}

/** The instant reached after `minutes` working minutes from `t`. */
export function addBusinessMinutes(t: Date, minutes: number, wh: WorkHours): Date {
  let remaining = minutes;
  let cursor = t;
  for (let i = 0; i < 200 && remaining > 0; i++) {
    const w = windowFor(cursor, 0, wh);
    if (w.workday && cursor < w.end) {
      const from = cursor > w.start ? cursor : w.start;
      const avail = (w.end.getTime() - from.getTime()) / 60000;
      if (avail >= remaining) return new Date(from.getTime() + remaining * 60000);
      remaining -= avail;
    }
    cursor = windowFor(cursor, 1, wh).start;
  }
  return cursor;
}

export function iso(t: Date): string {
  return t.toISOString();
}
