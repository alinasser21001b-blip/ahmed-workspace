/* ============================================================
   STOLEN HOURS — the chapters
   Each scene owns its beats and hands the stage to the next.
   ============================================================ */

import { CONFIG as C } from "./config.js";
import {
  el, speak, show, clock, holdToReveal, magnetic,
  atmos, bloom, audio, buzz, store, REDUCED,
} from "./engine.js";

const TOTAL = 7;
const mark = (stage, i) => { stage.marks(TOTAL, i); store.set({ chapter: i }); };

/* ------------------------------------------------------------
   00 — COLD OPEN
------------------------------------------------------------ */
export function open({ mount, d, stage }) {
  mark(stage, 0);
  atmos.set("dust");
  bloom("");
  audio.bed("night");

  const saved = store.get();
  const canResume = typeof saved.chapter === "number" && saved.chapter > 0 && saved.chapter < 6;

  speak(d, mount, [
    { html: `${C.date.day} <span style="letter-spacing:-.01em">${C.date.month}</span>`, cls: "statement hero", hold: 2500 },
    { html: "Tomorrow.", cls: "statement", hold: 1900 },
    { html: "I stole a few hours of your day.", cls: "statement", hold: 2700 },
    { html: "Your only job?", cls: "statement", hold: 1800 },
    { html: "", cls: "statement", hold: 850, out: 0 },
    { html: "Be ready at 7.", cls: "statement", hold: 1500, keep: true },
  ], () => {
    const gap = el(`<div class="gap-xl"></div>`);
    const enter = el(`
      <div class="portal-wrap">
        <span class="core" aria-hidden="true"></span>
        <button class="portal" type="button" aria-label="Enter">
          <span class="ring" aria-hidden="true"></span>
          <span class="label">enter</span>
        </button>
      </div>`);
    mount.append(gap, enter);
    show(d, enter, 120);
    magnetic(d, enter, 9);

    d.on(enter.querySelector(".portal"), "click", () => {
      enter.classList.add("firing");
      enter.querySelector(".portal").classList.add("firing");
      audio.whoosh(); buzz(18);
      bloom("flare");
      d.timer(() => stage.go(pickup, "push"), 620);
    });

    if (canResume) {
      const resume = el(`<button class="softlink" type="button">resume where you left off ↩</button>`);
      mount.append(el(`<div class="gap-m"></div>`), resume);
      show(d, resume, 900);
      d.on(resume, "click", () => {
        audio.tick();
        const jump = [open, pickup, travel, split, quest, ret, ending][saved.chapter] || pickup;
        stage.go(jump, "cut");
      });
    }
  });
}

