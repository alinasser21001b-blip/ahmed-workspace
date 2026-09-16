# 08 — Ways of Working

Human intervention points (PART 10), the two-agent working model (§59–§60), Definition of
Done (§85), scope control (§66) and git workflow (§83–§84).

---

# PART 10 — Human intervention points

Where each human must engage, and what happens if they do not.

## Ali — Product Owner, Medical Reviewer, Technical Operator

| When | What | If skipped |
| --- | --- | --- |
| Before M0 | Answer the blocking decisions in [`06-OPEN-DECISIONS.md`](./06-OPEN-DECISIONS.md) | Architecture is guesswork |
| Before M0 ends | Approve the architecture. **Write `ARCHITECTURE APPROVED — START MILESTONE 1`** | No code is written |
| **Continuously from M0** | Author and approve clinical content | The critical path stalls. **Start now** |
| Every milestone | Approve acceptance criteria *before* implementation | We build the wrong thing efficiently |
| Every milestone | Accept or reject the demo | Neither agent may accept its own or the other's work |
| M0–M1 | Provision cloud accounts, secrets, environments | Nothing deploys |
| M2, M4 | Bring the coordinator in to use it on real cases | R5: staff never adopt it |
| M7 | Approve every alert rule, threshold, and patient-facing sentence | Nothing clinical ships |
| M9 | Engage the security reviewer; run the restore drill in production | R8, R13 |
| M10 | Select and enrol pilot patients face-to-face | R1: engagement collapses |
| M11 | Authorise production launch with real patients | Nobody else can take this responsibility |
| Ongoing | Scope control — classify every new request before it is touched | R3: scope creep |

## Medical Reviewer (Ali, plus specialists)

| When | What |
| --- | --- |
| From M0 | Author all content in [`09-CLINICAL-CONTENT-REQUESTS.md`](./09-CLINICAL-CONTENT-REQUESTS.md) |
| Before M6 | Approve protocol definitions, stages, durations, tasks |
| Before M7 | Approve every red-flag rule **with its test cases** (§57) |
| Before M7 | Approve response-window and emergency wording |
| Before M5 | Approve every patient-facing Arabic sentence |
| Recommended | A second bariatric surgeon reviews the red-flag rules — a single clinical reviewer is a single point of clinical failure |
| Recommended | A dietitian validates the nutrition module against real practice |

## Human developer (part-time, retained)

| When | What | Effort |
| --- | --- | --- |
| End of M0 | Independent architecture review before any code exists | 4–8 hrs |
| End of M1 | Review the authentication and authorization design | 4–8 hrs |
| Ongoing | Spot-review AI-generated code; be the person who is not invested in it being right | ~4 hrs/week |
| M9 | Release-readiness review of the whole deploy path | 1–2 days |
| M11 | Certificates, signing, store submission, real-device testing | 5–10 days |
| Post-launch | On-call backup. **An AI cannot be paged** | Retainer |

## Security specialist

| When | What |
| --- | --- |
| Before M1 implementation | Review the authentication and session design — cheaper before than after |
| M9 | Penetration test, focused on broken access control and IDOR |
| M9 | Infrastructure review: network exposure, database reachability, secrets |
| Annually | Re-test |

## Legal / privacy reviewer

| When | What |
| --- | --- |
| **M0** | What law governs patient health data here; is this a regulated medical device; is in-country residency required |
| Before M5 | Privacy policy, terms, medical disclaimer, consent wording |
| Before M7 | **Liability posture for the alert feature specifically** |
| Before M11 | Store privacy disclosures; retention and deletion policy |

## Clinic staff

| When | What | Why |
| --- | --- | --- |
| M2, M4 | Coordinator uses the dashboard on real cases | The dashboard must match how the clinic runs, not how we imagine it does |
| M6 | Dietitian validates the nutrition module | Same |
| M7 | Whoever owns the alert queue confirms the workflow is actually workable | R7 |
| M10 | Everyone, during the pilot | Adoption is a human process |

---

# The two-agent working model

## Ownership

**One owner and one reviewer per feature. Never two implementers on the same surface.**

Two agents writing adjacent features in one module produces merge conflicts, inconsistent
conventions, and duplicated logic — and neither agent can see the other's reasoning.

| Work | Owner | Reviewer |
| --- | --- | --- |
| Architecture and ADRs | Claude Code | Codex + human, at M0 |
| Data model and migrations | Claude Code | Codex, **before** migrations are written |
| Domain logic and services | Claude Code | Codex |
| **Authorization** | Claude Code | **Codex, adversarially + human pen test** |
| Authentication | Claude Code | Codex + **human design review** |
| Dashboard | Claude Code | Codex |
| Mobile app | Claude Code | Codex |
| **Negative and authorization tests** | **Codex** | Claude Code |
| **Medical rule test cases** | **Codex**, from approved rules | Claude Code + Medical Reviewer |
| Security review of a surface | Codex | Claude Code |
| Dependency and license review | Codex | Claude Code |
| Documentation | Claude Code | Ali |

