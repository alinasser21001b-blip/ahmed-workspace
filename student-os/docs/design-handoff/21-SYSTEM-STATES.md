# System states

Specified once. Every screen must satisfy its row. A screen without states is an incomplete screen.

## The five core states

| State | Shape | Rules |
| --- | --- | --- |
| **Loading** | LoadingSkeleton shaped like the incoming screen — real header, real rules, paper200 at 60% for content | No full-screen spinner. No shimmer (decorative motion). A refetch keeps stale content and marks it with the attention rule instead of covering it. |
| **Empty** | display-voice line → explanation → **required action** | The repo already requires an action; that stands. Never illustrated — a drawing here would be the only drawing in the product. One exception: the notifications tray, where "Nothing new" is the whole point. |
| **Error** | challenged display line → "Nothing you did caused it." → Retry (secondary) | The one place challenged red is used for something other than a correction. Retry is never the dominant ink control — nothing on an error screen deserves that weight. |
| **Offline** | 2 px attention leading rule, **inline at the top of content**, stating what is preserved | Not a floating toast. Actions go inert, never disappear. |
| **Restricted** | the forbidden control is **removed** and replaced by a sentence naming who may act | Never a disabled control — a greyed box invites a tap that will never work. |

## Additional required states

| State | Specification |
| --- | --- |
| **Deleted / unavailable** | "This {object} is no longer available." + back. Applies to topic, post, classroom, profile, message (message keeps its bubble and suppresses the body). |
| **Validation failure** | ValidationMessage attached to its cause, never a toast, never a dialog. Announced politely. |
| **Network failure on write** | The write is not claimed. Practice: "That answer did not reach us. Nothing was recorded." Messages: the bubble goes `failed` with retry. Compose: the post is not cleared. |
| **Retry** | Explicit and user-initiated for a failed write. Automatic backoff exists only for messages (`retryDelayMs`, 5 attempts, cap 30 s) because that state machine is built for it. |
| **Keyboard visible** | Compose, Auth, Onboarding step 5, Conversation, Search. The pinned action rises with the keyboard and stays fully visible at the largest text step. The focused field scrolls into view above it. Headers do not move. |
| **Large text** | Every screen at the largest supported step. Nothing on a fixed height. Content may fall below the fold; nothing may clip, overlap, or become unreachable. |
| **360 px** | See `08` §extreme content for the full matrix. |
| **Arabic / RTL** | Every screen. See `22`. |

## The state family per screen

| Screen | Loading | Empty | Error | Offline | Restricted | Deleted |
| --- | --- | --- | --- | --- | --- | --- |
| Home | skeleton | "Nothing classified yet" + browse | full | cached + banner | n/a (policy-scoped) | n/a |
| Learn | skeleton | "Nothing answered yet" + find a topic | full | cached, band inert | n/a | n/a |
| Topic | skeleton | index omitted | full | cached, Practise inert | 403 → scope reason | topic gone |
| Practice | skeleton | n/a (no session ⇒ no entry) | full + retry | load fails / submit fails | n/a | n/a |
| Classroom | skeleton | "No lectures yet" + members | full | cached, Join inert | **non-member view, not an error** | classroom gone |
| Messages list | skeleton rows | "No conversations" + search people | full | cached + connection line | n/a | n/a |
| Conversation | skeleton bubbles | "No messages yet" | full | composer queues | **composer removed + reason** | message body suppressed |
| Search | skeleton after 2 chars | honest no-results advice | full | "Search needs a connection" | n/a | n/a |
| Profile | skeleton | "No posts yet" | full | cached, actions inert | blocked-you → unavailable | account gone |
| Compose | options disabled, not absent | Publish disabled | inline | banner + inert Publish | audience chip disabled + reason | n/a |
| Notifications | skeleton | "Nothing new" — **no action** | full | cached, read-state queues | n/a | n/a |
| Auth | control busy | n/a | field-attached, 4 messages | "Sign in needs a connection" | suspended account | n/a |
| Onboarding | list skeleton | n/a | keeps values | Finish inert | n/a | n/a |

## Copy rules for states

- Name what happened, then what is preserved, then what to do.
- Never blame the user. "Nothing you did caused it."
- Never promise recovery the product cannot deliver — Compose's offline copy says the text is kept *here*, because there is no draft store.
- Never use a generic message where the code distinguishes cases (see the four auth errors).
