/* ============================================================
   STOLEN HOURS — engine
   Scene lifecycle, atmosphere, motion helpers, generated audio.
   Everything a scene creates is tracked and torn down on exit.
   ============================================================ */

export const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- tiny helpers ---------- */
export const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const R = (a, b) => a + Math.random() * (b - a);

/* Tightens the pacing when motion is reduced. Scaled, never clamped:
   a clamp collapses every delay to the same value and the beats of a
   scene then fire on top of each other. */
export const beat = (ms) => (REDUCED ? Math.round(ms * 0.5) : ms);

/* ---------- disposer: no scene leaves anything behind ---------- */
export class Disposer {
  constructor() { this.timers = new Set(); this.offs = []; this.rafs = new Set(); this.dead = false; }
  timer(fn, ms) {
    if (this.dead) return -1;
    const id = setTimeout(() => { this.timers.delete(id); if (!this.dead) fn(); }, beat(ms));
    this.timers.add(id);
    return id;
  }
  interval(fn, ms) {
    if (this.dead) return -1;
    const id = setInterval(() => { if (!this.dead) fn(); }, ms);
    this.timers.add(id);
    return id;
  }
  on(target, type, fn, opts) {
    if (this.dead) return;
    target.addEventListener(type, fn, opts);
    this.offs.push(() => target.removeEventListener(type, fn, opts));
  }
  raf(fn) {
    if (this.dead) return;
    let id;
    const loop = (t) => { if (this.dead) return; fn(t); id = requestAnimationFrame(loop); this.rafs.add(id); };
    id = requestAnimationFrame(loop);
    this.rafs.add(id);
  }
  add(fn) { this.offs.push(fn); }
  dispose() {
    this.dead = true;
    this.timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
    this.rafs.forEach((id) => cancelAnimationFrame(id));
    this.offs.forEach((f) => { try { f(); } catch (_) {} });
    this.timers.clear(); this.rafs.clear(); this.offs.length = 0;
  }
}

/* ---------- storage (never throws in private mode) ---------- */
export const store = {
  key: "stolen-hours:v1",
  get() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } },
  set(patch) { try { localStorage.setItem(this.key, JSON.stringify({ ...this.get(), ...patch })); } catch {} },
  clear() { try { localStorage.removeItem(this.key); } catch {} },
};

/* ---------- haptics (Android honours it; iOS quietly ignores) ---------- */
export const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

/* ============================================================
   ATMOSPHERE — one canvas, one loop, several moods
   ============================================================ */
