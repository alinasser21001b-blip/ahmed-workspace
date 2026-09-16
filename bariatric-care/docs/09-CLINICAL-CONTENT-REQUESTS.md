# 09 — Clinical Content Requests · طلبات المحتوى الطبي

**Every item on this page is `[MEDICAL REVIEW REQUIRED]` and is currently EMPTY.**

Nothing here has been filled in with a plausible-looking value, and nothing will be. An
invented post-operative diet progression or symptom threshold would look correct and could
cause harm — it is the single most dangerous thing that could happen in this project.

كل عنصر في هذه الصفحة فارغ عمداً. لن أخترع أي بروتوكول طبي. أنت المسؤول عن اعتماد كل
محتوى طبي، وأنا أبني المحرّك فقط.

---

## How to use this document

1. Fill in a section. Partial is fine — one procedure, one pathway is enough to start.
2. Sign it: approver name and date. That becomes the approval record the system stores.
3. It becomes versioned data in the content store — **never a string in source code.**
4. Changing it later creates a **new version**. Patients stay pinned to the version in
   force when they were enrolled, so historical records remain interpretable.

**Priority order.** CC-1, CC-2 and CC-8 block the most milestones. Start there. A small,
approved set beats a complete, unapproved one.

---

## CC-1 — Procedures · العمليات
**Blocks:** M2 · **Priority: High**

Which procedures does the clinic perform, and do any have different post-operative
pathways?

| Procedure name (EN) | Name (AR) | Different pathway? | Notes |
| --- | --- | --- | --- |
| _(empty)_ | | | |

Examples appeared in the handoff (Sleeve Gastrectomy, RYGB, OAGB/MGB) but the handoff
states explicitly that the list is not final. The system treats procedures as
configuration; it will not assume any list.

---

## CC-2 — Post-operative pathway and diet phases · المراحل بعد العملية
**Blocks:** M6 · **Priority: High — longest lead time in the project**

For **each** procedure:

| Stage # | Name (EN) | Name (AR) | Starts (day) | Ends (day) | Allowed | Avoid | Transition criteria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _(empty)_ | | | | | | | |

Also required per stage:
- Patient tasks for this stage
- Educational content shown
- Required check-ins and their frequency
- Which rules (CC-5) are active during this stage

**Do the stage boundaries depend on anything other than days since surgery** — tolerance,
clinical assessment, a clinician's manual advance? This changes the engine's design, so it
is needed before M6 is planned.

---

## CC-3 — Follow-up schedule · جدول المتابعة
**Blocks:** M4 · **Priority: High**

| Visit | Timing after surgery | Window (± days) | Required? | What happens at this visit |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

And the definitions the follow-up queue depends on:
- At what point is a follow-up **overdue**?
- At what point is a patient considered **lost to follow-up**?
- At what point is a patient **inactive**?
- Do these differ by procedure or by time since surgery?

---

## CC-4 — Symptoms and check-ins · الأعراض
**Blocks:** M7 · **Priority: High**

| Symptom (EN) | Symptom (AR) | Answer type | Scale / options | Which stages |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

Plus:
- The exact Arabic wording of the question as the patient reads it
- Whether free text is allowed (I recommend not, in MVP — see Q7)

---

## CC-5 — Red-flag rules · قواعد الإنذار
**Blocks:** M7 · **Priority: High · Highest risk item in the project**

Recommendation: **three to five rules for MVP**, not thirty. Each must be unambiguous,
and each must ship with its test cases (§57).

For each rule:

| Field | Value |
| --- | --- |
| Rule ID | _(empty)_ |
| Version | _(empty)_ |
| Condition (precise, testable) | _(empty)_ |
| Applies to which procedures / stages | _(empty)_ |
| Severity level | _(empty)_ |
| Routes to which queue | _(empty)_ |
| Expected response window | _(empty)_ |
| Message the **patient** sees | _(empty)_ |
| Message the **clinician** sees | _(empty)_ |
| Approved by / date | _(empty)_ |

**Test cases (required — a rule without these does not ship):**

| Case | Input | Expected |
| --- | --- | --- |
| At threshold | | |
| Just below threshold | | |
| Just above threshold | | |
| Missing data | | |
| Stale data | | |
| Duplicate submission | | |

**Constraints the engine enforces regardless of content:** no rule message states or
implies a diagnosis; no rule produces an "all clear"; every rule routes to a human.

---

## CC-6 — Alert levels · مستويات الإنذار
**Blocks:** M7

| Level | Name (EN) | Name (AR) | Definition | Owning role | Response window |
| --- | --- | --- | --- | --- | --- |
| _(empty)_ | | | | | |

The handoff suggested informational / attention required / high priority, and also said
classification must be configurable. Both are respected: these are data, not code.

---

## CC-7 — Response windows and emergency wording · أوقات الاستجابة وحالات الطوارئ
**Blocks:** M7 · **Priority: High — safety-critical**

This is what prevents the product from implying monitoring it does not provide.

- Clinic working hours: _(empty)_
- Expected review time for a submitted symptom during hours: _(empty)_
- Expected review time outside hours: _(empty)_
- **Exact Arabic sentence shown to the patient at submission** (must state the window
  honestly): _(empty)_
- **Exact Arabic emergency instruction** — where to go, who to call: _(empty)_

