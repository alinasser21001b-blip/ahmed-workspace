# Changelog

## Final lock — 2026-08-15

The last two open documentation decisions are closed. **No visual design reopened, no route added, no backend behaviour changed.** Design work stops here.

| # | Decision | Resolution |
| --- | --- | --- |
| 18 | `settings.deleteAccount.confirmTitle` | **Deleted** from `en.ts` and `ar.ts`. Explicitly **not** promoted into a heading — the screen heading stays `settings.deleteAccount`, and a second title would be a visual change. The typed-`DELETE` gate and `confirmBody` already carry the confirmation |
| 19 | Password-reset copy | Standardised on the capability-neutral phrase **"reset link or code"**. Sent state: "Check your email for a reset link or code." Reset state: "Open the reset link, or enter the reset code manually." True whether the mail carries a link, a code or both, so it never needs revision against the mail template |

Behaviour is untouched by both: deep-link token pre-fill (read-only) and the typed-or-pasted path remain exactly as `20` specifies, and `auth.resetPassword.token` stays "Reset code" because it labels a field that only ever holds a code.

**The handoff is final.** `FINAL_HANDOFF_LOCKED = YES`. No further design rounds; reopening requires a demonstrated accessibility failure or implementation contradiction, with evidence, the affected rule, the minimum correction and an entry here.

## Contract reconciliation — 2026-08-15

Three contract mismatches closed so the handoff can be implementation-locked. **No design changed, no mockup direction was added, no route was created, and no product or backend behaviour was touched.** Each was closed in the direction that does not reopen design: the contract moved to the shipped V1 where the surface was sound, and a specification was written where one was missing.

| # | Mismatch | Resolution | Documents |
| --- | --- | --- | --- |
| 15 | **Report surface** | The contract is now **a modal** — `ReportSheet.tsx` as shipped. No pushed route is to be built. The original reasoning ("a report is a considered action") survives as three binding constraints: the modal fills the screen it opens over, dismisses only deliberately (never tap-outside on typed input), and owns focus | `24`, `03`, `25`, `26` |
| 16 | **Deletion lifecycle** | The seven states — entry, warning, confirmation, processing, success, failure, retry/support — are now explicit, **as states across the two existing routes, not seven compositions.** Each row binds behaviour and copy: warning above the fields, submit-as-processing with no cancel, success replacing the control, two distinct failure messages, retry by re-press, support link on the generic branch only. Backend semantics and the corrected wording are unchanged | `24`, `03`, `25`, `26` |
| 17 | **Password reset** | Implementation-grade specification for both shipped screens, in the frozen auth grammar — hierarchy, the existence-agnostic sent state, error mapping reusing the sign-in strings, deep-link vs typed token, RTL and accessibility. Screens 38–39; the count moves 37 → 39 | `20`, `03`, `FINAL-FREEZE`, `25`, `26` |

### Recorded as implementation debt, not design

**`typography.micro` (11/16) is retired and must not be used by final UI implementation.** The two call sites merged `main` added (`settings/index.tsx`, `settings/delete-account.tsx`) are debt to remove — re-point to the 13/20 metadata role and delete the token in the same change. It is not a narrow-remit token, not a metadata role and not an escape hatch: there is no size below 13 px in this system. `06-TYPOGRAPHY.md`, `05-TOKENS.md` §4.

Also settled: `settings.deleteAccount.confirmTitle` is translated in both locales and rendered nowhere — the screen heading stays `settings.deleteAccount`, so the key is **deleted**.

### New flag

`HANDOFF_CONTRACT_CONSISTENT = YES` — no document describes a surface the repository lacks, and no shipped surface lacks a contract.

## Post-merge reconciliation — 2026-08-15

The engineering branch merged into `main`. The handoff was re-checked against the merged tree (`aadae41ee191`, four commits and 70 changed files past the audit marker `8d7541ddd7e4`). **No visual decision changed. No design was reopened.** What changed is status claims and one screen's copy.

### Resolved

| # | Item | Resolution |
| --- | --- | --- |
| 10 | **iPad / DESIGN_BLOCKER_IPAD** | **Decided: V1 is iPhone-only.** `app.json` carries `ios.supportsTablet: false`. `08` §responsive rewritten from a blocker into a decision; `02`, `BLOCKED_CAPABILITIES` (18) and `FINAL-FREEZE` updated. No tablet layout is in scope. |
| 11 | **Account deletion copy** | The deletion job exists, so the provisional wording is retired. `24` is rewritten against `account.service.ts`: hard delete, one transaction ending in `DELETE FROM users`, **no retention window**. The destroyed list and the survives list are each cited to code. Two copy strings are specified as P0. |
| 12 | **Report** | Was recorded as "nothing exists". **Wrong at audit time** — the request contract and `reports` table predate the audit by three phases. Merged `main` adds the moderator reader and `ReportSheet.tsx`. Now SUPPORTED_NOW. |
| 13 | **Block/unblock** | Was DESIGN_READY_CODE_REQUIRED on a missing route. `app/settings/blocked.tsx` and the profile entry points ship. Now SUPPORTED_NOW. |
| 14 | **Settings root** | `25` listed `app/settings/*` as "all new". `settings/index.tsx` ships. |

### The deletion copy correction, stated plainly

The shipped string promises that "messages" are permanently deleted. They are **tombstoned**: `messages.sender_id` is `ON DELETE SET NULL` and the row survives, body cleared, because `seq` is a gapless per-conversation counter and removing the row would renumber the other person's thread. The frozen rule is *do not promise erasure the backend cannot perform*. Corrected wording is in `24`, and it invents no retention behaviour: what survives is exactly what the code and `docs/app-store/01-PRIVACY-DATA-MAP.md` say survives — message tombstones, reports with the reporter nulled, analytics with `user_id` nulled, transferred-or-archived containers, and a counts-only deletion receipt.

