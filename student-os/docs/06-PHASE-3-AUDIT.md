# Phase 3 Closure Audit

> Written **before** any closure change was made, by reading the migrations,
> policy, repositories, services, routes, client screens and tests — and by
> running probes against a real database rather than reasoning about what the
> code ought to do. Findings marked **PROVEN** were reproduced against
> PostgreSQL 16; findings marked **READ** come from the code alone.
>
> Baseline at audit time: 115 unit + 94 integration tests green.

## 1. Visibility is not two states — it is ten

The directive assumes public/private. The implementation does not have a
`private` boolean anywhere; it has one `visibility` enum shared by content,
groups, communities and files:

| Value | For a group, means |
| --- | --- |
| `public` | anyone signed in |
| `university` | same university |
| `college` | same college |
| `stage` | same college **and** stage — the cohort default |
| `course` | enrolled in the group's course |
| `community` | member of the group's community |
| `group` | **unlisted** — the "private group" of the directive. Invisible to everyone but members and invitees, whatever their cohort |
| `classroom` | reserved; no group uses it |
| `followers` | reserved for content; on a group it denies (deliberate) |
| `private` | author-only for content; on a group it denies (deliberate) |

`scopeAdmits` (`membership.policy.ts:63`) resolves the first six and **denies**
the last four with reason `unlisted`. The `never` exhaustiveness guard means a
new enum value is a compile error, not a silent allow.

So "private group" below always means **`visibility = 'group'`**, and
"discoverable group" means one of the six scoped values that the viewer
satisfies.

## 2. The membership matrix, as the code actually behaves

Legend: **G** = group shell (name, description, member count) · **P** = posts
inside it · **R** = roster · **Q** = pending-request queue.

| Viewer | Discoverable group | Unlisted group (`visibility='group'`) |
| --- | --- | --- |
| Non-member, in scope | G ✅ · P ❌ · R ❌ · Q ❌ | G ❌ (404) · P ❌ · R ❌ · Q ❌ |
| Non-member, out of scope | G ❌ (404) | G ❌ (404) |
| Invited | G ✅ · P ❌ · R ❌ | G ✅ · P ❌ · R ❌ |
| Pending requester | G ✅ · P ❌ · R ❌ | G ❌ (404) — a request cannot be filed on a group you cannot see |
| Active member | G ✅ · P ✅ · R ✅ · Q ❌ | same |
| Moderator | + Q ✅, approve/remove below own rank | same |
| Admin | + settings, invites, promote | same |
| Owner | + transfer ownership, archive | same |
| Left / removed member | G ✅ (may rejoin) · P ❌ · R ❌ | G ❌ (404) |
| Banned member | G ❌ (404) · rejoin refused | G ❌ (404) |
| Blocked (either direction) | group unaffected; the blocked user's **posts and profile** vanish from feed, search and member lists | same |
| Restricted account | reads everything a member reads; **cannot** join, post or create | same |
| Suspended / banned / deleted account | reads nothing | reads nothing |

Three separate mechanisms produce that table, and it matters which is which:

1. **The group shell** — `canViewGroup`, called by every group service read.
2. **Posts inside it** — `canViewContent`'s hard container boundary
   (`content.policy.ts:47`): `content.groupId && !actor.groupIds.has(...)` →
   deny, evaluated **before** the visibility switch, so a `stage`-visible post
   inside a group is still member-only.
3. **The Actor's `groupIds`** — built by `loadActor` from
   `group_members WHERE status = 'active'` only. This is the load-bearing
   detail: `left`, `banned`, `pending` and `invited` never enter the set, so
   removal takes effect on the next request across *every* surface at once.

### The Part 1 questions, answered

| Question | Answer |
| --- | --- |
| Public group discoverable? | Yes — `listDiscoverableGroups` and `searchGroups`, both with the scope predicate in SQL |
| Public group joinable? | Yes; `joinPolicy` decides whether that means joined or requested, and the server returns which |
| Private group discoverable without membership? | **No.** `visibility <> 'group'` is a WHERE clause in discovery *and* in search, so an unlisted group never occupies a page slot — its existence is not inferable from a short result |
| Private group accessible without membership? | No — 404, not 403 |
| Can a user request membership? | Yes when `joinPolicy='request'`; `status='pending'` with `requested_at` and an optional message |
| Can owner/admin approve? | Yes — `PATCH /groups/:id/members/:handle {status:'active'}`, gated by `canModerateGroup` |
| Can owner/admin reject? | **API yes** (`DELETE …/members/:handle`), **UI no** — see finding F4 |
| Can owner/admin remove a member? | Yes, rank-checked: `canRemoveMember` refuses an equal or superior |
| Can a member leave? | Yes |
| Can the owner leave? | Only after transferring or when alone — through `DELETE /membership`. **Not enforced on the other path** — see F1 |
| Can a group become ownerless? | **Yes — PROVEN.** See F1 |
| Can a removed user re-enter via a stale URL? | No. `groupIds` is rebuilt per request; a stale client URL yields 404 (unlisted) or the joinable shell (discoverable) |
| Unauthorized access via API manipulation? | No path found for content. `groupId`, author, and academic context are all server-derived; client-supplied identity is rejected by Zod. Two authorization *duplications* were found (F5, F6) which are correctness risks rather than live leaks |