---

## CC-8 — Patient intake fields · بيانات المريض عند التسجيل
**Blocks:** M2 · **Priority: High**

| Field | Required? | Type | Options | Who may see it |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

Areas named in the handoff, none assumed: medical history, surgical history, medications,
allergies, comorbidities, height, weight, previous weight-loss attempts, smoking,
lifestyle. **Which of these are actually captured, and which are required, is a clinical
decision.**

---

## CC-9 — Weight-loss metrics · مقاييس فقدان الوزن
**Blocks:** M3

- Is %TWL used? Which formula exactly?
- Is %EWL used? Which formula, and on which ideal-body-weight basis?
- Which BMI classification is displayed, if any?
- What is shown to the **patient** versus to the **clinician**?

Competing formulas exist and the choice is clinical, not arithmetic. I will implement
whichever is approved, with the formula recorded and versioned, and I will not pick one.

---

## CC-10 — Nutrition targets · أهداف التغذية
**Blocks:** M6 (Phase 2 for the full module)

| Stage | Protein target | Fluid target | Calories tracked? | Other |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

- Do targets vary by patient (weight, sex, procedure)? By what rule?
- Is calorie tracking used at all, or deliberately avoided?

---

## CC-11 — Supplements · المكملات
**Blocks:** M6

| Supplement | Dose | Frequency | Starts | Duration | Which procedures |
| --- | --- | --- | --- | --- | --- |
| _(empty)_ | | | | | |

---

## CC-12 — Medications · الأدوية
**Blocks:** M6 (Phase 2 for the full module)

The system is **not** a prescribing engine. Required:
- What may the patient see, and what may they edit (I expect: nothing clinical)?
- Who may change a medication record?
- What does the patient see if their provider changes something?

---

## CC-13 — Labs · التحاليل
**Blocks:** M8 (Phase 2 for the full module)

| Test | Unit | Reference low | Reference high | Schedule after surgery |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

**The system will not interpret results autonomously.** Clinician-facing abnormal-value
highlighting is possible in a later phase, only within approved rules.

---

## CC-14 — Pre-operative checklist · قائمة ما قبل العملية
**Blocks:** Phase 2

| Item | Category | Required? | Which procedures | Order |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

---

## CC-15 — Patient-facing copy · النصوص التي يقرأها المريض
**Blocks:** M5 · **Priority: High**

Every sentence a patient reads about their health, in Arabic, approved by you.

| Screen / context | Arabic text | Approved |
| --- | --- | --- |
| Welcome / onboarding | _(empty)_ | ☐ |
| Consent | _(empty)_ | ☐ |
| Medical disclaimer | _(empty)_ | ☐ |
| Symptom submission confirmation | _(empty)_ | ☐ |
| Emergency instruction | _(empty)_ | ☐ |
| How to reach the clinic | _(empty)_ | ☐ |
| Task reminders | _(empty)_ | ☐ |
| Missed-task follow-up | _(empty)_ | ☐ |

I can draft Arabic text for you to edit. **Drafting is not approving**, and I cannot judge
whether a sentence lands correctly for a 55-year-old patient in Baghdad. That needs your
ear, and ideally a native UX reviewer's.

---

## CC-16 — Notification content · نصوص الإشعارات
**Blocks:** M6

| Notification | Arabic text | Send time | Max frequency | Category |
| --- | --- | --- | --- | --- |
| _(empty)_ | | | | |

**Constraint enforced by the system regardless of content (§79):** no notification payload
may contain clinical detail, because it appears on a lock screen. Generic wording that
prompts the patient to open the app.

---

## CC-17 — Educational content · المحتوى التثقيفي
**Blocks:** M8

| Title | Type | Procedure | Stage | Language | Source |
| --- | --- | --- | --- | --- | --- |
| _(empty)_ | | | | | |

Copyright matters: content must be authored by the clinic or properly licensed.

---

## CC-18 — Role permissions · صلاحيات الأدوار
**Blocks:** M1 · **Priority: High**

What may each role actually see and do **in your clinic**? Organisational, not technical.

| Capability | Patient | Surgeon | Dietitian | Nurse / Coordinator | Clinic Admin |
| --- | --- | --- | --- | --- | --- |
| View own record | ☐ | | | | |
| View any patient in clinic | | ☐ | ☐ | ☐ | ☐ |
| View surgical notes | | ☐ | ☐ | ☐ | ☐ |
| View nutrition data | ☐ | ☐ | ☐ | ☐ | ☐ |
| View labs | ☐ | ☐ | ☐ | ☐ | ☐ |
| Enter measurements | ☐ | ☐ | ☐ | ☐ | ☐ |
| Edit medications | | ☐ | ☐ | ☐ | ☐ |
| Acknowledge alerts | | ☐ | ☐ | ☐ | ☐ |
| Edit protocol config | | ☐ | ☐ | ☐ | ☐ |
| Manage users | | ☐ | ☐ | ☐ | ☐ |
| Export data | | ☐ | ☐ | ☐ | ☐ |

Tick what each role may do. Where you are unsure, the safe default is **no**, and it can
be widened later — the reverse is a breach.

---

## Approval log

| Section | Approved by | Date | Version | Notes |
| --- | --- | --- | --- | --- |
| _(none yet)_ | | | | |
