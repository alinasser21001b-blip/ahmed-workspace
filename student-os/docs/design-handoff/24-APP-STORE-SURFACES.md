# App Store compliance surfaces

These are the design contracts for the Apple-readiness surfaces. **No backend rules are invented here.**

**Re-checked against merged `main` (tree `aadae41ee191`), 2026-08-15.** Report, block and account deletion are no longer design-ahead-of-code: all three ship. This file now records what is built, and states the copy the built behaviour forces. Where a shipped surface departs from the frozen contract, the departure is recorded as a contradiction for engineering — **not resolved by redesigning the surface.**

## Report content / user — SUPPORTED_NOW (contract matches shipped V1)

**Repo truth.** `POST /v1/reports` and the `reports` table have existed since Phase 3/6 — the frozen claim that "nothing exists" was wrong. Merged `main` adds the moderator reader (`GET/POST /v1/moderation/reports`), server-side content moderation (`packages/core/src/moderation/moderation.ts`, migration 0015), and the client entry point `src/components/ReportSheet.tsx`, wired into `app/post/[id].tsx` and `app/profile/[handle].tsx`. The nine reason strings and both submitted-states are translated in `en.ts` / `ar.ts`.

**V1 surface decision: Report is a modal.** `ReportSheet.tsx` is the contract. The freeze asked for a full-screen pushed route on the ground that a report is a considered action; V1 keeps the shipped modal, and **no new route is to be created**. The reasoning behind the original ask is preserved as a constraint on the modal instead: the modal must not feel like a passing sheet.

Three requirements carry that intent across:

- **It fills the screen it opens over.** Not a third-height sheet, not a peek. The reason list, the detail field and the action are all visible without the surface being dragged.
- **It dismisses only deliberately.** An explicit Cancel and the system back gesture, never a tap-outside that discards a typed reason.
- **It owns focus.** Content behind it is inert and unannounced; on open, focus moves to the modal's title.

**Visual contract.** Reached from an overflow control on a post, a comment, a profile and a conversation — never buried more than one tap from the content. Presented as a screen-filling modal over the content it concerns, so the reported object stays the thing the person was just looking at.

Title "Report this post" → "What is wrong with it?" → a ChipPicker of reasons, single-select → optional detail field (500 chars, same rules as a bio) → DominantAction "Send report" → a closing line: "A moderator from your college reviews this. You will not be told who." Confirmation replaces the screen: "Report sent." + "You can also block this person." with an inline Block action.

**Interaction contract.** Reason required; detail optional. Submitting is idempotent per (reporter, target) — a second report on the same object updates rather than duplicates. Reporting does not hide the content for the reporter; blocking does, and the confirmation offers it.

**Report must not feel hidden or difficult** — the overflow control is a 44 px target with a visible glyph, and "Report" is never nested inside a submenu.

**RTL.** The modal's own layout mirrors; the overflow glyph that opens it does not (it is not directional). Cancel and submit keep reading order — submit at the trailing edge.

**Backend dependency.** None. **Owner.** Mobile. Nothing outstanding: the surface, the reasons, the detail field and both submitted states all ship, and the contract now describes them.

## Block / unblock — SUPPORTED_CONTRACT_NOT_UI

The API is implemented (`social.routes.ts`, `social.service.ts`, `social.repository.ts` `block`/`unblock`; `profile.viewer.isBlocked`, `canMessage`).

**Visual contract.** Block from the profile overflow and from the report confirmation. A confirmation dialog — the one destructive-action dialog outside deletion: title "Block {display name}?", body "They will not be able to message you or see your posts. You will not see theirs.", actions Cancel (secondary) / **Block (danger)**.

After blocking: the profile shows identity plus "You blocked this person" and an **Unblock** secondary action; their posts are suppressed; any open conversation closes and returns to the list. Unblock is a single tap with no dialog — reversing a restriction is not destructive.

**A blocked user sees "This profile is not available."** — never a confirmation that they were blocked.

**Backend dependency.** None. **Owner.** Mobile. **Status** SUPPORTED_NOW — `app/settings/blocked.tsx` ships the blocked-accounts list (`blocked.empty.*`, `blocked.unblock`, `blocked.blockedSince`), and block/unblock is reachable from the profile via `ActionSheet.tsx`. The shipped block confirmation is a modal from that same component; the dialog copy below is the contract it should carry.

## Privacy settings — SUPPORTED_CONTRACT_NOT_UI

`privacySettingsSchema` is real: `profileVisibility`, `defaultPostVisibility`, `whoCanMessage`, `showOnlineStatus`, `showLastSeen`, `showActivity`, `searchable`.

