import { beforeAll, describe, expect, it } from "vitest";
import { baseSunday, Browser, createTask, key, plus, rows, team } from "./helpers";

let T: Awaited<ReturnType<typeof team>>;
const B = baseSunday(2); // Sunday 09:00 Baghdad
const slot = (from: number, to: number) => ({ starts_at: plus(B, from).toISOString(), ends_at: plus(B, to).toISOString() });
const book = (as: Browser, client_id: string, s: { starts_at: string; ends_at: string }, extra: Record<string, unknown> = {}) =>
  as.post("/api/bookings", { client_id, title: "حجز تصوير", ...s, create_key: key(), ...extra });

beforeAll(async () => {
  T = await team();
});

describe("§14.9 two people cannot book the same time", () => {
  for (const day of [0, 1, 2]) {
    it(`§14.9 five simultaneous overlapping requests → exactly one booking (round ${day + 1})`, async () => {
      const d = day * 1440;
      const attempts = await Promise.all([
        book(T.sama, "c_obesity", slot(d + 60, d + 120)),
        book(T.sama, "c_obesity", slot(d + 90, d + 150)),
        book(T.ammar, "c_ward", slot(d + 30, d + 100)),
        book(T.ammar, "c_obesity", slot(d + 60, d + 120)),
        book(T.mohammed, "c_ward", slot(d + 100, d + 130)),
      ]);
      const statuses = attempts.map((a) => a.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);
      const active = await rows("select * from bookings where status = 'active' and starts_at < ? and ends_at > ?", plus(B, d + 150).toISOString(), plus(B, d + 30).toISOString());
      expect(active).toHaveLength(1);
      for (const a of attempts.filter((x) => x.status === 409)) {
        expect(a.body.error).toBe("booking_conflict");
        expect(a.body.message).toBeTruthy();
        expect(a.body.conflicts.length).toBeGreaterThan(0);
        const s = a.body.suggestion;
        expect(s).toBeTruthy();
        const check = await T.mohammed.get(`/api/bookings/check?starts_at=${encodeURIComponent(s.starts_at)}&ends_at=${encodeURIComponent(s.ends_at)}`);
        expect(check.body.free, JSON.stringify(s)).toBe(true);
        expect(check.body.within_hours).toBe(true);
      }
      expect((await rows("select * from events where type = 'booking_conflict' and created_at > ?", new Date(Date.now() - 60_000).toISOString())).length).toBeGreaterThanOrEqual(4);
    });
  }

  it("§14.9 the suggestion skips to the next working day when the clash runs to the end of the day", async () => {
    expect((await book(T.sama, "c_obesity", slot(3 * 1440 + 480, 3 * 1440 + 540))).status).toBe(201); // Wed 17:00–18:00
    const r = await book(T.ammar, "c_ward", slot(3 * 1440 + 500, 3 * 1440 + 530));
    expect(r.status).toBe(409);
    expect(r.body.suggestion.starts_at).toBe(plus(B, 4 * 1440).toISOString()); // Thu 09:00
  });

  it("§14.9 a repeated request with the same key returns the same booking; bad slots are refused", async () => {
    const k = key();
    const s = slot(4 * 1440 + 60, 4 * 1440 + 90);
    const [a, b] = await Promise.all([book(T.sama, "c_obesity", s, { create_key: k }), book(T.sama, "c_obesity", s, { create_key: k })]);
    expect(a.body.id).toBe(b.body.id);
    expect(await rows("select * from bookings where create_key = ?", k)).toHaveLength(1);
    expect((await book(T.sama, "c_obesity", slot(4 * 1440 + 200, 4 * 1440 + 190))).status).toBe(400);
    expect((await book(T.sama, "c_obesity", slot(4 * 1440 + 200, 4 * 1440 + 200 + 13 * 60))).status).toBe(400);
    const past = { starts_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), ends_at: new Date(Date.now() - 3_600_000).toISOString() };
    expect((await book(T.sama, "c_obesity", past)).status).toBe(400);
  });
});