export const atmos = (() => {
  const cv = document.getElementById("atmos");
  const ctx = cv.getContext("2d", { alpha: true });
  let W = 0, H = 0, dpr = 1, parts = [], mode = "off", raf = null, paused = false, t0 = 0;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = Math.floor(innerWidth * dpr);
    H = cv.height = Math.floor(innerHeight * dpr);
    cv.style.width = innerWidth + "px";
    cv.style.height = innerHeight + "px";
    if (mode !== "off") seed(mode);
  }

  function count(base) {
    const area = (innerWidth * innerHeight) / (390 * 844);
    return Math.round(base * clamp(area, .6, 1.7) * (REDUCED ? .35 : 1));
  }

  function seed(m) {
    mode = m; parts = [];
    if (m === "off") return;
    if (m === "dust") {
      for (let i = 0, n = count(30); i < n; i++) parts.push({
        x: R(0, W), y: R(0, H), r: R(.5, 1.7) * dpr,
        vx: R(-.04, .04) * dpr, vy: R(-.09, -.02) * dpr,
        a: R(.05, .2), tw: R(.0004, .0016), ph: R(0, 6.28), c: "232,200,154",
      });
    }
    if (m === "city") {
      for (let i = 0, n = count(46); i < n; i++) {
        const depth = Math.random();
        parts.push({
          x: R(0, W), y: R(H * .28, H), r: (1 + depth * 5) * dpr,
          vx: R(.06, .3) * dpr * (0.3 + depth), vy: R(-.03, .03) * dpr,
          a: .06 + depth * .3, tw: R(.0008, .003), ph: R(0, 6.28),
          c: Math.random() < .78 ? "232,200,154" : "255,238,214", blur: depth > .55,
        });
      }
    }
    if (m === "road") {
      for (let i = 0, n = count(64); i < n; i++) parts.push({
        ang: R(0, 6.283), rad: R(.02, 1) * Math.max(W, H) * .6,
        sp: R(.006, .022), len: R(.05, .2), a: R(.15, .6),
        c: Math.random() < .7 ? "232,200,154" : "200,214,238",
      });
    }
    if (m === "grid") {
      for (let i = 0, n = count(38); i < n; i++) parts.push({
        x: R(0, W), y: R(0, H), r: R(.6, 1.5) * dpr,
        vx: 0, vy: R(.15, .5) * dpr,
        a: R(.08, .32), tw: R(.002, .006), ph: R(0, 6.28), c: "159,176,207",
      });
    }
    if (m === "warm") {
      for (let i = 0, n = count(34); i < n; i++) parts.push({
        x: R(0, W), y: R(H * .3, H + 40 * dpr), r: R(.7, 2.4) * dpr,
        vx: R(-.05, .05) * dpr, vy: R(-.34, -.1) * dpr,
        a: R(.08, .34), tw: R(.001, .004), ph: R(0, 6.28),
        c: Math.random() < .6 ? "232,180,110" : "255,226,180", sway: R(4, 16) * dpr, sws: R(.0004, .0012),
      });
    }
    if (m === "spark") {
      for (let i = 0, n = count(50); i < n; i++) parts.push({
        x: W / 2, y: H / 2, ang: R(0, 6.283), sp: R(1.4, 6) * dpr,
        r: R(.8, 2.2) * dpr, a: 1, decay: R(.006, .018), c: "232,200,154",
      });
    }
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (paused) return;
    if (!t0) t0 = t;
    ctx.clearRect(0, 0, W, H);
    if (mode === "off") return;

    if (mode === "road") {
      const cx = W / 2, cy = H / 2;
      ctx.lineCap = "round";
      for (const p of parts) {
        p.rad += p.rad * p.sp + .6 * dpr;
        if (p.rad > Math.max(W, H) * .78) { p.rad = R(.02, .18) * Math.max(W, H) * .5; p.ang = R(0, 6.283); }
        const x1 = cx + Math.cos(p.ang) * p.rad, y1 = cy + Math.sin(p.ang) * p.rad;
        const r2 = p.rad * (1 - p.len);
        const x2 = cx + Math.cos(p.ang) * r2, y2 = cy + Math.sin(p.ang) * r2;
        const fade = clamp(p.rad / (Math.max(W, H) * .4), 0, 1);
        ctx.strokeStyle = `rgba(${p.c},${p.a * fade})`;
        ctx.lineWidth = clamp(p.rad / (Math.max(W, H) * .25), .4, 2.6) * dpr;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      return;
    }

    if (mode === "spark") {
      let alive = false;
      for (const p of parts) {
        if (p.a <= 0) continue;
        alive = true;
        p.x += Math.cos(p.ang) * p.sp; p.y += Math.sin(p.ang) * p.sp;
        p.sp *= .975; p.a -= p.decay;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29);
        ctx.fillStyle = `rgba(${p.c},${Math.max(p.a, 0)})`;
        ctx.fill();
      }
      if (!alive) mode = "off";
      return;
    }

    for (const p of parts) {
      const tw = .5 + .5 * Math.sin(t * p.tw + p.ph);
      let x = p.x;
      p.x += p.vx; p.y += p.vy;
      if (p.y < -20 * dpr) { p.y = H + 20 * dpr; p.x = R(0, W); }
      if (p.y > H + 20 * dpr) { p.y = -20 * dpr; p.x = R(0, W); }
      if (p.x < -20 * dpr) p.x = W + 20 * dpr;
      if (p.x > W + 20 * dpr) p.x = -20 * dpr;
      if (p.sway) x = p.x + Math.sin(t * p.sws + p.ph) * p.sway;
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, 6.29);
      ctx.fillStyle = `rgba(${p.c},${p.a * (.35 + .65 * tw)})`;
      if (p.blur) { ctx.shadowColor = `rgba(${p.c},.55)`; ctx.shadowBlur = p.r * 4; }
      else ctx.shadowBlur = 0;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  addEventListener("resize", resize, { passive: true });
  addEventListener("orientationchange", () => setTimeout(resize, 260), { passive: true });
  document.addEventListener("visibilitychange", () => { paused = document.hidden; });
  resize();
  raf = requestAnimationFrame(frame);

  return {
    set(m) { seed(m); },
    burst() { seed("spark"); },
  };
})();

