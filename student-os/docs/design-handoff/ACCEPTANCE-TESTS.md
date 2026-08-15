# Implementation acceptance tests

Given/when/then, concrete enough for Detox, Playwright (web target) or manual QA. `[P0]` blocks release.

88 tests, 51 marked P0. Tests 72–88 were added at the contract-reconciliation pass and cover the report modal, the deletion lifecycle and password reset.

## Practice

1. **[P0]** Given an unanswered single-select question, when the learner selects option B, then B shows a 2 px ink border, `paper100` fill and weight 500, **and no correct/incorrect indication appears anywhere on screen**.
2. **[P0]** Given no option is selected, then "Check answer" is **enabled** — an empty selection is a valid answer.
3. **[P0]** Given a submission succeeds, then the panel shows the learner's answer labelled "You chose", the key labelled "Correct", the explanation, and the evidence delta.
4. **[P0]** Given the learner answers incorrectly and progress was 4 correct of 7 answered, then the delta reads `4/7 → 4/8`.
5. **[P0]** Given the learner answers correctly from the same state, then the delta reads `4/7 → 5/8`.
6. **[P0]** Given `lowConfidence: true` in the response, then the small-sample caveat is rendered; given `false`, it is absent. The client performs **no threshold arithmetic** of its own.
7. **[P0]** Given `progress: null` (question without a topic), then the "What this changed" block is replaced by the no-topic sentence and **no fraction is shown**.
8. **[P0]** Given `alreadyAnswered: true`, then the stored result renders and **no delta block appears**.
9. **[P0]** Given `explanation: null`, then the panel shows the revealed key and the delta only, and **no prose is generated**.
10. **[P0]** Given Practice is open, then no tab bar exists in the view hierarchy (unmounted, not hidden), and the only navigation controls are close and — post-feedback — "Open topic".
11. **[P0]** Given a submission fails on the network, then the selection is preserved, an inline message states nothing was recorded, Retry is offered, and **no counter changes**.
12. Given a retry after a failure, when the server had already stored the answer, then the stored result renders once and the counter does not double-count.
13. Given a multi-select question with 3 of 4 key options selected, when submitted, then it renders as **incorrect**, the full key is shown, and no partial-credit score is displayed.
14. **[P0]** Given the learner exits mid-attempt and re-enters the topic, then Practice resumes at the first unanswered question and does not re-ask answered ones.
15. Given the last question is answered, then the completion screen shows the answered count and the session's start→end accuracy delta.
16. **[P0]** Given VoiceOver is active on question load, then the announcement order is question number, stem, options — and the classification metadata is **not** announced before the stem.
17. **[P0]** Given a screenshot of any feedback state converted to greyscale, then correct, incorrect and selected remain distinguishable.

## Learning loop end to end

18. **[P0]** Given the learner starts on Learn, when they open a topic, practise, answer, return to the topic and then to Learn, then **both** screens show the updated fraction — neither serves a cached pre-answer value.
19. **[P0]** Given Quick Practice from the Learn band, when the learner exits, then they land on **Learn** (not Topic), refetched.
20. Given the learner has an open attempt, then Home shows the resume band and Learn's general band is suppressed — **exactly one** filled resume control exists across the two screens.

## RTL and Arabic

21. **[P0]** Given the Arabic UI and an English textbook title in a source line, then the title renders directionally isolated and its comma and full stop stay attached (`Nelson 21e, p.2521`).
22. **[P0]** Given the Arabic UI, then evidence fractions read `٤ من ٨` — never a mirrored slash.
23. **[P0]** Given the Arabic UI, then the back arrow, list chevrons, the evidence-delta arrow and the send glyph are mirrored, while the checkmark, close, shield, search and retry glyphs are not.
24. **[P0]** Given the Arabic UI, then email, password, handle and join-code fields render LTR with leading alignment, while their labels render in Arabic.
25. **[P0]** Given an Arabic string containing a count, then the form matches the CLDR category — `٢` takes the dual (`عضوان`), not the singular.
26. Given the Arabic UI and a clinical value, then `18 g/L`, `pH 7.1` and `+3` render Latin with Latin units.
27. Given the Arabic UI in a group conversation, then own bubbles align to the left and received bubbles to the right, achieved by flex alignment (no absolute positioning).
28. Given an Arabic display name beside a Latin handle, then `@noor_hj · Stage 3` renders as one isolated LTR run aligned to the reading start.
29. **[P0]** Given the device locale is neither `en` nor `ar`, then the app starts in Arabic and direction is RTL from first paint.
30. Given an Arabic query with tashkeel, when no results return, then the empty state advises a shorter word — it does **not** claim different keywords will help.