/* ------------------------------------------------------------
   01 — THE PICKUP
------------------------------------------------------------ */
export function pickup({ mount, d, stage }) {
  mark(stage, 1);
  atmos.set("dust");
  bloom("");
  audio.bed("night");

  const tag = el(`<div class="eyebrow">chapter 01 — the pickup</div>`);
  const gap1 = el(`<div class="gap-l"></div>`);
  const time = clock(C.pickup.from);
  const wrap = el(`<div></div>`);
  wrap.appendChild(time);
  const gap2 = el(`<div class="gap-l"></div>`);
  const line = el(`<div></div>`);
  mount.append(tag, gap1, wrap, gap2, line);
  show(d, tag, 200);
  show(d, wrap, 500);

  d.timer(() => { time.setTo(C.pickup.to); audio.tick(); buzz(6); }, 2200);

  d.timer(() => {
    speak(d, line, [
      { html: "Somewhere between these two…", cls: "statement sm", hold: 2300 },
      { html: "I'm stealing you.", cls: "statement", hold: 2300 },
    ], () => {
      atmos.set("city");
      bloom("warm");
      d.timer(() => {
        wrap.classList.add("hiding");
        tag.classList.add("hiding");
        d.timer(() => { wrap.remove(); tag.remove(); gap1.remove(); locked(); }, 700);
      }, 400);
    });
  }, 3600);

  function locked() {
    const head = el(`<div class="mono-tag">destination locked</div>`);
    const gapA = el(`<div class="gap-l"></div>`);
    mount.append(head, gapA);
    show(d, head, 100);

    const hold = holdToReveal(d, {
      label: "hold to reveal",
      duration: 1600,
      onDone: () => {
        atmos.burst();
        bloom("flare");
        d.timer(() => bloom("warm"), 900);
        hold.classList.add("hiding");
        d.timer(() => { hold.remove(); head.remove(); gapA.remove(); revealed(); }, 620);
      },
    });
    mount.appendChild(hold);
    show(d, hold, 300);
  }

  function revealed() {
    const card = el(`
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        <div class="statement ar" style="font-size:clamp(38px,11.5vw,58px)">${C.pickup.placeArabic}</div>
        <div class="eyebrow" style="letter-spacing:.42em">${C.pickup.placeLatin}</div>
        <div class="gap-xs"></div>
        <div class="mono-tag">${C.pickup.tag}</div>
      </div>`);
    mount.appendChild(card);
    show(d, card, 120);

    /* the place itself, graded into the night — only if the photo exists */
    if (C.photos?.beitHalab) {
      const probe = new Image();
      probe.onload = () => {
        if (d.dead) return;
        const ph = el(`<div class="photo-card"><img src="${C.photos.beitHalab}" alt="${C.pickup.placeLatin}"></div>`);
        card.appendChild(el(`<div class="gap-s"></div>`));
        card.appendChild(ph);
        show(d, ph, 60);
      };
      probe.src = C.photos.beitHalab;
    }

    const rest = el(`<div style="width:100%"></div>`);
    mount.append(el(`<div class="gap-l"></div>`), rest);

    d.timer(() => {
      speak(d, rest, [
        { html: "First mission: arrive hungry.", cls: "subcopy", hold: 2400 },
      ], () => {
        const lines = el(`
          <div class="subcopy" style="line-height:2.1">
            <div class="l1">We eat.</div>
            <div class="l2">We talk.</div>
            <div class="l3">We steal food from each other's plates.</div>
          </div>`);
        rest.appendChild(lines);
        ["l1", "l2", "l3"].forEach((c, i) => {
          const n = lines.querySelector("." + c);
          n.classList.add("veiled", "quick");
          d.timer(() => { void n.offsetWidth; n.classList.add("shown"); }, 260 * i);
        });
        d.timer(() => next(), 2600);
      });
    }, 900);
  }

  function next() {
    const go = el(`<button class="softlink" type="button">then we drive ↦</button>`);
    mount.append(el(`<div class="gap-l"></div>`), go);
    show(d, go, 200);
    d.on(go, "click", () => { audio.whoosh(); stage.go(travel, "fade"); });
  }
}

/* ------------------------------------------------------------
   02 — TRAVEL  (the only scene that plays itself)
------------------------------------------------------------ */
export function travel({ mount, d, stage }) {
  mark(stage, 2);
  atmos.set("road");
  bloom("warm");
  audio.whoosh();

  const readout = el(`
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <div class="eyebrow">in transit</div>
      <div class="mono-tag" id="coords" style="letter-spacing:.18em;color:var(--paper-dim)">33.31° N &nbsp; 44.42° E</div>
    </div>`);
  mount.appendChild(readout);
  show(d, readout, 150);

  const co = readout.querySelector("#coords");
  const target = [33.3736, 44.3608];
  let cur = [33.3120, 44.4210];
  d.interval(() => {
    cur = [cur[0] + (target[0] - cur[0]) * .12, cur[1] + (target[1] - cur[1]) * .12];
    co.innerHTML = `${cur[0].toFixed(4)}° N &nbsp; ${cur[1].toFixed(4)}° E`;
  }, 90);

  const arrive = () => {
    readout.classList.add("hiding");
    const name = el(`
      <div style="display:flex;flex-direction:column;align-items:center;gap:12px">
        <div class="statement hero" style="font-size:clamp(36px,11vw,64px);letter-spacing:.06em">${C.district.latin}</div>
        <div class="subcopy ar" style="font-size:15px">${C.district.arabic}</div>
      </div>`);
    mount.appendChild(name);
    show(d, name, 420);
    atmos.set("city");
    d.timer(() => stage.go(split, "fade"), 2600);
  };

  const t = d.timer(arrive, 4200);
  /* impatient taps are welcome */
  d.on(mount, "click", () => { clearTimeout(t); arrive(); }, { once: true });
}

