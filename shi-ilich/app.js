/* ============================================================
   شي إلچ — the engine.
   لا تحتاج تعدّل هنا. كل الشخصي بملف config.js
   ============================================================ */
(() => {
"use strict";

const $stage   = document.getElementById("stage");
const $body    = document.body;
const $sound   = document.getElementById("soundToggle");
const C        = SURPRISE; // from config.js
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ------------------------------------------------------------
   السماء: نظام جزيئات واحد بثلاث أمزجة
   dust → غبار خافت | stars → نجوم | crowd → أضوية جمهور
------------------------------------------------------------ */
const sky = (() => {
  const cv = document.getElementById("sky");
  const ctx = cv.getContext("2d");
  let W, H, parts = [], mode = "dust", raf = null;

  function resize(){
    W = cv.width  = innerWidth  * devicePixelRatio;
    H = cv.height = innerHeight * devicePixelRatio;
  }
  addEventListener("resize", () => { resize(); seed(mode); });
  resize();

  function rnd(a, b){ return a + Math.random() * (b - a); }

  function seed(m){
    mode = m;
    parts = [];
    const dpr = devicePixelRatio;
    if (m === "dust"){
      const n = reduceMotion ? 14 : 34;
      for (let i = 0; i < n; i++) parts.push({
        x: rnd(0, W), y: rnd(0, H), r: rnd(.6, 1.6) * dpr,
        vx: rnd(-.05, .05) * dpr, vy: rnd(-.09, -.02) * dpr,
        a: rnd(.04, .16), tw: rnd(.0005, .002), ph: rnd(0, 6.28),
        hue: "170,180,212",
      });
    }
    if (m === "stars"){
      const n = reduceMotion ? 30 : 80;
      for (let i = 0; i < n; i++) parts.push({
        x: rnd(0, W), y: rnd(0, H * .72) * (Math.random() < .8 ? rnd(.1, 1) : 1),
        r: rnd(.5, 1.5) * dpr,
        vx: 0, vy: 0,
        a: rnd(.1, .55), tw: rnd(.001, .004), ph: rnd(0, 6.28),
        hue: Math.random() < .85 ? "220,228,255" : "255,224,170",
      });
    }
    if (m === "hearts"){
      const n = reduceMotion ? 20 : 46;
      for (let i = 0; i < n; i++) parts.push({
        x: rnd(0, W), y: H + rnd(0, H * .8),
        r: rnd(7, 17) * devicePixelRatio,
        vx: 0, vy: -rnd(.25, .8) * devicePixelRatio,
        sway: rnd(6, 22) * devicePixelRatio, swaySpeed: rnd(.0004, .001),
        a: rnd(.15, .6), tw: rnd(.001, .003), ph: rnd(0, 6.28),
        hue: "hearts", baseX: 0,
      }), parts[parts.length - 1].baseX = parts[parts.length - 1].x;
    }
    if (m === "crowd"){
      const n = reduceMotion ? 60 : 150;
      for (let i = 0; i < n; i++){
        const depth = Math.random();               // 0 بعيد → 1 قريب
        parts.push({
          x: rnd(0, W),
          y: H * (0.42 + depth * 0.55) + rnd(-14, 14) * dpr,
          r: (0.7 + depth * 2.4) * dpr,
          vx: 0, vy: 0,
          sway: rnd(.15, .5) * dpr * (0.3 + depth),
          swaySpeed: rnd(.0004, .0011),
          a: .12 + depth * .6, tw: rnd(.002, .006), ph: rnd(0, 6.28),
          hue: Math.random() < .8 ? "255,206,120" : "255,240,214",
          baseX: 0,
        });
        parts[parts.length - 1].baseX = parts[parts.length - 1].x;
      }
    }
    if (!raf) loop(0);
  }

  function loop(t){
    raf = requestAnimationFrame(loop);
    ctx.clearRect(0, 0, W, H);
    for (const p of parts){
      const tw = .5 + .5 * Math.sin(t * p.tw + p.ph);
      let x = p.x;
      if (mode === "hearts"){
        p.y += p.vy;
        if (p.y < -30) { p.y = H + 30; p.baseX = Math.random() * W; }
        x = p.baseX + Math.sin(t * p.swaySpeed + p.ph) * p.sway;
        ctx.globalAlpha = p.a * (.4 + .6 * tw);
        ctx.font = `${p.r}px serif`;
        ctx.fillStyle = "rgb(224,112,138)";
        ctx.fillText("❤", x, p.y);
        ctx.globalAlpha = 1;
        continue;
      }
      if (mode === "crowd"){
        x = p.baseX + Math.sin(t * p.swaySpeed + p.ph) * p.sway * 14;
      } else {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -8){ p.y = H + 8; p.x = Math.random() * W; }
        if (p.x < -8) p.x = W + 8;
        if (p.x > W + 8) p.x = -8;
        x = p.x;
      }
      const alpha = p.a * (mode === "dust" ? tw : .35 + .65 * tw);
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, 6.29);
      ctx.fillStyle = `rgba(${p.hue},${alpha})`;
      if (mode === "crowd" && p.r > 2 * devicePixelRatio){
        ctx.shadowColor = `rgba(${p.hue},.9)`;
        ctx.shadowBlur = 12 * devicePixelRatio;
      } else ctx.shadowBlur = 0;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  seed("dust");
  return { seed };
})();

/* ------------------------------------------------------------
   الصوت: أجواء مولّدة (بدون أي مقطع محفوظ الحقوق)
------------------------------------------------------------ */
const audio = (() => {
  let ac = null, master = null, nodes = [], on = false, crowdGain = null;

  function ensure(){
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
  }

  function noiseBuffer(){
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++){         // brown noise
      const white = Math.random() * 2 - 1;
      last = (last + .02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  function startAmbient(){
    ensure();
    stopAll();
    // نغمة أرضية عميقة
    const o1 = ac.createOscillator(), o2 = ac.createOscillator();
    o1.frequency.value = 55; o2.frequency.value = 55.6;
    o1.type = o2.type = "sine";
    const og = ac.createGain(); og.gain.value = .05;
    o1.connect(og); o2.connect(og); og.connect(master);
    o1.start(); o2.start();
    // نسمة هوا
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(); src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 240;
    const ng = ac.createGain(); ng.gain.value = .05;
    src.connect(f); f.connect(ng); ng.connect(master);
    src.start();
    nodes = [o1, o2, src];
  }

  function startCrowd(){
    ensure();
    stopAll();   // نوقف فرشة الليل الهادئة — صار وقت الجمهور
    // همهمة جمهور: ضوضاء مفلترة تتنفس
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(); src.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 850; bp.Q.value = .7;
    crowdGain = ac.createGain(); crowdGain.gain.value = 0;
    src.connect(bp); bp.connect(crowdGain); crowdGain.connect(master);
    src.start();
    crowdGain.gain.linearRampToValueAtTime(.16, ac.currentTime + 5);
    // موجات حماس
    const swell = () => {
      if (!crowdGain) return;
      const t = ac.currentTime;
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
      crowdGain.gain.linearRampToValueAtTime(.22 + Math.random() * .08, t + .8);
      crowdGain.gain.linearRampToValueAtTime(.15, t + 2.6);
      swellTimer = setTimeout(swell, 3200 + Math.random() * 2600);
    };
    let swellTimer = setTimeout(swell, 2500);
    nodes.push(src);
    nodes.push({ stop(){ clearTimeout(swellTimer); crowdGain = null; } });
  }

  function chordSwell(){
    ensure();
    // تآلف دافي يصعد لحظة الكشف
    [220, 277.18, 329.63, 440].forEach((fr, i) => {
      const o = ac.createOscillator();
      o.type = "sine"; o.frequency.value = fr;
      const g = ac.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(master);
      const t = ac.currentTime;
      g.gain.linearRampToValueAtTime(.045, t + 2.5 + i * .4);
      g.gain.linearRampToValueAtTime(0, t + 9);
      o.start(); o.stop(t + 9.2);
    });
  }

  function blip(){
    if (!on || !ac) return;
    const o = ac.createOscillator();
    o.type = "sine"; o.frequency.value = 660;
    const g = ac.createGain();
    g.gain.value = .0; o.connect(g); g.connect(master);
    const t = ac.currentTime;
    g.gain.linearRampToValueAtTime(.05, t + .01);
    g.gain.exponentialRampToValueAtTime(.0001, t + .25);
    o.start(); o.stop(t + .3);
  }

  function stopAll(){
    nodes.forEach(n => { try{ n.stop(); }catch(e){} });
    nodes = [];
  }

  function setOn(v){
    on = v;
    ensure();
    if (ac.state === "suspended") ac.resume();
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.linearRampToValueAtTime(v ? 1 : 0, ac.currentTime + 1.2);
  }

  return { startAmbient, startCrowd, chordSwell, blip, setOn, get on(){ return on; } };
})();

/* أي مشهد نصب أي "فرشة" صوت — حتى إذا شغّلت الصوت متأخر يشتغل الصح */
let audioBed = "ambient";
let bedStarted = false;
function setBed(name){
  audioBed = name;
  if (audio.on){
    if (name === "ambient") audio.startAmbient();
    if (name === "crowd"){ audio.startCrowd(); }
    bedStarted = true;
  } else bedStarted = false;
}

$sound.addEventListener("click", () => {
  const next = !audio.on;
  audio.setOn(next);
  if (next && !bedStarted){
    bedStarted = true;
    if (audioBed === "crowd") audio.startCrowd();
    else audio.startAmbient();
  }
  $sound.textContent = next ? "🔊" : "🔇";
  $sound.classList.toggle("on", next);
});

/* اهتزاز خفيف (أندرويد) — آيفون يتجاهلها بهدوء */
function buzz(pattern){
  try{ navigator.vibrate && navigator.vibrate(pattern); }catch(e){}
}

/* ------------------------------------------------------------
   محرك المشاهد
------------------------------------------------------------ */
let delayCursor = 0;
function L(text, cls = "", d = null){         // سطر
  if (d === null){ d = delayCursor; delayCursor += .95; }
  return `<p class="line ${cls}" style="--d:${d}s">${text}</p>`;
}
function GAP(size = "m"){ return `<div class="gap-${size}"></div>`; }
function BTN(text, id, cls = "", d = null){
  if (d === null){ d = delayCursor + .4; }
  return `<button class="btn ${cls}" id="${id}" style="--d:${d}s">${text}</button>`;
}
function resetDelays(start = 0.3){ delayCursor = start; }

function show(html, wire){
  const current = $stage.querySelector(".scene");
  const put = () => {
    resetDelays();
    $stage.innerHTML = `<div class="scene">${html()}</div>`;
    if (wire) wire($stage.querySelector(".scene"));
  };
  if (current){
    current.classList.add("out");
    setTimeout(put, 820);
  } else put();
}

function ember(level){ $body.dataset.ember = level; }

const on = (root, sel, fn) => {
  root.querySelector(sel).addEventListener("click", (e) => { audio.blip(); fn(e); }, { once: false });
};

/* "عم يكتب…" قبل الرد — يعطي إحساس إنه آني اللي دأرد عليها */
let respondTimer = null;
function respond($el, html, wireFn){
  clearTimeout(respondTimer);              // تخمين جديد يلغي رد التخمين القديم
  $el.innerHTML = `<div class="gap-m"></div>
    <p class="typing-dots"><span></span><span></span><span></span></p>`;
  respondTimer = setTimeout(() => {
    $el.innerHTML = html;
    if (wireFn) wireFn();
  }, 850);
}

/* ------------------------------------------------------------
   المشاهد
------------------------------------------------------------ */

/* ٠ — الختم: نقطة ضوء وحيدة بالعتمة */
function sceneSeal(){
  show(() => `
    <div style="height:38vh"></div>
    <button id="sealLight" class="firefly" style="position:relative;margin:0" aria-label="ضوة">
      <i style="animation-duration:2.8s"></i>
    </button>
    <p class="line line--dim" id="sealHint" style="--d:5.5s;font-size:14px">اكو ضوة هنا… دگّي عليها</p>
  `, (root) => {
    on(root, "#sealLight", () => {
      if (!$sound.dataset.started && audio.on !== true){ /* الصوت يبقى بإيدها */ }
      ember(1);
      sceneGreeting();
    });
  });
}

/* ١ — التحية */
function sceneGreeting(){
  show(() => `
    ${L(`هلا ${C.herName}.`, "line--big")}
    ${GAP("s")}
    ${L("لا، ماكو شي غلط 🙂", "line--dim")}
    ${L("بس عندي شي إلچ.")}
    ${L("شي… ما أگدر أنطيچ ياه بإيدي.")}
    ${GAP("l")}
    ${BTN("شنو هو؟", "b1")}
  `, (root) => on(root, "#b1", sceneMission));
}

/* ٢ — المهمة */
function sceneMission(){
  ember(2);
  show(() => `
    ${L("الشي موجود. حقيقي.")}
    ${L("ومحجوز باسمچ من فترة.", "line--big")}
    ${GAP("m")}
    ${L("بس حتى توصلين إله…", "line--dim")}
    ${L("لازم تفتحين ثلاث بواب.")}
    ${L("كل باب وراه سؤال. وآني وراهم كلهم 🙂", "line--dim")}
    ${GAP("l")}
    ${BTN("يالله، الباب الأول", "b1", "btn--primary")}
  `, (root) => on(root, "#b1", sceneDoorMemory));
}

/* أدوات البواب */
function doorHeader(n){
  const labels = ["الباب الأول — الذاكرة", "الباب الثاني — العين", "الباب الثالث — القلب"];
  return `
    <span class="door-label" style="--d:.2s">${labels[n]}</span>
    <div class="door-dots" style="--d:.4s">
      ${[0,1,2].map(i => `<b class="${i <= n ? "lit" : ""}"></b>`).join("")}
    </div>
    ${GAP("m")}`;
}

/* ٣ — باب الذاكرة */
function sceneDoorMemory(){
  ember(2);
  const q = C.memoryDoor;
  show(() => `
    ${doorHeader(0)}
    ${L(q.question)}
    <div class="choices">
      ${q.options.map((o, i) =>
        `<button class="choice" data-i="${i}" style="--d:${1.4 + i * .25}s">${o.text}</button>`
      ).join("")}
    </div>
    <div id="resp"></div>
  `, (root) => {
    root.querySelectorAll(".choice").forEach(btn => {
      btn.addEventListener("click", () => {
        audio.blip();
        const opt = q.options[+btn.dataset.i];
        root.querySelectorAll(".choice").forEach(b => b.classList.add(b === btn ? "picked" : "faded"));
        btn.style.pointerEvents = "none";
        buzz(12);
        respond(root.querySelector("#resp"), `
          <p class="line ${opt.correct ? "" : "line--dim"}" style="--d:.1s">${opt.response}</p>
          ${BTN("الباب الثاني ←", "next", "", 1.2)}`,
          () => on(root, "#next", sceneDoorDiscovery));
      }, { once: true });
    });
  });
}

/* ٤ — باب الاكتشاف: غرفة مظلمة وضوة تنسحب */
function sceneDoorDiscovery(){
  ember(3);
  show(() => `
    ${doorHeader(1)}
    ${L("هاي الغرفة مظلمة…", "line--dim")}
    ${L("بس مو فارغة.")}
    <div class="darkroom" id="room">
      <button class="firefly" id="fly" aria-label="ضوة صغيرة"><i></i></button>
    </div>
    <p class="line line--dim" id="hint" style="--d:7s;font-size:14px">دوري على شي يلمع ✨</p>
  `, (root) => {
    const room = root.querySelector("#room");
    const fly = root.querySelector("#fly");
    let alive = true;

    // الضوة تتمشى بمسار عشوائي ناعم
    let x = 30 + Math.random() * 40, y = 25 + Math.random() * 40;
    let tx = x, ty = y;
    function wander(){
      if (!alive) return;
      tx = 12 + Math.random() * 76;
      ty = 10 + Math.random() * 78;
      setTimeout(wander, 2600 + Math.random() * 1800);
    }
    wander();
    (function step(){
      if (!alive) return;
      x += (tx - x) * .012; y += (ty - y) * .012;
      fly.style.left = x + "%";
      fly.style.top  = y + "%";
      requestAnimationFrame(step);
    })();

    fly.addEventListener("click", () => {
      alive = false;
      audio.blip(); buzz(25);
      fly.style.transition = "transform .7s ease, opacity .7s ease";
      fly.style.transform = "scale(3)";
      fly.style.opacity = "0";
      root.querySelector("#hint")?.remove();
      setTimeout(() => {
        room.outerHTML = `
          <div class="gap-m"></div>
          <p class="line" style="--d:.2s">لگيتيها 🙂</p>
          <p class="line" style="--d:1.2s;white-space:pre-line">${C.discoveryClue}</p>
          <button class="btn" id="next" style="--d:2.6s">الباب الثالث ←</button>`;
        on(root, "#next", sceneDoorHeart);
      }, 750);
    }, { once: true });
  });
}

/* ٥ — باب القلب */
function sceneDoorHeart(){
  ember(3);
  const q = C.heartDoor;
  show(() => `
    ${doorHeader(2)}
    ${L(q.question)}
    <div class="choices">
      ${q.options.map((o, i) =>
        `<button class="choice" data-i="${i}" style="--d:${1.4 + i * .25}s">${o.text}</button>`
      ).join("")}
    </div>
    <div id="resp"></div>
  `, (root) => {
    root.querySelectorAll(".choice").forEach(btn => {
      btn.addEventListener("click", () => {
        audio.blip();
        const opt = q.options[+btn.dataset.i];
        root.querySelectorAll(".choice").forEach(b => b.classList.add(b === btn ? "picked" : "faded"));
        btn.style.pointerEvents = "none";
        buzz(12);
        respond(root.querySelector("#resp"), `
          <p class="line" style="--d:.1s">${opt.response}</p>
          ${BTN("اطلعي من البواب ←", "next", "btn--primary", 1.3)}`,
          () => on(root, "#next", sceneShift));
      }, { once: true });
    });
  });
}

/* ٦ — التحوّل: السماء تصير نجوم، تلميحات */
function sceneShift(){
  ember(4);
  sky.seed("stars");
  show(() => `
    ${L("البواب الثلاثة انفتحت.", "line--big")}
    ${GAP("s")}
    ${L("هسه أگدر أگلچ شوية أشياء…", "line--dim")}
    ${L("افتحيهن وحدة وحدة:")}
    <div class="choices">
      ${C.clues.map((c, i) => `
        <div class="clue" data-i="${i}" style="--d:${2 + i * .3}s">
          <span class="clue-text">${c}</span>
          <span class="veil">دگّي حتى ينفتح ✦</span>
        </div>`).join("")}
    </div>
    <div id="go"></div>
  `, (root) => {
    let opened = 0;
    root.querySelectorAll(".clue").forEach(el => {
      el.addEventListener("click", () => {
        if (el.classList.contains("open")) return;
        audio.blip();
        el.classList.add("open");
        if (++opened === C.clues.length){
          root.querySelector("#go").innerHTML =
            BTN("خلص… أعتقد عرفت 😤", "next", "btn--primary", .8);
          on(root, "#next", sceneGuess);
        }
      });
    });
  });
}

/* ٧ — التخمين: التضليل */
function sceneGuess(){
  ember(5);
  const guesses = [
    { t: "🎁 هدية غالية",   r: "لا. يعني… اكو شي راح تاخذينه، بس مو «هدية» بالمعنى المعروف 🙂" },
    { t: "🌹 عشا رومنسي",  r: "العشا وارد 😌 بس هذا مو هو." },
    { t: "✈️ سفرة",        r: "سفرة؟ 😂 لا حبيبتي، مو سفرة. فكري بشي أقرب." },
    { t: "🎶 حفلة",        r: "همم… لا تستعجلين 😏 مو كل شي واضح من أول مرة." },
  ];
  show(() => `
    ${L("ها؟ شكلچ متأكدة من نفسچ 😏")}
    ${L("زين، خلي أشوف شگد تعرفيني:", "line--dim")}
    <div class="choices">
      ${guesses.map((g, i) => `<button class="choice" data-i="${i}" style="--d:${1.3 + i * .2}s">${g.t}</button>`).join("")}
    </div>
    <div id="resp"></div>
  `, (root) => {
    // تگدر تجرب أكثر من تخمين — كل تخمين إله رد
    root.querySelectorAll(".choice").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("picked")) return;
        audio.blip(); buzz(12);
        const g = guesses[+btn.dataset.i];
        root.querySelectorAll(".choice").forEach(b => b.classList.remove("picked"));
        btn.classList.add("picked");
        respond(root.querySelector("#resp"), `
          <p class="line" style="--d:.1s">${g.r}</p>
          ${BTN("خلص گلي!! 😤", "fake", "btn--primary", 1.3)}`,
          () => on(root, "#fake", sceneFakeEnd));
      });
    });
  });
}