## 3. Findings

### F1 — A group can be stranded with no owner · **PROVEN** · security/correctness

`leaveGroup` refuses to let an owner leave a populated group (412). The
member-removal endpoint does not:

```
DELETE /v1/groups/:id/membership              → 412 PRECONDITION_FAILED  ✅
DELETE /v1/groups/:id/members/<own handle>    → 204 No Content           ❌
→ active owners: 0 · active members: 1 · archived: null
```

`canRemoveMember` short-circuits on `targetUserId === actor.userId` with
`allow('self_leave')` (`membership.policy.ts:228`) **before** the strand check,
and `removeMember` never repeats the guard that `leaveGroup` applies. The
resulting group is permanently unmanageable: nobody can approve requests,
promote, transfer ownership, or archive it. Unrecoverable without direct SQL.

### F2 — Mutes do not affect any read surface · **PROVEN** · correctness

`PUT /v1/mutes` returns 204 and writes the row. The muted author's post is
still in the muter's feed on the next read. `mutes` is referenced in exactly two
places: the insert/delete, and the relationship projection that tells the client
"you have muted this person". Neither the feed nor search consults it.
`visibilityScopesFor` has no muted-id channel at all. A mute is currently a
label, not a behaviour.

### F3 — `pnpm test:unit` fails · **PROVEN** · process

`apps/api`'s `test:unit` is `vitest run --dir src`; `apps/api/src` contains no
test files, and unlike `@sos/contracts` and `@sos/mobile` it lacks
`--passWithNoTests`. Vitest exits 1, the recursive run fails, and **the CI
`pnpm test:unit` step has therefore been red on every push since Phase 0.** The
"209 tests passing" in the Phase 2 and Phase 3 reports was true of the two
suites run individually and false of the command CI actually runs. This is the
clearest instance in the repo of the failure the directive names: green
suite-level output taken for a green pipeline.

### F4 — Join requests can be approved but not rejected in the UI · product gap

`decideRequest(handle, approve)` in `app/group/[id].tsx` handles both branches;
only the approve branch is ever called. A moderator's only way to clear a
request they do not want is to leave it pending forever. The reject path is
dead code rather than a dead button — nothing lies to the user — but the flow is
incomplete.

Also absent from Phase 3 UI, with working endpoints behind them: the member
roster (`GET /groups/:id/members`), invites (`POST /groups/:id/invites`),
group settings (`PATCH /groups/:id`), and role management. These are honest
absences — no placeholder, no disabled control — but the roster in particular is
Phase 3 scope.

### F5 — Container membership is checked twice, two different ways · consistency

`content.service.ts:140` gates posting into a group with
`!actor.groupIds.has(input.groupId)` rather than `canPostInGroup`. It reaches
the same verdict today (both reduce to active membership) but it is a second
implementation of a policy question, which is precisely what ADR-0003 forbids.
The named write gates the directive asks for — `canWrite`, `canComment`,
`canInvite` — do not exist; `canPostInGroup` and `canManageGroup` are doing
their work implicitly.

### F6 — Author account status is enforced in SQL but not in the policy · consistency

`canViewContent` never looks at the author's account status. The feed and search
queries both add `u.status NOT IN ('banned','deleted')`. So the TypeScript
policy and the SQL disagree, and the single-item read (which uses the policy)
will serve a banned author's post that the feed hides.

### F7 — A test asserts something other than its name · **PROVEN** · test integrity

`social.integration.test.ts:161` is called *"excludes content from a suspended
author"* and sets `status = 'banned'`. Nothing anywhere covers `suspended`, and
`suspended` is **not** in either exclusion list — a suspended author's posts stay
in the cohort feed. Either the name or the behaviour is wrong; both need
deciding, and the test must then assert the decision.

### F8 — Arabic plural is English-shaped · i18n

`'groups.members.count': '{count} عضو'` renders «5 عضو», «2 عضو», «0 عضو» — wrong
for four of Arabic's six plural categories. Used on three screens. `t()` has no
plural mechanism at all, only `{name}` interpolation.

