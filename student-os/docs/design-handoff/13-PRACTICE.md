# Practice — the mode, the states, the evidence contract

**Route** `app/practice/[topicId].tsx` — **not currently registered in `app/_layout.tsx`. Register it with `presentation: 'fullScreenModal'`.**
**Purpose** Ask the learner a question the system knows the answer to, then explain the answer and report truthfully what changed.
**Primary user question** "Do I actually know this, and if not, why not?"
**Dominant action** Check answer → then Next question.
**Secondary actions** exit (close), "Open topic" after feedback. **Nothing else. No tab bar.**

**Source repo files** `app/practice/[topicId].tsx`, `packages/contracts/src/learning/practice.contract.ts`, `packages/core/src/learning/grading.ts`, `packages/core/src/learning/weakness.ts`.
**API** `GET` practice session by topic → `practiceSessionSchema`; `POST` answer → `practiceAnswerResultSchema`.
**Required data** `attemptId`, `topicName`, questions (`id`, `kind`, `prompt`, `options`, `answered`), `progress` before.
**Optional data** `explanation` (nullable), `difficulty`, `points`.
**Unsupported data** correctness before submission (never sent), scheduling, streaks, time limits, per-question difficulty adaptation.

## The mode

**Ink header band + white reading body + no persistent tab bar.** The band paints into the top inset and carries light status-bar glyphs. The body is `surface` (#FFFFFF), not paper — the one place in the product with a white reading ground, because it is the one place the learner must not be reading anything else.

### Full dark inversion: tested and rejected

Direction 2c demonstrated a fully inverted Practice. It was tested against all six content states and rejected: it sharpens the stem and the options, and it measurably costs the **explanation**, which is the longest continuous text in the product (15.5/25, often 4–6 lines). Light text on ink at that length is the worst case for sustained reading, and the explanation is the part that teaches. The band keeps the mode switch unmistakable while leaving the teaching surface readable.

**Do not make full inversion part of the system.** Recorded in `CHANGELOG.md`.

## When navigation may appear

Exactly twice: the `close` control in the band, and "Open topic" in the post-feedback footer. No tab bar, no back arrow, no crumb, no header title.

## State machine

```
                  ┌──────────── resume ────────────┐
                  │                                ▼
loading ──▶ idle ──▶ answer_selected ──▶ submitting ──▶ feedback_correct
   │          ▲            │                 │     └──▶ feedback_incorrect
   │          └── deselect ┘                 │                │
   │                                         ├──▶ submit_failed
   ▼                                         │      │
load_failed                                  │      └── retry ──▶ submitting
                                             ▼
                              feedback_* ──▶ next ──▶ idle (next question)
                                        └──▶ complete ──▶ return
```

| From | Event | To | Notes |
| --- | --- | --- | --- |
| loading | session loaded, all `answered: false` | idle | first question |
| loading | session loaded, some `answered: true` | idle **at first unanswered** | resume; answered questions are not re-asked |
| loading | every question answered | complete | attempt already finished |
| loading | request fails | load_failed | ErrorState + Retry, full screen |
| idle | select option | answer_selected | single: replaces; multi: toggles |
| idle | **submit with nothing selected** | submitting | **legal** — empty selection is a valid answer |
| answer_selected | deselect (multi only) | idle if empty | |
| answer_selected | submit | submitting | control shows spinner, width held |
| submitting | 200, `isCorrect: true` | feedback_correct | |
| submitting | 200, `isCorrect: false` | feedback_incorrect | |
| submitting | 200, `alreadyAnswered: true` | feedback_* | **delta block omitted** |
| submitting | network failure | submit_failed | selection preserved |
| submitting | 4xx other than 409 | submit_failed | selection preserved |
| submit_failed | retry | submitting | idempotent — the server returns the stored row |
| submit_failed | exit | return | the answer was not recorded; nothing is claimed |
| feedback_* | next, more remain | idle | |
| feedback_* | next, none remain | complete | |
| feedback_* | Open topic | return (topic, refetched) | |
| complete | Back to topic | return (topic, refetched) | |
| any | close | return | attempt persists; re-entry resumes |

**Invalid transitions, which must be unrepresentable:** idle → feedback (no verdict without submission); submitting → submitting (double-submit — the control is inert while in flight); feedback → answer_selected (an answer cannot be changed after reveal); complete → idle.

## Screen states

| State | Specification |
| --- | --- |
| **entry** | band + counter "1 of N", stem, options, Check enabled (empty selection is valid) |
| **resume** | identical, opening at the first unanswered question; the band's segments already show earlier verdicts |
| **unanswered** | options at 1.5 px border, no hint of the key |
| **selected** | 2 px ink + paper100 + weight 500. **No correctness signal** — `correctOptionIds` has not been received |
| **submitting** | Check shows a spinner at held width; options inert; nothing else changes |
| **correct** | key option: 2 px ink + paper100 + checkmark + "Correct". Why-label in ink reads "Why this is right" |
| **incorrect** | chosen option: 2 px challenged + "You chose". Key option: 2 px ink + checkmark + "Correct". Why-label challenged, reads "Why" |
| **explanation** | ExplanationBlock + ProvenanceLine. `explanation` is nullable — when absent, show the revealed key and delta only, and invent nothing |
| **evidence delta** | "What this changed": before (textFaint) → after (ink 600) + "answered on this topic", then the low-sample caveat while `lowConfidence` |
| **no topic** | `progress` is null → the delta block is replaced by "This question is not attached to a topic, so nothing was updated." The answer was still recorded |
| **already answered** | stored result shown; **no delta**; footer reads Next |
| **submission failed** | inline ValidationMessage above the footer: "That answer did not reach us. Nothing was recorded." + Retry as the dominant action, exit still available |
| **completion** | "Session complete", answered count, the session's start→end accuracy delta, the caveat, "Back to topic" |
| **exit / return** | destination is Topic (topic path) or Learn (Quick Practice path), **refetched** |
| **offline** | entering offline → load_failed with "You are offline" copy. Mid-session → submit_failed on Check; the selection is preserved and Retry works when connectivity returns. Answers are **not** queued optimistically — an unrecorded answer must never render as recorded |

## Question kinds

| Kind | Indicator | Selection | Footer | Reveal |
| --- | --- | --- | --- | --- |
| `mcq_single` | letter A–D / أ–د | replaces | "Check answer" | key + chosen |
| `mcq_multi` | 24 px square | additive | "Check answers" | every option marked; `isCorrect` is **strict** — a half-right selection renders incorrect and shows the full key |
| `true_false` | letter, two options | replaces | "Check answer" | key + chosen |

Partial credit exists in `pointsAwarded` only and is **not shown** — points are not part of the learner-facing design, because a point total is a score, and a score is the overclaim this product is defined against.

## Behaviour

- **Scrolling** stem + options scroll together; the footer is pinned and adds the bottom inset.
- **Keyboard** n/a — no text input in Practice.
- **RTL** counter `٣ من ٧`; segments fill from the trailing edge; option letters أ ب ج د; the delta arrow flips; `borderInlineStart` on the provenance rule.
- **Mixed script** an Arabic stem with `18 g/L`, `pH 7.1`, `+3`, `FSGS` — each isolated LTR, units never translated.
- **Dynamic Type** the stem must remain the largest text on screen at every step. Options grow freely. Option D may fall below the fold — accepted.
- **360 px** verified: 6 lines Latin / 7 Arabic, D below the fold, footer reachable, nothing clipped.
- **Accessibility** see `23` §Practice for the full reading order. Summary: counter → stem → options → (after submit) verdict → correct answer → your answer → explanation → evidence change. **Classification metadata is announced after the stem, never before it.**

**Status** SUPPORTED_NOW for single-select; multi and boolean DESIGN_READY_CODE_REQUIRED; resume SUPPORTED_CONTRACT_NOT_UI; route registration required.

---

# Learning evidence contract

## What Student OS may claim

| Claim | Field | Canonical copy (EN / AR) |
| --- | --- | --- |
| answered count | `questionsSeen` | "you have answered 8 of 10 here" / "أجبت ٨ من ١٠ هنا" |
| correct count | `questionsCorrect` | "4 correct" / "٤ صحيحة" |
| accuracy fraction | both | `4/8` / `٤ من ٨` |
| before/after pair | `progress` before and after | "was 4 of 7, now 4 of 8" / "٤ من ٧ ← ٤ من ٨" |
| small sample | `lowConfidence: true` | "Eight answers is still a small sample. One question does not change what can be said about the topic." / "ثماني إجابات ما تزال عيّنة صغيرة. سؤال واحد لا يغيّر ما يمكن قوله عن الموضوع." |
| insufficient evidence | `lowConfidence` on a topic | "Too small a sample to conclude anything either way." / "عيّنة أصغر من أن يُستنتج منها شيء." |
| difficulty signal | `weaknessScore` ranking | "Recent answers suggest difficulty" / "إجاباتك الأخيرة تشير إلى صعوبة" |
| unseen questions | session/bank count | "3 questions you have not seen" / "٣ أسئلة لم ترها" |
| privacy | policy | "Study-activity signals, not a grade. Private to you." / "إشارات نشاط دراسي، وليست تقييمًا. تظهر لك وحدك." |
| correct answer | `isCorrect` | "Correct" + "Why this is right" |
| incorrect answer | `isCorrect` | "You chose" + "Why" — never "Wrong", never "Try again!" |

## What Student OS must never claim

mastery · mastered · you know · you understand · confidence % · readiness · ready for the exam · weakness score as a number · predicted grade · knowledge score · level · rank · recommended next · study path · due for review · spaced-repetition interval · streak · "you are weak in X".

**`weaknessScore` and `confidence` are real fields and must not be displayed.** `weaknessScore` may **order** a list. `confidence` may only ever surface as the low-sample sentence — and the word "confidence" itself is banned from learner-facing copy, because a learner reads it as self-assurance when it means sample support.

## Rules that outlive this document

1. The client never computes `lowConfidence`. Render the boolean.
2. A single answer never changes what may be said about a topic. The caveat persists through the whole session.
3. `isCorrect` is strict. Do not soften a half-right multi-select.
4. Never celebrate. Never punish. Feedback explains.
5. If a future engineer wants to "improve" this wording, the improvement is almost certainly an overclaim.