/* ٨ — النهاية المزيفة */
function sceneFakeEnd(){
  show(() => `
    ${L("زين. تعبتي وياي 🙂")}
    ${L("خلاص، راح أگلچ هسه.", "line--big")}
    ${GAP("l")}
    ${BTN("گلي!", "tell", "btn--primary")}
  `, (root) => {
    on(root, "#tell", () => {
      const scene = root;
      scene.querySelector("#tell").disabled = true;
      scene.querySelector("#tell").textContent = "…";
      setTimeout(() => {
        scene.classList.add("flicker");
        setTimeout(() => {
          show(() => `
            ${L("لا.", "line--huge")}
            ${GAP("s")}
            ${L("بعدني ما خلصت 😌", "line--dim")}
            ${GAP("l")}
            ${BTN(`${C.myName}!!! 😤`, "grr", "btn--ghost")}
          `, (r2) => on(r2, "#grr", sceneLock));
        }, 900);
      }, 1400);
    });
  });
}

/* ٩ — القفل الأخير: كل شي يهدأ */
function sceneLock(){
  ember(6);
  show(() => `
    ${GAP("l")}
    ${L("آخر سؤال.", "line--huge", .8)}
    ${GAP("l")}
    ${L("إذا أختار إلچ ليلة وحدة، بس وحدة، من هالسنة كلها…", "", 3)}
    ${L("وأوعدچ إنها تبقى وياچ…", "", 4.4)}
    ${GAP("m")}
    ${L("توافقين تنطيني ياها؟", "line--big", 5.8)}
    ${GAP("l")}
    ${BTN("أوافق ❤️", "yes", "btn--love", 7.4)}
  `, (root) => on(root, "#yes", () => {
    // ومضة دافية قبل التعتيم — مثل فلاش كاميرا من بعيد
    buzz([30, 90, 30]);
    const flash = document.createElement("div");
    flash.id = "flash";
    document.body.appendChild(flash);
    requestAnimationFrame(() => flash.classList.add("on"));
    setTimeout(() => flash.remove(), 900);
    setTimeout(sceneReveal, 350);
  }));
}

