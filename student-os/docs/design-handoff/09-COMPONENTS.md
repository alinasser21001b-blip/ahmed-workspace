# Component inventory

31 components. A component exists here only because two or more contexts share its **semantic** behaviour — not to raise a count. Anything used once is written inline in its screen.

Schema per entry: purpose · anatomy · props · variants · states · interaction · a11y role · RTL · Dynamic Type · min target · used on · repo dependency · status.

---

## Shell

### AppShell
Providers and direction. **Anatomy:** SafeAreaProvider › I18nProvider › ThemeProvider › SessionProvider › RealtimeProvider › Stack. **Props:** none. **RTL:** `applyDirection(locale)` runs once before first paint; no runtime flip. **Repo:** `app/_layout.tsx`. **Status:** SUPPORTED_NOW.

### TopBar
**Purpose:** the screen's own header — the navigator draws none. **Anatomy:** status-bar row › [back control 44 px] [crumb metadata] › title block › 2 px ink rule. **Props:** `title`, `crumb?`, `onBack?`, `actions?[]`, `rule?: boolean`. **Variants:** with-crumb (Topic, Classroom, Profile), with-actions (Home, Search), title-only (Learn, Messages, Notifications). **States:** default; scrolled (no change — the title does not collapse). **A11y:** title is `accessibilityRole="header"`. **RTL:** back glyph flips `arrow-back`→`arrow-forward`; crumb separators reverse with the flow, not by string reversal. **Dynamic Type:** title wraps, never truncates; the rule sits below the wrapped block. **Target:** back 44. **Used on:** every screen except Practice and Compose. **Status:** DESIGN_READY_CODE_REQUIRED.

### TabBar
Five items, 74 px + bottom inset, hairline top, no shadow. **Props:** `active`. **States:** active (filled glyph, ink, weight 600) / inactive (outline glyph, textMuted, 500). **A11y:** `accessibilityRole="tab"`, `selected`. **RTL:** order reverses. **Target:** 48 each. **Absent on:** Practice, Compose, auth, onboarding. **Repo:** `app/(tabs)/_layout.tsx`. **Status:** SUPPORTED_NOW.

---

## Text primitives

### EditorialHeading
**Purpose:** the display voice. **Props:** `level: 'display'|'screen'|'knowledge'`, `children`. **Variants:** by level and by script. **RTL/script:** Newsreader for Latin, IBM Plex Sans Arabic 600 for Arabic — resolved from the *content's* script where mixed, otherwise from locale. **Dynamic Type:** scales fully, wraps, never truncates. **Used on:** all screen titles, knowledge bodies in feed/search/profile/notifications. **Forbidden on:** chat, settings, form labels. **Status:** DESIGN_READY_CODE_REQUIRED.

### MetadataLine
**Purpose:** every interface fact. The one universal primitive. **Anatomy:** a single 13/20 line, weight 500, textMuted, parts joined by ` · `. **Props:** `parts: (string|node)[]`, `tone?: 'muted'|'structure'|'challenged'|'provenance'|'attention'`. **States:** default only. **A11y:** joined into one label with commas so a screen reader does not read "middle dot". **RTL:** part order follows reading direction; each Latin part is isolated. **Target:** n/a (not interactive). **Used on:** every screen. **Status:** DESIGN_READY_CODE_REQUIRED.

### SectionHeader
13/20 weight 600, sentence case, ink or a role colour. Optional trailing count or link. **Used on:** Learn, Topic, Search, Notifications, Classroom, Compose. **Never uppercase.** **Status:** DESIGN_READY_CODE_REQUIRED.

---

## Academic primitives — the load-bearing four