Codex owns test authorship on the highest-risk surfaces deliberately: tests written by the
author of the code inherit the author's blind spots. A different model reading the policy
layer cold and trying to break it is worth more than the same model writing more tests.

## Rules

1. **Neither agent accepts its own work.** Ali accepts (§60).
2. **Neither agent accepts the other's work because the other approved it.** A second AI
   approving is evidence, not authority.
3. **Review against acceptance criteria, not against the code.** "Does this do what was
   agreed?" not "is this code plausible?"
4. **Object to bad engineering.** If either agent — or Ali — proposes something
   structurally wrong, say so, explain why, and propose an alternative (§SPECIAL RULE: AI
   CODING). Silence is not agreement.
5. **Say "this requires a decision"** rather than inventing a requirement.
6. **Mark `[MEDICAL REVIEW REQUIRED]`** on anything clinical, and treat it as unapproved
   until approved in writing.

## Per-feature cycle

```
Acceptance criteria  →  approved by Ali BEFORE implementation
        ↓
Implementation plan  →  what changes, what could break, what gets tested
        ↓
Code                 →  one feature, one branch
        ↓
Tests                →  unit, integration, authorization, E2E as applicable
        ↓
Self-review          →  read the diff adversarially before asking anyone
        ↓
Cross-agent review   →  the other agent, against the criteria
        ↓
Demo                 →  Ali sees it work
        ↓
Approval             →  Ali accepts, or sends it back
        ↓
Next feature
```

No skipping to the next feature because the current one is "basically done".

---

# Definition of Done (§85)

A feature is not done when the UI renders. It is done when **all** of these hold:

- [ ] The agreed requirement is satisfied — not an adjacent one
- [ ] Backend complete, with validation on every input (frontend is never trusted)
- [ ] **Authorization correct and covered by tests**, including negative cases
- [ ] Frontend complete: loading states, error states, empty states
- [ ] Tests pass — unit, integration, authorization, and E2E where the journey is critical
- [ ] Arabic and English both checked, RTL verified
- [ ] Accessible: labels, contrast, touch targets
- [ ] Responsive at real device widths, including small phones
- [ ] Audit events emitted where the action is clinically or administratively significant
- [ ] No secret, credential or PHI in logs, analytics, or notification payloads
- [ ] Documentation updated; an ADR written if a structural decision was made
- [ ] Reviewed by the other agent against the acceptance criteria
- [ ] Demonstrated to Ali and accepted

**Additionally, for anything clinical:**
- [ ] Content traceable to an approved, versioned source with an approver and a date
- [ ] Rules carry a rule id, a version, and their test cases
- [ ] No sentence states or implies a diagnosis, or reassures a patient

---

# Scope control (§66)

When a new feature is requested mid-implementation, it is **not** implemented on arrival.
It gets classified, in writing:

| Question | Answer required |
| --- | --- |
| Is it MVP, Phase 2, or Phase 3? | — |
| What does it depend on? | — |
| Estimated complexity | S / M / L / XL |
| What risk does it add? | Especially clinical, security, or privacy risk |
| What would it displace? | Something always gets displaced |

Then Ali decides. The default answer for anything not already in the MVP scope is
**Phase 2**, and the burden is on the request to argue otherwise.

---

# Git workflow (§83)

- Never commit directly to `main`.
- One branch per feature: `feat/<area>-<short-description>`.
- Every branch runs the full CI pipeline before merge.
- PR-style review, even when both author and reviewer are agents.
- Squash or merge per repository convention, consistently.

## Commits (§84)

Conventional commits, with a scope, describing the change:

```
feat(patient): add weight tracking API with source attribution
fix(auth): prevent cross-patient record access in list endpoint
test(authz): cover dietitian access to surgical notes
docs(adr): record decision to run the API as a container
```

Not `fix stuff`, `update`, `wip`.

---

# AI-generated code policy (§58)

No code is accepted because it compiles. Every change passes:

1. **Static review** — lint, formatting, conventions
2. **Type checking** — including the deployment configuration, not just the source tree
3. **Tests** — unit, integration, authorization, E2E where applicable
4. **Security review** — mandatory for authentication, authorization, patient data, file
   handling, clinical rules, and anything touching AI
5. **Dependency review** — is it maintained, secure, licensed acceptably, and worth the
   coupling (§95)
6. **Architecture review** — does it belong where it was put

And one gate learned from this workspace's own history: **verify that CI actually runs.**
After configuring or changing the pipeline, push a deliberately failing commit and confirm
it is rejected. A green check that tests nothing is worse than no check, because it is
trusted.
