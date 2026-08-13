# UX Architecture

> Constitution §89.E. Screens, navigation, and the rules that keep this from
> looking like either an LMS or an Instagram clone.

## 1. Visual identity

The product has to read as **academic and social at once**. Two decisions carry
most of that:

- **Deep indigo primary**, not blue-grey enterprise and not social-app gradient.
  Serious enough to sit under dense text.
- **Teal reserved exclusively for learning actions.** "Continue lecture" and
  "take quiz" never look like "like" or "follow". This single reservation is
  what stops the product collapsing into a social app with coursework attached.
  It is enforced by having `learning` be a `Button` variant, not a colour prop.

Everything else is ordinary and deliberate: 4pt spacing scale, generous line
heights (Arabic carries more vertical detail and becomes unreadable at tight
leading), one text primitive, one card primitive.

## 2. Navigation

```
Tabs:  Home · Groups · Create · Learn · Chat
Global: search, notifications, profile (behind the avatar)
```

Five tabs, not ten (§54). **Learn is its own destination**, not a section
inside Home — if studying is reachable only by scrolling past a social feed,
the product has already lost the argument it exists to make.

```
/                       routing gate
├── (auth)/sign-in · sign-up
├── (onboarding)/       university → college → program → stage → profile
└── (tabs)/
    ├── index           Home
    ├── groups          Groups
    ├── create          Create
    ├── learn           Learn
    └── chat            Chat
```

The gate at `/` reads one server-provided fact, `onboardingCompleted`, and
routes on it. Guessing that client-side is how users end up stranded outside
their own cohort.

## 3. Screen map

| Screen | Phase | State |
| --- | --- | --- |
| Sign in / Sign up | 0 | **Built** |
| Onboarding (5 steps) | 0/1 | **Built** — every option fetched from the hierarchy API |
| Home shell | 0 | **Built** — real profile header + section scaffolding + empty states |
| Groups / Create / Learn / Chat shells | 0 | **Built** — real empty states with actions |
| Feed, post composer, post detail | 2 | **Built** |
| Community, group detail (Chat/Resources/Posts/Study/AI tabs) | 3 | **Built** |
| Conversation, thread | 4 | **Built** |
| Topic (hierarchy · subtopics · related · knowledge, filtered by type) | 5 | **Built** |
| Post detail with sources and corrections | 5 | **Built** |
| Learn (focus topics · interests · saved · this week) | 5 | **Built** |
| Classroom (Overview/Lectures/Materials/Quizzes/Live/Discussion/Progress/AI) | 5b | Contracted |
| Lecture hub (material · summary · objectives · quiz · flashcards · discussion · reels · AI) | 5b/6 | Contracted |
| Quiz player, results, topic performance | 7 | Contracted |
| Reels feed | 8 | Contracted |
| Learning profile, weak topics | 11 | Contracted |
| Admin console (web) | 12 | Contracted |

## 4. Rules the components enforce

Some product rules are better enforced by a component than by a review comment.

| Rule | Enforced by |
| --- | --- |
| No hardcoded colours or spacing | `useTheme()`; tokens are the only source |
| No hardcoded strings | `t(key)`; the English catalogue is typed against the Arabic one, so a missing translation is a **compile error** |
| Every async surface has loading / empty / error / retry | `LoadingState`, `EmptyState`, `ErrorState` in `states.tsx` — a screen missing one is visibly incomplete in review |
| Empty states are never dead ends | `EmptyState` takes an `action` |
| Learning ≠ social affordance | `Button variant="learning"` |
| Minimum 44pt touch targets | `MIN_TOUCH_TARGET` in `Button`, `Input` |
| RTL correctness | `theme.isRTL`; `Text` sets `writingDirection`; layout uses logical alignment |
| A chip that navigates is announced as a control | `Badge` renders a `Pressable` with `accessibilityRole="button"` when given `onPress`, and a plain `View` otherwise — an inert button is never produced by accident |
| Knowledge is described, never rated | `KnowledgeBadges` renders counts and a provenance class; there is no component that can display a score, because none exists to display ([ADR-0013](adr/0013-provenance-classes.md)) |

## 5. Empty states as a first-class surface

A product with 100 users is mostly empty states in week one. Each one names the
situation honestly and offers the next useful action:

> **لا توجد مجموعات دراسية بعد** — أنشئ مجموعة مع زملائك للمذاكرة ومشاركة الملفات.
> `[ إنشاء مجموعة دراسية ]`

## 6. Honesty in the UI

`learn.signalsDisclaimer` — *"these are study activity signals, not an
assessment of your ability"* — appears on every surface built from activity
counts. Constitution §35 requires this framing in the data model; putting it in
the interface too is the part that actually reaches the student.

Phase 5 extended the same rule to three more places:

- **A weak signal says so on the row.** A weakness computed from two answers
  carries `learn.focus.lowConfidence` beside it, not in a footnote a student
  will not read.
- **`author_claim` is shown by its absence.** Most student notes are exactly
  that, and badging every one of them would train readers to ignore the badge —
  costing the cases it exists for. Only `source_backed`, `disputed` and
  `corrected` get a chip.
- **Disputed content is flagged, not hidden.** `ReaderCaution` sits *above* the
  body, because a disagreement is often where the learning is; the product's job
  is to make sure the reader knows before they read, not to decide for them.

## 7. Internationalisation

Arabic is primary and the default; English is secondary. Direction is resolved
once at startup from the device locale and applied before first paint — a
mid-session flip leaves half the tree mirrored.

The E2E test runs the entire first journey **in Arabic**, because RTL is where
layout bugs actually appear and an English-only happy path would hide them.

## 8. Accessibility

Semantic roles on every control (`button`, `link`, `checkbox`, `alert`,
`progressbar`), `accessibilityLiveRegion` on validation feedback, labelled
inputs, 44pt targets, decorative skeletons hidden from screen readers, and
contrast checked in both themes. Video captions and transcripts arrive with
Phase 8/10 media.
