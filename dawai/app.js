/**
 * Dawai patient prototype — demo data only.
 * Tokens / copy rules: ../DAWAI_DESIGN_SYSTEM.md
 */

const state = {
  screen: "home",
  query: "",
  selectedMed: null,
  phase: "idle", // idle | searching | offers | held
  holdCode: null,
  holdPharmacy: null,
};

const MEDS = [
  { id: "aml", nameAr: "أملوديبين", nameLa: "Amlodipine 5mg", form: "أقراص" },
  { id: "met", nameAr: "ميتفورمين", nameLa: "Metformin 500mg", form: "أقراص" },
  { id: "ator", nameAr: "أتورفاستاتين", nameLa: "Atorvastatin 20mg", form: "أقراص" },
  { id: "vent", nameAr: "فنتولين", nameLa: "Salbutamol inhaler", form: "بخاخ" },
];

const PHARMACIES = [
  {
    id: "karrada",
    name: "صيدلية الكرادة المركزية",
    km: 1.2,
    eta: "12 دقيقة",
    reliability: "تلتزم بالحجز",
    verified: true,
    price: 4500,
    freshness: "تأكيد قبل 3 دقائق",
    match: "مطابق",
  },
  {
    id: "jadriya",
    name: "صيدلية الجادرية",
    km: 2.4,
    eta: "18 دقيقة",
    reliability: "تلتزم بالحجز",
    verified: true,
    price: 5000,
    freshness: "تأكيد قبل 8 دقائق",
    match: "مطابق",
  },
  {
    id: "mansour",
    name: "صيدلية المنصور الليلية",
    km: 4.1,
    eta: "28 دقيقة",
    reliability: "أحياناً تتأخر",
    verified: true,
    price: 4200,
    freshness: "تأكيد قبل 14 دقيقة",
    match: "جزئي — علبة أصغر",
  },
];

const MY_MEDS = [
  { nameAr: "أملوديبين", nameLa: "Amlodipine 5mg", next: "متبقي ≈ 6 أيام" },
  { nameAr: "ميتفورمين", nameLa: "Metformin 500mg", next: "متبقي ≈ 12 يوماً" },
];

const main = document.getElementById("main");
const tabs = [...document.querySelectorAll("[data-nav]")];