/* ١٠ — الكشف */
function sceneReveal(){
  // تعتيم كامل
  const black = document.createElement("div");
  black.id = "blackout";
  document.body.appendChild(black);
  requestAnimationFrame(() => black.classList.add("on"));

  setTimeout(() => {
    $stage.innerHTML = "";
    ember(7);
    sky.seed("crowd");
    setBed("crowd");
    if (audio.on) audio.chordSwell();
    buzz([40, 120, 40, 120, 200]);
    // أعمدة ضوة المسرح
    if (!document.getElementById("beams")){
      const beams = document.createElement("div");
      beams.id = "beams";
      beams.innerHTML = "<i></i><i></i>";
      document.body.appendChild(beams);
      requestAnimationFrame(() => beams.classList.add("on"));
    }
    black.classList.remove("on");
    setTimeout(() => black.remove(), 1800);

    show(() => `
      ${GAP("l")}
      ${L("إذن…", "line--huge", 1.2)}
      ${GAP("m")}
      ${L("عندچ موعد.", "line--huge", 3.4)}
      ${GAP("m")}
      ${L(`مع ${C.concert.bandArabic} 🎸`, "line--huge line--glow", 5.8)}
      ${GAP("l")}
      ${BTN("شوفي التذكرة 🎟️", "tk", "btn--primary", 8)}
    `, (root) => on(root, "#tk", () => {
      // الأغنية المخصصة لازم تبدي بنفس لمسة الزر — آيفون يرفضها إذا تأخرت
      if (C.revealTrack && !sceneReveal.played){
        sceneReveal.played = true;
        const a = new Audio(C.revealTrack);
        a.volume = .8;
        a.play().catch(() => {});
      }
      sceneTicket();
    }));
  }, 2100);
}

