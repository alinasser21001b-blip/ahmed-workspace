# 05 — TODAY, AS AN ACADEMIC SOCIAL FEED

Owner decision, non-negotiable: **Today is the primary academic social feed.**
Not a task dashboard, not a reading list. This document records what Today was,
what it is now, and the line the design holds against becoming a timeline.

---

## What it was

Today fetched `GET /v1/feed?scope=home`, grouped items into two classification
sections, reported view impressions, and navigated. That was the whole surface.
Its own header comment said so plainly — *"Home has no dominant action; reading
is the action"* — and every act a student might want to perform lived one screen
deeper on `/post/[id]`.

The audit's finding was not that the code was wrong but that the product was
absent:

- No like, save or comment affordance anywhere on the feed
  (`ContentGrammar.tsx` exposed only `onPress`/`onPressAuthor`).
- `useFeed` had complete optimistic `toggleReaction`, `toggleBookmark`,
  `loadMore`, `prepend` and `replace` implementations. **Nothing invoked any of
  them.** They were dead code inside the hook that owns the feed.
- The list had no `onEndReached`, so the cursor the API returns on every page
  was never used: Today showed the first twenty posts and stopped.
- Saving worked and could not be read back — no screen anywhere listed a
  student's saved posts.
- Deleting your own post had a working endpoint and no caller: a student could
  publish and never retract.

## What it is now

The loop the brief specifies, closed on one screen:

**read → like → comment → save → open profile → open topic → compose → return**

| Act | How it works now | Endpoint (all pre-existing) |
|---|---|---|
| Read | Classification sections, hairline-separated rows | `GET /v1/feed?scope=home` |
| Like / unlike | On the row, optimistic with rollback, count reconciled from the server's answer | `PUT`/`DELETE /v1/content/:id/reaction` |
| Comment | Count on the row; tapping opens the thread where the composer is | `GET`/`POST /v1/content/:id/comments` |
| Save / unsave | On the row; readable afterwards on **Saved** | `PUT`/`DELETE /v1/content/:id/bookmark`, `feed?scope=saved` |
| Open profile | The author line | `GET /v1/profiles/:handle` |
| Open topic | The classification line above the claim | `GET /v1/topics/:id` |
| Report | Row overflow menu, nine reasons | `POST /v1/reports` |
| Delete own post | Row overflow menu, confirmed | `DELETE /v1/content/:id` |
| Block effect | Blocked authors' posts never enter the feed (server-side predicate) | hydrated into every `Actor` |
| Compose | Masthead, always one tap away | `POST /v1/content` |
| More posts | Cursor pagination on scroll | `nextCursor` |

Own profile and Settings are reachable from the masthead avatar. Before, a
student could reach their own profile only by finding one of their own posts —
which put account deletion and blocked accounts behind an accident.

## Post anatomy

Every row, in fixed order: **classification** (knowledge type · topic, tappable)
→ **the claim** in the display voice → **provenance** (cited sources, or nothing
at all) → **author line** (avatar, name, instructor mark, relative time) →
**status** (under challenge / corrected, as words) → **actions**.

Absent facts render as absence. A post with no sources shows no provenance line,
because an uncited claim is an author's claim and not an error. A post nobody
has liked shows no zero.

## The line this holds

The reference is the *familiarity* of the interaction, never the visual
language or the incentives around it:

- **No cards.** Rows separated by hairlines on paper, as the frozen design has
  it.
- **No colour carrying a state alone.** A liked post is a filled glyph plus an
  ink-weighted count plus an accessibility state — not a red heart doing all
  three jobs. There is no engagement palette.
- **No zeroes.** Counts appear only where there are any. A row of zeroes is a
  scoreboard inviting a student to fill it in.
- **No ranking.** Order is the feed's classification order. Nothing is scored,
  boosted or recommended.
- **No virality surface.** No share count, no reach, no trending, no reels, no
  infinite novelty. Pagination loads the next page of a cohort's work, and ends.
- **Metadata scale for instruments.** The claim stays the loudest thing in the
  row.

## What Today deliberately does not do

- **No resume band.** The frozen design has one for an open practice attempt,
  and no endpoint exposes open attempts. An honest absence.
- **No unread badges or counters** anywhere in the tab bar.
- **No "for you".** Classification is the curriculum, not a model's guess.

## Left backend-only, on purpose

Post edit, comment edit/delete/react, comment replies, followers and following
lists, and mutes all have working endpoints and no interface. Each is a real
product decision rather than an oversight, and each is recorded in
`01-CAPABILITY-MATRIX.md` as `BACKEND_ONLY` rather than quietly implied to work.

## Evidence

`apps/mobile/e2e/social-journey.mjs` performs the whole loop against the real
API in Arabic: publish, like, unlike, save, read back on Saved, unsave, comment,
follow the classification to its topic, open a profile, report, block. It reads
counts back from the interface after the server answers, so an optimistic update
that never reconciled fails the test.