function bdi(text) {
  return `<bdi>${escapeHtml(text)}</bdi>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(n) {
  return `${n.toLocaleString("en-IQ")} د.ع`;
}

function setNav(screen) {
  tabs.forEach((t) => {
    const on = t.dataset.nav === screen;
    t.classList.toggle("is-active", on);
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
}

function go(screen, patch = {}) {
  Object.assign(state, patch, { screen });
  render();
}

function renderHome() {
  const active =
    state.phase === "held"
      ? `<div class="info-strip" role="status">
          <strong>طلبك محفوظ</strong>
          — اعرض رمز الحجز عند الاستلام من ${escapeHtml(state.holdPharmacy?.name ?? "الصيدلية")}.
        </div>`
      : state.phase === "searching"
        ? `<div class="pillbar pillbar--progress" role="status">
            <span class="live-dot" aria-hidden="true"></span>
            بانتظار الاتصال — نسأل الصيدليات القريبة الآن
          </div>`
        : state.phase === "offers"
          ? `<div class="pillbar pillbar--action" role="status">
              وصلت عروض — اختر صيدلية لحجز الدواء
            </div>`
          : `<div class="info-strip">
              <strong>هدفنا:</strong> تعرف أي صيدلية فيها دواءك وتحجزه — بدون أحد عشر اتصال.
            </div>`;

  return `
    <section class="screen" aria-labelledby="home-title">
      <div class="stack">
        <p class="eyebrow">اليوم · بغداد</p>
        <h1 id="home-title">مرحباً، حسين</h1>
        <p class="lede">لدواء والدتك أو لحاجتك أنت — ابدأ بالاسم، ونحن نسأل القريبين.</p>
      </div>
      ${active}
      <div class="stat-grid" aria-label="ملخص سريع">
        <div class="stat"><span>أدوية نشطة</span><strong>2</strong></div>
        <div class="stat"><span>حجوزات</span><strong>${state.phase === "held" ? "1" : "0"}</strong></div>
      </div>
      <div class="card stack">
        <h2>اطلب دواء بسرعة</h2>
        <p class="lede">ابحث بالاسم العربي أو اللاتيني. لا تشخيص ولا حساب جرعة.</p>
        <button type="button" class="btn btn--primary btn--block" data-action="to-search">ابحث عن دواء</button>
      </div>
      <div class="card stack">
        <h2>أدويتك القادمة</h2>
        ${MY_MEDS.map(
          (m) => `
          <div class="med-row">
            <div>
              <p><strong>${escapeHtml(m.nameAr)}</strong> · ${bdi(m.nameLa)}</p>
              <p class="sub">${escapeHtml(m.next)}</p>
            </div>
            <button type="button" class="btn btn--ghost" data-action="quick-med" data-id="${m.nameLa.startsWith("Aml") ? "aml" : "met"}">أعد الطلب</button>
          </div>`
        ).join("")}
      </div>
    </section>`;
}

function renderSearch() {
  const q = state.query.trim();
  const hits = q
    ? MEDS.filter(
        (m) =>
          m.nameAr.includes(q) ||
          m.nameLa.toLowerCase().includes(q.toLowerCase())
      )
    : MEDS;

  return `
    <section class="screen" aria-labelledby="search-title">
      <div class="stack">
        <p class="eyebrow">اطلب دواء</p>
        <h1 id="search-title">ما الدواء الذي تحتاجه؟</h1>
        <p class="lede">قرار واحد في هذه الشاشة: اختر الدواء. الصيدلي يقرر البديل إن لزم.</p>
      </div>
      <form class="search-box" id="search-form">
        <label for="med-q">اسم الدواء</label>
        <input id="med-q" name="q" type="search" enterkeyhint="search" autocomplete="off"
          placeholder="مثال: أملوديبين أو Amlodipine"
          value="${escapeHtml(state.query)}" />
      </form>
      <div class="chip-row" aria-label="اختصارات شائعة">
        ${MEDS.map(
          (m) =>
            `<button type="button" class="chip ${state.selectedMed === m.id ? "is-selected" : ""}" data-action="pick-med" data-id="${m.id}">${escapeHtml(m.nameAr)}</button>`
        ).join("")}
      </div>
      <div class="stack" role="list">
        ${
          hits.length
            ? hits
                .map(
                  (m) => `
            <article class="card pharmacy" role="listitem">
              <div class="pharmacy__head">
                <div>
                  <h2 class="pharmacy__name">${escapeHtml(m.nameAr)}</h2>
                  <div class="meta">${bdi(m.nameLa)} · ${escapeHtml(m.form)}</div>
                </div>
              </div>
              <button type="button" class="btn btn--primary btn--block" data-action="request" data-id="${m.id}">اطلب من صيدليات قريبة</button>
            </article>`
                )
                .join("")
            : `<div class="card empty"><p>لا يوجد في قائمتنا بعد. يمكنك رفع صورة العلبة لاحقاً — بدون ادعاء قراءة تلقائية.</p></div>`
        }
      </div>
    </section>`;
}

function renderWaiting() {
  const med = MEDS.find((m) => m.id === state.selectedMed);
  return `
    <section class="screen" aria-labelledby="wait-title" aria-live="polite">
      <div class="stack">
        <p class="eyebrow">بانتظار الاتصال</p>
        <h1 id="wait-title">نسأل الصيدليات القريبة</h1>
        <p class="lede">
          نبحث عن ${escapeHtml(med?.nameAr ?? "الدواء")}
          ${med ? `· ${bdi(med.nameLa)}` : ""}
          ضمن نطاق يزداد تدريجياً. الصمت ليس طمأنينة — سنخبرك إن تعذّر التحقق.
        </p>
      </div>
      <div class="pillbar pillbar--progress" role="status">
        <span class="live-dot" aria-hidden="true"></span>
        جارٍ السؤال · نطاق 2 كم ثم 5 كم
      </div>
      <div class="card card--quiet stack">
        <h2>ماذا يحدث الآن؟</h2>
        <p class="lede">الصيدليات الموثقة على دوائي ترى الطلب إن كانت ضمن النطاق وساعات العمل. لا نحجز حتى يقرّ الصيدلي.</p>
      </div>
      <button type="button" class="btn btn--ghost btn--block" data-action="cancel-wait">إلغاء الطلب</button>
    </section>`;
}

function renderOffers() {
  const med = MEDS.find((m) => m.id === state.selectedMed);
  return `
    <section class="screen" aria-labelledby="offers-title">
      <div class="stack">
        <p class="eyebrow">عروض متاحة</p>
        <h1 id="offers-title">صيدليات أكّدت التوفر</h1>
        <p class="lede">
          لـ ${escapeHtml(med?.nameAr ?? "الدواء")}
          ${med ? `· ${bdi(med.nameLa)}` : ""}.
          السعر قبل الالتزام. البديل لا يُحجز تلقائياً.
        </p>
      </div>
      <div class="pillbar pillbar--action" role="status">اختر عرضاً واحداً لطلب الحجز</div>
      <div class="stack">
        ${PHARMACIES.map(
          (p) => `
          <article class="card pharmacy">
            <div class="pharmacy__head">
              <div>
                <h2 class="pharmacy__name">${escapeHtml(p.name)}</h2>
                <div class="meta">
                  <span>${bdi(String(p.km))} كم · ${escapeHtml(p.eta)}</span>
                  <span>${escapeHtml(p.reliability)}</span>
                </div>
              </div>
              ${p.verified ? `<span class="badge">موثّقة على دوائي</span>` : ""}
            </div>
            <div class="offer">
              <div class="offer__price">${bdi(money(p.price))}</div>
              <div class="meta">
                <span>${escapeHtml(p.match)}</span>
                <span>${escapeHtml(p.freshness)}</span>
              </div>
              <button type="button" class="btn btn--primary btn--block" data-action="hold" data-id="${p.id}">اطلب الحجز هنا</button>
            </div>
          </article>`
        ).join("")}
      </div>
    </section>`;
}

function renderHold() {
  const med = MEDS.find((m) => m.id === state.selectedMed);
  const p = state.holdPharmacy;
  return `
    <section class="screen" aria-labelledby="hold-title">
      <div class="stack">
        <p class="eyebrow">حجز مؤكد</p>
        <h1 id="hold-title">اعرض هذا الرمز عند الاستلام</h1>
        <p class="lede">${escapeHtml(p?.name ?? "")} · ${escapeHtml(med?.nameAr ?? "")}</p>
      </div>
      <div class="code-panel" aria-label="رمز الحجز">
        <p class="label">رمز الحجز</p>
        <p class="code" lang="en">${escapeHtml(state.holdCode)}</p>
        <p class="hint">لا تشارك الرمز إلا عند الاستلام من الصيدلية. الحجز يثبت بعد إقرار الصيدلي — وهذا ما حدث.</p>
      </div>
      <div class="card stack">
        <h2>التفاصيل</h2>
        <div class="meta">
          <span>المسافة ${bdi(String(p?.km ?? "—"))} كم</span>
          <span>الوصول تقريباً ${escapeHtml(p?.eta ?? "—")}</span>
          <span>السعر ${bdi(money(p?.price ?? 0))}</span>
        </div>
        <div class="btn-row">
          <a class="btn btn--primary btn--block" href="https://maps.google.com/?q=Baghdad" target="_blank" rel="noopener noreferrer">الاتجاهات</a>
          <button type="button" class="btn btn--ghost btn--block" data-action="done-hold">حسناً، فهمت</button>
        </div>
      </div>
    </section>`;
}

function renderHolds() {
  if (state.phase !== "held") {
    return `
      <section class="screen" aria-labelledby="holds-title">
        <div class="stack">
          <p class="eyebrow">حجوزاتي</p>
          <h1 id="holds-title">لا حجوزات نشطة</h1>
          <p class="lede">عندما تؤكد صيدلية الحجز، يظهر الرمز هنا.</p>
        </div>
        <div class="card empty">
          <p>ابدأ بطلب دواء من صيدليات قريبة.</p>
          <button type="button" class="btn btn--primary" data-action="to-search">اطلب دواء</button>
        </div>
      </section>`;
  }
  return renderHold();
}

function renderMeds() {
  return `
    <section class="screen" aria-labelledby="meds-title">
      <div class="stack">
        <p class="eyebrow">أدويتي</p>
        <h1 id="meds-title">السجل للدواء، لا للسوق</h1>
        <p class="lede">السجل ملكك. نعرض ما صُرف وما هو نشط — دون تعديل أحداث الجرعة بعد تسجيلها.</p>
      </div>
      <div class="stack">
        ${MY_MEDS.map(
          (m) => `
          <article class="card med-row">
            <div>
              <p><strong>${escapeHtml(m.nameAr)}</strong></p>
              <p class="sub">${bdi(m.nameLa)} · ${escapeHtml(m.next)}</p>
            </div>
          </article>`
        ).join("")}
      </div>
      <div class="pillbar pillbar--progress" role="note">لا تشخيص · لا حساب جرعة · البديل قرار الصيدلي</div>
    </section>`;
}

function render() {
  const map = {
    home: renderHome,
    search: renderSearch,
    waiting: renderWaiting,
    offers: renderOffers,
    hold: renderHold,
    holds: renderHolds,
    meds: renderMeds,
  };
  const navKey =
    state.screen === "waiting" || state.screen === "offers" || state.screen === "hold"
      ? "search"
      : state.screen === "holds"
        ? "holds"
        : state.screen;
  setNav(["home", "search", "holds", "meds"].includes(navKey) ? navKey : "home");
  main.innerHTML = (map[state.screen] || renderHome)();
  main.focus({ preventScroll: true });
}

tabs.forEach((t) => {
  t.addEventListener("click", () => {
    const id = t.dataset.nav;
    if (id === "home") go("home");
    else if (id === "search") go("search");
    else if (id === "holds") go("holds");
    else if (id === "meds") go("meds");
  });
});

main.addEventListener("input", (e) => {
  if (e.target.id === "med-q") {
    state.query = e.target.value;
    const active = document.activeElement;
    const start = active?.selectionStart;
    render();
    const input = document.getElementById("med-q");
    if (input) {
      input.focus();
      if (typeof start === "number") input.setSelectionRange(start, start);
    }
  }
});

main.addEventListener("submit", (e) => {
  if (e.target.id === "search-form") {
    e.preventDefault();
    state.query = new FormData(e.target).get("q")?.toString() ?? "";
    render();
  }
});

main.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "to-search") go("search");
  if (action === "pick-med") {
    state.selectedMed = id;
    state.query = MEDS.find((m) => m.id === id)?.nameAr ?? state.query;
    render();
  }
  if (action === "quick-med") {
    state.selectedMed = id;
    go("search", { query: MEDS.find((m) => m.id === id)?.nameAr ?? "" });
  }
  if (action === "request") {
    state.selectedMed = id;
    state.phase = "searching";
    go("waiting");
    window.setTimeout(() => {
      if (state.phase === "searching") {
        state.phase = "offers";
        go("offers");
      }
    }, 2200);
  }
  if (action === "cancel-wait") {
    state.phase = "idle";
    go("search");
  }
  if (action === "hold") {
    const pharmacy = PHARMACIES.find((p) => p.id === id);
    state.holdPharmacy = pharmacy;
    state.holdCode = "482917";
    state.phase = "held";
    go("hold");
  }
  if (action === "done-hold") go("home");
});

document.getElementById("btn-profile")?.addEventListener("click", () => {
  go("meds");
});

render();
