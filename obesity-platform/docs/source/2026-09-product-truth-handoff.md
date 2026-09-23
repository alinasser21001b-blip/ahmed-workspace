# Product Truth & Priority Handoff — Obesity & Healthy Lifestyle Platform (Beta Reset)

> **Source record. Do not edit.** This is a verbatim transcription of
> `Product_Truth_Priority_Handoff_Obesity_Platform.docx`, received 2026-09-23.
> The candidate product definition is [`../PRODUCT.md`](../PRODUCT.md), and every
> change to it goes through [`../../DECISIONS.md`](../../DECISIONS.md). If the
> two disagree, PRODUCT.md is current and this file shows where it started.

**Purpose:** freeze what is known, separate physician input from product
interpretation, and restore execution priorities before more code or design is
added.

**CORE RULE:** Build from confirmed product truth. Do not let the existing
codebase define the product, and do not let unresolved medical/business choices
become accidental product decisions.

## 1. Why we are resetting now

- The product changed materially after the physician meeting.
- The current beta implementation already moved fast, but speed increased the
  risk of encoding assumptions before the product was fully frozen.
- The first generated UI was weak and engineer-led, which exposed a broader
  issue: implementation started to outrun product definition.
- We therefore need one canonical handoff that tells Claude Code, Claude
  Design, developers, and reviewers what is confirmed, what is inferred, what
  is deferred, and what must not be invented.

## 2. What the physician actually asked for

This section is the closest thing to the physician's direct product intent. It
should be treated as primary input.

| Physician input | Meaning |
| --- | --- |
| Free patient-facing product | The app should provide useful free services to people with obesity / overweight, not only to postoperative bariatric patients. |
| Five broad areas | Main / weight-BMI-details; Health Profile; "Your health now"; Follow-up; Nearby healthy lifestyle places. |
| Follow-up layer | There should be an additional follow-up service involving obesity-focused specialists such as nutritionists and doctors. |
| Healthy lifestyle ecosystem | Gyms, healthy restaurants, cafés and similar places should appear clearly, preferably on a map. |
| Commercial partnerships | The business can create partnerships/contracts with these places and surface them inside the app. |
| Broader positioning | The physician's vision is larger than a bariatric postoperative follow-up system. |

## 3. Our product interpretation

**Working product definition:** A patient-first Obesity & Healthy Lifestyle
Platform with three connected engines: free health tools, structured
specialist follow-up, and a curated healthy-lifestyle discovery/map layer.

- **A. Free Health Engine:** Weight, BMI, progress, Health Profile,
  current-health check-ins, basic education and useful day-to-day health
  tracking.
- **B. Medical Follow-up Engine:** Specialists, enrolment/request, assignment,
  appointments, goals, tasks, plans, measurements, progress and provider-side
  workflow.
- **C. Healthy Lifestyle / Nearby Engine:** Curated gyms, healthy restaurants,
  cafés and partner places with map/list discovery, details, directions and
  offers.

## 4. What changed from the old concept

| Old framing | Current framing |
| --- | --- |
| Bariatric clinic operating system | Patient-first obesity & healthy lifestyle platform |
| Clinic enrols patient first | Direct patient acquisition is possible; follow-up can be activated later |
| Dashboard defines the product | Patient app is now a core product surface; dashboard supports follow-up operations |
| Surgery-centric pathway | Supports non-surgical obesity care and optional bariatric episodes |
| Follow-up as clinic workflow | Follow-up as an ongoing care relationship layered on top of the free app |
| No major consumer discovery layer | Nearby/partner map is a distinct value proposition |

## 5. Canonical product surfaces for Beta

1. **Today / Home** — Current weight, BMI/progress, a small number of relevant
   actions, next appointment / follow-up status. Must feel consumer-grade, not
   like a clinical dashboard.
2. **My Health** — Three distinct ideas: Health Now (changing state), Progress
   (trends), Health Profile (long-term health information).
3. **Follow-up** — Not merely appointment booking. Patient → specialist →
   follow-up program/case → plan/goals/tasks → next review → progress/outcome.
4. **Nearby** — Curated map/list of partner gyms, healthy restaurants, cafés
   and similar places. Beta is discovery, not a full marketplace.
5. **Me** — Account, language, privacy, settings, support and account
   controls.

## 6. The provider side still matters

- The provider dashboard is required because Follow-up cannot be a
  patient-only feature.
- Its home should be Today / Action Center: who needs attention, why, who owns
  it, what is next, and whether it is closed.
- Provider workflow should support patient roster, follow-up queue,
  appointments, patient overview, measurements, Health Profile, current
  health, plans/tasks, specialists and partner administration.
- The dashboard is no longer the entire product, but it remains operationally
  critical to the Follow-up layer.

## 7. Beta priorities — reordered

The main correction is to stop building horizontally. We should finish
complete vertical journeys in this order:

- **P0 — Product Truth Freeze:** Resolve only decisions that block UX, data
  model or clinical safety. Update one canonical product definition. Stop
  adding new features.
