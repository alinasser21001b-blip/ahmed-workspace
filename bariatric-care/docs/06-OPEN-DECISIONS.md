# 06 — Open Decisions / القرارات المطلوبة (PART 12)

Only the questions that genuinely block an architecture or scope decision. Anything I
could reasonably derive from engineering judgement is not here.

**Each question carries my recommendation.** If you agree, answer "agreed" and we move.
Write a different answer only where you disagree or know something I do not.

أسئلة تمنعني فعلاً من اتخاذ قرار معماري أو قرار Scope. لكل سؤال توصيتي — إذا كنت موافقاً
اكتب "موافق" ونكمل.

---

## Blocking Milestone 0–1 (architecture)

### Q1 — Patient authentication method · طريقة دخول المريض
**EN:** Phone+OTP fits Iraqi patient behaviour but has real per-message cost and
deliverability problems across carriers. Password-only is cheap but a recovery nightmare
for low-digital-literacy users with no email.

**AR:** ما طريقة دخول المريض؟ رقم الهاتف مع OTP هو الأنسب لسلوك المريض العراقي، لكن كلفة
الرسائل وموثوقية وصولها عبر الشبكات مشكلة حقيقية. الباسوورد رخيص لكن استرجاعه صعب جداً
لمريض كبير بالعمر بدون إيميل.

**My recommendation:** **Clinic-assisted enrolment as the primary path** — the coordinator
verifies the patient's identity at the desk and issues a one-time invitation code; the
patient sets a PIN/password in the app on the spot. OTP is used only for device re-binding
and recovery, which is a fraction of the message volume. This removes OTP from the
critical signup path, cuts cost dramatically, and matches how the clinic already works.

**Blocks:** identity module design (M1), cost model.

---

### Q2 — Is WhatsApp a supported channel? · هل واتساب قناة رسمية؟
**EN:** Probably the highest-leverage decision in the project. Iraqi patients live on
WhatsApp; push notifications on old Android are unreliable. WhatsApp Business API requires
business verification, has per-conversation cost, and constrains message templates.

**AR:** أهم قرار تقريباً. المريض العراقي موجود على واتساب، والإشعارات push غير موثوقة على
أندرويد القديم. لكن WhatsApp Business API يحتاج توثيق تجاري وله كلفة وقوالب رسائل محددة.

**My recommendation:** **Push-only in MVP, with the notification layer designed
channel-agnostic from day one** so WhatsApp can be added in Phase 2 without rework. Start
the business verification process now, in parallel — it has a long lead time. Do not build
the integration until the pilot tells us push reach is genuinely inadequate.

**Blocks:** notification architecture (M6), cost model.

---

### Q3 — Hosting region and data residency · مكان استضافة البيانات
**EN:** Does any law, contract, or hospital policy require patient data to remain inside
Iraq? I do not know Iraqi law and will not guess.

**AR:** هل يوجد قانون أو عقد أو سياسة تفرض بقاء بيانات المرضى داخل العراق؟ أنا لا أعرف
القانون العراقي ولن أخمّن.

**My recommendation:** Ask the legal reviewer this specific question early. Until
answered, I will design so the answer is cheap to honour: containerised application,
standard PostgreSQL, S3-compatible storage, no proprietary primitives in domain code.
Default assumption if no requirement exists: a European region (Frankfurt) for latency and
provider maturity.

**Blocks:** hosting provider choice (M0), privacy policy.

---

### Q4 — Who is the legal data controller? · من هو المسؤول القانوني عن البيانات؟
**EN:** The surgeon personally, a registered clinic entity, or a company? This determines
who signs provider contracts, who owns the data, whose name appears in the privacy policy
and on the App Store listing.

**AR:** الطبيب شخصياً، أم كيان العيادة المسجل، أم شركة؟ هذا يحدد من يوقّع عقود الخدمات،
ومن يملك البيانات، واسم من يظهر في سياسة الخصوصية وفي App Store.

**My recommendation:** A registered entity rather than an individual, if one exists or can
be created. It separates personal and professional liability, is required for an
organisation-type Apple account, and is necessary for any future SaaS sale.

**Blocks:** privacy policy, store account type, provider contracts.

---

### Q5 — Tenancy posture for v1 · بنية تعدد العيادات
**EN:** My proposal: `clinic_id` on every row from the first migration (cheap now,
impossible to retrofit), but a single deployment, one clinic, no tenant routing, no
configuration portal.

**AR:** اقتراحي: `clinic_id` في كل جدول من أول migration — رخيص الآن ومستحيل إضافته
لاحقاً — لكن مع deployment واحد وعيادة واحدة، بدون تعقيد multi-tenant.

**My recommendation:** As stated. Confirm.

**Blocks:** data model (M0).

---

## Blocking scope

### Q6 — Dashboard first, or patient app first? · نبدأ بالـDashboard أم بتطبيق المريض؟
**EN:** I recommend dashboard-first, argued in
[`05-MVP-AND-ROADMAP.md`](./05-MVP-AND-ROADMAP.md) §8.5: the clinic gets value at zero
patient adoption, the largest unknown is de-risked, and the App Store leaves the critical
path.

**AR:** أوصي بالبدء بالـDashboard. السبب في المستند أعلاه: العيادة تستفيد حتى لو لم
يستخدم أي مريض التطبيق، ونتجنب أن يكون App Store على المسار الحرج.

**My recommendation:** Dashboard first. Tell me if a commitment or launch event makes this
impossible.

**Blocks:** milestone order.

---

### Q7 — Is messaging in MVP? · هل المراسلة ضمن الـMVP؟
**EN:** Messaging creates an expectation of a reply and an implied duty of care the clinic
is not staffed for.