/* ١١ — التذكرة */
function sceneTicket(){
  const k = C.concert;
  const extra = (k.extras || []).map(x =>
    `<div class="tk-cell"><div class="tk-label">${x.label}</div><div class="tk-value gold">${x.value}</div></div>`);
  show(() => `
    <div class="ticket-wrap" id="tw" style="--d:.3s">
      <div class="tk-flip" id="tkFlip">
        <div class="ticket tk-front" dir="ltr">
          <div class="tk-top">
            <div class="tk-eyebrow">ONE NIGHT ONLY</div>
            <div class="tk-band">${k.bandLatin}</div>
            <div class="tk-band-ar">${k.bandArabic}</div>
            <div class="tk-city">LIVE IN ${k.cityLatin}</div>
            ${k.taglineLatin ? `<div class="tk-tagline">${k.taglineLatin}</div>` : ""}
          </div>
          <div class="tk-perf"></div>
          <div class="tk-details">
            <div class="tk-cell"><div class="tk-label">DATE</div><div class="tk-value">${k.dateLatin}</div></div>
            <div class="tk-cell"><div class="tk-label">SHOW STARTS</div><div class="tk-value">${k.timeLatin}</div></div>
            ${extra.join("")}
            <div class="tk-cell wide"><div class="tk-label">ADMIT ONE</div>
              <div class="tk-value" dir="rtl">${k.dateDisplay} — ${k.timeDisplay}</div></div>
            <div class="tk-cell wide"><div class="tk-label">FOR</div>
              <div class="tk-for" dir="rtl">${k.holderName || C.herName} ❤</div></div>
          </div>
          <div class="tk-barcode"></div>
          <div class="tk-serial">${k.serial}</div>
        </div>
        <div class="ticket tk-back">
          <div class="tk-back-heart">🤍</div>
          <p class="tk-back-line">هاي مو بس تذكرة.<br>هاي أول ليلة من الليالي اللي<br>راح نحچي عنها بعد سنين.</p>
          <div class="tk-serial">${k.serial} · ${C.herName} ♡ ${C.myName}</div>
        </div>
      </div>
    </div>
    ${GAP("s")}
    ${L("دوسي عليها… إلها وجه ثاني 🙂", "line--dim", 2.4)}
    <p class="line countdown" id="cd" style="--d:3s"></p>
    <button class="btn btn--ghost" id="realTk" style="--d:3.3s;display:none">التذكرة الرسمية 📄</button>
    ${BTN("اكو شي بعد…", "more", "btn--ghost", 3.6)}
  `, (root) => {
    on(root, "#tw", () => { buzz(12); root.querySelector("#tkFlip").classList.toggle("flipped"); });
    on(root, "#more", sceneLetter);

    // صورة التذكرة الرسمية — الزر يظهر بس إذا الصورة فعلًا موجودة
    if (C.ticketPhoto){
      const probe = new Image();
      probe.onload = () => {
        const btn = root.querySelector("#realTk");
        if (!btn) return;
        btn.style.display = "";
        btn.addEventListener("click", () => {
          audio.blip();
          const ov = document.createElement("div");
          ov.className = "photo-overlay";
          ov.innerHTML = `<img src="${C.ticketPhoto}" alt="التذكرة الرسمية">
                          <span class="photo-hint">دوسي بأي مكان حتى ترجعين</span>`;
          ov.addEventListener("click", () => ov.remove());
          document.body.appendChild(ov);
        });
      };
      probe.src = C.ticketPhoto;
    }

    // عدّاد تنازلي حي (إذا محدد dateISO بالإعدادات)
    if (k.dateISO){
      const cd = root.querySelector("#cd");
      const target = new Date(k.dateISO).getTime();
      const fmt = (n) => n.toLocaleString("ar-EG");
      const tick = () => {
        if (!document.contains(cd)) return clearInterval(iv);
        const left = target - Date.now();
        if (left <= 0){ cd.textContent = "الليلة هي الليلة 🎶"; return clearInterval(iv); }
        const d = Math.floor(left / 864e5),
              h = Math.floor(left % 864e5 / 36e5),
              m = Math.floor(left % 36e5 / 6e4);
        cd.textContent = `باقي ${fmt(d)} يوم · ${fmt(h)} ساعة · ${fmt(m)} دقيقة`;
      };
      const iv = setInterval(tick, 1e4);
      tick();
    }
  });
}

