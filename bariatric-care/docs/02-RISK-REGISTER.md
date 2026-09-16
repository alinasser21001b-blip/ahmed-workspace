# 02 — Risk Register (PART 5)

Probability and impact are assessed for **this** project — one clinic, one surgeon, a
one-person team with AI agents, patients in Iraq — not for software projects generally.

**Impact scale:** Low · Medium · High · Critical (project-ending or patient-harming)

Risks are ordered by expected damage, not by category.

---

## Tier 1 — Most likely to actually kill the project

### R1 — Patient engagement collapses
**Probability: High · Impact: High**

Patients install, use it for 1–3 weeks, and stop. The dashboard empties, the clinic
concludes it does not work, and every downstream feature's value goes to zero. This is
the default outcome for patient-facing health apps, not the exception.

*Mitigation:* Design for value at zero patient adoption — the nurse can enter any data
the patient can, with source attribution, so the follow-up queue works regardless. Enroll
patients face-to-face at the clinic desk, never by sending a link. Keep the patient app
brutally small at launch. Instrument engagement from patient #1 and treat a falling curve
as a P0 product bug, not a metric. Consider whether the reminder channel should be
WhatsApp, where the patient already is.

### R2 — Clinical content is never finished
**Probability: High · Impact: High**

Ali is the sole source of every diet phase, red flag, threshold, lab schedule and
patient-facing sentence — while also being Product Owner, Technical Operator, and a
practising surgeon. The engine ships empty and stays empty.

*Mitigation:* Start clinical content **now**, in parallel with Milestone 0, using
[`09-CLINICAL-CONTENT-REQUESTS.md`](./09-CLINICAL-CONTENT-REQUESTS.md). Treat it as the
critical path in the plan, not a dependency of it. Ship with a deliberately minimal
approved content set — one procedure, one pathway — rather than waiting for completeness.
Timebox each content request; an empty module is better than a delayed launch, and far
better than invented content.

### R3 — Scope creep
**Probability: High · Impact: Medium-High**

The handoff describes a platform that would occupy a 6-person team for 18 months. The
realistic failure is not bad code: it is thirty features at 70% completion and nothing
shippable.

*Mitigation:* §66 of the handoff — every new request gets classified (MVP / Phase 2 /
Phase 3) before it is touched, never implemented on arrival. One feature through the full
gate at a time. A written MVP scope that requires an explicit decision to change.

### R4 — Single point of failure: Ali
**Probability: Medium · Impact: Critical**

Product owner, medical reviewer, technical operator, deployer, secret holder, escalation
point, and the only person who understands both the clinic and the system. A busy
operating month stalls the project; after launch it stalls patient care workflows.

*Mitigation:* §63 — everything in the repository, written for a stranger. A second person
with break-glass production access and documented recovery steps. The retained part-time
engineer kept warm with context *before* they are needed, not summoned during an
incident. Runbooks tested by someone other than their author.

### R5 — Clinic staff do not adopt the dashboard
**Probability: Medium · Impact: High**

The coordinator keeps using WhatsApp and a notebook because the dashboard does not match
how the clinic actually runs. The system becomes the surgeon's private toy.

*Mitigation:* The coordinator is a named participant from Milestone 2, not a recipient at
launch. Watch them use it on real cases before building more. Measure adoption by staff
actions per day, not by feature count. Accept workflow feedback as requirements.

---

## Tier 2 — Safety and security

### R6 — Broken access control exposes patient data
**Probability: Medium · Impact: Critical**

One missing scope check in one list query, or one endpoint taking an id from the client
without an ownership check. For a named surgeon in a local community this is a
reputational event first and a technical one second.

*Mitigation:* Single policy layer with no privileged path; scope pushed into SQL rather
than filtering after fetch; an exhaustive role × resource × operation test suite on every
commit; adversarial review by the second agent; human penetration test before launch
focused specifically on IDOR. Never traded away for MVP speed.

### R7 — The alert system creates a duty of care nobody is staffed to meet
**Probability: Medium · Impact: Critical**

A patient reports a symptom at 2 a.m., receives a calm confirmation, and reasonably infers
someone is watching. Nobody is until Sunday. The harm is caused by the system working
exactly as built.

*Mitigation:* Response window and emergency instruction shown at the moment of
submission, every time. No "all clear" state anywhere in the product. A named human owner
per queue with a defined review cadence. A hard product rule: a channel the clinic cannot
staff does not ship. Legal review of the alert feature specifically.

### R8 — Medical data breach
**Probability: Low · Impact: Critical**

Bariatric patients' weight, comorbidities and surgical history are among the more
sensitive categories of personal data, in a context where social consequences are real.

*Mitigation:* Encryption in transit everywhere; managed database not publicly reachable;
secrets in a secret manager and never in git; least-privilege service accounts; audit
logging; dependency and secret scanning in CI; penetration test; no PHI in third-party
analytics or crash reporting; a written incident response plan before launch, not after.

### R9 — Protocol versioning not handled, historical data becomes uninterpretable
**Probability: Medium · Impact: High**

The doctor revises the diet protocol in month 8. Every previously recorded adherence
entry now refers to a stage that no longer means what it meant. The dataset loses its
scientific and legal value silently — nothing breaks, nothing alerts.

*Mitigation:* Protocol definitions immutable once activated; new versions instead of
edits; every patient pinned to the version in force at enrolment; every derived record
carrying the version used. Designed in at the first migration, because it cannot be
retrofitted.

### R10 — Notification failure treated as patient informed
**Probability: Medium · Impact: High**

Push is silently unreliable on several Android OEMs. The system records "sent", the
patient never saw it, and a follow-up is missed while the dashboard shows the reminder
went out.