## Dynamic Type and 360 px

31. **[P0]** Given 360 px width and the largest supported text step, when a four-option question renders, then no critical control overlaps and "Check answer" remains reachable without scrolling back.
32. **[P0]** Given the same conditions, then no text is clipped or truncated in the stem or any option label.
33. **[P0]** Given the largest text step on Compose with the keyboard visible, then Publish is fully visible and does not overlap the classification rows.
34. Given the largest text step, then no interface text renders below 13 px anywhere.
35. Given a 48-character Arabic classroom title, then it wraps to three lines and clears the header rule without clipping.

## Colour semantics

36. **[P0]** Given any screen, then teal appears **only** on provenance/citation elements and the handle-availability confirmation.
37. **[P0]** Given any screen, then at most **one** filled ink control is visible.
38. Given a correct answer, then it is ink with the word "Correct" — **not** green and not teal.
39. Given a sent message, then the bubble is ink and the state is a word ("Sent"), not a coloured tick.

## Search

40. **[P0]** Given a Group result, then it appears under "Study groups" and a Community result under "Communities" with an "Official" label — the two are semantically distinguishable.
41. Given a query under 2 characters, then no request is made.
42. Given topic search is not yet implemented, then **no "Topics" section renders** — the section must not appear speculatively.
43. Given classroom search lands later, then a non-member classroom row shows title, course code and member count and **never** a lecture count.

## Messages

44. **[P0]** Given a message send fails, then the bubble shows "Failed" plus a 44 px retry, and the message is not silently dropped.
45. **[P0]** Given the learner enters a conversation with unread messages, then the unread divider is pinned at the entry read position and **does not move** as further messages arrive.
46. Given `chat.readOnly`, then the composer is **absent from the view hierarchy** and replaced by the reason sentence — not present-but-disabled.
47. Given the socket is closed, then the connection line is visible on both the list and the conversation.
48. Given an out-of-order `read` receipt arriving before `delivered`, then no illegal-transition error is thrown and the state does not regress.

## Classroom

49. **[P0]** Given `viewer.canRead: false`, then no lecture titles or member names appear anywhere in the response or the view.
50. Given a student viewer, then no join code is displayed.
51. Given a member view, then lectures render numbered with material counts, in Arabic-Indic digits under the Arabic UI.

## Compose

52. **[P0]** Given an empty body and no image, then Publish is disabled and no error text is shown before interaction.
53. **[P0]** Given an image over 8 MB, then the size error renders inline and **the typed text is retained**.
54. Given the screen opens, then the audience control is pre-selected from `defaultPostVisibility` and the classification control is unset.
55. Given a selected classification chip is tapped again, then it clears.
56. Given the learner dismisses Compose with text present, then no draft is created and no promise of one was shown.

## Auth

57. **[P0]** Given wrong credentials, suspended account, offline and rate-limited, then four **distinct** messages render — never one generic failure.
58. **[P0]** Given sign-out, when the back gesture is used, then no authenticated screen is revealed.
59. Given a session expires mid-use, then sign-in shows "Your session ended" and the pre-expiry route is not restored.
60. Given onboarding step 5, then Finish stays inert until the handle is confirmed available and a display name exists.
61. Given a failed Finish, then every entered value is retained.

## System states