**AR:** المراسلة تخلق توقعاً بالرد ومسؤولية ضمنية لا تستطيع العيادة تغطيتها الآن.

**My recommendation:** **No.** Instead ship a "how to reach the clinic" screen with phone
/ WhatsApp, clinic hours, and a clear emergency instruction. Revisit in Phase 2 with a
defined response SLA and a named owner.

**Blocks:** MVP scope.

---

### Q8 — Is there an existing patient database to migrate? · هل توجد قاعدة بيانات مرضى حالية؟
**EN:** Paper records, Excel, an existing system? Rough volume? This changes Milestone 2
substantially and may add a whole migration workstream.

**AR:** سجلات ورقية، Excel، أم نظام موجود؟ كم العدد تقريباً؟ يغيّر Milestone 2 كثيراً.

**My recommendation:** If the answer is "thousands of historical records", do **not**
migrate them for MVP. Start with new patients and import history later, selectively. A
migration at the start doubles the risk of the riskiest phase.

**Blocks:** M2 scope.

---

### Q9 — Pilot size, timing and who selects the patients · حجم وتوقيت التجربة الأولية
**EN:** How many patients, when, and who chooses them?

**AR:** كم مريض، متى، ومن يختارهم؟

**My recommendation (revised — doc 12 §8.13):** two stages, because selecting patients for
engagement likelihood and then measuring engagement produces a number that means nothing.
**Stage 1, friendly alpha:** 5–10 patients you hand-pick, after Milestone 9, 2–3 weeks, to
find UX and workflow problems. Measures nothing. **Stage 2, representative mini-pilot:** 15–25
**consecutively enrolled, unselected** patients, 4 weeks, where engagement and every other KPI
is actually measured.

**Blocks:** M10 planning.

---

## Blocking launch (decide early — long lead times)

### Q10 — Apple Developer account · حساب Apple Developer
**EN:** Do you have one? Individual or organisation? Health apps under an individual
account draw more review scrutiny, and the account holder's name appears publicly.
Enrolment can take weeks.

**AR:** هل لديك حساب؟ فردي أم شركة؟ التطبيقات الصحية تحت حساب فردي تخضع لتدقيق أكثر، واسم
صاحب الحساب يظهر للعامة. التسجيل قد يستغرق أسابيع.

**My recommendation:** Organisation account, tied to the entity from Q4. **Start enrolment
during Milestone 0** — it is on the critical path and costs nothing to start early.

**Blocks:** M11.

---

### Q11 — Monthly infrastructure budget ceiling · سقف الكلفة الشهرية
**EN:** Not for pricing the clinic — for choosing infrastructure. A $30/month ceiling and
a $300/month ceiling lead to different, both-defensible architectures.

**AR:** ليس لتسعير العيادة، بل لاختيار البنية التحتية. سقف 30 دولار وسقف 300 دولار
يعطيان معمارية مختلفة، وكلاهما صحيح.

**My recommendation:** Tell me the ceiling and I will design to it. See
[`07-COST-DRIVERS.md`](./07-COST-DRIVERS.md) for what actually drives cost. The variable
that dominates everything else is per-message cost if SMS/WhatsApp is chosen.

**Blocks:** hosting choice (M0).

---

### Q12 — Clinic identity and branding · هوية العيادة
**EN:** Clinic name, app name, logo, colours, domain. Also: is the product named after the
surgeon? That is a reasonable choice for v1 and a problem for a multi-clinic SaaS later.

**AR:** اسم العيادة، اسم التطبيق، الشعار، الألوان، الدومين. وأيضاً: هل المنتج باسم الطبيب؟
قرار منطقي للنسخة الأولى لكنه يصبح مشكلة عند التحول إلى SaaS.

**My recommendation:** A **product name distinct from the surgeon's name**, with the
clinic's identity applied as configuration (logo, colours, clinic name). Costs nothing now
and preserves the Phase 3 option entirely.

**Blocks:** branding config, store listing, domain.

---

## Also needed, but not blocking architecture

Start these in parallel — they have long lead times and do not block Milestone 0:

- All clinical content — see [`09-CLINICAL-CONTENT-REQUESTS.md`](./09-CLINICAL-CONTENT-REQUESTS.md)
- Who the legal reviewer will be, and when they are engaged
- Who the retained part-time engineer will be
- Names and roles of the actual clinic staff who will use the dashboard
- Whether there is a hard launch date, and what is driving it

---

## Answer log

Record answers here as they are decided, with the date. This becomes the source of truth
(§65) and each architectural answer becomes an ADR.

**What each question actually blocks** — revised per doc 12 §"Q1–Q12 reclassified". An earlier
version of the checklist claimed all twelve block Milestone 1; they do not.

| # | Decision | Blocks | Answer | Date | ADR |
| --- | --- | --- | --- | --- | --- |
| Q1 | Patient auth method | **Architecture / M1** | _pending_ | | |
| Q2 | WhatsApp channel | M6 | _pending_ | | |
| Q3 | Hosting / residency | **M0** provisioning | _pending_ | | |
| Q4 | Legal data controller | **M0** contracts | _pending_ | | |
| Q5 | Tenancy posture | **Architecture / M1** | _pending_ | | |
| Q6 | Dashboard-first | M2 | _pending_ | | |
| Q7 | Messaging in MVP | Phase 2 | _pending_ | | |
| Q8 | Existing data migration | M2 | _pending_ | | |
| Q9 | Pilot plan | Pilot (M10) | _pending_ | | |
| Q10 | Apple account | Launch (M11) | _pending_ | | |
| Q11 | Budget ceiling | **M0** tier | _pending_ | | |
| Q12 | Branding | M5 | _pending_ | | |