### ProvenanceLine
**Purpose:** the product's defining primitive. States that a claim is sourced.
**Anatomy:** 2 px teal rule on the leading edge · 11 px inset · line 1 "Cites N sources" (weight 600, teal) · line 2 source title + locator (metadata, textMuted, locator in mono).
**Props:** `sourceCount`, `sources: {title, locator?}[]`, `density: 'full'|'inline'`.
**Variants:** `full` (two lines, on post detail and topic) · `inline` (one line, "Cites 2 sources — Nelson 21e", in feed rows and search results).
**States:** present · **absent → renders nothing at all** (no "no sources" placeholder — see `17-PROVENANCE` below) · long source (title wraps, locator moves to its own line before either truncates).
**A11y:** `accessibilityLabel`: "Cites 2 sources. Nelson 21st edition, page 2521." Digits spoken, not spelled.
**RTL:** `borderInlineStart` — flips with no second rule. Latin source titles isolated.
**Target:** non-interactive today. If sources become tappable, 44 px per source row.
**Used on:** feed, post detail, topic, search knowledge results, profile posts, notification rows.
**Forbidden:** as ordinary metadata. A timestamp is not provenance.
**Repo:** `knowledge.contract.ts` provenance class + source count. **Status:** SUPPORTED_NOW.

### RelationshipPrimitive
**Purpose:** topic-to-topic structure, drawn rather than listed.
**Anatomy:** one row per relation — `[label, fixed width] [connector line, flex] [target name]`, 44 px min height.
**Props:** `relations: {type, label, target, derived: boolean}[]`.
**Allowed types — exhaustive:** `part_of` ("Part of") · `has_type` ("Types") · `co_occurs` ("Seen with") · `appears_in` ("Also appears in", Learn only).
**Forbidden types:** prerequisite, recommended-next, weakness-origin, causal, difficulty-ordering. None is supported by `topic_relations`, and implying one is a product claim.
**Variants:** curated (solid connector, structure-coloured label) · derived (dashed connector, muted label, plus one caption "dashed = found in cohort content, not curated").
**States:** default · empty (the whole section is omitted) · overflow (more than 5 relations → show 4 and a "See all" row; never a horizontal scroller).
**A11y:** each row is one label — "Part of: Glomerular disease". The connector is decorative, `accessible={false}`. Announce the derived caption once per section, not per row.
**RTL:** label leads, connector grows toward the trailing edge. Never mirrored geometry.
**Dynamic Type:** label column widens with text; the connector shrinks and may reach 0 width, at which point the row wraps to two lines.
**Target:** 44 when tappable.
**Used on:** Topic ("How it connects"), Learn (one row on the difficulty topic).
**Forbidden on:** classroom rosters, search, messages, settings.
**Status:** SUPPORTED_NOW for the four allowed types.

### EvidenceFraction
**Purpose:** state what was answered without implying knowledge.
**Anatomy:** `correct` mono 15/500 ink + `/total` in paper400 — or in Arabic the word form `٥ من ١٢`.
**Props:** `correct`, `answered`, `lowConfidence`, `showTicks?`.
**Variants:** bare fraction · with tick band (12 max segments, ink filled / paper200 empty) · with delta (`before → after`).
**States:** normal · low-sample (dashed container, muted, plus the caveat sentence) · **delta** (before in textFaint, arrow, after in ink 600) · zero-answers (renders "Not answered yet", never "0/0").
**A11y:** label "5 of 12 answered correctly". The tick band is `accessible={false}` — it restates the fraction. The delta announces "was 4 of 7, now 4 of 8".
**RTL:** the slash does not mirror safely, so Arabic uses `٥ من ١٢`. Ticks fill from the trailing edge; the counter sits at the reading end. The delta arrow flips — it means "progressed to".
**Target:** n/a.
**Used on:** Learn, Topic, Practice feedback, Practice completion.
**Forbidden on:** profiles, anywhere social, anywhere another person can see it.
**Repo:** `topicProgressSchema`. **Status:** SUPPORTED_NOW.

