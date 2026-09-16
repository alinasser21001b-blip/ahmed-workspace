# 12 — Review Response and Access Design

**Responds to:** the review notes of 2026-09-16.
**Scope:** close the six raised items with the minimum documentation necessary. No code, no
new scope, no rewrite of the baseline.
**Status:** proposed. Not in force until `ARCHITECTURE APPROVED`.

> **The review notes were truncated** mid-sentence in item 6, at *"Do not leave 'second
> person"*. If items 7+ existed, they are not addressed here. Send them and I will extend
> this document.

---

## Verdicts at a glance

| # | Item | Verdict | Priority | Where it stands now |
| --- | --- | --- | --- | --- |
| 1 | Hosting architecture not closed | **RESOLVED** — but the review found a real defect it did not intend | **P0** (the defect) | Doc 11 §1.3, §1.4, §2.1, §2.2. Doc 03 was stale and contradicted it |
| 2 | Network topology not specific enough | **PARTIALLY RESOLVED** | **P0** | §2 below closes four genuine gaps |
| 3 | Gateway needs precise definition | **PARTIALLY RESOLVED** — and the note's framing is better than mine | **P0** | ADR-0004 amended; §3 below |
| 4 | Worker as a second privileged path | **NOT RESOLVED** | **P0** | §4 below: per-job actors, not a god worker |
| 5 | Challenge `super_admin` | **NOT RESOLVED** — note is correct | **P0** | §5 below: removed from v1 |
| 6 | Break-glass not designed | **PARTIALLY RESOLVED** | **P0** design / **P1** drill | §6 below |

---

## 1. Hosting — RESOLVED, and the note found something better

**Verdict: RESOLVED.** Every item the note lists was decided in document 11, published
before these notes:

| Asked for | Decided in |
| --- | --- |
| Exact provider, region, API / worker / PostgreSQL / storage / dashboard / edge location, private networking, DB reachability, monitoring, backups | Doc 11 §2.1 (component placement table) and §2.2 (zones) |
| Provider recommendation with reasoning | Doc 11 §1.3 |
| Edge/DNS/WAF position | Doc 11 §1.4 |
| Origin bypass protection | Doc 11 §2.3 |
| Topology studied as a whole rather than service by service | Doc 11 §2, diagram `d11-topology` |

**But the note is right that something was not closed, and it is worse than an open
decision — it is a contradiction.** `03-STACK-EVALUATION.md` line 203 still read:

> `| Hosting | Container host + managed PostgreSQL | [DECISION REQUIRED] — follows residency |`

Two source-of-truth documents disagreeing about whether a P0 decision has been made is
exactly the failure §65 of the original handoff exists to prevent, and a reviewer reading
document 03 alone would correctly conclude the hosting decision was open. **Fixed:** doc 03
now records the decision and points to doc 11.

**Two sub-points genuinely needed tightening, and are now specified:**

