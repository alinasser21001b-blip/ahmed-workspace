# Home / Today

**Route** `app/(tabs)/index.tsx`
**Purpose** Show what has arrived in this learner's topics since they last looked, and let them resume an open practice attempt.
**Primary user question** "What is new that concerns what I am studying?"
**Dominant action** The resume band — *only when an open attempt exists* (see §resume rule). Otherwise Home has no dominant action, and that is correct: reading is the action.
**Secondary actions** Search, Compose (both 44 px header glyphs).

**Source repo files** `app/(tabs)/index.tsx`, `src/components/PostCard.tsx`, `src/components/KnowledgeBadges.tsx`, `src/components/surfaces.tsx`.
**API / contract** `content.contract.ts` feed, `knowledge.contract.ts`, `feed-ranking.ts`.
**Required data** feed items (author summary, knowledge type, topic, body, created-at), provenance class + source count, correction status.
**Optional data** excerpt, media, helpful count, open attempt.
**Unsupported data** any per-item relevance explanation, engagement or trending metric, algorithmic label beyond the ranking's own factual grouping.

## Hierarchy

Header (Student OS + date + cohort) → 2 px rule → section groups → optional resume band → tab bar.

Sections are **classification statements, not engagement buckets**: "Classified to your topics" (structure), "Under challenge" (challenged). Each item is a ContentGrammar row separated by hairlines. No cards.

The badge stack from Turn 1 is gone. Eleven pills became: one classification metadata line, one provenance line, one author line. Difficulty and helpful counts moved to post detail.

## Behaviour

- **Layout** single column, 20 px gutter, hairline-separated items.
- **Scrolling** one container between header and tab bar; the resume band scrolls with content.
- **Safe area** top inset in the status row; bottom inset added to the tab bar.
- **Keyboard** n/a.
- **Loading** LoadingSkeleton with the real header and two item-shaped blocks.
- **Empty** "Nothing classified to your topics yet" + action "Browse topics". Reachable for a new student whose interests match no content.
- **Error** ErrorState, full screen, Retry.
- **Offline** cached feed with an OfflineBanner above the first section; Compose remains reachable (it has its own offline state).
- **Restricted** n/a — the feed is already scoped by policy server-side.
- **RTL** section order and item internals mirror; relative timestamps are Arabic words with Arabic-Indic digits.
- **Mixed script** an Arabic body with a Latin drug name or textbook title keeps one baseline (metric siblings) and isolates the Latin run.
- **Dynamic Type** every row grows; the resume band's two text lines wrap before the action shrinks.
- **360 px** unchanged; the author line's role suffix ("instructor") truncates before the name.
- **Accessibility** each item is one `accessibilityElement` with reading order classification → body → provenance → author → status. Section headers are `role="header"`. The challenged status is spoken, never colour-only.
- **Analytics** none — no analytics dependency exists in the repo. Do not add events as part of this work.

**Status** SUPPORTED_NOW.
**Blockers** none.

## The resume rule — resolves the Home/Learn duplication

Home shows the resume band **only if** the learner has an open attempt with unanswered questions. Learn owns the general "ready to practise" band. When both conditions hold, **Home suppresses its band** and Learn's is the only one.

Rationale: two identical filled controls two taps apart, meaning the same thing, violates principle 2. Learn is the surface whose purpose is practice; Home's band is only for finishing something already started.

**Status** DESIGN_READY_CODE_REQUIRED — a suppression condition in the Home selector.

## Post detail + correction thread

**Route** `app/post/[id].tsx`. Full ContentGrammar at `detail` density, then difficulty and helpful count as metadata, then the correction thread: each proposed correction with its author, its state (pending / accepted / rejected), and the challenged rule where pending.

The correction lifecycle is the most academically distinctive thing in the product and the reason Home has an "Under challenge" section at all. **Status** SUPPORTED_CONTRACT_NOT_UI.