### ContentGrammar (knowledge row)
**Purpose:** one representation of an academic object everywhere it appears, so no feature team invents a second.
**Anatomy, in fixed order:** classification metadata ("Explanation · Nephrotic syndrome") › EditorialHeading knowledge body › optional body excerpt › ProvenanceLine › author metadata (avatar 24 px, name, verification glyph, role, relative time) › optional status (challenged).
**Props:** `knowledgeType`, `topicName`, `body`, `excerpt?`, `provenance?`, `author`, `status?`, `density: 'feed'|'search'|'profile'|'detail'`.
**States:** default · challenged (challenged-coloured status block, correction pending) · corrected (accepted correction noted) · deleted ("This has been removed", body suppressed).
**A11y:** reading order is exactly the visual order; classification is read first because it frames the claim.
**Used on:** Home feed, post detail, Topic, Search, Profile.
**Repo:** `content.contract.ts`, `knowledge.contract.ts`. **Status:** SUPPORTED_NOW.

---

## Rows

### AcademicRow
Generic grouped row: hairline top border, 48 px min, `[content] [count?] [chevron?]`. **Used on:** knowledge index, lectures, settings. **RTL:** chevron flips. **Status:** DESIGN_READY_CODE_REQUIRED.

### TopicRow
`[topic name, display voice] [EvidenceFraction]` + MetadataLine. 52 px min. **Variants:** normal · low-sample (inside the dashed group) · updated (attention-coloured "updated after your last session"). **Used on:** Learn. **Status:** SUPPORTED_NOW.

### ClassroomActivityRow
`[N · lecture title] [materials · duration · posted]` + chevron. 66 px min. Numbered because a block is a sequence, not a stream. **RTL:** Arabic-Indic lecture number. **Repo:** `LectureSummary`. **Status:** SUPPORTED_NOW.

### ConversationRow
`[avatar 44] [name + time] [preview + unread badge]`. 72 px min. **States:** unread (structure badge, name weight 600) · read · empty ("No messages yet", textFaint) · failed-last-message (challenged preview). **RTL:** avatar leads; time at the trailing edge; preview truncates at the reading end. **Repo:** `Conversation`. **Status:** SUPPORTED_NOW.

### SearchResultRow
Four shapes under one language — see `16-SEARCH.md`. The section heading carries the type, so the row never repeats it. **Status:** SUPPORTED_NOW.

### NotificationRow
`[event sentence] [MetadataLine]`. Correction events use the knowledge display voice; everything else uses 15/22 weight 500. **States:** unread (structure leading marker) · read · collapsed ("3 comments on…"). **Status:** BLOCKED_BY_PRODUCT_CAPABILITY.

---

## Actions

### DominantAction
**Purpose:** the one filled control. **Anatomy:** ink fill, radius 6, 54 px min, paper label 15.5/600, centred. **Props:** `label`, `onPress`, `disabled`, `loading`, `inverse?`. **Variants:** full-width footer (Practice, Compose, Auth) · inline (Topic's Practise, 44 px) · `inverse` (paper fill on an ink band — Learn's Start). **States:** default · pressed (opacity 0.85, 120 ms) · **disabled (paper400 fill, not reduced opacity — a greyed label at 45% fails contrast)** · loading (label replaced by a spinner, width held). **A11y:** `accessibilityRole="button"`; `accessibilityState={{disabled, busy}}`. **Target:** 54. **Rule:** at most one visible per screen. **Status:** DESIGN_READY_CODE_REQUIRED.

