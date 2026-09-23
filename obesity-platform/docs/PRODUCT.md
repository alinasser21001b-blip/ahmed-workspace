# Product definition: Obesity & Healthy Lifestyle Platform (Beta)

> **Canonical.** Frozen at P0 on 2026-09-23 from the
> [physician handoff](source/2026-09-product-truth-handoff.md). Code, design and
> review follow this file. Changes are made only by closing or adding an entry
> in [DECISIONS.md](../DECISIONS.md), in the same commit.

Every statement below carries a tag showing where it comes from. The handoff
exists to keep these apart, so the tags matter.

| Tag | Meaning | Can we change it? |
| --- | --- | --- |
| **`PHY`** | The physician asked for it (handoff §2) | Only the physician can |
| **`INT`** | Our interpretation of the physician's intent. Not confirmed by the physician | Yes, but check it with the physician first |
| **`DEC`** | Decided without waiting (handoff §10, DECISIONS A-xx) | Yes, with a new entry in DECISIONS.md |
| **`OPEN`** | Unresolved. A safe default ships behind a flag | Only its owner can close it (D-xx) |

## 1. The product in one sentence

Build the smallest complete version of the physician's actual product: a
**free, patient-first obesity and healthy-lifestyle app**, with **structured
specialist follow-up** and **curated nearby partners**. Do not let old
bariatric-only assumptions, weak UI or unresolved decisions drive the
implementation.

## 2. What the physician asked for (`PHY`)

- A **free** patient-facing product for people with overweight or obesity, not
  only for post-operative bariatric patients.
- **Five areas:** Main (weight, BMI, details) · Health Profile · "Your health
  now" · Follow-up · Nearby healthy-lifestyle places.
- A **follow-up service** with obesity-focused specialists, such as
  nutritionists and doctors.
- **Gyms, healthy restaurants, cafés** and similar places, shown clearly and
  preferably on a map.
- The business can **partner with those places** and surface them in the app.
- The vision is **larger than a bariatric post-operative follow-up system**.

## 3. Product shape: three engines (`INT`)

| Engine | Contains | Priority |
| --- | --- | --- |
| **A. Free Health** | Weight, BMI, progress, Health Profile, Health Now check-ins, day-to-day tracking. Education only once it is approved (`OPEN` D-07) | P1 |
| **B. Medical Follow-up** | Request, assignment, specialists, appointments, goals, tasks, plans, measurements, progress, provider workflow | P2, P3 |
| **C. Healthy Lifestyle / Nearby** | Curated partner gyms, restaurants and cafés: map and list, details, directions, offers | P4 |

A patient gets value from **A** and **C** without ever joining **B**. **B**
sits on top of **A** as an ongoing care relationship (`DEC` A-10); it is not a
separate app.

## 4. Patient surfaces

The physician's five areas map to our five surfaces as follows. The grouping
is `INT` and still needs the physician's confirmation (`OPEN` D-15).

| Our surface | Physician's area | What it is |
| --- | --- | --- |
| **Today / Home** | Main (weight/BMI) `PHY` | Current weight, BMI and progress, a few relevant actions, and Follow-up status or the next appointment. It must feel like a consumer app, not a clinical dashboard. |
| **My Health** | Health Profile + Your health now `PHY`. Grouping and Progress are `INT` | Three separate ideas that must not blur together. **Health Now** is the patient's changing state. **Progress** is trends over time. **Health Profile** is long-term information. |
| **Follow-up** | Follow-up `PHY` | A program or case, not a booking page: patient → specialist → case → plan, goals and tasks → next review → progress and outcome. |
| **Nearby** | Nearby places `PHY` | A curated map and list of partner places with details. Discovery only (`DEC` A-09). |
| **Me** | none (`INT`) | Account, language, privacy, settings, support, account controls. |

Constraints that apply to every patient surface:

- `DEC` A-03: never assume surgery. A bariatric episode is optional.
- `DEC` A-12: the free core shows measurements and trends. It never recommends
  a target weight, rate of loss, calories or medication.
- `OPEN` D-11: BMI is shown as a number and a trend, with no category label
  until the physician approves thresholds and wording.
- `OPEN` D-03 / D-04: Health Profile and Health Now fields come from a
  physician-approved catalogue. No fields are made up.
- `OPEN` D-13: no symptom capture until the physician approves the symptom
  list and the response text.

## 5. Provider and admin side (`INT`)

