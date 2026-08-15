# Final freeze

**Date** 2026-08-15
**Design system version** 1.0.0-freeze
**Repository audited** `alinasser21001b-blip/ahmed-workspace`, branch `main`, resolved ref `8d7541ddd7e4`
**Re-checked against merged `main`** 2026-08-15, tree `aadae41ee191`, four commits later — after the engineering branch merged. The re-check is the current statement of truth; the audit marker is history.
*Provenance note: neither `8d7541ddd7e4` nor `aadae41ee191` is a commit SHA — both are refs reported by code-search tooling. Confirm against `git rev-parse main` before treating either as a commit.*

## Final approved direction

Academic Editorial hierarchy, with one-dominant-action discipline and relationship primitives used only where relations carry information. Latin display in Newsreader, Arabic display in IBM Plex Sans Arabic, body and metadata in IBM Plex Sans / Sans Arabic, numerals in IBM Plex Mono. Paper ground, ink text, teal for provenance alone. No cards, no shadows on content, no decorative motion, no invented learning intelligence. Practice is the single mode switch: ink header band, white reading body, no tab bar.

## Counts

| | |
| --- | --- |
| Screens and screen-states specified | 39 (37 at freeze + password reset ×2) |
| Components | 31 |
| Component states in the matrix | 16 components × 11 state columns |
| Acceptance tests | 86 (49 marked P0) — 72–86 added at the contract-reconciliation pass |
| Design tokens — colour roles | 14 |
| Type roles | 13 |
| Blocked capabilities | 15 (was 17 — report and deletion shipped) |
| Deferred product decisions | 3 (was 5 — iPad decided; deletion copy resolved) |
| External dependencies | 1 |
| New translation keys required | ≈95 per locale |
| P0 implementation items | 10 (report and deletion closed; the deletion copy correction and the `micro` regression added) |

## Token source of truth

`student-os/apps/mobile/src/theme/tokens.ts`. `tokens.json` in this folder is the design-side record and **must not be imported at runtime**. There is one token system, and the required diff to it is in `05-TOKENS.md`. The highest-risk item is the `learning` → `provenance` rename with call-site re-pointing.

## Status by area

| Area | Status |
| --- | --- |
| Arabic / RTL | Specified in full — one constitution, 18 rules, 8 worked mixed-script fixtures, per-screen exceptions. Arabic is the default locale, so this is the majority path. |
| Accessibility | Spec complete. Device verification (VoiceOver ar + en, TalkBack) outstanding as P0 QA. |
| 360 px | Verified at the largest supported text step with a four-option question, in both scripts. Option D falls below the fold; accepted, with the rationale recorded. |
| iPad | **RESOLVED — V1 is iPhone-only.** `app.json` carries `supportsTablet: false`. DESIGN_BLOCKER_IPAD closed; no tablet layout in scope. |
| Web | `web.output: single` is real; measure and keyboard behaviour unresolved. DEFERRED. |
| Dark theme | `darkColors` exists, `userInterfaceStyle: automatic` declared, no dark screen reviewed. DEFERRED. |

## Known design debt

1. Web layout undesigned while `web.output: single` is declared. (iPad is no longer a target — `supportsTablet: false`.)
2. Dark theme unreviewed against the editorial direction.
3. Multi-select, true/false, submit-failure and resume Practice states specified in writing but never drawn.
4. Arabic Practice completion state not drawn.
5. Post detail with its correction thread specified only in outline — the correction lifecycle is the most distinctive thing in the product and deserves its own frame.
6. ~~Account deletion copy is provisional.~~ **Resolved at the re-check.** The deletion job exists; `24` is rewritten against it, with no retention window because the implementation has none. What remains is two copy strings and their Arabic — tracked as a P0 copy task, not design debt.
7. ~~Password reset ships unspecified.~~ **Resolved** — specified in `20` as screens 38–39 in the frozen auth grammar. The link-versus-code inconsistency is also resolved: both screens say "reset link or code".
8. ~~Report ships as a modal where `24` specifies a pushed route.~~ **Resolved** — the modal is the V1 contract, with three constraints carrying the original intent. Block confirmation ships from the shared `ActionSheet`; `24` §Block states the copy it must carry.

## Known implementation debt

1. `practice/[topicId]` is not registered in `app/_layout.tsx`.
2. `colors.learning` is used for learning actions across screens and must be re-pointed to ink, not renamed in place.
3. `typography.micro` (11/16) still exists **and merged `main` newly renders it** — `settings/index.tsx` and `settings/delete-account.tsx` both use `variant="micro"`. **Retired: final UI must not use it.** The call sites are debt to remove, not a live token; re-point to 13/20 metadata and delete the token in the same change. P0.
4. Follow/unfollow renders from `groups.join` / `groups.leave`.
5. Home and Learn can both surface the same resume action.
6. Three of six message states are unrepresented in the UI.
7. `KnowledgeBadges.tsx` is retired by this design but still imported by three screens.
8. Arabic counted strings are concatenated rather than resolved through `selectPlural`.

## External dependencies

Privacy policy and Terms URLs, a support contact route, and **Arabic translations of both legal documents**.

---

## Flags

```
DESIGN_SYSTEM_LOCKED             = YES
FINAL_HANDOFF_LOCKED             = YES
HANDOFF_COMPLETE                 = YES
HANDOFF_CONTRACT_CONSISTENT      = YES   (report, deletion lifecycle, password reset)
REPO_TRUTH_SYNCHRONIZED          = YES   (re-checked against merged main)
RTL_SPEC_COMPLETE                = YES
ACCESSIBILITY_SPEC_COMPLETE      = YES
IMPLEMENTATION_CONTRACT_COMPLETE = NO
```