**Visual contract.** A settings route with grouped AcademicRows; each visibility field opens a single-select list (stage / college / university / private); booleans are switches with a metadata line stating the consequence — "Off means your name will not appear in search results", not "Searchable".

**Honest gap:** `showOnlineStatus` and `showLastSeen` govern a presence feature that does not exist. **Do not ship toggles that control nothing** — hold those two until presence ships. The other five are shippable now.

**Owner.** Mobile.

## Account deletion — SUPPORTED_NOW (shipped; copy correction required)

**This section was provisional at freeze and is now written against the implementation.** The freeze note said the retention wording could not be finalised until a deletion job existed. It exists. Nothing below is inferred: every behaviour cites merged `main`.

### What the implementation actually does

`DELETE /v1/me/account` (`apps/api/src/modules/account/account.service.ts`, contract `packages/contracts/src/users/account.contract.ts`).

**It is a hard delete, and there is no retention window.** One transaction, ordered: open receipt → take inventory → revoke sessions → tombstone messages → resolve container ownership → `DELETE FROM users` → close receipt. The service header names the three things it deliberately is not: not a soft disable (`status = 'deleted'`), not a hidden profile, not "email support".

**Destroyed immediately.** Account row and email; password hash; profile, handle, bio, university/college/program/stage; declared interests; posts, comments and questions; reactions, bookmarks, follows; blocks and mutes; practice answers and the whole learning record; uploaded file rows, with the storage objects deleted after the commit; all sessions revoked; all push tokens removed.

**Survives, by design, and the copy must say so:**

| What survives | Why | Source |
| --- | --- | --- |
| Messages you sent — as tombstones | `messages.sender_id` is `ON DELETE SET NULL`; the row is shared state and `seq` is a gapless per-conversation counter, so removing it would silently renumber the other person's thread. `body` and `metadata` are cleared and `deleted_at` is set, so the row renders as the existing `chat.deleted` placeholder | `account.repository.ts:tombstoneMessages`, `docs/app-store/01-PRIVACY-DATA-MAP.md` §tombstone |
| Reports you filed | The row survives for moderation history; the reporter's identity is `SET NULL` | `01-PRIVACY-DATA-MAP.md:23` |
| Product-analytics rows | `user_id` is `SET NULL` — anonymised, not deleted | `01-PRIVACY-DATA-MAP.md:29` |
| Groups, communities and classrooms you owned | Ownership transfers to a successor; with no successor the container is **archived**, not deleted. Counts come back in the response | `account.service.ts`, `deleteAccountResponseSchema` |
| A deletion receipt | `account_deletions` holds counts and no identity, so the deletion is provable without retaining who it was | migration 0015, `account.repository.ts` |
| Storage objects whose delete failed | Recorded as orphaned keys for a sweep, and reported as `objectsOrphaned` | `account.service.ts` |

### Lifecycle contract — seven states across two screens

The seven states are **states, not seven visual compositions.** Two routes carry all of them: `app/settings/index.tsx` and `app/settings/delete-account.tsx`. No new route is required and none is to be created. Each row below is binding on behaviour and copy.

| # | State | Where it lives | Behaviour | Copy |
| --- | --- | --- | --- | --- |
| 1 | **Entry** | `settings/index.tsx`, last group, own `SectionHeader`, row label in `danger` | Reachable in-app, never behind a web link. Pushes the deletion route. Nothing is destroyed by reaching it | `settings.deleteAccount` = "Delete account"; `settings.deleteAccount.body` beneath it as the group's standing warning |
| 2 | **Warning** | Top of `delete-account.tsx`, above the fields — **not a separate screen** | Present before any input, so what is destroyed is read before anything is typed. Never collapsed behind a disclosure | `settings.deleteAccount.confirmBody`, plus the **survives** line specified under *Copy correction* below. Both must be visible without scrolling on a 360 px screen at the default text step |
| 3 | **Confirmation** | Same screen: password field + literal-`DELETE` field | Submit is inert until the password is non-empty **and** the confirmation is exactly `DELETE`. A non-matching entry turns that field's border `danger` and shows an inline message; it never blocks editing. The literal is deliberately untranslated — a translated word would make the API's meaning depend on `Accept-Language` | `confirmField` = "Type DELETE to confirm"; `wrongConfirmation` = "Type DELETE exactly to continue."; `password` = "Password"; submit = "Permanently delete account", `danger`, full width |
| 4 | **Processing** | The submit control's own loading state | The control holds its width and shows the busy state; the whole form goes inert; **there is no cancel** once accepted, because the transaction cannot be recalled. No full-screen processing view — a screen swap here reads as completion and the request has not returned | No new string. The button's label persists; do not swap it for "Deleting…" and do not add a progress figure the API does not report |
| 5 | **Success** | Same screen, then `router.replace('/(auth)/sign-in')` | The local session is forgotten via `forgetLocalSession`, **not `signOut`** — a logout call would fail against an account that no longer exists. Success copy replaces the submit control so the destructive action cannot be pressed twice. Back must never reveal an authenticated screen | `settings.deleteAccount.success` = "Your account has been deleted." No marketing, no "sorry to see you go", **no retention or recovery language** — there is no grace period to describe |
| 6 | **Failure** | Inline message above the submit control | The account still exists and nothing was destroyed — the transaction is all-or-nothing. The form stays filled except the password, which clears. A wrong password maps to `auth.error.invalidCredentials` and attaches to the password field; anything else maps to `error.generic` | Two distinct messages, never collapsed into one. The generic message must not imply partial deletion |
| 7 | **Retry / support** | Same inline failure region | Retry is **re-pressing the submit control**, which is live again the moment the request settles — no separate Retry button. Alongside the generic failure only, a text link to the support row in settings, because a person whose deletion keeps failing has an Apple-relevant right to reach a human | Support link reuses `settings.support.help`. Required only on the generic branch; a wrong password needs no support route |