/* ------------------------------------------------------------
   03 — THE SPLIT
------------------------------------------------------------ */
export function split({ mount, d, stage }) {
  mark(stage, 3);
  atmos.set("city");
  bloom("");
  audio.bed("night");

  const intro = el(`<div></div>`);
  mount.appendChild(intro);

  speak(d, intro, [
    { html: "And this is where the night<br>temporarily splits.", cls: "statement sm", hold: 2600 },
  ], () => {
    const stage3 = el(`
      <div class="split-wrap">
        <svg class="split-svg" viewBox="0 0 320 132" aria-hidden="true">
          <path class="trunk" d="M160 2 L160 52"></path>
          <path class="hers"  d="M160 52 C160 104 96 96 44 130"></path>
          <path class="his"   d="M160 52 C160 104 224 96 276 130"></path>
        </svg>
        <div class="paths">
          <div class="path-card hers">
            <span class="who">${C.split.hers.label}</span>
            <span class="icon">${C.split.hers.icon}</span>
            <span class="where">${C.split.hers.name}</span>
            <span class="note">Coffee.<br>Chill.<br>Don't get too comfortable.</span>
          </div>
          <div class="path-card his">
            <span class="who">${C.split.his.label}</span>
            <span class="icon">${C.split.his.icon}</span>
            <span class="where">${C.split.his.name}</span>
            <span class="note">Unfortunately…</span>
          </div>
        </div>
      </div>`);
    mount.appendChild(stage3);

    /* draw the trunk, then let it fork */
    const paths = [...stage3.querySelectorAll("path")];
    paths.forEach((p) => {
      const len = p.getTotalLength();
      p.style.setProperty("--len", len);
    });
    const cards = [...stage3.querySelectorAll(".path-card")];
    cards.forEach((c) => c.classList.add("veiled"));

    d.timer(() => paths[0].classList.add("drawn"), 200);
    d.timer(() => { paths[1].classList.add("drawn"); paths[2].classList.add("drawn"); audio.tick(); }, 1100);
    d.timer(() => { void cards[0].offsetWidth; cards[0].classList.add("shown"); }, 2100);
    d.timer(() => { void cards[1].offsetWidth; cards[1].classList.add("shown"); }, 2600);

    d.timer(() => {
      const detect = el(`<div class="mono-tag pulse-tag" style="color:#9fb0cf">side quest detected</div>`);
      mount.append(el(`<div class="gap-l"></div>`), detect);
      show(d, detect, 100);
      audio.tick(); buzz([8, 60, 8]);

      const go = el(`<button class="softlink" type="button">accept ↦</button>`);
      mount.append(el(`<div class="gap-s"></div>`), go);
      show(d, go, 700);
      d.on(go, "click", () => { audio.press(); stage.go(quest, "cut"); });
    }, 3600);
  });
}

/* ------------------------------------------------------------
   04 — THE SIDE QUEST
------------------------------------------------------------ */
export function quest({ mount, d, stage }) {
  mark(stage, 4);
  atmos.set("grid");
  bloom("cool");
  audio.bed("quest");

  const box = el(`
    <div class="quest">
      <div class="frame">
        <div class="qlabel">side quest</div>
        <div class="qtitle">${C.quest.title}</div>
        <div class="qclock" id="qc">${C.quest.clock[0]}</div>
        <div class="meter"><i id="mfill"></i></div>
        <div class="meter-label"><span>${C.quest.meter}</span><span id="mpct">0%</span></div>
      </div>
    </div>`);
  mount.appendChild(box);
  show(d, box, 150);

  const qc = box.querySelector("#qc");
  const fill = box.querySelector("#mfill");
  const pct = box.querySelector("#mpct");
  const steps = C.quest.clock;

  steps.forEach((time, i) => {
    d.timer(() => {
      qc.textContent = time;
      const p = Math.round(((i + 1) / steps.length) * 100);
      fill.style.right = (100 - p) + "%";
      pct.textContent = p + "%";
      audio.tick(); buzz(5);
    }, 900 + i * 1000);
  });

  d.timer(() => {
    box.classList.add("complete");
    qc.textContent = "";
    const stamp = el(`<div class="complete-stamp">mission complete</div>`);
    qc.appendChild(stamp);
    atmos.burst();
    audio.swell(); buzz([18, 50, 18, 50, 30]);
  }, 900 + steps.length * 1000 + 400);

  /* everything goes quiet */
  d.timer(() => {
    box.classList.add("hiding");
    atmos.set("off");
    bloom("");
    audio.bed("night");
    d.timer(() => {
      box.remove();
      const closing = el(`<div></div>`);
      mount.appendChild(closing);
      speak(d, closing, [
        { html: "Now…", cls: "statement", hold: 1700 },
        { html: "Where were we?", cls: "statement", hold: 2100 },
      ], () => {
        atmos.set("warm");
        bloom("warm");
        const word = el(`<button class="portal-word" type="button">${C.ret.place}</button>`);
        mount.appendChild(word);
        show(d, word, 200);
        magnetic(d, word, 7);
        d.on(word, "click", () => {
          word.classList.add("firing");
          audio.whoosh(); buzz(16);
          d.timer(() => stage.go(ret, "push"), 640);
        });
      });
    }, 800);
  }, 900 + steps.length * 1000 + 2600);
}