### SecondaryAction
1.5 px borderStrong outline, transparent fill, ink label. 48–54 px. Used beside a DominantAction (Practice's "Open topic") or alone (Retry, Following). **Status:** DESIGN_READY_CODE_REQUIRED.

### ChipPicker
**Purpose:** a mutually exclusive choice the author makes. **Anatomy:** wrapping row, pill radius, 44 px min per chip, 6 px gap. **Props:** `options`, `value`, `onChange`, `allowUnset`, `label`, `optional?`. **States:** selected (ink fill, paper label, 600) · unselected (borderStrong outline, textSecondary, 500) · disabled · error (challenged border on the group, message below). **A11y:** `accessibilityRole="radio"` per chip inside a `radiogroup` with the section title as its label. **RTL:** wraps from the reading edge. **Used on:** Compose audience / knowledge type / difficulty, Onboarding interests. Same decision shape, same control. **Status:** SUPPORTED_NOW.

---

## Practice

### PracticeHeader
**Anatomy:** ink band painting into the top inset › status-bar row (light glyphs) › `[close 44] [segment bar, flex] [counter]`. **Props:** `total`, `index`, `results[]`, `onExit`. **Segment states:** unanswered `#3C3A34` · current `#8E8B82` · answered-correct `#FCFBF9` · answered-incorrect challenged. Four states, no teal, distinguishable in greyscale. **A11y:** the bar is `accessible={false}`; the counter carries "Question 3 of 7". **RTL:** segments fill from the trailing edge; counter reads `٣ من ٧`. **Status:** DESIGN_READY_CODE_REQUIRED.

### PracticeStem
The question. 24/34 Newsreader (Latin) or 22/40 IBM Plex Sans Arabic 600. **Must remain the largest text on the screen at every Dynamic Type step.** Never truncates, never clamps. **A11y:** the first element in reading order after the counter; classification metadata is announced *after* the stem, not before. **Status:** SUPPORTED_NOW.

### AnswerOption
**Anatomy:** `[letter, mono] [label] [badge?]`, 56 px min, radius 6.
**Props:** `letter`, `label`, `kind: 'single'|'multi'|'boolean'`, `selected`, `revealed`, `isCorrect`, `wasChosen`, `onPress`.
**States:** default (1.5 px border) · selected (2 px ink + paper100 + weight 500, **no correctness hint**) · correct-revealed (2 px ink + paper100 + checkmark + "Correct") · chosen-and-wrong (2 px challenged + "You chose") · other-after-reveal (1 px paper200, label dimmed to #9C978B) · disabled-after-submit.
**Multi-select variant:** square 24 px indicator instead of a letter circle; selection is additive; the footer control reads "Check answers"; on reveal, each option shows its own correct/incorrect mark. Partial credit affects `pointsAwarded` only — `isCorrect` is strict, so a half-right multi-select renders as **incorrect** with the full key shown.
**True/false variant:** two options, labels from `practice.true`/`practice.false`, same anatomy.
**A11y:** `accessibilityRole="radio"` (single/boolean) or `"checkbox"` (multi); `accessibilityState={{checked, disabled}}`; after reveal the label appends ", correct answer" or ", your answer, incorrect".
**RTL:** letter leads; Arabic letters أ ب ج د; badge at the trailing edge.
**Dynamic Type:** grows to any height; two-line labels are normal.
**Target:** 56.
**Status:** SUPPORTED_NOW (single) · DESIGN_READY_CODE_REQUIRED (multi, boolean).

### FeedbackPanel
**Anatomy:** why-label (ink if correct, challenged if not) › ExplanationBlock › ProvenanceLine › hairline › "What this changed" + EvidenceFraction delta › low-sample caveat.
**Props:** `isCorrect`, `explanation`, `sources`, `progressBefore`, `progressAfter`, `lowConfidence`, `alreadyAnswered`.
**States:** correct · incorrect · **no explanation** (`explanation` is nullable — the panel then shows only the revealed key and the delta; it must not invent prose) · **no topic** (`progress` is null — the "What this changed" block is omitted entirely, replaced by "This question is not attached to a topic, so nothing was updated") · `alreadyAnswered` (stored result shown, **delta block omitted** — no counter moved).
**A11y:** on reveal, announce via `AccessibilityInfo.announceForAccessibility`: verdict → correct answer → your answer → explanation → evidence change. Focus moves to the why-label.
**Status:** SUPPORTED_NOW.

### ExplanationBlock
15.5/25 (Latin) or /29 (Arabic), textSecondary, `textWrap: pretty`. The longest text in the product — this is why full dark inversion was rejected. **Status:** SUPPORTED_NOW.

---

## Messaging

### MessageBubble
**Anatomy:** `[sender name if group and not own] [body] [state, own only]`, max 85% width, radius 12.
**Props:** `body`, `own`, `senderName?`, `state: MessageState`, `onRetry?`.
**States — all six from `message-state.ts`:** `queued` (own, 60% opacity, "Queued") · `sending` (60% opacity, "Sending…") · `sent` ("Sent") · `delivered` ("Delivered") · `read` ("Read") · `failed` (challenged word "Failed" + retry glyph, 44 px tap).
Own bubbles are **ink, not teal**. Received bubbles are surface with a hairline border.
**A11y:** label is "You: {body}, sent" or "{sender}: {body}". Retry is a separate button.
**RTL:** own bubbles align to the reading end (left in Arabic) via flex, never absolute positioning.
**Repo:** `message-state.ts`, `src/state/outbox.ts`. **Status:** SUPPORTED_NOW.

### UnreadDivider
Rule · "Unread" · rule, in structure. **Pinned at the read position on entry and immutable for the session** — it must not slide as messages arrive. **Status:** SUPPORTED_NOW.

### Composer
`[field, 44 px min, grows to 5 lines] [send 44 px circle]`. **States:** empty (send disabled) · typing · sending · offline (field usable, send queues) · read-only (**the composer is removed and replaced by a reason line**, not disabled). **RTL:** the send glyph mirrors — a paper plane depicts motion along the writing direction. **Status:** SUPPORTED_NOW.

### SharedAcademicReference — **contract only, do not build**
The shape agreed in advance so backend work has a target: `[type label] [title] [ProvenanceLine inline?]` in a bordered block inside a bubble, types limited to topic · post · classroom · source. **Status:** BLOCKED_BY_PRODUCT_CAPABILITY.

---

## Identity and forms

### ProfileIdentity
`[avatar 56] [display name, display voice] [academic context metadata]` › bio › contributionScore + label › interests. **A11y:** name is a header; the score's label is part of its own accessibility label ("142, contribution score"). **Repo:** `profileSchema`. **Status:** SUPPORTED_NOW.

### FormField
`[label 13/600] [field 50 px] [helper or error]`. **Props:** `label`, `value`, `error?`, `helper?`, `keyboardType`, `forceLTR?`. **States:** default · focused (2 px ink border) · error (1.5 px challenged + ValidationMessage) · success (helper in teal — used only for handle availability) · disabled. **RTL:** label follows locale; `forceLTR` fields (email, password, handle, join code) keep `direction: ltr` and leading alignment in both languages. **A11y:** label is bound via `accessibilityLabel`; the error is `accessibilityLiveRegion="polite"`. **Status:** SUPPORTED_NOW.

### ValidationMessage
2 px challenged leading rule + 13/500 message + optional recovery line. Never a toast — errors stay attached to their cause. **Status:** SUPPORTED_NOW.

---

## States

### LoadingSkeleton
Blocks shaped like the incoming screen — real header, real rules, paper200 at 60% opacity for content. **No spinner on a full screen. No shimmer animation** (it is decorative motion). **Repo:** `states.tsx` Skeleton. **Status:** SUPPORTED_NOW.

### EmptyState
Display-voice line › explanation › **required action**. Never illustrated. The repo already requires an action; that rule stands. **Status:** SUPPORTED_NOW.

### ErrorState
Challenged display line › "Nothing you did caused it." › Retry (SecondaryAction). **Status:** SUPPORTED_NOW.

### OfflineBanner
2 px attention leading rule, inline at the top of content — **not a floating toast**. States what is preserved. **Status:** SUPPORTED_NOW.

### RestrictedState
Replaces the forbidden control with a plain sentence explaining who may act. Never a disabled control. **Status:** SUPPORTED_NOW.