/* ١٢ — الرسالة الأخيرة + الأغنية */
function sceneLetter(){
  const hasSong = C.song && C.song.youtubeId;
  show(() => `
    ${L("مني، إلچ:", "line--dim", .4)}
    ${hasSong ? `
      <div class="song-card" id="songCard" style="--d:1s">
        <span class="song-play">▶</span>
        <span class="song-meta">
          <b>${C.song.kicker}</b>
          <i>${C.song.title}</i>
        </span>
      </div>` : ""}
    ${GAP("m")}
    <p class="letter" style="--d:${hasSong ? 1.8 : 1.2}s">${C.finalMessage}</p>
    ${GAP("m")}
    <p class="letter-sign" style="--d:3.8s">— ${C.myName}</p>
    ${C.secret.enabled ? `<div class="gap-l"></div>${BTN("بعدچ ما خلصتي 👀", "egg", "btn--ghost", 7)}` : ""}
  `, (root) => {
    if (hasSong){
      on(root, "#songCard", () => {
        // تضمين الفيديو الرسمي من قناة كايروكي — يشتغل بلمستها (مسموح بالموبايل)
        const card = root.querySelector("#songCard");
        card.outerHTML = `
          <div class="song-frame" style="--d:0s">
            <iframe src="https://www.youtube-nocookie.com/embed/${C.song.youtubeId}?autoplay=1&playsinline=1&rel=0"
              title="${C.song.title}" frameborder="0"
              allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
          </div>`;
      });
    }
    if (C.secret.enabled) on(root, "#egg", sceneSecret);
  });
}

/* ١٣ — السر */
function sceneSecret(){
  show(() => `
    ${C.secret.photo ? `<img class="secret-photo" src="${C.secret.photo}" alt="" style="--d:.5s">` : ""}
    ${GAP("m")}
    <p class="letter" style="--d:${C.secret.photo ? 1.6 : .5}s">${C.secret.message}</p>
    ${GAP("l")}
    <button class="btn heart-btn" id="heart" style="--d:4.5s" aria-label="قلب">❤️</button>
    ${L("دوسي عالقلب", "line--dim", 5.3)}
  `, (root) => on(root, "#heart", sceneHearts));
}

/* ١٤ — الختام: مطر قلوب */
function sceneHearts(){
  sky.seed("hearts");
  buzz([20, 60, 20]);
  show(() => `
    ${GAP("l")}
    ${L(`أحبچ يا ${C.herName} ❤️`, "line--huge", 1)}
    ${GAP("m")}
    ${L("أشوفچ بالحفلة ✦", "line--dim", 2.8)}
  `);
}

/* انطلاق */
sceneSeal();

})();