### F9 — Arabic search: measured, not assumed

Run against PostgreSQL 16 with `pg_trgm`. `similarity()` values, floor = 0.15:

| Case | Score | Verdict |
| --- | --- | --- |
| Arabic exact phrase | 1.00 | ✅ |
| Arabic word inside a phrase | 0.50 | ✅ |
| Arabic 5-char prefix | 0.29 | ✅ |
| Mixed Arabic + English | 0.37 | ✅ |
| `أمراض` vs `امراض` (hamza) | 0.64 | ✅ by luck |
| `الكلوية` vs `الكلويه` (ة/ه) | 0.60 | ✅ by luck |
| `مستشفى` vs `مستشفي` (ى/ي) | 0.56 | ✅ by luck |
| `القـــلب` vs `القلب` (tatweel) | 0.36 | ⚠️ degraded |
| **`آفة` vs `افة` (alef madda)** | **0.14** | ❌ **below the floor — no result** |
| **`اَلْقَلْب` vs `القلب` (tashkeel)** | **0.07** | ❌ **below the floor — no result** |
| `القلب` vs `قلب` (definite article) | 0.25 | ⚠️ weak |

Two more facts worth stating plainly:

- **`show_trgm` on Arabic returns hashed trigrams**, not readable ones
  (`{0xafa81e,…}`). pg_trgm CRC-hashes any trigram containing a multibyte
  character. Matching works; the index is a hash index in effect, and collisions
  are possible at scale.
- **There is no Arabic stemming, tokenisation, or root analysis, and there
  cannot be.** Trigrams cannot relate كتاب / كتب / مكتبة. This is not a bug to
  fix in this phase; it is a limit to write down.

So: Arabic search is **not solved**. Diacritics and one alef variant fail
outright. Normalisation is justified for exactly the class of difference that
carries no meaning — Unicode combining marks (U+064B–U+0652, U+0670), tatweel
(U+0640), alef variants (أ إ آ ٱ → ا), ta marbuta (ة → ه), alef maqsura (ى → ي)
— which is the set Lucene's `ArabicNormalizationFilter` uses. Anything beyond
that (stripping ال, collapsing و/ؤ) would destroy real distinctions.

The normalisation must be applied to **both sides** of the comparison, which
means a stored normalised column with its own trigram index — normalising only
the query would make it match nothing, and normalising the column inline in the
`WHERE` would discard the index.

### F10 — Notifications have a table and no producer · architecture

`notifications`, `notification_preferences` and `push_tokens` exist from
migration 0001. Nothing writes to them. Join requests, approvals, mentions and
comments emit `analytics_events` rows only, through `recordAnalytics`, which is
a metrics sink and not a delivery mechanism. There is no domain-event or outbox
concept anywhere in the codebase — so the risk the directive names (a second
notification architecture appearing in Phase 4) is real and currently
unmitigated.

### F11 — E2E is not in CI, and depends on manual database state · process

`apps/mobile/e2e/first-journey.mjs` (24 checks, Arabic) is documented as
requiring `db:reset && db:seed`, a running API, and a served web bundle, all by
hand. CI never runs it. The seed itself is deterministic in content but does not
reset first, so re-running it against a dirty database is not idempotent-by-
construction.

### F12 — RTL is derived correctly, but not audited · UI

`ThemeProvider` computes `isRTL` from the locale (`isRTLLocale(locale) ||
I18nManager.isRTL`) — the Phase 3 fix, and the right one for react-native-web.
What has not been done is a screen-by-screen audit of what consumes it. Grep
finds directional icons switched in some places (`arrow-back`/`arrow-forward`)
and not others, and no viewport or LTR-Arabic verification has been performed.

## 4. What is genuinely solid

Stated as plainly as the findings, because the audit is not a list of
complaints:

- **The container boundary holds.** One predicate, three surfaces — feed, single
  item, search — with an integration test that asserts an unlisted group's post
  is absent from all three for a non-member.
- **Discovery excludes in SQL, not after the fetch.** Unlisted groups never take
  a slot in a page, so their existence is not inferable from result counts.
- **404-over-403 is applied consistently** in `loadVisibleGroup`, including on
  the join path, so an unlisted group never confirms itself.
- **Rank enforcement is real** and tested: a moderator cannot remove an admin or
  mint moderators.
- **`member_count` cannot drift** — `removeMembership` recounts rather than
  decrementing, which is correct across leave/kick/ban/rejoin.
- **Placement is copied from the founder's profile**, never taken from the
  request.
- **The `canRead` / `isActive` split is correct and load-bearing**: restricted
  accounts read and cannot write, which is the distinction the directive asks to
  preserve. It is preserved.