The physician asked for specialist follow-up. A provider dashboard is our
inference of what that needs, because Follow-up cannot work from the patient
side alone.

- **Home is Today / Action Center:** who needs attention, why, who owns it,
  what happens next, and whether it is closed.
- **Workflow:** patient roster, follow-up queue, appointments, patient
  overview, measurements, Health Profile, current health, plans and tasks.
- **Admin:** manages specialists and partner places without a mobile release.
- `DEC` A-08: every provider action goes through central authorization and
  SQL-level patient scoping. A provider sees only the patients on cases they
  are assigned to (`OPEN` D-14 decides what is shared, D-17 decides who may do
  what).

## 6. What changed from the old concept

| Old framing | Current framing |
| --- | --- |
| Bariatric clinic operating system | Patient-first obesity & healthy-lifestyle platform |
| The clinic enrols the patient first | Patients can sign up directly. Follow-up can be activated later (`OPEN` D-01, D-06) |
| The dashboard defines the product | The patient app is a core surface. The dashboard supports follow-up operations |
| Surgery-centric pathway | Non-surgical care by default, with optional bariatric episodes |
| Follow-up as clinic workflow | Follow-up as an ongoing care relationship on top of the free app |
| No consumer discovery layer | The Nearby partner map is its own value proposition |

## 7. Build order

Build complete vertical journeys one at a time, not layers across the whole
product. A phase is done when its journey works end to end through the API,
database, UI and permissions. A screen existing does not make it done.

| Phase | Journey | Done when |
| --- | --- | --- |
| **P0** Product truth freeze | This file and DECISIONS.md | Every P1 row in the [blocking decisions](../DECISIONS.md#blocking-decisions-in-build-order) table has an answer or an accepted safe default |
| **P1** Free patient core | Onboarding → height and weight → Home → weight history and progress → Health Profile → Health Now | A new patient reaches a useful Home without joining Follow-up. Weight is saved and shown as meaningful progress. Health Profile and Health Now are clearly different |
| **P2** Follow-up core | Request → assignment → specialist action → appointment → care plan and tasks → patient sees the next step | The patient can see assignment, appointment, plan, tasks and next step |
| **P3** Provider Action Center | Today queue, patient overview, ownership, next action, closure, overdue handling | An authorized provider can run Follow-up without seeing other patients. Ownership and next action are obvious |
| **P4** Nearby / partners | Map, list and detail, plus admin management | Curated discovery works with location optional. Admin manages places without a release |
| **P5** Design quality | Design system, then a redesign of mobile and dashboard around user needs | Arabic RTL is genuinely usable. The design follows §9 |
| **P6** Verification / hardening | Typecheck, builds, migrations, authz/IDOR tests, E2E, Expo smoke, offline and error states, Arabic/RTL | Everything passes. No real PHI. No critical or high security defect before the pilot |

No new product scope is added until P0–P6 are complete.

## 8. Out of Beta

These are not built, not even as stubs or disabled screens:

- Social or community feed, patient-to-patient chat, broad messaging
- Generative-AI medical advice, autonomous diagnosis, treatment or medication
  changes
- Restaurant ordering or delivery, gym membership purchases
- Payments of any kind: splitting, marketplace settlement, partner billing
- Partner self-service portal
- Wearables
- Hospital, EHR or insurance integrations
- Multi-clinic billing, white-label SaaS
- Advanced analytics or BI

## 9. Design principles

The previous interface is not a reference. It may be used only to understand
functionality.

- **Patient app:** calm, premium, motivating, lifestyle-oriented, medically
  credible.
- **Provider dashboard:** fast, action-oriented, dense with information but
  modern.
- No card-after-card layouts, no raw tables on mobile, no giant forms, no
  backend status labels shown to users.
- Charts only where they explain progress or operational change, never as
  decoration.
- Every screen answers one question: what does the user need to understand or
  do now?
- Arabic first, with RTL built into the structure (`DEC` A-05).

## 10. Rules for everyone building this

- Do not invent medical, legal or commercial decisions. Add an `OPEN` entry to
  DECISIONS.md, ship the safe default behind its flag, and keep going.
- Use synthetic data only (`DEC` A-06).
- Workflow state lives in the database. Notifications only deliver it
  (`DEC` A-07).
- Do not let code structure force behaviour that contradicts this file.
- Do not skip review on auth, health data, security or release, whatever
  tools are used.