62. **[P0]** Given any screen loads, then a skeleton shaped like that screen renders — no full-screen spinner.
63. **[P0]** Given any empty state except the notifications tray, then an action is present.
64. Given a load error, then the message states the user did not cause it, and Retry is a secondary control (not the dominant ink control).
65. Given a permission restriction, then the forbidden control is absent and replaced by a reason — never disabled in place.
66. Given a refetch over existing content, then the stale content stays visible with the attention rule and is not covered by a spinner.

## Accessibility

67. **[P0]** Given a screen reader, then a feed item is one element read in the order classification, body, provenance, author, status.
68. **[P0]** Given any interactive element, then its measured target is ≥ 44 px (list rows ≥ 48, practice options ≥ 56).
69. Given a validation error, then it is announced politely and focus moves to the message.
70. Given reduced motion, then all transitions resolve at 0 ms and nothing depends on animation for meaning.
71. Given Compose or Practice is open, then focus is trapped and the first focusable element is the close control.

## Report (modal is the contract)

72. **[P0]** Given the report modal is open, then it fills the screen it opened over, the reason list, the detail field and the submit control are all reachable without dragging the surface, and content behind it is inert and unannounced to a screen reader.
73. **[P0]** Given a reason is picked and detail text typed, when the person taps outside the modal, then **nothing is discarded** — dismissal happens only through the explicit Cancel or the system back gesture.
74. Given the modal opens, then focus moves to its title; given it closes, then focus returns to the overflow control that opened it.
75. Given a second report on the same target by the same reporter, then it updates rather than duplicating, and the already-reported state (`report.alreadyFiled`) renders instead of a second submission.

## Account deletion lifecycle

76. **[P0]** Given the deletion route opens, then the warning copy — what is destroyed **and** what survives — is visible without scrolling at 360 px and the default text step, before any field is filled, and is not behind a disclosure.
77. **[P0]** Given the password field is empty **or** the confirmation is not exactly `DELETE`, then the submit control is inert; given a non-matching confirmation, then that field's border is `danger` with an inline message, and the field remains editable.
78. **[P0]** Given a submission is in flight, then the submit control shows its busy state at held width, the form is inert, and **no cancel control exists** — and no full-screen processing view replaces the screen.
79. **[P0]** Given deletion succeeds, then the success copy replaces the submit control so it cannot be pressed twice, the local session is forgotten without calling logout, the app replaces to sign-in, and **back never reveals an authenticated screen**.
80. **[P0]** Given a wrong password and given any other failure, then **two distinct messages** render — the first attached to the password field, the second generic — the password field clears while other input is retained, no copy implies partial deletion, and the support link appears on the generic branch only.
81. **[P0]** Given any deletion screen in either locale, then no copy states a retention window, grace period or recovery path, and no copy claims messages are deleted.

## Password reset

82. **[P0]** Given any syntactically valid email is submitted on forgot-password, then the sent state renders **identically whether or not an account exists** — no "no account found", no timing difference — focus moves to its title, and the submit control is removed.
83. **[P0]** Given a reset token that is invalid, expired or already spent, then `auth.error.resetTokenInvalid` attaches to the token field and the forgot-password route is reachable from the same region.
84. Given the route is reached through the `studentos` deep link, then the token field is pre-filled and read-only; given it is reached by hand, then the token can be typed or pasted.
85. **[P0]** Given a reset succeeds, then the person lands on sign-in and is **not** auto-authenticated; given it fails, then the token is retained and the password field clears.
86. Given the Arabic UI on either screen, then the email, token and password fields are `forceLTR` with leading alignment while their labels render Arabic.
87. **[P0]** Given either reset screen in either locale, then the copy says "reset link or code" and **never** names only one of the two — the sent state reads "Check your email for a reset link or code." and the reset state "Open the reset link, or enter the reset code manually."
88. Given a grep of `en.ts` and `ar.ts`, then `settings.deleteAccount.confirmTitle` does not exist, and no screen renders a second deletion title.