/* ------------------------------------------------------------
   05 — THE RETURN
------------------------------------------------------------ */
export function ret({ mount, d, stage }) {
  mark(stage, 5);
  atmos.set("warm");
  bloom("warm");
  audio.bed("warm");

  /* the feeling of the place, behind everything — only if the photo exists */
  if (C.photos?.grinders) {
    const probe = new Image();
    probe.onload = () => {
      if (d.dead) return;
      const bg = el(`<div class="scene-photo-bg" aria-hidden="true"><img src="${C.photos.grinders}" alt=""></div>`);
      const sceneEl = mount.closest(".scene");
      sceneEl.style.position = "absolute";
      sceneEl.insertBefore(bg, sceneEl.firstChild);
      requestAnimationFrame(() => bg.classList.add("live"));
    };
    probe.src = C.photos.grinders;
  }

  const body = el(`<div></div>`);
  mount.appendChild(body);

  speak(d, body, [
    { html: "You waited.", cls: "statement", hold: 2300 },
    { html: "I came back.", cls: "statement", hold: 2500 },
    { html: "The official plan ends here.", cls: "statement sm", hold: 2600 },
    { html: "", cls: "statement", hold: 1100, out: 0 },
    { html: "But the night doesn't have to.", cls: "statement", hold: 2400, keep: true },
  ], () => {
    const go = el(`<button class="softlink" type="button">so…</button>`);
    mount.append(el(`<div class="gap-xl"></div>`), go);
    show(d, go, 400);
    d.on(go, "click", () => { audio.press(); stage.go(ending, "fade"); });
  });
}