- **Exact region.** "EU" was not precise enough. The intent is Railway's European region
  (Amsterdam, `europe-west4` on Railway's current Metal regions) for **API, worker,
  PostgreSQL and object storage in one project on one private network**. `[VERIFY]` the
  exact region identifier against Railway's console during Gate 0 — region names move.
- **Why one provider for all four.** Deliberate, not incidental: co-locating API, worker, DB
  and storage on one private network means **zero cross-provider egress on the hot path, no
  public transit for database traffic, and a single failure domain that is easier to reason
  about than four correlated ones.** Splitting storage to a different vendor would add egress
  cost, a second credential, and a second availability dependency for every document read.
  The off-provider backup is the one deliberate exception, and it is off the hot path.

`[IRAQI LEGAL REVIEW REQUIRED]` — residency remains unknown. The engineering recommendation
above stands **under the stated assumption that no in-country residency requirement exists**.
If one does, this recommendation fails and the option set gets materially worse (no
mainstream PaaS has an Iraq region).

---

## 2. Network and access topology — the four real gaps

**Verdict: PARTIALLY RESOLVED.** Doc 11 §2.2 defines the zones and §2.3 already answers the
note's own sharpest point — *"a diagram labelled Cloudflare → API is not enough if the
original hostname remains directly reachable"* — with the secret-header origin lockdown.
Four questions were genuinely unanswered.

**One reframe first.** The note asks for a `MANAGEMENT-ONLY` network zone. On a managed
platform that category does not exist as a *network* zone: management is the provider's
console and API, reachable from the internet by definition, protected by account security
rather than by network position. Modelling it as a network zone would describe a control we
do not have. It is modelled below as an **access tier** instead, which is what it actually
is.

### 2.1 Component exposure — the definitive table

| Component | Classification | Public IP / inbound? |
| --- | --- | --- |
| Cloudflare edge | **PUBLIC** | Yes, by design |
| Fastify API (incl. dashboard bundle) | **EDGE-EXPOSED** | Platform hostname exists but rejects any request lacking the Cloudflare secret header (bare 404) |
| Worker | **INTERNAL-ONLY** | No HTTP domain assigned. No inbound listener. Outbound only |
| PostgreSQL | **PRIVATE** | **No.** Railway's public TCP proxy is **disabled** and stays disabled |
| Object storage | **PRIVATE** | **No.** No public endpoint, no public listing, no anonymous read, no presigned URL path in v1 |
| Backups (off-provider) | **PRIVATE** | Write-only credential held by the worker; separate vendor |
| Provider console / CI | **MANAGEMENT** (an access tier, not a network zone) | Internet-reachable; protected by account MFA, §6 |

### 2.2 The four questions

**Does PostgreSQL have a public IP?** No. Railway Postgres is reachable at
`*.railway.internal` on the project's private network. The optional public TCP proxy is the
one setting that would undo this, so it is **explicitly disabled, and its state is a
reviewed item in the pre-production checklist** — not an assumption.

**Can an engineer's laptop connect directly to production PostgreSQL?** **No — not as
routine, and this is a deliberate constraint rather than an oversight.** Three sanctioned
paths exist instead:

| Need | Path |
| --- | --- |
| Investigate a data question | A one-off command run *inside* the project network under the read-only `app_readonly` role, output audited |
| Apply a schema change | Migrations, below |
| Genuine emergency | Break-glass, §6 — which includes temporarily enabling the proxy, and mandatory credential rotation afterwards |

**How are migrations executed?** CI never connects to the database. CI builds the image, then
**triggers a one-off command inside the project's private network** which runs the migrations
under the dedicated `migrator` role. The `migrator` credential is never present in the API or
worker containers, and migrations must not read PHI (ADR-0004 exception 1). This keeps the
database unreachable from outside the project while still automating schema change.

**Which firewall / security-group rules exist?** **On a managed platform: none, and pretending
otherwise would be dishonest.** There are no VPCs or security groups to write. What exists
instead:

- Private networking between services by default; public exposure is opt-in per service and
  is enabled for exactly one (the API).
- The Cloudflare secret header as the origin's only admission control.
- Platform account security as the management boundary.

This is a **real trade for the operational simplicity**, and it is the strongest argument
anyone can make for a VPC-based host such as AWS. It is accepted knowingly because the
alternative costs a VPC, subnets, NAT, IAM and security groups for a one-person team — the
accidental complexity that put `student-os` into a production 502. If a future security
review judges it insufficient, the migration path is a container move, not a rewrite.

---

## 3. The gateway definition — the note's framing is better than mine

**Verdict: PARTIALLY RESOLVED.** Two questions were asked.

### 3.1 Should it be ADR-0004, extend ADR-0003, or be a design document?

**Keep ADR-0004, and cross-reference it from ADR-0003** (now done). The note's concern about
redundancy is fair, and here is why it is not redundant:

- **ADR-0003** says: *inside the application, there is one policy module.* It constrains code
  that already reaches the policy layer.
- **ADR-0004** says: *nothing reaches clinical data without traversing that module.* It
  constrains paths that never enter the application at all — a client DB SDK, a service-role
  key, an analytics job, a provider MCP integration.

ADR-0003 is silent on all four, and those are what actually cause breaches. Merging them
would bury a system-boundary rule inside a code-structure rule. The failure mode of *not*
having 0004 is concrete: someone satisfies 0003 perfectly and still ships a second path.

### 3.2 "One gateway" must not mean "every byte through Fastify"

**The note is right, my wording was imprecise, and ADR-0004 has been amended.**

ADR-0004 already stated that the rule centralises authorization rather than exposure, and
that the worker legitimately bypasses the API. But §3.6 of document 11 then decided against
presigned URLs, and placing that decision under a heading about the gateway made it read as
though the *rule* forbade them. It does not. Two separate things were conflated:

| | Claim | Status |
| --- | --- | --- |
| **Architectural rule** | A short-lived, object-scoped signed URL minted *after* an authorization decision **conforms** to the gateway. Authorization happened at the boundary; only the byte transfer is delegated. | **Conformant. Permitted by ADR-0004.** |
| **v1 product decision** | v1 nonetheless proxies bytes through the API. | A *product and audit* decision, not an architectural prohibition |

The v1 decision rests on three grounds that have nothing to do with the gateway rule:
audit fidelity (minting records authorization, not delivery); a presigned URL being a bearer
token inside a URL, which in this population lands in screenshots and WhatsApp forwards; and
the cost objection vanishing because Railway's buckets have free egress on the private
network.

This matters because the distinction changes what a future engineer is allowed to do.
**Adopting signed URLs later is a product decision requiring the named triggers in doc 11
§3.6 — not an ADR amendment.** ADR-0004's allowed-paths list now says so explicitly.

---

## 4. The worker identity model — NOT RESOLVED, now designed

**Verdict: NOT RESOLVED.** Doc 11 §3.3 and ADR-0004 said the worker runs under a "system
Actor". The note is correct that this is hand-waving: an unscoped system Actor *is* the god
worker the note warns about, and naming it does not constrain it.

### 4.1 The design: per-job actors, never a worker identity

**The worker has no identity of its own. A *job* has an identity.** Every scheduled job and
every outbox consumer declares a `JobActor` before it can run:

```
JobActor {
  jobName        e.g. "followup-sweep"
  jobRunId       unique per execution
  clinicId       ALWAYS concrete — never a wildcard
  permissions    declared, narrow, per job
  causedBy       triggering domain event id, where applicable
}
```

Four rules make this enforceable rather than aspirational:

1. **No wildcard clinic scope, ever.** A job that must cover every clinic is *scheduled once
   per clinic* and receives a JobActor scoped to that clinic. This answers "can it bypass
   clinic scope?" with **no, by construction**, and it is what makes multi-clinic safe later
   rather than requiring a redesign.
2. **Per-job permissions, not per-worker.** See the table below.
3. **A separate database role.** The worker connects as `app_worker`, **not** the API's
   `app_api` credential, with table-level grants matching the union of its jobs' scopes. A
   compromised worker cannot read a table no job needs. This answers "does it share the API
   database credential?" with **no**.
4. **Boot assertion.** The worker process **exits at startup** if any registered job lacks a
   JobActor definition — mirroring the API's route/policy boot assertion, so a new job cannot
   be added without declaring its scope.

### 4.2 Declared job scopes

| Job | Reads | Writes | Notably cannot read |
| --- | --- | --- | --- |
| `outbox-relay` | `domain_events` | `domain_events.processed_at` | **Any clinical table** |
| `notification-dispatch` | `notifications`, `notification_preferences`, `push_tokens` | `notification_deliveries` | **Any clinical table** — payloads are generic by policy (doc 04 §11), so it needs none |
| `followup-sweep` | `appointments`, `patients` (status + assignment fields), `pathway_assignments` | `alerts`, `domain_events` | Clinical notes, documents, labs, symptoms |
| `protocol-task-generation` | `pathway_assignments`, `protocol_versions`, `surgery` | `tasks` | Notes, documents, labs |
| `alert-rule-evaluation` | Only the tables its approved rules declare | `alerts`, `domain_events` | Everything a rule does not declare |
| `backup-export` | Whole dataset **by definition** | Off-provider bucket | — (ADR-0004 exception 2: distinct credential, encrypted, audited) |

**"Can it fetch arbitrary patients?"** Within its clinic and its declared tables, yes — that
is the job; a follow-up sweep that cannot see every patient cannot find the overdue ones.
Outside them, no: jobs call the same `patientScopesFor(actor)` and the JobActor's scope is
what it returns. **The constraint is the table set and the clinic, not the patient set.**

**"Can notification processing see more clinical data than necessary?"** No — it reads **no
clinical table at all**. This falls out of a decision already made for a different reason:
notification payloads carry no clinical detail because they appear on lock screens (§79). A
constraint adopted for privacy turns out to collapse this job's data need to nothing, which
is the cheapest possible answer to the note's question.

### 4.3 Auditability

Every JobActor write emits an audit event with `actor_type='job'`, the job name, the run id
and the triggering event id. An investigator can always distinguish automated from human
action and trace *why* it happened. This is the auditability the note asks for, and it is
strictly better than a shared system identity, which would make every automated action
indistinguishable from every other.

![The worker has no identity; jobs do. Each declares a clinic-scoped actor and a narrow table set.](assets/d13-worker-job-actors.png)

---

## 5. `super_admin` — the note is right, and I would go further

**Verdict: NOT RESOLVED.** Doc 04 §4 proposed `super_admin`. **Recommendation: do not create
it.** Removed from doc 04.

For a one-clinic v1 it is the most dangerous account in the system and it protects against
nothing that the alternatives do not cover:

- Everything it would do routinely — create staff accounts, configure the clinic, manage
  protocol versions — is `clinic_admin`, scoped to the one clinic that exists.
- Everything else — restore a backup, rotate a secret, run a migration, emergency database
  access — **is not a role at all. It is break-glass** (§6), and it belongs to an operator
  procedure with sealed credentials and mandatory rotation, not to a standing application
  account that is one phishing email away from every patient record.

**v1 roles: `patient`, `surgeon`, `dietitian`, `nurse_coordinator`, `clinic_admin`.**

**Going further than the note asks, because it is cheaper to decide now than to walk back
later:** when multi-clinic arrives in Phase 3 and a platform operator role becomes genuinely
necessary, it must carry a hard constraint —

> **`platform_admin` manages tenants, billing and feature flags. It has NO clinical read, in
> any clinic, ever.**

A role that can read every clinic's clinical data must never exist. Conflating tenant
administration with clinical access is how multi-tenant health platforms get breached, and
the time to prevent it is before the role is written. If a platform operator genuinely needs
to see clinical data to debug a customer issue, that is a **break-glass event against one
named clinic**, time-boxed and audited — not a permission.

---

## 6. Break-glass and operator access — designed

**Verdict: PARTIALLY RESOLVED.** ADR-0004 listed break-glass as an exception with four
properties. That is a sketch. The note is right that risk R4 (Ali as a single point of
failure) is named in the register but never turned into a design.

### 6.1 Three access tiers

| Tier | Who | Holds | Auth | Production DB |
| --- | --- | --- | --- | --- |
| **0 — Application** | Clinic staff, patients | An application account | Password + **TOTP MFA for all staff** | None |
| **1 — Operator (routine)** | Ali | Provider console, CI, DNS, secrets | **Hardware security key** where supported, TOTP otherwise | **None routinely.** `app_readonly` via an in-project one-off command, audited |
| **2 — Break-glass (emergency)** | Ali + one named second operator | The sealed set below | Hardware key + sealed recovery material | Yes, under the procedure in §6.3 |

**SMS-based MFA is forbidden at every tier.** SIM swap is a realistic attack, and in this
product the phone number is also the patient identifier — the same channel must not be both
the identity and the second factor.

### 6.2 The sealed set, and where it lives

| Credential | Why it is in the envelope |
| --- | --- |
| Provider account owner + MFA recovery codes | Without it, nothing can be restored or redeployed |
| Cloudflare + domain registrar account + recovery codes | Losing DNS loses the product even if the data survives |
| Database superuser / `migrator` credential | Restore and repair |
| **Backup decryption key (`age` private key)** | **The single most important item.** Everything else is replaceable |
| Secret manager master credential | Rotation after any incident |
| GitHub organisation owner recovery | Source and CI |
| Apple / Google developer account recovery | Store presence and the ability to ship a fix |

**Storage — two copies, two people, two locations, and one non-negotiable separation:**

- **The backup decryption key is never stored with the provider credentials.** If one
  compromise yields both the backups and the key, the encryption bought nothing. They are
  sealed separately and held by different people.
- Copy A: password-manager emergency access (1Password/Bitwarden emergency kit) held by the
  named second operator.
- Copy B: printed, sealed, offline, in a physical safe or bank box.

**The second operator is a named person before production, not a role to be filled later.**
Their minimum capability: restore the database, revoke access, and reach the clinic to inform
it. They need no routine access at all.

### 6.3 The procedure

1. **Declare** — who, why, what is needed, in writing, with a typed reason.
2. **Retrieve** the specific sealed credential. Not the envelope; the credential.
3. **Act**, with the second person observing where the emergency permits it.
4. **Alert fires out-of-band**, to an address the application cannot suppress — because an
   incident may be the application misbehaving.
5. **Rotate every credential used, within 24 hours.** Non-negotiable. A break-glass
   credential that survives its use has become a standing credential.
6. **Write the incident note**: what happened, what was touched, what was rotated.
7. **Reseal**, and update the credential inventory.

**Revocation** is a checklist, not a memory exercise: a maintained **credential inventory**
listing every place each credential exists (provider, CI, sealed copies, any laptop), so
revoking one is complete rather than approximate.

### 6.4 The quarterly drill — the part that is always skipped

**A sealed envelope that has never been opened is a file, not a control.** This is exactly
the failure the repository already guards against for backups, and the same discipline
applies:

Quarterly, the **second operator** — not Ali — performs an unaided drill: retrieve the
sealed material, use it to restore the database into a scratch environment, confirm the data
is intact, reseal, and rotate what was used. It fails if they need to ask Ali anything.

That last condition is the whole point. The scenario this control exists for is the one
where Ali cannot be asked.

`[HUMAN SECURITY REVIEW REQUIRED]` — the tier model, the sealed set and the rotation
procedure should be reviewed by the security specialist engaged at M9, before real patients.

![Three access tiers, the sealed set, and the quarterly drill that proves it still works.](assets/d14-access-tiers.png)

---

## Who must decide what

| Decision | Owner | Type |
| --- | --- | --- |
| Accept removal of `super_admin` from v1 | **Ali** | Product |
| **Name the second break-glass operator** | **Ali** | Organisational — blocks production, not approval |
| Accept no routine laptop→production DB access | **Ali** | Operational |
| Physical location of the offline sealed copy | **Ali** | Operational |
| Exact Railway region identifier | Verify at Gate 0 | Engineering |
| Whether Iraqi law requires in-country residency | **Iraqi legal reviewer** | `[IRAQI LEGAL REVIEW REQUIRED]` |
| Whether PaaS-without-security-groups is acceptable | **Human security reviewer** at M9 | Security |
| Break-glass tiers, sealed set, rotation | **Human security reviewer** at M9 | Security |

---

# ARCHITECTURE APPROVAL READINESS CHECKLIST

Everything that must be true before `ARCHITECTURE APPROVED` is a reasonable thing to write.

### P0 — blocks approval

| # | Item | State |
| --- | --- | --- |
| 1 | Hosting provider, region and full topology decided | ✅ Doc 11 §1.3–§2.3 |
| 2 | Doc 03 no longer contradicts doc 11 on hosting | ✅ Fixed this revision |
| 3 | Every component classified public / edge / private / internal | ✅ §2.1 |
| 4 | PostgreSQL has no public endpoint; TCP proxy disabled | ✅ §2.2, checklist item pre-production |
| 5 | Engineer-laptop→production-DB question answered | ✅ §2.2 — no, with three sanctioned paths |
| 6 | Migration execution path defined | ✅ §2.2 |
| 7 | Origin-bypass protection defined | ✅ Doc 11 §2.3 |
| 8 | Gateway rule distinguishes authorization from exposure | ✅ ADR-0004, amended |
| 9 | Signed URLs classified as conformant-but-deferred, not forbidden | ✅ §3.2, ADR-0004 |
| 10 | ADR-0003 ↔ ADR-0004 relationship explicit | ✅ Cross-referenced |
| 11 | Worker identity model defined with per-job scopes | ✅ §4 |
| 12 | Worker uses a separate DB role from the API | ✅ §4.1 |
| 13 | No wildcard clinic scope anywhere | ✅ §4.1 |
| 14 | `super_admin` removed from v1 | ✅ §5, doc 04 amended |
| 15 | Break-glass tiers, sealed set and procedure designed | ✅ §6 |
| 16 | **Second break-glass operator named** | ⬜ **Ali — blocks production, not approval** |
| 17 | **Q1–Q12 answered** (doc 06) | ⬜ **Ali — these still block Milestone 1** |

### P1 — before the relevant milestone

| # | Item | Milestone |
| --- | --- | --- |
| 18 | Gate 0 executed: Iraqi signup and payment verified per provider | Before M0 ends |
| 19 | Exact Railway region confirmed in console | Gate 0 |
| 20 | Boot assertions implemented: every route has a policy, every job has a JobActor | M1 |
| 21 | `app_api` / `app_worker` / `app_readonly` / `migrator` roles created with least-privilege grants | M1 |
| 22 | Credential inventory established | M1 |
| 23 | Latency measured from Zain, Asiacell, Korek and a fixed line | Before M5 |
| 24 | Iraqi legal review commissioned | M0, answer before M7 |
| 25 | Break-glass sealed and first drill executed | Before production data |
| 26 | Human security review of tiers and authorization | M9 |
| 27 | Penetration test focused on object-level authorization | M9 |

### P2 — documented, may wait

| # | Item | When |
| --- | --- | --- |
| 28 | RLS policies enabled (plumbing exists from day one) | Multi-clinic |
| 29 | `platform_admin` defined with no clinical read | Phase 3 |
| 30 | Two-hostname exposure split | On SSO adoption or >10 staff |
| 31 | Signed URLs reconsidered | At the doc 11 §3.6 triggers |
| 32 | Cloudflare Tunnel | If the origin becomes a VM |

**Approval is blocked by items 16 and 17 only.** Item 16 is a name. Item 17 is twelve
answers, most of which can be "agreed".
