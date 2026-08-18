/* ============================================================
   STOLEN HOURS — 19 August
   Everything personal lives here. Nothing else needs editing.
   ============================================================ */

export const CONFIG = {
  date: {
    day: "19",
    month: "AUGUST",
    stamp: "19.08",
  },

  /* Chapter 01 — the pickup */
  pickup: {
    from: "07:00",
    to: "07:30",
    placeArabic: "بيت حلب",
    placeLatin: "BEIT HALAB",
    tag: "OPEN BUFFET",
  },

  /* Chapter 02 — where the night lands */
  district: {
    latin: "ADHAMIYA",
    arabic: "الأعظمية",
  },

  /* Chapter 03 — the split */
  split: {
    hers: { name: "GRINDERS", icon: "☕", label: "YOU" },
    his:  { name: "COLLEGE",  icon: "🎓", label: "ME" },
  },

  /* Chapter 04 — the side quest */
  quest: {
    title: "Survive College",
    clock: ["10:00", "10:34", "11:08", "11:31", "11:48"],
    meter: "LECTURE SURVIVAL",
  },

  /* Chapter 05 — the return */
  ret: { place: "GRINDERS" },

  /* Photos of the places. Drop the two files into experience/assets/img/
     with these exact names; each scene picks its photo up automatically
     and skips it gracefully if the file is missing. */
  photos: {
    beitHalab: "assets/img/beit-halab.jpg",
    grinders:  "assets/img/grinders.jpg",
  },

  /* The one hidden line. Long-press or triple-tap the date stamp at the end. */
  secret: "p.s. you looked cute reading all this.",

  /* A closing line in her language. Keep it short. */
  outroArabic: "لا تتأخرين 🙂",
};
