# Decisions

> **Candidate, not canonical.** This file and [docs/PRODUCT.md](docs/PRODUCT.md)
> are a product-definition patch waiting to be merged into the existing
> obesity-platform codebase. That codebase has not been located yet (see
> [A-11](#a-11-codebase-continuity) and the
> [location report](CODEBASE-LOCATION-REPORT.md)). When it is found, these
> entries are compared with its own `DECISIONS.md` and merged there. This
> folder must not become a second implementation.

This file records every product choice that is **open**, **provisional**, or
was **decided after the handoff**. Code that depends on an open decision reads
a flag or config key named here and ships the conservative default. It never
hard-codes a guess.

- The product definition is in [docs/PRODUCT.md](docs/PRODUCT.md).
- The original physician handoff is in
  [docs/source/](docs/source/2026-09-product-truth-handoff.md).

## Rules

1. **Medical, legal and commercial decisions are never made in code or design.**
   If one comes up during work, add an `OPEN` entry here, ship the
   conservative default, and keep going.
2. **An entry is closed only by its owner.** Record who decided, when and how
   (meeting, message, signed document). "The physician would probably want X"
   does not close an entry, and neither does anything inferred from the
   current workspace.
3. **Closing an entry updates PRODUCT.md in the same commit.** The two files
   must not disagree.
4. **Do not delete entries.** Mark a reversed decision `SUPERSEDED` and link
   the entry that replaces it.

Statuses: `OPEN` · `PROVISIONAL` (in force as a guardrail, awaiting its owner's
approval) · `DECIDED` · `SUPERSEDED`
Owners: **Physician** (clinical content and safety) · **Business** (audience,
pricing, partners, legal) · **Product** (decisions the handoff says can be
made without waiting)

---

## Decision classification

An unanswered question only stops engineering if it is a true blocker. Every
open entry is one of three types:

- **TRUE BLOCKER:** without this answer, the data model, the safety model or
  an irreversible part of the UX architecture cannot safely proceed.
- **CONFIGURABLE:** build it now behind a flag or config, using an explicit
  conservative default. The owner's answer changes configuration, not code.
- **CONTENT:** build the UI and system now. Final wording or content, and
  switching the feature on, wait for the owner's approval.

| Entry | Type | Phase | Conservative default while open |
| --- | --- | --- | --- |
| [A-11](#a-11-codebase-continuity) Codebase continuity | **TRUE BLOCKER** | everything | Write no application code until the existing codebase is located or proven unavailable |
| [D-01](#d-01-target-audience) Audience | CONFIGURABLE | P1 | The model supports both public/free sign-up and clinic-linked sign-up. Neither is forced |
| [D-02](#d-02-which-features-are-free) Free features | CONFIGURABLE | — | The P1 core and Nearby are free |
| [D-03](#d-03-health-profile-fields) Health Profile fields | CONFIGURABLE | P1 | A field catalogue. Start with approved, low-risk fields only |
| [D-04](#d-04-health-now-fields-and-symptoms) Health Now fields | CONFIGURABLE | P1 | A field catalogue. Unapproved sensitive fields stay OFF |
| [D-05](#d-05-specialist-types-at-launch) Specialist types | CONFIGURABLE | P2 | Admin-managed reference data |
| [D-06](#d-06-follow-up-pricing-and-activation) Follow-up pricing and activation | CONFIGURABLE | P2 | Patient requests, admin approves, no payment |
| [D-07](#d-07-clinical-education-content) Education content | CONTENT | — | No content ships until approved |
| [D-08](#d-08-nearby-partners-only-or-public-places-too) Nearby scope | CONFIGURABLE | P4 | Partners only |
| [D-09](#d-09-partner-commercial-model) Partner commercial model | CONFIGURABLE | — | Nothing built |
| [D-10](#d-10-brand-legal-text-and-store-account-holder) Brand and legal | CONTENT | P6 | Marked-draft placeholders. The release check fails while the marker is present |
| [D-11](#d-11-bmi-categories-and-wording) BMI interpretation | CONTENT | P1 | Numeric BMI and trend are shown. Category labels are OFF |
| [D-12](#d-12-eligibility-age-and-pregnancy) Age and pregnancy | CONFIGURABLE | P1 | Conservative eligibility guard: adults (18+) only |
| [D-13](#d-13-health-now-red-flag-response) Symptom handling | CONTENT | P1 | The feature stays OFF until the physician approves the rules and wording |
| [D-14](#d-14-data-sharing-when-joining-follow-up) Specialist data visibility | CONFIGURABLE | P2 | Consented, case-scoped, minimum necessary. Consent is granted per dataset, so it can be widened later |
| [D-15](#d-15-physicians-five-areas-vs-our-five-tabs) Tab grouping | CONFIGURABLE | P5 | Separate screens. Grouping is a presentation choice |
| [D-16](#d-16-languages-and-units) Languages and units | CONFIGURABLE | — | Arabic first, English available, metric |
| [D-17](#d-17-provider-roles-and-permissions) Permissions by specialist type | CONFIGURABLE | P2/P3 | One specialist role with per-case grants. Permissions are capability-based, so type differences are configuration |

**The physician still answers every OPEN entry, but none of them stops P1.**
The one true blocker is A-11. Two entries stay CONFIGURABLE only if the code
is built a particular way. For D-14, consent must be recorded per dataset
rather than as a single yes/no. For D-17, authorization must check
capabilities rather than hard-coded role names. If the existing codebase
turns out not to be built that way, the gap audit should reclassify them as
TRUE BLOCKERS for P2.

---

## Open — codebase continuity

### A-11 Codebase continuity
- **Status:** OPEN · **Type:** TRUE BLOCKER · **Owner:** Business (product owner)
- **Question:** Which repository or workspace is the actual obesity platform?
  A previous session built one at `~/obesity-platform`, with API, dashboard,
  mobile, contracts/core, migrations, E2E tests and its own `DECISIONS.md`.
- **Current state:** UNRESOLVED. It was not found among the sources this
  session can reach; see [CODEBASE-LOCATION-REPORT.md](CODEBASE-LOCATION-REPORT.md).
- **While open:** Write no application code here or anywhere else. This folder
  holds documents only. Once the codebase is found, run the Product Truth Gap
  Audit (Keep / Modify / Delete / Missing) against it and merge these entries
  into its `DECISIONS.md`.
- **History:** On 2026-09-23 this entry was first recorded as DECIDED ("this
  is a new codebase"). That was inferred from the workspace this session had
  opened, and the product owner did not approve it. It was reopened the same
  day.

## Open — owned by the physician or the business (handoff §9)

### D-01 Target audience
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Business + Physician · **Blocks:** P1 onboarding
- **Question:** Is the app for everyone with overweight/obesity, for clinic
  patients only, or for both?
- **Safe default:** The architecture supports public/free users and
  clinic-linked users without forcing either. A clinic link is an optional
  relationship on the patient, never a precondition for an account. How
  people sign up in a given deployment is set by `audience.mode`. For the
  closed synthetic-data Beta (A-06) that is `invite_only`, which is a
  deployment gate, not a positioning decision.
- **Flag:** `audience.mode` = `invite_only` | `open` | `clinic_linked`

### D-02 Which features are free
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Business · **Blocks:** nothing in Beta
- **Question:** Exactly which patient features stay free?
- **Safe default:** All of the P1 Free Patient Core and all of Nearby are free.
  Follow-up is governed by D-06. Every surface checks `entitlement.<feature>`,
  so the answer can change without a release.
- **Flag:** `entitlement.*`

### D-03 Health Profile fields
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician · **Blocks:** P1 Health Profile
- **Question:** What is the exact approved list of Health Profile fields
  (long-term information: conditions, medications, surgical history, and so
  on)?
- **Safe default:** Fields come from a server-side field catalogue, and each
  field needs physician approval before it can be activated. Until the
  list arrives, Health Profile holds only height, which P1 onboarding already
  collects. The screen works with an empty catalogue. A bariatric history is a
  separate optional episode (A-03), not a profile field.
- **Flag:** `health_profile.fields` (catalogue rows with `approved_by`, `approved_at`)

### D-04 Health Now fields and symptoms
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician · **Blocks:** P1 Health Now
- **Question:** What are the exact Health Now fields (the patient's changing
  state) and the symptom options?
- **Safe default:** The same catalogue mechanism as D-03, starting empty.
  Weight is its own measurement stream (P1), not a Health Now field. Symptom
  options stay disabled until they are approved, together with D-13.
- **Flag:** `health_now.fields`, `health_now.symptoms`

### D-05 Specialist types at launch
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician + Business · **Blocks:** P2
- **Question:** Which specialist types launch? The physician named
  nutritionists and doctors "such as".
- **Safe default:** Specialist type is admin-managed reference data, not an
  enum in code. Beta seed data uses `nutritionist` and `physician` as synthetic
  examples only.
- **Flag:** `specialist_type` table

### D-06 Follow-up pricing and activation
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Business · **Blocks:** P2 request flow
- **Question:** Is Follow-up paid in Beta, and how is access activated (the
  patient requests it, a clinic enrols the patient, a code, or payment)?
- **Safe default:** The patient requests Follow-up and an admin approves it.
  There is no payment step, because payment rails are out of Beta scope
  (PRODUCT.md §8). The activation method sits behind a flag.
- **Flag:** `follow_up.activation` = `admin_approval` | `code` | `clinic_enrolment`

### D-07 Clinical education content
- **Status:** OPEN · **Type:** CONTENT · **Owner:** Physician · **Blocks:** any education content shipping
- **Question:** Which education content is approved, and who is the named
  approver?
- **Safe default:** No education content ships. The content model requires
  `approved_by` and `approved_at`, and unapproved content cannot be published.
  AI-generated health content is out of scope in any case.
- **Flag:** `education.enabled` = `false`

### D-08 Nearby: partners only, or public places too
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Business · **Blocks:** P4
- **Question:** Does Nearby show only contracted partners, or broader public
  places as well?
- **Safe default:** Partners only, entered by an admin. The place model carries
  `is_partner` so that public places can be added later without a migration.
- **Flag:** `nearby.scope` = `partners` | `partners_and_public`

### D-09 Partner commercial model
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Business · **Blocks:** nothing in Beta
- **Question:** How do partners pay: listing, featured placement, referral,
  discount, or something else?
- **Safe default:** None is built. Beta Nearby is plain curated discovery with
  a free-text offer field on each place. There is no ranking by payment, no
  referral tracking and no billing.

### D-10 Brand, legal text and store account holder
- **Status:** OPEN · **Type:** CONTENT · **Owner:** Business · **Blocks:** pilot and store submission (P6)
- **Question:** What are the brand name, legal and privacy text, and the
  store's legal entity and account holder?
- **Safe default:** A working name is set in config (`brand.*`). Legal and
  privacy screens show placeholder text marked `DRAFT — NOT APPROVED`, and a
  release check fails while that marker is present.

## Open — not in the handoff, found during the P0 review

Section 9 of the handoff lists ten open decisions. Reading the P1–P3 journeys
closely turned up seven more that the build would otherwise settle by
accident. Each still needs confirmation from its owner.

### D-11 BMI categories and wording
- **Status:** OPEN · **Type:** CONTENT · **Owner:** Physician · **Blocks:** P1 Home
- **Question:** Should Home show a BMI category label (for example "obesity
  class II")? If it does, which thresholds apply? WHO's general thresholds
  differ from some population-specific cut-offs. And what Arabic wording is
  acceptable to people living with obesity?
- **Safe default:** Show the BMI number and its trend with no category label.
  Weight change is described neutrally ("down 1.2 kg since 1 Sept"), with no
  praise or warning language.
- **Flag:** `bmi.show_category`, `bmi.thresholds`

### D-12 Eligibility: age and pregnancy
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician · **Blocks:** P1 onboarding
- **Question:** What is the minimum age? And how should the app behave for a
  user who is pregnant, since adult BMI and weight-loss framing do not apply?
- **Safe default:** Adults (18+) only, confirmed at onboarding. Pregnancy
  behaviour is left unbuilt until the physician decides. Onboarding asks
  nothing about it.
- **Flag:** `eligibility.min_age` = `18`

### D-13 Health Now red-flag response
- **Status:** OPEN · **Type:** CONTENT · **Owner:** Physician · **Blocks:** P1 Health Now symptoms
- **Question:** When a patient records a worrying symptom (and D-04 decides
  which symptoms can be recorded), what does the app say? What does it say
  when that patient is in Follow-up?
- **Safe default:** The app does no automated interpretation, scoring or
  triage. Symptom capture stays disabled until the physician approves the
  symptom list and the exact response text for each one.
- **Note:** This is also a P3 question: does a Health Now entry from a
  Follow-up patient show up in the provider's Today queue? The default is no
  until it is decided, because an entry that looks watched but isn't is worse
  than one that obviously isn't.

### D-14 Data sharing when joining Follow-up
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician + Business · **Blocks:** P2
- **Question:** When a patient joins Follow-up, what can the assigned
  specialist see: the weight history, the Health Profile, the Health Now
  history, and from which date?
- **Safe default:** The patient gives explicit consent at the request step,
  and the screen lists exactly what is shared. Access is scoped to the
  specialists assigned to that case and ends when the case closes. This
  follows handoff §10 (SQL-level patient scoping).

### D-15 Physician's five areas vs. our five tabs
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician · **Blocks:** P5 navigation (not P1 data)
- **Question:** The physician named five areas: Main (weight/BMI), Health
  Profile, Your health now, Follow-up and Nearby. Our five surfaces merge
  Health Profile and Health Now into **My Health**, add **Progress** inside
  it, and add **Me**. Does the physician accept that structure?
- **Safe default:** Build P1 as separate screens with separate data. The
  navigation grouping is a presentation choice that P5 can change.

### D-16 Languages and units
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Business · **Blocks:** nothing in P1 (the default is safe)
- **Question:** Is English a supported second language at launch? Are imperial
  units needed?
- **Safe default:** Arabic first, with RTL built into the structure (handoff
  §10). English is available. Metric only (kg, cm).

### D-17 Provider roles and permissions
- **Status:** OPEN · **Type:** CONFIGURABLE · **Owner:** Physician · **Blocks:** P2/P3 authorization
- **Question:** Do nutritionists and doctors have different permissions (for
  example, who can create or change a care plan, or close a case)?
- **Safe default:** There is one `specialist` role, and permissions are
  granted per case through assignment. Differences between types are not
  enforced until they are decided. An admin role manages specialists and
  partner places.

---

## Decided and provisional

### A-01 to A-10: Handoff §10 decisions
- **Status:** DECIDED · **Owner:** Product · **Date:** 2026-09-23 · **Source:** handoff §10

| ID | Decision |
| --- | --- |
| A-01 | Modular-monolith architecture with one shared API for the patient app, provider dashboard and admin. |
| A-02 | `patient_record` is separate from `user_account`. A person's health record is not their login. |
| A-03 | Non-surgical obesity care is the default. A bariatric episode is optional and attached to a patient, never assumed. |
| A-04 | Unresolved choices are configurable or flagged, never fabricated (this file). |
| A-05 | Arabic-first, with RTL built into the layout structure rather than mirrored afterwards. |
| A-06 | Synthetic/demo data only until the security and clinical gates are closed. |
| A-07 | Notifications are delivery channels. Workflow state lives in the database, never in a notification. |
| A-08 | Every provider action passes central authorization and SQL-level patient scoping. |
| A-09 | Nearby Beta is curated discovery only: no ordering, booking, payment or partner portal. |
| A-10 | Follow-up is an ongoing program or case with a lifecycle, not a one-off booking page. |

### A-12 Free core gives no weight targets or rate-of-loss advice
- **Status:** PROVISIONAL · **Owner:** Physician (approval pending) · **Date:** 2026-09-23
- **Decision:** The free core records and displays measurements and trends. It
  never recommends a target weight, a rate of loss, calories or medication.
  Goals exist only inside Follow-up, where a specialist sets them. This applies
  handoff §8 ("no medical advice") and §12 ("do not invent medical
  decisions").
- **Classification:** a safe clinical-product guardrail, in force now. The
  physician has not approved it as policy. The physician may confirm it,
  narrow it or widen it (for example, allowing a physician-approved target
  range) through a new entry.
