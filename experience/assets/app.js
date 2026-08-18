/* ============================================================
   STOLEN HOURS — entry point
   ============================================================ */

import { Stage, audio, store } from "./engine.js";
import { open, pickup, travel, split, quest, ret, ending } from "./scenes.js";

const stage = new Stage(
  document.getElementById("world"),
  document.getElementById("chapters")
);

/* ---- sound: opt-in, one control, never autoplayed ---- */
const soundBtn = document.getElementById("sound");
soundBtn.addEventListener("click", () => {
  const on = audio.toggle();
  soundBtn.classList.toggle("on", on);
  soundBtn.setAttribute("aria-label", on ? "Sound on" : "Sound off");
  soundBtn.setAttribute("aria-pressed", String(on));
});

/* ---- resilience: a broken beat must never end the night ----
   If a scene throws, drop her back at the chapter she reached
   instead of leaving a black screen.                          */
const CHAPTERS = [open, pickup, travel, split, quest, ret, ending];
let recovering = false;
addEventListener("error", () => {
  if (recovering) return;
  recovering = true;
  setTimeout(() => {
    const saved = store.get();
    const idx = Math.min(Math.max(saved.chapter || 0, 0), CHAPTERS.length - 1);
    try { stage.busy = false; stage.go(CHAPTERS[idx], "cut"); } catch {}
    recovering = false;
  }, 400);
});

stage.go(open, "fade");
