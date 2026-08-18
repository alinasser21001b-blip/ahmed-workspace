# 13 — BEFORE / AFTER

What changed in this recovery, stated as differences a reviewer can check
against the commits (`5b6963a`, `09ba576`, `28bbdf3`, `7f750c0`), not as
narrative.

---

## Today

| | Before | After |
|---|---|---|
| Interactions on the feed | None — like/save/comment lived one screen deeper on `/post/[id]` | Like, save, comment (count → thread), report, delete-own, all on the row |
| Pagination | First 20 posts, then nothing — `onEndReached` was never wired | Cursor pagination on scroll, against the API's existing `nextCursor` |
| Saved posts | Write-only: saving worked, nothing ever listed them | `/saved` screen, reachable from Learn, with the server's own `savedCount` shown beside it |
| Deleting your own post | Endpoint existed, no caller | Row overflow menu → confirm → `DELETE /v1/content/:id` |
| Blocking a user | **Silently broken for every student.** `toggleBlock` sent no request body; the server correctly rejects a bodyless `PUT` with 400; the catch block swallowed the failure, so the confirm dialog closed as if it had worked. Found by an independent adversarial pass, live-reproduced against the real API, not caught by the recovery's own test | `toggleBlock` sends `{}` (the pattern `toggleBookmark` already used); confirmed live: no-body → 400, `{}` → 200 with `isBlocked:true`, appears in `GET /v1/me/blocks` |
| Fast-scroll pagination | `loadMore` had no re-entrancy guard — two `onEndReached` firings before the first response landed both fetched the same stale cursor and appended it, duplicating posts on an ordinary fast scroll | A synchronous in-flight `ref` in `useFeed.ts` makes a second `load()` call while one is pending a no-op; verified live — a 10-tick scroll burst against a 54-post seed fired two "more" requests, for two *distinct* cursors, zero duplicates |
| Reaching your own profile | Only by finding one of your own posts | Masthead avatar, always present |
| `useFeed`'s optimistic helpers | Fully implemented, never invoked (dead code inside the hook that owns the feed) | Invoked: `toggleReaction`, `toggleBookmark`, `loadMore` all drive the screen now |

## Profile

| | Before | After |
|---|---|---|
| Contribution score | A 30px headline number, sourced from `profiles.contribution_score`, whose only writer is a `DEFAULT 0` in a migration — every real student saw a permanent zero | Removed. Nothing computes it, so nothing claims it. `06-LEARNING-ARCHITECTURE.md` records what a real computation would need to decide |
| Starting a conversation | No path anywhere in the shipped app | `Message` action beside `Follow`, calling the pre-existing idempotent `POST /v1/conversations` |

## Realtime

| | Before | After |
|---|---|---|
| Socket behaviour on the deployed host | Retried forever with jittered backoff against an endpoint that can never upgrade (`app.inject()` per request) | `EXPO_PUBLIC_REALTIME=0` set by `netlify-build.sh`; the client never attempts the socket, and the same honest "live delivery unavailable" line renders either way |

## Student bundle cleanliness

| | Before | After |
|---|---|---|
| Fixture world (`fixtures.ts`, demo people, demo posts) in a real export | Shipped, unreachable but readable — static import chain through `session.tsx` | Metro resolver swaps the module for a throwing stub outside a preview export; absent from the artifact, verified by `bundle-cleanliness.mjs` |
| `/motion-samples` | Route existed in every build; rendered untranslated English developer copy to an Arabic-default app if visited | Deleted, along with its e2e script |
| `/preview-feedback` route + always-mounted banner | Refused to render *at runtime* outside preview, but the working form, its write path, and the banner's `"— sample data · بيانات تجريبية"` line all still shipped as bundled, readable code (found by the adversarial pass, `7f750c0`) | Both resolve to minimal stubs (`Redirect` to `/`, `() => null`) outside a preview export, via the same resolver mechanism as the fixture world |
| Metro resolver robustness | Matched on the literal import specifier string — a changed relative path would silently stop protecting anything | Matches on the resolved absolute file path, closing that hole |
| Web shell | `<html lang="en">`, no favicon, no description, for an Arabic-default app | `lang="ar" dir="rtl"`, an inline SVG icon, and a bilingual description, patched into every export by `scripts/patch-web-shell.mjs` |
| Bundle size (JS only) | 1.59 MB | 1.55 MB — a real but modest reduction (~2.7%); an earlier commit message overstated this as "3.9MB to 1.5MB", comparing whole-export-directory size against JS-only size. Corrected here rather than in the original commit |

## Arabic / RTL

| | Before | After |
|---|---|---|
| Bidi truncation (RC-03) | Ellipsis fell on the visual left of a mixed-script name in the English UI (and the mirror in Arabic) — `numberOfLines` clipping followed `dir="auto"`'s per-element resolution | Single-line truncated text is isolated (U+2068…U+2069) and forced to the interface's own direction, so the ellipsis lands at the reading end; multi-line body text is untouched, since forcing direction there reordered whole sentences |
| `Text`'s `align="start"`/`"end"` on web | Compiled to literal `left`/`right`, which react-native-web never flips for RTL — every default-aligned line carried `text-align: left` even in Arabic | Resolved against `theme.isRTL` before emission |
| Logical properties app-wide (`borderStart`, `paddingStart`, …) | React-native-web resolves these against a direction *context* nothing in the app ever set, so every one defaulted to its `ltr` form — found in visual QA as the provenance citation border sitting on the wrong side | One `dir` prop at the theme root fixes the whole class |

## Documentation

| | Before | After |
|---|---|---|
| Repository-truth capability inventory | Scattered across prior audits and product docs, none from a single fresh sweep | `01-CAPABILITY-MATRIX.md`, built from 11 independent read-only auditors' evidence-cited findings (524 tool calls) |
| External service dependencies | Not consolidated anywhere | `09-EXTERNAL-SERVICES.md` (technical) and `10-OWNER-SERVICE-REQUEST.md` (plain language) |

## What did not change

- The Academic Editorial visual system: paper/ink palette, Newsreader +
  IBM Plex trio, the 3-token motion language. None of it was touched.
- The backend. Every capability this recovery "added" to Today was an
  existing, tested endpoint the client had never called.
- The frozen five-tab navigation.
- Dark theme: still deferred, still unreviewed, still forced off.