/* ---------- the bloom layer follows the story's temperature ---------- */
const bloomEl = document.getElementById("bloom");
export const bloom = (kind) => { bloomEl.className = kind || ""; };

/* ============================================================
   AUDIO — generated, opt-in, never autoplayed
   ============================================================ */
export const audio = (() => {
  let ac = null, master = null, bedNodes = [], enabled = false, bedName = null;

  const ensure = () => {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
  };

  function noise() {
    const len = ac.sampleRate * 2;
    const b = ac.createBuffer(1, len, ac.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + .02 * w) / 1.02; d[i] = last * 3.2; }
    return b;
  }

  function stopBed() { bedNodes.forEach((n) => { try { n.stop(); } catch {} }); bedNodes = []; }

  function bed(name) {
    bedName = name;
    if (!enabled) return;
    ensure(); stopBed();
    if (name === "off") return;
    const src = ac.createBufferSource();
    src.buffer = noise(); src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = name === "quest" ? 620 : name === "warm" ? 300 : 220;
    const g = ac.createGain();
    g.gain.value = name === "warm" ? .07 : .05;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    bedNodes.push(src);

    const base = name === "quest" ? 74 : name === "warm" ? 48 : 55;
    [base, base * 1.01].forEach((fr) => {
      const o = ac.createOscillator();
      o.type = "sine"; o.frequency.value = fr;
      const og = ac.createGain(); og.gain.value = .045;
      o.connect(og); og.connect(master); o.start();
      bedNodes.push(o);
    });
  }

  const tone = (freq, dur, vol = .05, type = "sine") => {
    if (!enabled || !ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = 0; o.connect(g); g.connect(master);
    const t = ac.currentTime;
    g.gain.linearRampToValueAtTime(vol, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.start(); o.stop(t + dur + .05);
  };

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      ensure();
      if (ac.state === "suspended") ac.resume();
      master.gain.cancelScheduledValues(ac.currentTime);
      master.gain.linearRampToValueAtTime(enabled ? 1 : 0, ac.currentTime + 1);
      if (enabled) bed(bedName || "night");
      return enabled;
    },
    bed,
    tick() { tone(880, .1, .028); },
    press() { tone(320, .16, .05); },
    whoosh() {
      if (!enabled || !ac) return;
      const src = ac.createBufferSource();
      src.buffer = noise(); src.loop = false;
      const f = ac.createBiquadFilter();
      f.type = "bandpass"; f.Q.value = .9;
      const g = ac.createGain();
      const t = ac.currentTime;
      f.frequency.setValueAtTime(280, t);
      f.frequency.exponentialRampToValueAtTime(2200, t + .55);
      g.gain.setValueAtTime(.0001, t);
      g.gain.linearRampToValueAtTime(.09, t + .16);
      g.gain.exponentialRampToValueAtTime(.0001, t + .8);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(); src.stop(t + .9);
    },
    swell() {
      if (!enabled || !ac) return;
      [174.6, 220, 261.6, 349.2].forEach((fr, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine"; o.frequency.value = fr;
        g.gain.value = 0; o.connect(g); g.connect(master);
        const t = ac.currentTime;
        g.gain.linearRampToValueAtTime(.05, t + 1.4 + i * .28);
        g.gain.linearRampToValueAtTime(0, t + 6.5);
        o.start(); o.stop(t + 6.8);
      });
    },
  };
})();

/* ============================================================
   MOTION HELPERS
   ============================================================ */