## 5. Disposition, and what was done

| # | Finding | Outcome |
| --- | --- | --- |
| F1 | Ownerless group | **Fixed.** The strand rule moved into `canLeaveGroup`, and both exits — `DELETE /membership` and `DELETE /members/:ownHandle` — now route through it. Tested through both. |
| F2 | Mutes do not filter | **Fixed.** The Actor carries four mute sets, filtered in the feed's SQL. Applied to ambient surfaces, not to a group's own page or an author's profile — a mute is a volume control, not a lockout. |
| F3 | `test:unit` red | **Fixed.** `--passWithNoTests` on the API's unit script. `pnpm test:unit` is green for the first time since Phase 0. |
| F4 | Reject request; member roster | **Fixed.** Reject is wired to the endpoint that always existed; the roster is a disclosure on the member count, gated on `viewer.canRead`. Invites and group settings remain **deferred** — no control is drawn for either. |
| F5 | Duplicate container check | **Fixed.** `canReadInGroup`, `canWriteInGroup`, `canPostInGroup`, `canCommentInGroup`, `canInviteToGroup`, `canLeaveGroup` are named and separate; `groupCapabilities` resolves them together; `impliedMembership` lets a caller holding only an Actor ask the policy instead of reading `actor.groupIds`. |
| F6 | Author status not in policy | **Fixed.** `authorIsWithheld` in the policy, the same list in the feed and search SQL. `suspended` joins `banned` and `deleted`; `restricted` deliberately does not. |
| F7 | Mislabelled test | **Fixed.** The test now runs over both statuses and asserts the single-item read as well as the feed, and a new test asserts that a restricted author's existing content stays visible. |
| F8 | Arabic plural | **Fixed.** CLDR's six categories in `@sos/core`, a plural catalogue in the client, `t()` resolving countable keys through it. |
| F9 | Arabic search | **Fixed** for meaning-preserving variation ([ADR-0009](adr/0009-arabic-normalisation.md)), with a TypeScript/SQL agreement test. Stemming and semantic retrieval **deferred** to a Search phase, in writing. |
| F10 | Notifications | **Foundation built** ([ADR-0010](adr/0010-domain-events-outbox.md)): vocabulary, transactional outbox, membership producers. Delivery deferred to Phase 8; nothing consumes the events yet, and that is stated rather than implied. |
| F11 | E2E not in CI | **Fixed.** A `journey` job runs install → migrate → seed → build → serve → journey → layout audit. The seed was verified idempotent. |
| F12 | RTL audit | **Fixed**, and it found three real defects — see below. |

## 6. What the layout audit found

`apps/mobile/e2e/rtl-audit.mjs` walks nine screens in four combinations
(Arabic and English × phone and desktop) and checks direction, overflow,
clipping, hit areas, icon geometry, console and network. Writing it produced
three findings that reading the code had not:

1. **The document was never set to RTL.** `ThemeProvider`'s comment claimed
   react-native-web applied the document direction; it does not, and nothing
   else did either. Every `Text` set its own `writingDirection`, so the copy
   looked right while `getComputedStyle(document.body).direction` stayed `ltr` —
   leaving the browser's bidi resolution, text selection, scrollbar placement,
   form controls and assistive technology all working from the wrong base.
   `applyDirection` now sets `dir` and `lang` on the document element.

2. **English posts rendered right-to-left.** Forcing `writingDirection` onto
   every `Text` emitted a CSS `direction` rule, and an explicit CSS direction
   overrides the `dir="auto"` that react-native-web already puts on a root-level
   `Text`. So an English sentence in the Arabic UI rendered as
   «.Short English post» — full stop on the wrong end. `Text` gained a
   `bidi="auto"` mode, used everywhere a student's own words are shown, which
   lets the platform resolve direction per paragraph from the first strong
   character. That is the Unicode rule and the only one that gets a mixed
   Arabic/English corpus right.

3. **Every screen fired its first request unauthenticated.** Screen mount
   effects race the session restore and win, so a cold start produced a burst of
   401s — six per load — and each screen's `catch` painted an error state over a
   perfectly good session. Fixed in the API client with a readiness gate that
   authenticated requests await, rather than in nine screens that would each
   have to remember.

Directional icons were also centralised into `DirectionalIcon`, which names the
intent (`back`, `forward`, `disclosure`) rather than the glyph, and records
which icons must **not** mirror — play, checkmark, search, external-link,
clocks — so that "mirror navigation, never mirror everything" is enforced in one
place instead of re-derived per screen.

Result: **192/192 checks pass** across all four combinations, with a clean
console and no failed requests.
