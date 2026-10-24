// Dates are stored as UTC instants and always shown in the agency's time zone
// (from the server's work-hours setting), whatever the phone is set to.

let TZ = "Asia/Baghdad";
export function setTimeZone(tz: string) {
  TZ = tz;
}
export const timeZone = () => TZ;

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar-IQ", { timeZone: TZ, numberingSystem: "latn", ...opts });

export function parts(d: Date) {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, weekday: p.weekday };
}

/** "2026-10-25T14:00" read as wall-clock time in the agency zone → UTC ISO. */
export function localInputToIso(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = (t: number) => {
    const p = parts(new Date(t));
    return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(t / 60000) * 60000) / 60000;
  };
  let utc = guess - off(guess) * 60000;
  const o2 = off(utc);
  if (o2 !== off(guess)) utc = guess - o2 * 60000;
  return new Date(utc).toISOString();
}

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = parts(new Date(iso));
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

export function dayKey(iso: string): string {
  const p = parts(new Date(iso));
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export const fmtTime = (iso: string) => fmt({ hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export const fmtDay = (iso: string) => fmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
export const fmtDateTime = (iso: string) => fmt({ weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export const fmtFull = (iso: string) => fmt({ year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** «اليوم ٣:٠٠ م» / «غداً» / «الأحد ...» relative to now in the agency zone. */
export function fmtDue(iso: string, now = new Date()): string {
  const k = dayKey(iso);
  const today = dayKey(now.toISOString());
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000).toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  if (k === today) return `اليوم ${fmtTime(iso)}`;
  if (k === tomorrow) return `غداً ${fmtTime(iso)}`;
  if (k === yesterday) return `أمس ${fmtTime(iso)}`;
  return fmtDateTime(iso);
}

export function fmtAgo(iso: string, now = new Date()): string {
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "الآن";
  if (min < 60) return `قبل ${min} دقيقة`;
  const h = Math.round(min / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  return fmtDateTime(iso);
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} دقيقة`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} س ${m} د` : `${h} ساعة`;
}