/* ------------------------------------------------------------
   06 — CHOOSE THE ENDING
------------------------------------------------------------ */
export function ending({ mount, d, stage }) {
  mark(stage, 6);
  atmos.set("warm");
  bloom("warm");
  audio.bed("warm");

  const head = el(`<div class="statement sm">Choose the ending.</div>`);
  mount.append(head, el(`<div class="gap-l"></div>`));
  show(d, head, 200);

  const box = el(`
    <div class="choices">
      <button class="choice behave" type="button">
        <span class="glow" aria-hidden="true"></span><span class="fill" aria-hidden="true"></span>
        <span class="txt"><span>☕</span> Behave</span>
      </button>
      <button class="choice improvise" type="button">
        <span class="glow" aria-hidden="true"></span><span class="fill" aria-hidden="true"></span>
        <span class="txt"><span>🔥</span> Improvise</span>
      </button>
    </div>`);
  mount.appendChild(box);
  show(d, box, 500);

  const hint = el(`<div class="eyebrow" style="opacity:0;transition:opacity .6s;margin-top:22px">press and hold to choose</div>`);
  mount.appendChild(hint);

  const buttons = [...box.querySelectorAll(".choice")];
  let settled = false, misses = 0;

  buttons.forEach((btn) => {
    magnetic(d, btn, 8);
    const fill = btn.querySelector(".fill");
    const DUR = REDUCED ? 260 : 620;
    let t0 = 0, raf = 0, tapCommits = false;

    const loop = () => {
      const p = Math.min((performance.now() - t0) / DUR, 1);
      fill.style.width = (p * 100) + "%";
      if (p >= 1) { commit(); return; }
      raf = requestAnimationFrame(loop);
    };
    const down = (e) => {
      if (settled) return;
      if (e.cancelable) e.preventDefault();
      audio.press(); buzz(6);
      t0 = performance.now();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    };
    const up = () => {
      if (settled) return;
      cancelAnimationFrame(raf);
      if (parseFloat(fill.style.width) < 98) {
        if (tapCommits) return commit();
        fill.style.transition = "width .4s cubic-bezier(.16,1,.3,1)";
        fill.style.width = "0%";
        setTimeout(() => { fill.style.transition = ""; }, 420);
        if (++misses >= 1) hint.style.opacity = ".75";
        if (misses >= 2) buttons.forEach(() => { tapCommits = true; });
      }
    };
    const commit = () => {
      if (settled) return;
      settled = true;
      cancelAnimationFrame(raf);
      fill.style.width = "100%";
      btn.classList.add("chosen");
      buttons.filter((b) => b !== btn).forEach((b) => b.classList.add("dismissed"));
      hint.style.opacity = "0";
      buzz([16, 40, 22]);
      d.timer(() => resolve(btn.classList.contains("behave") ? "behave" : "improvise"), 900);
    };

    d.on(btn, "pointerdown", down);
    d.on(btn, "pointerup", up);
    d.on(btn, "pointercancel", up);
    d.on(btn, "pointerleave", up);
    d.on(btn, "keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); commit(); } });
    d.add(() => cancelAnimationFrame(raf));
  });

  function resolve(choice) {
    head.classList.add("hiding");
    box.classList.add("hiding");
    hint.remove();
    d.timer(() => {
      head.remove(); box.remove();
      const out = el(`<div></div>`);
      mount.appendChild(out);

      const script = choice === "behave"
        ? [
            { html: "Very responsible.", cls: "statement", hold: 2100 },
            { html: "Suspiciously responsible.", cls: "statement sm", hold: 2600 },
          ]
        : [
            { html: "Risky choice.", cls: "statement", hold: 2000 },
            { html: "", cls: "statement", hold: 1000, out: 0 },
            { html: "We'll see.", cls: "statement", hold: 2100 },
            { html: "No spoilers.", cls: "statement sm gold", hold: 2400 },
          ];

      if (choice === "improvise") { bloom("flare"); d.timer(() => bloom("warm"), 1400); }
      speak(d, out, script, () => outro({ mount, d, stage }));
    }, 700);
  }
}

/* ------------------------------------------------------------
   07 — OUTRO  (and the one hidden line)
------------------------------------------------------------ */
export function outro({ mount, d, stage }) {
  store.set({ chapter: 7, done: true });
  atmos.set("warm");
  bloom("warm");

  mount.innerHTML = "";
  const end = el(`
    <div style="display:flex;flex-direction:column;align-items:center;gap:14px">
      <div class="eyebrow" id="stamp" style="cursor:default">${C.date.day} ${C.date.month}</div>
      <div class="gap-s"></div>
      <div class="statement">See you at 7.</div>
      <div class="subcopy ar" style="font-size:16px">${C.outroArabic}</div>
    </div>`);
  mount.appendChild(end);
  show(d, end, 200);
  audio.swell();

  const again = el(`<button class="softlink" type="button">replay our night ↺</button>`);
  mount.append(el(`<div class="gap-xl"></div>`), again);
  show(d, again, 1400);
  d.on(again, "click", () => {
    store.set({ chapter: 0, done: false });
    audio.tick();
    stage.go(open, "cut");
  });

  /* ---- the easter egg: nobody is told about this ---- */
  const stamp = end.querySelector("#stamp");
  const ps = document.getElementById("ps");
  let taps = 0, tapTimer = 0, pressTimer = 0;

  const fire = () => {
    if (ps.classList.contains("on")) return;
    ps.textContent = C.secret;
    ps.classList.add("on");
    buzz(10);
    d.timer(() => ps.classList.remove("on"), 3800);
  };

  d.on(stamp, "click", () => {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 700);
    if (taps >= 3) { taps = 0; fire(); }
  });
  d.on(stamp, "pointerdown", () => { pressTimer = setTimeout(fire, 1200); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    d.on(stamp, ev, () => clearTimeout(pressTimer)));
  d.add(() => { clearTimeout(tapTimer); clearTimeout(pressTimer); ps.classList.remove("on"); });
}