/* Rule 1 — statements arrive out of blur, one at a time. */
export function speak(d, mount, items, done) {
  const node = document.createElement("div");
  node.className = "veiled";
  mount.appendChild(node);
  let i = 0;
  const step = () => {
    if (i >= items.length) { done && done(); return; }
    const it = items[i++];
    node.className = "veiled " + (it.cls || "statement") + (it.quick ? " quick" : "");
    node.innerHTML = it.html;
    void node.offsetWidth;                       // commit the veiled state first
    node.classList.add("shown");
    d.timer(() => {
      if (it.keep) { done && done(); return; }
      node.classList.remove("shown");
      node.classList.add("hiding");
      d.timer(() => { node.classList.remove("hiding"); step(); }, it.out ?? 620);
    }, it.hold ?? 2100);
  };
  step();
  return node;
}

/* Reveal an element that is already in the DOM. */
export function show(d, node, delay = 0) {
  node.classList.add("veiled");
  d.timer(() => { void node.offsetWidth; node.classList.add("shown"); }, delay);
  return node;
}

/* Rule 3 — time morphs digit by digit. */
export function clock(value) {
  const wrap = el(`<div class="clock" role="text" aria-label="${value}"></div>`);
  const build = (ch) => ch === ":"
    ? el(`<span class="colon">:</span>`)
    : el(`<span class="digit"><i>${ch}</i></span>`);
  [...value].forEach((ch) => wrap.appendChild(build(ch)));
  wrap.setTo = (next) => {
    wrap.setAttribute("aria-label", next);
    const cells = [...wrap.children];
    [...next].forEach((ch, idx) => {
      const cell = cells[idx];
      if (!cell || ch === ":") return;
      const cur = cell.querySelector("i:not(.out)");
      if (!cur || cur.textContent === ch) return;
      const nxt = el(`<i class="in">${ch}</i>`);
      cell.appendChild(nxt);
      requestAnimationFrame(() => {
        cur.classList.add("out");
        nxt.classList.add("settle");
      });
      setTimeout(() => { cur.remove(); nxt.classList.remove("in", "settle"); }, 700);
    });
  };
  return wrap;
}

/* Rule 2 — press and hold. Always has a way out. */
export function holdToReveal(d, { label = "hold to reveal", duration = 1500, onDone }) {
  const dur = REDUCED ? 700 : duration;
  const node = el(`
    <div style="display:flex;flex-direction:column;align-items:center">
      <button class="holder" type="button" aria-label="${label}">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="track" cx="50" cy="50" r="46"></circle>
          <circle class="prog" cx="50" cy="50" r="46"
                  stroke-dasharray="289" stroke-dashoffset="289"></circle>
        </svg>
        <span class="pulse" aria-hidden="true"></span>
        <span class="hint">${label}</span>
      </button>
    </div>`);
  const btn = node.querySelector(".holder");
  const prog = node.querySelector(".prog");
  const LEN = 289;

  let t0 = 0, rafId = 0, finished = false, misses = 0;

  const paint = (p) => { prog.style.strokeDashoffset = String(LEN * (1 - p)); };

  const tickLoop = () => {
    const p = clamp((performance.now() - t0) / dur, 0, 1);
    paint(p);
    if (p >= 1) { finish(); return; }
    rafId = requestAnimationFrame(tickLoop);
  };

  const start = (e) => {
    if (finished) return;
    if (e.cancelable) e.preventDefault();
    btn.classList.add("active");
    audio.press(); buzz(8);
    t0 = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tickLoop);
  };

  const stop = () => {
    if (finished) return;
    cancelAnimationFrame(rafId);
    btn.classList.remove("active");
    const p = Number(prog.style.strokeDashoffset || LEN);
    if (p > LEN * .04) {                      // released early
      prog.style.transition = "stroke-dashoffset .5s cubic-bezier(.16,1,.3,1)";
      paint(0);
      setTimeout(() => { prog.style.transition = ""; }, 520);
      if (++misses === 2) showFallback();
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    paint(1);
    btn.classList.add("done");
    buzz([14, 40, 22]); audio.swell();
    onDone && onDone();
  };

  function showFallback() {
    if (node.querySelector(".hold-fallback")) return;
    const fb = el(`<button class="hold-fallback" type="button">or just tap here</button>`);
    fb.addEventListener("click", finish);
    node.appendChild(fb);
    void fb.offsetWidth;
  }

  d.on(btn, "pointerdown", start);
  d.on(btn, "pointerup", stop);
  d.on(btn, "pointercancel", stop);
  d.on(btn, "pointerleave", stop);
  /* keyboard: hold Space/Enter, or press twice — both work */
  d.on(btn, "keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!t0 || finished) start(e); }
  });
  d.on(btn, "keyup", (e) => { if (e.key === " " || e.key === "Enter") stop(); });
  /* a hold that never starts still gets a door: fallback after 9s idle */
  d.timer(showFallback, 9000);
  d.add(() => cancelAnimationFrame(rafId));

  return node;
}