### Why HANDOFF_COMPLETE flipped to YES

Both reasons it was NO are resolved, and neither was resolved by redesigning anything.

1. **iPad.** Decided: V1 is iPhone-only, `supportsTablet: false`, already in the repository. There is no 1024 pt width to specify.
2. **Account deletion copy.** The deletion job exists, so the copy is no longer provisional. `24` states exactly what is destroyed and exactly what survives, each line cited to the implementation, with no retention window because the implementation has none. Two strings must be written into `en.ts` / `ar.ts` — a copy task with a defined answer, not an undocumented design decision.

The remaining test — another engineer can implement without asking for a design decision that was never made — now passes for all 37 specified screens. Two shipped screens (password reset) sit outside the 37 and have no visual spec; they were built without one and are recorded as debt rather than reopening the freeze.

### Why HANDOFF_CONTRACT_CONSISTENT = YES

No document in this handoff now describes a surface the repository does not have, and no shipped surface lacks a contract. The three mismatches the re-check found are closed in the only direction that does not reopen design: **the contract moved to the shipped V1 where the shipped surface was sound** (report as a modal, the typed literal `DELETE`), and **the specification was written where one was simply missing** (the deletion lifecycle's seven states, both password-reset screens). Nothing was redesigned, no route was added, and no product or backend behaviour changed.

What remains against the contract is copy and debt, each with a defined answer: two deletion strings and their Arabic, the state-7 support link, deleting `confirmTitle`, removing the two `micro` call sites, and settling "link" versus "code" in the reset emails.

### Why IMPLEMENTATION_CONTRACT_COMPLETE is still NO

Two of the four blockers cleared: report and account deletion both have endpoints and shipped clients. **Topic search still has no endpoint** — the single largest architectural gap, since the topic graph Learn, Topic and Practice are built on stays unreachable from the screen whose job is navigation. **Notifications** still have schema and rules with no producer, drain, route or client. Classroom search is unchanged and P1.

It becomes YES when topic search and notification delivery have endpoints.

### Why the other four are YES

- **LOCKED** — the direction is fixed, the rationale for each decision is recorded, and the reopening condition is a demonstrated accessibility or implementation failure, not taste.
- **REPO_TRUTH_SYNCHRONIZED** — every surface was re-read at the audited ref, not recalled. Four earlier claims were wrong and are corrected in `CHANGELOG.md` with the repository as the authority. `31` cross-checks the contested terms below.
- **RTL_SPEC_COMPLETE** — one constitution rather than scattered notes, with the engineering treatment named (LRI/PDI isolation, an `<Isolated>` helper, `selectPlural`) and real mixed medical text as fixtures.
- **ACCESSIBILITY_SPEC_COMPLETE** — targets, Dynamic Type, measured contrast, colour-independence, reading and focus order, the Practice announcement sequence, and forms. Device verification remains, and that is QA against a complete spec rather than a gap in it.

---

## Terminology consistency check (§31)

Every contested term, and the status every document must agree on:

| Term | Declared status | Where it may appear |
| --- | --- | --- |
| mastery | does not exist | nowhere |
| confidence | field exists, display forbidden | the low-sample sentence only; the word never in learner copy |
| weaknessScore | field exists, display forbidden | may order a list |
| recommendation | does not exist | never; `rankWeakTopics` is a ranking |
| prerequisite | does not exist | never |
| adaptive | does not exist | never |
| spaced repetition | does not exist | never |
| notification | schema yes, delivery no | `19` as design only |
| topic search | blocked | `16` §deferred only |
| classroom search | blocked | `16` §deferred only |
| draft | does not exist | never as a promise; offline copy is scoped to "here" |
| attachment | posts only | never in conversations |
| offline | real | banner + inert actions |
| resume | **supported** | Practice resume, and Home's band only with an open attempt |
| follow | supported; own keys required | `social.*`, never `groups.*` |
| join | groups and classrooms only | never about a person |
| block | **implemented, UI ships** | `24`; `settings/blocked.tsx` |
| report | **implemented** — contract since Phase 3, UI in merged `main` | `24`; the "does not exist" claim is withdrawn |
| delete (account) | **implemented** — hard delete, no retention window | `24`; never describe a grace period |
| retention window (account) | does not exist | nowhere — deletion is immediate and irreversible |
| password reset | implemented and specified | `20` §Forgot password, §Reset password |
| micro (11/16) | **retired** | nowhere in final UI; existing call sites are debt to remove |
| report surface | **modal** | `24`; a pushed route is not the V1 contract |
| follower count | field exists, omitted by decision | recorded in `17` and `BLOCKED_CAPABILITIES` |

No document in this handoff claims a capability another marks blocked.

---

## Stop condition

**FINAL_HANDOFF_LOCKED = YES.** Every documentation decision this handoff owns is closed: the iPad platform decision, the deletion copy and its lifecycle, the report surface, both password-reset screens, the `micro` ruling, the dead `confirmTitle` key and the reset-copy phrasing. What remains is implementation and QA, each item with a defined answer and an owner.

Design is closed. The next phase is engineering: handoff → implementation in `apps/mobile` → repo integration → native QA → TestFlight.

No Turn 6. No Direction D. No further mockups for polish. Design reopens only if implementation exposes a genuine contradiction or an accessibility failure — with evidence, the affected rule, the minimum correction, and a `CHANGELOG.md` entry.
