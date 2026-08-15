# Profile

**Route** `app/profile/[handle].tsx`
**Purpose** Show an academic identity and the work behind it.
**Primary user question** "Who is this, academically, and what have they contributed?"
**Dominant action** own profile: none (Edit is secondary). Other: Follow when not following; nothing filled when already following.
**Secondary actions** Message (where `viewer.canMessage`), block, report (blocked), settings entry on own profile.

**Source repo files** `app/profile/[handle].tsx`, `packages/contracts/src/users/users.contract.ts`, `packages/core/src/policy/interaction.policy.ts`, `apps/api/src/modules/social/*`.
**Required data** `handle`, `displayName`, `avatarUrl`, `verificationLevel`, `academic` context (university, college, programme, stage, year), `contributionScore`, `viewer.{isSelf, isFollowing, isBlocked, canMessage}`.
**Optional data** `bio`, `interests`, authored posts.
**Deliberately not displayed** `followerCount`, `followingCount` — see below.

## Hierarchy — identity, then context, then work

Avatar 56 + display name (display voice) + academic context metadata → bio → **2 px rule** → contribution score → interests → relationship action → "Posts" as ContentGrammar rows with their ProvenanceLines.

Their posts reuse the feed's pattern exactly, so a profile reads as a body of work rather than a wall.

## Follower counts — a product decision, not a limit

**Correction to Turn 5, which stated these were unsupported.** `profileSchema` carries `followerCount` and `followingCount`. They are real and available.

The design omits them. `contributionScore` is the only number, and the contract's own comment says it is "contribution-based, never follower-derived (§37)". Displaying a follower count next to it would put a popularity metric beside a contribution metric and let the popularity one win — which is the drift from academic identity into a vanity page that the contract is written against.

**Status:** DEFERRED_PRODUCT_DECISION. If a product owner wants them shown, that is a legitimate call — but it is a call, and it must be recorded here rather than implemented because the field happened to exist.

## Follow terminology — the fix

Today the control renders from `groups.join` / `groups.leave`, so a profile says "Join" about a person.

Final: new keys `social.follow` ("Follow" / "متابعة"), `social.following` ("Following" / "تتابعه"), `social.unfollow` ("Unfollow" / "إلغاء المتابعة"). Not-following → a filled Follow. Following → an outlined "Following"; tapping it confirms unfollow in place. No second button, and no dominant action on a profile you already follow.

**Status** DESIGN_READY_CODE_REQUIRED — two keys per locale, one string swap.

## Own vs other

| | Own | Other |
| --- | --- | --- |
| Relationship action | Edit profile (secondary) | Follow / Following |
| Message | — | where `canMessage` |
| Block / report | — | in an overflow menu |
| Settings, privacy | entry row | — |
| Interests | editable | read-only |
| Blocked-by-you | — | identity + "You blocked this person" + Unblock; posts suppressed |
| Blocked-you | — | RestrictedState: "This profile is not available." No explanation of why — never confirm to a blocked user that they were blocked |

## Behaviour

· one scroll container · loading: skeleton with a real avatar circle and rules · empty: no posts → "No posts yet" (own: + "Write something") · error + retry · deleted/suspended account → "This profile is not available" · offline: cached, actions inert · restricted per the table above · RTL: `@handle` isolated LTR beside an Arabic display name, aligned to the reading start; Arabic avatar initials for Arabic names (أر، نه), Latin for Latin · mixed script: Arabic display name + Latin handle + Arabic and Latin interests in one wrapping row · Dynamic Type: name wraps, never truncates; the academic context line wraps to three lines · 360 px: interests wrap to three rows · accessibility: name is the h1; verification glyph has a label ("verified instructor"), never colour-only; the score is announced with its label; relationship actions announce their result via a polite live region.

**Status** SUPPORTED_NOW. Report BLOCKED; block SUPPORTED_CONTRACT_NOT_UI.

## Privacy settings — real fields

`privacySettingsSchema` exists and is unexposed: `profileVisibility`, `defaultPostVisibility`, `whoCanMessage`, `showOnlineStatus`, `showLastSeen`, `showActivity`, `searchable`. Design contract in `24`. **Status** SUPPORTED_CONTRACT_NOT_UI.

Note the honest gap: `showOnlineStatus` and `showLastSeen` are settings for a presence feature that does not exist. Do not build a toggle that controls nothing — ship those two only when presence ships.
