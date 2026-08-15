# Navigation contract

Root navigator is `app/_layout.tsx` — a single `Stack` with `headerShown: false`. Every header in this product is drawn by the screen, not by the navigator. That is deliberate: the editorial header is content.

## Root

```
Stack
├── index                    session restoration / gate
├── (auth)                   sign-in, sign-up
├── (onboarding)             5 steps
├── (tabs)                   app shell
├── compose                  presentation: modal
├── group/new                presentation: modal
├── classrooms/new           presentation: modal
├── post/[id]  topic/[id]  search  chat/[id]  profile/[handle]
├── classrooms/index  classrooms/[id]  lecture/[id]
└── group/[id]
```

**Missing from the root and required:** `practice/[topicId]` and `notifications`. Practice currently has no registered route in `_layout.tsx` — add it with `presentation: 'fullScreenModal'` (see Practice mode below). Notifications is blocked.

## Tabs

Five: Today · Topics · Learn · Rooms · Chat. Labels are `nav.*` translation keys. The tab bar is 74 px plus safe-area inset, hairline top border, no shadow.

The tab bar is present on every tab screen and every pushed screen **except Practice**.

## Gating

| Condition | Destination | Back behaviour |
| --- | --- | --- |
| No stored refresh token | `(auth)/sign-in` | none — root replace |
| Token present, restoring | `index` with restoration state | none |
| `authUser.onboardingCompleted === false` | `(onboarding)` step 1 | back exits to sign-in only from step 1 |
| Authenticated + onboarded | `(tabs)` | none — root replace |
| `session_expired` mid-session | `(auth)/sign-in` with the expiry message | the pre-expiry route is **not** restored |

Gating uses `router.replace`, never `push`. A back gesture must never reveal an authenticated screen after sign-out.

## Transitions

Format: source → trigger → destination → back → preserved state.

### Learning loop (primary path)

| Source | Trigger | Destination | Back | Preserved |
| --- | --- | --- | --- | --- |
| Learn | tap topic row | `topic/[id]` | → Learn | Learn scroll position |
| Topic | tap **Practise** | `practice/[topicId]` | close control only | topic route stays mounted beneath |
| Practice | select option | same screen, `answer_selected` | — | selection |
| Practice | Check answer | `feedback_*` | — | selection + result |
| Practice | Next question | next unanswered | — | attempt |
| Practice | Open topic | `topic/[id]` **refetched** | → Learn | new progress |
| Practice | last Next | `complete` | close only | attempt summary |
| Complete | Back to topic | `topic/[id]` refetched | → Learn | new progress |
| Topic (returned) | back | Learn **refetched** | — | new progress |

Both returns must refetch. Returning to a cached topic after answering shows stale evidence, which is the one thing the loop exists to prove.

### Quick Practice (shortcut path)

| Source | Trigger | Destination | Back | Preserved |
| --- | --- | --- | --- | --- |
| Learn ink band | Start | `practice/[topicId]` | close only | — |
| Practice | exit | **Learn**, refetched | — | Learn scroll |

**Why both exist.** The topic row is for a learner who wants context before answering — it opens the reading surface, where relations, knowledge counts and coverage live. The band is for a learner who already knows what they want to practise and is skipping that reading. They resolve to the same route with the same attempt semantics; only the return destination differs (Quick Practice returns to Learn, the topic path returns to Topic). Per principle 2, only the band is a filled control.

### Practice mode

Practice is a full-screen presentation, not a tab screen:

- **No tab bar.** Not hidden by opacity — unmounted.
- Exit is the single `close` control, top-leading, 44 px.
- Hardware/gesture back maps to the same exit as the close control.
- Exiting mid-attempt does **not** discard the attempt; `attemptId` persists and re-entry resumes.
- Navigation may appear inside Practice in exactly two places: the exit control, and the post-feedback "Open topic" secondary action. Nothing else.

### Compose

`presentation: 'modal'`. Dismiss is the `close` control or the sheet gesture. Compose has no tab bar. On dismiss with a non-empty body: no confirmation dialog and no draft — the text is lost, and because that is true, the close control is a 44 px target placed away from Publish.

### Search → destinations

| Result type | Destination |
| --- | --- |
| Person | `profile/[handle]` |
| Knowledge / content | `post/[id]` |
| Study group | `group/[id]` — or the group's join view when not a member |
| Community | community route |
| Topic | `topic/[id]` — **blocked** |
| Classroom | `classrooms/[id]` — **blocked** |

Back always returns to Search with the query and scroll position intact.

### Notifications → destinations (design only; route blocked)

correction event → `post/[id]` anchored to the correction · reply/mention → `post/[id]` anchored to the comment · membership → `group/[id]` or `classrooms/[id]` · group content → the group · message → `chat/[id]`.

### Profile → relationship actions

Follow, unfollow and block act in place with an optimistic control state and a revert on failure. They never navigate. Block additionally invalidates any open conversation with that user and returns to the messages list if one is open.

### Classroom

`classrooms/index` → `classrooms/[id]`. A non-member lands on the same route; the server's `viewer.canRead: false` selects the join view. Joining does not navigate — it refetches in place, and the member view replaces the join view. Lecture rows push `lecture/[id]`.

### Messages

`(tabs)/chat` → `chat/[id]`. Entering marks read and pins the unread divider at the entry read position — the divider must not move as further messages arrive. Back returns to the list with the unread count updated.

## Deep links

Scheme `studentos`. Supported by route registration: post, topic, profile, classroom, group, chat. A deep link into an authenticated route while signed out stores the intent, routes to sign-in, and resumes after onboarding is satisfied. A deep link to a blocked route (notifications, practice until registered) must fall back to the tab shell rather than crash.