describe("§14.8 Sama sees other clients' bookings only as busy", () => {
  it("§14.8 Ward bookings reach Sama as «مشغول» with no title, client or task — in the calendar, the check and a refused booking", async () => {
    const wardTask = await createTask(T.ammar, { client_id: "c_ward", assignee_id: "u_hussein", title: "مهمة-ورد-للحجز" });
    const SECRET = "حجز-ورد-سري";
    const w = await book(T.ammar, "c_ward", slot(1440 * 7 + 60, 1440 * 7 + 180), { title: SECRET, task_id: wardTask }); // next Sunday 10:00–12:00
    expect(w.status).toBe(201);
    const own = await book(T.sama, "c_obesity", slot(1440 * 7 + 240, 1440 * 7 + 300), { title: "حجز-عيادة-لسما" });
    expect(own.status).toBe(201);

    const cal = await T.sama.get(`/api/bookings?from=${plus(B, 1440 * 7).toISOString()}&to=${plus(B, 1440 * 8).toISOString()}`);
    expect(JSON.stringify(cal.body)).not.toContain(SECRET);
    expect(JSON.stringify(cal.body)).not.toContain(wardTask);
    const wb = cal.body.bookings.find((b: any) => b.id === w.body.id);
    expect(Object.keys(wb).sort()).toEqual(["busy_only", "ends_at", "id", "resource_id", "starts_at", "title"]);
    expect(wb).toMatchObject({ busy_only: true, title: "مشغول" });
    expect(cal.body.bookings.find((b: any) => b.id === own.body.id)).toMatchObject({ busy_only: false, title: "حجز-عيادة-لسما" });

    const check = await T.sama.get(`/api/bookings/check?starts_at=${encodeURIComponent(plus(B, 1440 * 7 + 90).toISOString())}&ends_at=${encodeURIComponent(plus(B, 1440 * 7 + 120).toISOString())}`);
    expect(check.body.free).toBe(false);
    expect(JSON.stringify(check.body)).not.toContain(SECRET);
    const refused = await book(T.sama, "c_obesity", slot(1440 * 7 + 90, 1440 * 7 + 120));
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).not.toContain(SECRET);
    expect(refused.body.conflicts[0].busy_only).toBe(true);

    // The photographer and the owner see the details; Hussein gets the task link because it is his task.
    const hb = (await T.hussein.get(`/api/bookings?from=${plus(B, 1440 * 7).toISOString()}&to=${plus(B, 1440 * 8).toISOString()}`)).body.bookings.find((b: any) => b.id === w.body.id);
    expect(hb).toMatchObject({ busy_only: false, title: SECRET, task_id: wardTask });
    const mb = (await T.mohammed.get(`/api/bookings?from=${plus(B, 1440 * 7).toISOString()}&to=${plus(B, 1440 * 8).toISOString()}`)).body.bookings.find((b: any) => b.id === w.body.id);
    expect(mb.title).toBe(SECRET);

    // Sama's Today shows it as busy too.
    expect(JSON.stringify((await T.sama.get("/api/today")).body)).not.toContain(SECRET);
  });
});

describe("rescheduling and cancelling", () => {
  it("§14.9 rescheduling needs a reason, notifies the photographer, and still refuses overlaps; others cannot touch the booking", async () => {
    const a = await book(T.ammar, "c_ward", slot(1440 * 8 + 60, 1440 * 8 + 120), { title: "جولة" });
    const b = await book(T.sama, "c_obesity", slot(1440 * 8 + 180, 1440 * 8 + 240));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((await T.ammar.patch(`/api/bookings/${a.body.id}`, slot(1440 * 8 + 300, 1440 * 8 + 360))).status).toBe(400);
    const overlap = await T.ammar.patch(`/api/bookings/${a.body.id}`, { ...slot(1440 * 8 + 200, 1440 * 8 + 260), reason: "طلب المستشفى" });
    expect(overlap.status).toBe(409);
    expect((await T.sama.patch(`/api/bookings/${a.body.id}`, { ...slot(1440 * 8 + 300, 1440 * 8 + 360), reason: "محاولة" })).status).toBe(404);
    expect((await T.hussein.post(`/api/bookings/${a.body.id}/cancel`, { reason: "مشغول" })).status).toBe(404);
    expect((await T.ammar.patch(`/api/bookings/${a.body.id}`, { ...slot(1440 * 8 + 300, 1440 * 8 + 360), reason: "طلب المستشفى" })).status).toBe(200);
    expect(await rows("select * from notifications where user_id = 'u_hussein' and kind = 'booking_changed' and ref_id = ?", a.body.id)).toHaveLength(1);
    expect(await rows("select * from events where type = 'booking_rescheduled' and json_extract(data, '$.booking') = ?", a.body.id)).toHaveLength(1);
    expect((await T.mohammed.post(`/api/bookings/${b.body.id}/cancel`, { reason: "أُلغي الموعد مع العميل" })).status).toBe(200);
    expect((await book(T.ammar, "c_ward", slot(1440 * 8 + 180, 1440 * 8 + 240))).status).toBe(201); // the freed slot is bookable
  });
});