### New debt the merge introduced

1. `typography.micro` (11/16) is **newly rendered** by `settings/index.tsx` and `settings/delete-account.tsx`. The system retires it; two new files reintroduce it. P0.
2. Report ships as a `Modal`; `24` specifies a pushed route.
3. Deletion ships two steps against a seven-step contract — no warning, processing, success or failure screen, and no Retry.
4. `settings.deleteAccount.confirmTitle` is translated in both locales and rendered nowhere.
5. Password reset ships as two screens with no visual specification.

### Accepted as-is

The typed confirmation is the literal `DELETE`, not the handle the design asked for. The contract fixes the literal so the API's meaning cannot change with `Accept-Language`; the design's intent — a typed gate no mis-tap can trigger — is met. **The implementation stands and `24` was corrected to it**, which is the correct direction of travel for a shipped, legally significant screen.

## Freeze — 2026-08-15

Design frozen. Repository audited at `main` / `8d7541ddd7e4`.

### Corrections forced by the repository audit

| # | Earlier claim | Repository truth | Action |
| --- | --- | --- | --- |
| 1 | "No follower counts exist" (Turn 5) | `followerCount`, `followingCount` in `profileSchema` | Moved to DEFERRED_PRODUCT_DECISION. Design still omits them; the reason is now recorded as a choice. |
| 2 | Low-sample threshold 12 (Turn 4 prototype) | `MIN_QUESTIONS_FOR_CONFIDENCE = 5`, saturation 20 | Spec states 5, and states that the **client must never compute the threshold** — render the server's `lowConfidence`. The prototype's 12 is a known deviation in a demo, not a spec value. |
| 3 | "Resumable attempts — persistence unconfirmed" | `answered`, `alreadyAnswered`, persistent `attemptId` | Unblocked. Resume specified in `13`. |
| 4 | "Confidence % is blocked" | `confidence` and `weaknessScore` are real fields | Refined: the data exists, the *display* is forbidden. `confidence` may only surface as the low-sample sentence, and the word is banned from learner-facing copy. |
| 5 | Practice designed for single-select only | Three kinds: `mcq_single`, `mcq_multi`, `true_false` | Multi-select and boolean variants specified in `09` and `13`. |
| 6 | Practice submit disabled until a selection | "An empty array is a valid answer" | Submit is **enabled** with nothing selected. |
| 7 | Three message states drawn | Six in `message-state.ts` | All six specified, plus retry backoff and idempotency. |
| 8 | "4 of 7" doing double duty (Turn 3) | coverage and accuracy are different numbers | Split: coverage in metadata, accuracy as the fraction. The delta lands on accuracy. |
| 9 | Turn 5 said Search had no topic/classroom types | Confirmed | Unchanged, now with a written contract for when they land. |

### Locked decisions with recorded rationale

| Decision | Rationale |
| --- | --- |
| **Teal is provenance only** | It marked both "cites a source" and "you answered correctly" — two unrelated facts in one colour. Correct answers, CTAs, sent messages and evidence ticks moved to ink. Also fixes contrast: teal600 (4.6:1) replaces teal500 (3.4:1). |
| **Metadata is 13/20 sentence case** | 11 px uppercase mono has no Arabic equivalent and measured ≈3.6:1. This single change took the RTL score from 5 to 9. Costs ≈8% vertical space. |
| **Full dark Practice rejected** | Tested across all six content states. It sharpens the stem and costs the explanation, which is the longest text in the product. Resolved as an ink band over a white reading body. |
| **Latin and Arabic display faces differ** | Newsreader has no Arabic. The display *role* is constant; the voice changes by script. IBM Plex Sans / Sans Arabic are metric siblings, so mixed runs share a baseline. |
| **No shadows on content** | Hairlines do the work. `shadow.card` is retired; `shadow.sheet` stays for modals. |
| **No decorative motion** | Three tokens only. No celebration on a correct answer, no counter tween — animating an understated number dramatises it. |
| **Practice loses the tab bar; Learn gains a direct Practice entry** | Both are product-structure improvements, confirmed by the product owner. |
| **Two Learn entry paths, one filled control** | The topic row is for context; the ink band is the shortcut. Only the band is filled. |

### Deferred at freeze

~~iPad (**DESIGN_BLOCKER_IPAD**)~~ *decided at the re-check: iPhone-only* · follower counts · Compose drafts · dark theme review · web measure and keyboard.

### Turn history

| Turn | Content |
| --- | --- |
| 1 | Baseline recreation of Home, Learn, Topic, Practice from `apps/mobile` + §11 audit |
| 2 | Three divergent directions (2a Academic Editorial, 2b Calm OS, 2c Knowledge Network) |
| 3 | Resolved direction (2a base + 2b action discipline + 2c relationship primitive), metadata rebuild, Arabic stress test, §46 scorecard — nothing below 8 |
| 4 | Clickable learning loop with live evidence state, both branches, both languages, 360 px stress frame |
| 5 | Classroom, Messages, Search, Profile, Compose, Notifications, Auth, state family, Arabic set, colour and primitive inventories, cross-screen audit |
| Freeze | This handoff |

### Post-freeze rule

Design reopens only on a demonstrated accessibility failure or implementation contradiction. Required: evidence, the affected rule, the minimum correction, and an entry here.