*Mitigation:* Record delivery attempts and outcomes as first-class data. Detect missed
tasks by the absence of the *action*, never by the absence of a delivery failure. Escalate
to a human queue on repeated non-response. Never display "reminded" as if it meant
"informed".

### R11 — AI invents clinical content
**Probability: Low (with controls) · Impact: Critical**

An agent produces a plausible post-op diet progression or a threshold, it looks right, and
it ships. This is the single most dangerous possible event in the project.

*Mitigation:* Absolute rule — no clinical string originates from an agent. Content lives
in an approved, versioned store with an approver and a timestamp. A CI check that fails
if clinical content appears in source code rather than in the content store. Every
clinical item traceable to an approval record.

---

## Tier 3 — Engineering and delivery

### R12 — Green CI that tests nothing
**Probability: Medium · Impact: High**

Documented twice in this workspace's own history: a workflow in the wrong directory meant
six phases merged with zero checks; and a packaging defect took production to 502 while
every check was green, because nothing tested the artifact that actually ships.

*Mitigation:* After configuring CI, push a deliberately failing commit and confirm it is
rejected. Include a deployment-contract gate that runs the *packaged* artifact in an
environment where the repository's dependencies are unreachable. Re-verify after any
pipeline change.

### R13 — Untested backups
**Probability: Low-Medium · Impact: Critical**

Backups run for six months, the restore has never been attempted, and it fails on the day
it is needed. Clinical data exists nowhere else.

*Mitigation:* A restore *drill* script that backs up, restores into a scratch database,
compares row counts of irreplaceable tables, and exits non-zero on disagreement. Run on a
schedule and before any data-rewriting migration. `student-os/ops/` already contains a
working implementation of exactly this pattern.

### R14 — AI-generated code drifts in quality and convention
**Probability: Medium · Impact: High**

Two agents over many months produce inconsistent patterns, duplicated logic, and
unreviewable volume. Nobody can hold the system in their head.

*Mitigation:* One owner and one reviewer per feature. Conventions written down and
enforced by lint where possible. ADRs for every structural decision. A hard rule that
volume is not progress — a feature is not done because code exists (see Definition of Done
in [`08-WAYS-OF-WORKING.md`](./08-WAYS-OF-WORKING.md)).

### R15 — Over-engineering multi-tenancy too early
**Probability: Medium · Impact: Medium**

Tenant isolation, clinic configuration portals and white-labelling built for customers who
do not exist, tripling MVP complexity.

*Mitigation:* `clinic_id` on every row from day one — cheap, and impossible to retrofit.
Everything else deferred: one deployment, one clinic, config in one table. Multi-tenant
*operations* are a Phase 3 problem.

### R16 — Under-engineering multi-tenancy, so it cannot be sold
**Probability: Medium · Impact: High**

The inverse. Clinic-specific assumptions leak into schema, URLs, branding and content, and
surgeon #2 requires a fork.

*Mitigation:* The same `clinic_id` discipline, plus: no hard-coded clinic name in code,
branding as configuration, content scoped to a clinic, and a periodic check that no query
can return rows across clinics.

### R17 — SMS / OTP cost and deliverability in Iraq
**Probability: High · Impact: High**

OTP delivery in Iraq is expensive, inconsistent across carriers, and slow enough that
patients abandon signup. At 200–500 patients/month plus reminders, per-message cost
becomes the largest recurring line item.

*Mitigation:* Decide the channel strategy before building authentication. Evaluate
WhatsApp as the primary channel. Design the identity module so the delivery channel is
pluggable. Consider clinic-assisted enrolment, where the patient is verified at the desk
by a staff member instead of by an OTP.

### R18 — App Store rejection
**Probability: Medium · Impact: High**

Health apps draw scrutiny: medical claims, privacy disclosure accuracy, account deletion
requirements, permissions justification, and the reviewer needing a working demo account.

*Mitigation:* Design against the guidelines from the start rather than auditing at the
end. No claim the product cannot support. Account deletion in MVP, not later. Accurate
data-use disclosure. A reviewer demo account with seeded data. Human iOS developer engaged
before submission. `student-os/docs/app-store/` contains a usable template for this work.

### R19 — Vendor lock-in
**Probability: Medium · Impact: Medium**

Deep coupling to one provider's proprietary primitives makes migration expensive when
pricing, policy or residency requirements change.

*Mitigation:* Standard PostgreSQL, S3-compatible storage, containerised application, no
proprietary primitive in domain code. Data export capability built in Phase 2 (§75).
Serverless-specific runtimes avoided for the API — see
[`03-STACK-EVALUATION.md`](./03-STACK-EVALUATION.md).

### R20 — Low-end Android and weak connectivity make the app unusable
**Probability: Medium · Impact: Medium**

Older devices, 2GB RAM, aggressive battery optimisation, intermittent 3G. The app works on
the developer's machine and not on the patient's phone.

*Mitigation:* Small bundle, few dependencies, optimistic local writes with visible pending
state and retry, no assumption of a live socket, real-device testing on deliberately old
hardware before launch.

### R21 — Arabic/RTL retrofit debt
**Probability: Low (if handled early) · Impact: Medium*

Layout, date formatting, number formatting, text truncation and bidirectional text break
in Arabic when RTL is treated as a late translation pass.

*Mitigation:* §71 — RTL from the first screen. Automated RTL audit in both languages at
multiple viewports, in CI. `student-os` runs this suite today.

---

## Summary

| Tier | Risks | Character |
| --- | --- | --- |
| 1 | R1–R5 | Product, people and discipline — **not** technical |
| 2 | R6–R11 | Safety and security — lower probability, highest consequence |
| 3 | R12–R21 | Engineering and delivery — well-understood, controllable |

The register's shape is the finding: **the risks most likely to end this project are not
engineering risks.** Tier 3 is where the effort naturally goes and where it matters least.
