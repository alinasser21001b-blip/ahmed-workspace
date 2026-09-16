# Bariatric Digital Care Platform

**Status: PRE-APPROVAL. No application code exists in this directory, and none will be
written until the Product Owner writes `ARCHITECTURE APPROVED — START MILESTONE 1`.**

A digital care pathway for a bariatric and general surgery clinic: a patient mobile app,
a clinical dashboard, and a backend platform that follows a patient from first contact
through long-term post-operative follow-up.

## What this directory currently is

A decision record, not a product. Everything here is a **proposal awaiting approval**.
Two markers are used throughout and both mean "not settled":

- `[MEDICAL REVIEW REQUIRED]` — clinical content or a clinical rule. Not approved until
  the Medical Reviewer approves it in writing. Nothing clinical in these documents was
  invented; where a clinical input is needed, the document says so and leaves it empty.
- `[DECISION REQUIRED]` — a product, legal or infrastructure decision that cannot be
  derived from engineering reasoning alone.

## Documents

| Document | Contents |
| --- | --- |
| [`docs/00-READINESS-REPORT.md`](docs/00-READINESS-REPORT.md) | Understanding, assumptions, missing decisions, and the ten direct answers |
| [`docs/01-CAPABILITY-ASSESSMENT.md`](docs/01-CAPABILITY-ASSESSMENT.md) | What Claude can build alone / with input / not at all, and the capability matrix |
| [`docs/02-RISK-REGISTER.md`](docs/02-RISK-REGISTER.md) | 21 risks with probability, impact and mitigation |
| [`docs/03-STACK-EVALUATION.md`](docs/03-STACK-EVALUATION.md) | Three stack options, scored, with a recommendation |
| [`docs/04-ARCHITECTURE-DRAFT.md`](docs/04-ARCHITECTURE-DRAFT.md) | Proposed high-level architecture |
| [`docs/05-MVP-AND-ROADMAP.md`](docs/05-MVP-AND-ROADMAP.md) | Critique of the proposed MVP scope, and milestones |
| [`docs/06-OPEN-DECISIONS.md`](docs/06-OPEN-DECISIONS.md) | Blocking questions for Ali (Arabic + English) |
| [`docs/07-COST-DRIVERS.md`](docs/07-COST-DRIVERS.md) | Technical cost drivers |
| [`docs/08-WAYS-OF-WORKING.md`](docs/08-WAYS-OF-WORKING.md) | Agent workflow, human intervention points, Definition of Done |
| [`docs/09-CLINICAL-CONTENT-REQUESTS.md`](docs/09-CLINICAL-CONTENT-REQUESTS.md) | Every clinical input the Medical Reviewer must supply |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records |

Two of these are worth naming separately:
[`docs/00-EXECUTIVE-SUMMARY-AR.md`](docs/00-EXECUTIVE-SUMMARY-AR.md) is the Arabic
executive summary, written for the Product Owner rather than for a future engineer, and
[`docs/06-OPEN-DECISIONS.md`](docs/06-OPEN-DECISIONS.md) is the one document that needs an
answer rather than a read.

## The Word deliverable

`Bariatric-Digital-Care-Platform-Readiness-Report.docx` is every document above in one
file — Arabic summary first, then the ten parts and the appendix, with a cover page and a
table of contents.

**It is generated, not maintained.** The markdown is the source of truth; the Word file is
rendered from it by [`tools/build-docx.js`](tools/build-docx.js). Edit the markdown and
re-run the script, never the other way around — a hand-edited .docx and the repository
would disagree within a week, and the repository is what the project runs on.

```sh
npm install docx && node tools/build-docx.js
```

Open the table of contents and press F9 in Word to populate page numbers.

Documents named in the handoff but **deliberately absent** — `architecture.md`,
`product-requirements.md`, `clinical-rules.md`, `security.md`, `deployment.md`,
`api.md`, `database.md` — are written during Milestone 0 and Milestone 1, once the
architecture is approved. Writing them now would record decisions that have not been
made.

## Safety position

This platform is **not** an emergency service, **not** a monitoring service, and **not**
a diagnostic device. No component autonomously diagnoses, recommends treatment, changes
medication, or reassures a patient that a symptom is benign. Alert rules route
information to a human queue; humans decide.

## Related work in this workspace

`../student-os/` is a production-grade TypeScript monorepo built by the same
Product Owner with the same AI workforce. It is cited throughout these documents as
**evidence** for capability claims — its ADRs, CI pipeline, authorization layer,
backup-restore drills and App Store readiness audits are the reference standard this
project should meet or exceed. It is a blueprint to learn from, not a codebase to fork.