**Two frictions, both deliberate and both binding:** the password (a leaked access token must not be enough to destroy an account) and the typed literal (a single confirm button is one mis-tap from something irreversible).

**Accepted departures from the freeze wording, now the contract:** the typed token is the literal `DELETE` rather than the handle, and states 2–7 are lightweight states on one screen rather than seven compositions. Both are recorded here as V1 decisions, not open questions.

**`settings.deleteAccount.confirmTitle` is deleted.** It is translated in both locales and rendered nowhere. It does **not** become a heading: the screen's heading is `settings.deleteAccount` ("Delete account"), state 2 is warning copy rather than a titled section, and adding a second title would be a visual change this pass does not make. Remove the key from `en.ts` and `ar.ts`; the typed-`DELETE` gate and `confirmBody` already carry the confirmation's weight.

**Outstanding against this contract:** the state-2 survives line and the corrected body string (below), and the state-7 support link on the generic failure branch. Nothing else.

### Copy correction — P0, before submission

The shipped string is:

> `settings.deleteAccount.body` — "This permanently deletes your account: your profile, posts, comments, messages, and learning record. This cannot be undone."

**"messages" is the problem.** Messages are tombstoned, not removed: the other participant keeps a placeholder row in their thread forever. The frozen rule is *do not promise erasure the backend cannot perform*, and this promises it. The correction states the real behaviour without inventing a retention period:

> **`settings.deleteAccount.body`** — "This permanently deletes your account: your profile, posts, comments, practice history and learning record. It cannot be undone. Messages you sent stay in other people's conversations as "This message was deleted", without your name."

Also required, because the destroyed/survives list has nowhere else to live now that the warning screen was not built: **a metadata line under the body on `delete-account.tsx`** —

> "Groups and classrooms you own pass to another member, or are archived if there is no one to pass them to. Reports you filed stay with moderation, without your name."

Both strings need Arabic, and both counted phrases must go through `selectPlural` if a count is ever added. `confirmBody` ("Type DELETE and enter your password to confirm. This cannot be undone once submitted.") is accurate as shipped — no change.

**What must not be written.** No retention window, no grace period, no "30 days", no "you can recover your account" — the implementation gives none of them. No claim that messages are deleted. No claim that analytics or moderation records are erased.

**Owner.** Mobile, for two strings and their translations. **Backend:** none.

## Support and legal — EXTERNAL_RELEASE_DEPENDENCY

**Visual contract.** A settings group: Privacy policy, Terms, Support, App version. Each row is an AcademicRow with an external-link glyph (which does **not** mirror in RTL — it is not a directional icon). Version is metadata, not a row.

**Dependency.** Real URLs, a support contact route, and Arabic copies of both legal documents. Arabic legal text is a translation deliverable, not a design one; without it the Arabic default sends the majority of users to English legal copy. Flag that to whoever owns release.

## Summary

| Surface | Visual | Interaction | Backend | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Report | specified | specified | exists | mobile | **SUPPORTED_NOW** — ships as a modal, contract says pushed route |
| Block / unblock | specified | specified | exists | mobile | **SUPPORTED_NOW** — list + entry points ship |
| Privacy | specified | specified | exists (5 of 7 fields meaningful) | mobile | DESIGN_READY_CODE_REQUIRED — no privacy route ships yet |
| Account deletion | specified | specified | exists | mobile | **SUPPORTED_NOW** — two copy strings outstanding (P0) |
| Support / legal | specified | specified | URLs + AR translations | release owner | EXTERNAL_RELEASE_DEPENDENCY — rows ship, driven by `GET` support links; the gate `pnpm appstore:check` fails when unset |