/* Micro-interaction: elements lean toward the finger. */
export function magnetic(d, node, strength = 12) {
  if (REDUCED) return;
  let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
  const apply = () => {
    cx += (tx - cx) * .16; cy += (ty - cy) * .16;
    node.style.transform = `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px)`;
    if (Math.abs(tx - cx) > .1 || Math.abs(ty - cy) > .1) raf = requestAnimationFrame(apply);
  };
  const move = (e) => {
    const p = e.touches ? e.touches[0] : e;
    const r = node.getBoundingClientRect();
    const dx = p.clientX - (r.left + r.width / 2);
    const dy = p.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    const reach = Math.max(r.width, r.height) * 1.25;
    if (dist < reach) {
      const f = (1 - dist / reach) * strength;
      tx = (dx / dist || 0) * f; ty = (dy / dist || 0) * f;
      node.classList.add("near");
    } else { tx = 0; ty = 0; node.classList.remove("near"); }
    cancelAnimationFrame(raf); raf = requestAnimationFrame(apply);
  };
  const leave = () => { tx = 0; ty = 0; node.classList.remove("near"); cancelAnimationFrame(raf); raf = requestAnimationFrame(apply); };
  d.on(window, "pointermove", move, { passive: true });
  d.on(window, "pointerup", leave, { passive: true });
  d.add(() => { cancelAnimationFrame(raf); node.style.transform = ""; });
}

/* ============================================================
   STAGE — owns the scene lifecycle and the transitions between
   ============================================================ */
export class Stage {
  constructor(root, chaptersEl) {
    this.root = root;
    this.chaptersEl = chaptersEl;
    this.current = null;
    this.d = null;
    this.veil = document.getElementById("veil");
    this.busy = false;
  }

  marks(total, index) {
    if (!this.chaptersEl.children.length) {
      for (let i = 0; i < total; i++) this.chaptersEl.appendChild(el("<b></b>"));
    }
    [...this.chaptersEl.children].forEach((b, i) => {
      b.className = i < index ? "done" : i === index ? "now" : "";
    });
    this.chaptersEl.classList.toggle("on", index > 0);
  }

  /* transition: 'push' (camera enters an object), 'cut' (to black), 'fade' */
  async go(factory, transition = "fade") {
    if (this.busy) return;
    this.busy = true;

    if (this.current) {
      if (transition === "push" && !REDUCED) {
        this.root.classList.add("push");
        await wait(760);
      } else if (transition === "cut") {
        this.veil.classList.add("on");
        await wait(beat(760));
      } else {
        this.current.classList.add("hiding");
        await wait(beat(560));
      }
      this.d.dispose();
      this.current.remove();
      this.root.classList.remove("push");
    }

    const d = new Disposer();
    const scene = el(`<section class="scene"><div class="scene-inner"></div></section>`);
    this.root.appendChild(scene);
    this.current = scene;
    this.d = d;

    factory({ mount: scene.querySelector(".scene-inner"), d, stage: this });

    if (transition === "cut") {
      await wait(60);
      this.veil.classList.remove("on");
    }
    this.busy = false;
  }
}
