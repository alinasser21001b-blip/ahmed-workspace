# 07 — Admin / Company Control Plane

> Companion to [`00-CURRENT-STATE.md`](./00-CURRENT-STATE.md), the citation of record. Answers audit area **§8 Admin / Company Control Plane**: audit Admin V0, define the minimum console required before a broad pilot. Constraint from the brief: **separate `ADMIN_CAPABILITY_EXISTS` from `ADMIN_UI_EXISTS`.** This document keeps those columns apart throughout — "the server can do X" is never rounded up to "someone at the company can do X."

## 1. Authorization model (`EXISTS_NOW`, sound)

`isPlatformAdmin` — `role === 'admin' && status === 'active'` (`packages/core/src/policy/actor.ts:112-114`) — is a **single definition, used consistently** across every admin-adjacent check in the codebase.

It is enforced at the **service layer**, not by a route-level hook, and the admin module's own comment explains why: a route hook plus a service check creates *"two places that decide who is an administrator [that] can disagree."* Enforcing inside the service means a future admin route cannot accidentally ship unprotected by forgetting a middleware.

**One structural caveat**, carried into `08-SECURITY.md`: this is a **convention**, not a constraint. Every admin service function happens to call `assertMayAdminister` first, but nothing — no lint rule, no type, no test — prevents a future function from omitting it. The pattern is correct; it is unenforced.

## 2. What Admin V0 actually is

The admin module (`apps/api/src/modules/admin/`) describes itself in its own header: *"Admin V0... Four endpoints, one subject: who is academically eligible to teach."*

That is the honest scope. Instructor verification is the thing Admin V0 was built for. Moderation capability exists alongside it, in a separate module. Everything else a company needs to operate a platform is either absent or exists only as data nothing reads back.

## 3. `ADMIN_CAPABILITY_EXISTS` vs `ADMIN_UI_EXISTS`

**Every single admin capability that exists server-side has zero client UI.** `apps/mobile/app/` and `apps/mobile/src/` contain **no admin screen and no code path calling `/v1/admin/*` or `/v1/moderation/*` at all.** The only callers of those routes anywhere under `apps/mobile` are two Node E2E test scripts that hit the API directly to build fixtures — not app UI a human could use.

| Capability | `ADMIN_CAPABILITY_EXISTS` | `ADMIN_UI_EXISTS` | Evidence / gap |
|---|---|---|---|
| User search | **Yes** | **No** | Part of Admin V0's four endpoints |
| Instructor verification grant / revoke | **Yes** | **No** | The subject Admin V0 was built for |
| Verification history | **Yes** | **No** | Reads back from `audit_log` — the one narrow route that does |
| Moderation report queue | **Yes** | **No** | Exists in the moderation module |
| Report resolution | **Yes** | **No** | Account suspend/ban happens as a side effect of resolution, not as a standalone control |
| Admin-initiated content deletion | **Yes** | **No** | — |
| Account status change as a **first-class** action | **Partial** | **No** | Reachable only *through* report resolution. There is no direct "suspend this account" control independent of a report |
| Automated-moderation visibility | **No** | **No** | `moderation_decisions` is **written and never read back by any route.** An admin cannot see what the automated filter itself flagged |
| Block / report visibility per user | **No** | **No** | No admin view of a user's block list, and no "all reports against user X" view |
| Classrooms / groups administration | **No** | **No** | **No platform-wide view of classrooms or groups exists at all** — only per-container roles. An earlier draft of this document wrongly listed this as existing |
| Audit history (general) | **Partial** | **No** | `audit_log` is written by **exactly two call sites** (verification-level changes, admin bootstrap) and read by **exactly one narrow route**. **Moderation actions and admin content deletions are not written to it at all** — they land in a separate `moderation_actions` table that nothing joins against `audit_log`. There is no unified admin history |
| System health | **Yes** (`/health`, `/health/ready`) | **No** | An API response, not something a non-engineer can check |

**Two distinct classes of gap**, and conflating them would misprice the work:

1. **Built but unreachable** — user search, verification, moderation queue, report resolution, content deletion, system health. The hard part (data model, policy, authorization) is done; **only presentation is missing.**
2. **Not built at all** — platform-wide classroom/group views, per-user block/report views, automated-moderation visibility, a unified audit trail. These need **server work first**, then UI.

## 4. What this means operationally today

**A human operator's only path to any admin action is a direct API call or the `admin:bootstrap` CLI script.**

The realistic fallback — and this is a security finding as much as a usability one, carried into `08-SECURITY.md` §6 — is direct production database access. That path bypasses the service-layer authorization *and* the audit logging entirely: an admin action taken via SQL leaves no `audit_log` row, no `moderation_actions` row, and no attribution. The absence of a console does not mean admin actions will not happen; it means they will happen **unaudited**.

## 5. Minimum console before a broad pilot

Scoped to the smallest surface that removes the "an engineer with database access is the only admin interface" dependency.

**P0 — a broad pilot should not run without these**

1. **User lookup + direct account status change (suspend / reactivate).** The most time-sensitive admin action there is. Note this needs a *small amount of server work*: today status change is reachable only as a side effect of report resolution (§3), and it needs to be a first-class action.
2. **Moderation / report queue with resolution actions.** Report context, the reported content, reporter and reported user, and the resolution controls that already exist server-side. This is the link between "someone reported something" and "an admin acted" — a link that currently has no UI at any point along it.
3. **System health view.** A simple read of `/health` and `/health/ready` (and, once `05-MONITORING.md`'s P0 lands, the aggregated signal) so a non-engineer can answer "is it up" without reading logs.

**P1 — before the pilot scales, not necessarily before it starts**

4. **Instructor verification workflow UI** — turns Admin V0's existing four endpoints into something an operator can process.
5. **Unified audit history view.** Requires server work first: write moderation actions and admin content deletions into `audit_log` (or a view that unions it with `moderation_actions`), then build the read UI. Today the data is split across two tables that nothing joins.
6. **Automated-moderation visibility** — surface `moderation_decisions`, which is currently written and never read.
7. **Platform-wide classroom / group administration** — needs new server capability, not just UI.

**P2**

8. Per-user block/report aggregation views — richer trust-and-safety analytics beyond the acute case P0 #2 covers.

## 6. Build approach

**P0 #2 and #3 are UI-only** against contracts that already exist (`packages/contracts/src/admin/admin.contract.ts` and the moderation module). P0 #1 needs a small server addition. Most of P1 needs server work first. Do not plan this as "just a frontend project."

**Build it as a separate internal surface, not a screen in the student app.** Two independent reasons:

- The brief freezes the mobile UI and design system while Claude Design lands the handoff. An admin console added to `apps/mobile` would collide with that directly.
- Independent of timing, it is the right call: an internal operator tool has different UX, authentication, and audience requirements than a consumer mobile app, and conflating them would be poor architecture in any case.

## 7. Summary

| Question | Answer |
|---|---|
| Is the authorization model sound? | Yes — single definition, service-layer enforced. Convention-based, not structurally enforced |
| Does admin capability exist server-side? | **Partially.** Verification and moderation do. Classroom/group admin, block/report views, automated-moderation visibility, and a unified audit trail **do not exist at all** |
| Does any of it have a UI? | **No. Zero admin UI exists anywhere in the mobile client** |
| Can a non-engineer administer the platform today? | No. Direct API calls, the bootstrap CLI, or database access |
| Is the audit trail complete? | No — `audit_log` has two writers and one narrow reader; moderation actions bypass it entirely |
| Is this a UI gap or a capability gap? | **Both**, and they must be scoped separately (§3) |

**`ADMIN_CONTROL_PLANE_READY = NO`** — carried into `10-IMPLEMENTATION-PLAN.md`. `ADMIN_UI_EXISTS` is false for every capability without exception, and several capabilities a company needs are not built at all.