- **P1 — Free Patient Core:** Onboarding → height/weight → Home → weight
  history/progress → Health Profile → My Health Now. This is the product's
  free-value loop.
- **P2 — Follow-up Core:** Request → assignment → specialist/provider action →
  appointment → care plan/tasks → patient sees next step. This is the
  clinical/commercial loop.
- **P3 — Provider Action Center:** Today queue, patient overview, ownership,
  next action, closure and overdue handling. This proves Follow-up can
  actually operate.
- **P4 — Nearby / Partners:** Curated partner map/list/detail + admin
  management. No ordering, settlement, partner portal or complex monetization.
- **P5 — Design Quality:** Apply a proper design system and redesign mobile +
  dashboard from user needs, not from existing database forms.
- **P6 — Verification / Hardening:** Typecheck, builds, migrations, authz/IDOR
  tests, E2E, Expo smoke, offline/error states, Arabic/RTL, synthetic data
  only.

## 8. What must NOT enter Beta now

- Social/community feed or patient-to-patient chat.
- Generative AI medical advice, autonomous diagnosis, treatment or medication
  changes.
- Full restaurant ordering / delivery.
- Gym membership purchases.
- Payment splitting, marketplace settlement or complex partner billing.
- Partner self-service portal.
- Wearables ecosystem.
- Hospital/EHR/insurance integrations.
- Broad messaging/chat.
- Multi-clinic billing / white-label SaaS.
- Advanced analytics/BI.

## 9. Decisions that remain with the physician / business owner

- Exact target audience: everyone with overweight/obesity, clinic patients
  only, or both.
- Exactly which patient features remain free.
- Exact approved Health Profile fields.
- Exact My Health Now fields and symptom options.
- Specialist types included in launch.
- Whether Follow-up is paid in Beta, and how access is activated.
- Approved clinical education content and named approver.
- Whether Nearby shows partners only or broader public places.
- Commercial model for partners: listing, featured placement, referral,
  discount, etc.
- Brand name, legal text, privacy wording and store legal entity/account
  holder.

## 10. Decisions we can safely make without waiting

- Keep a modular-monolith architecture and one shared API.
- Keep `patient_record` separate from `user_account`.
- Support non-surgical obesity care and optional bariatric episodes; never
  assume surgery.
- Keep unresolved choices configurable / feature-flagged rather than
  fabricated.
- Use Arabic-first structural RTL.
- Use synthetic/demo data only until security and clinical gates are closed.
- Notifications are channels, not the source of workflow truth.
- Provider actions require central authorization and SQL-level patient
  scoping.
- Nearby Beta is curated discovery only.
- Follow-up is an ongoing program/case, not a one-off booking page.

## 11. Design reset

The existing interface is not the product reference. Existing screens may be
used only to understand functionality. Claude Design should rebuild the
presentation layer around user journeys, hierarchy, Arabic UX, progress,
follow-up and local discovery.

- Patient app: calm, premium, motivating, lifestyle-oriented, medically
  credible.
- Provider dashboard: fast, action-oriented, information-dense but modern.
- Avoid card-after-card layouts, raw tables on mobile, giant forms and backend
  status labels.
- Charts are useful only where they explain progress or operational change;
  never add graphs as decoration.
- Every screen must answer what the user needs to understand or do now.

## 12. Execution rules for Claude Code / developers

- Do not declare a feature complete because a screen exists.
- Complete vertical journeys end-to-end through API, database, UI and
  permissions.
- Do not invent medical, legal or commercial decisions.
- If a decision is unresolved, add a safe placeholder/flag and record it in
  DECISIONS.md.
- Do not let the current code structure force product behavior that
  contradicts this handoff.
- Use available tools/skills/agents to accelerate verification, but do not
  bypass review on auth, health data, security or release.
- Do not add new product scope until P0–P6 are complete.

## 13. Beta definition of done

- A new patient can onboard and reach a useful Home without joining Follow-up.
- Weight can be entered, persisted and shown as meaningful progress.
- Health Profile and My Health Now are clearly different and usable.
- A patient can request Follow-up and see assignment, appointment, plan/tasks
  and next step.
- An authorized provider can operate that Follow-up without unauthorized
  cross-patient access.
- Provider Today/Action Center makes ownership and next action obvious.
- Nearby supports curated partner discovery with map/list/detail and optional
  location.
- Admin can manage specialists and partner places without a mobile app
  release.
- Arabic RTL is genuinely usable.
- Build/typecheck/migrations/tests/E2E/mobile smoke all pass.
- No real PHI is used and no critical/high security defect remains before
  pilot.

## 14. The one-sentence rule for the team

Build the smallest complete version of the physician's actual product — a free
patient-first obesity and healthy-lifestyle app, with structured specialist
follow-up and curated nearby partners — and do not allow old bariatric-only
assumptions, weak UI, or unresolved decisions to drive the implementation.
