# Learn and Topic

## Learn

**Route** `app/(tabs)/learn.tsx`
**Purpose** Show what this learner's own answers indicate, and where there is not enough evidence to indicate anything.
**Primary user question** "What should I practise, and what does the product actually know about me?"
**Dominant action** The ink band — Quick Practice on the highest-ranked practisable topic.
**Secondary actions** topic rows (plain, chevron), saved knowledge, classrooms entry.

**Source repo files** `app/(tabs)/learn.tsx`, `src/components/states.tsx`, `packages/core/src/learning/weakness.ts`.
**API / contract** topic progress per topic, `rankWeakTopics`, `canPractice`.
**Required data** per topic: name, course, `questionsSeen`, `questionsCorrect`, `lowConfidence`, `lastActivityAt`; the practisable topic's unseen count.
**Optional data** `appears_in` relations for the top difficulty topic; saved-knowledge count.
**Unsupported data** mastery, readiness, predicted score, due date, streak, study path, recommended sequence.

### Hierarchy

Title "Learn" → subtitle "Built only from questions you have answered." → 2 px rule → **ink band** (Ready to practise) → "Recent answers suggest difficulty" → "Not enough evidence to say" (dashed group) → privacy line.

The two evidence groups are the screen's argument. Difficulty is a solid group; low evidence is a **dashed, desaturated** group — a structural difference, not a colour warning. `MIN_QUESTIONS_FOR_CONFIDENCE = 5` decides membership, and the client renders the server's `lowConfidence`; it does not compute a threshold.

The one RelationshipPrimitive row on this screen is "Also appears in" under the top difficulty topic — co-occurrence from cohort content, dashed, labelled derived. It exists because knowing a weak topic's neighbours is actionable. It is **not** a claim that the weakness originates there.

### Behaviour

- **Scrolling** one container; the band scrolls with content.
- **Loading** skeleton with the real title and rule.
- **Empty** no answers at all → "Nothing answered yet" + action "Find a topic". The evidence groups are omitted entirely rather than shown at zero.
- **Error / Offline / Restricted** standard; offline keeps cached fractions with the banner and the band inert.
- **RTL** fractions become `٥ من ١٢`; the dashed group and ticks mirror; the connector in the relation row grows toward the trailing edge.
- **Dynamic Type** topic names wrap to two lines; the band's action drops below its text at the largest steps rather than shrinking.
- **360 px** the privacy line may fall below the fold.
- **Accessibility** each topic row is one element: "Nephrotic syndrome, 4 of 7 answered correctly, too small a sample to conclude anything." The caveat is part of the row's label, not a separate node a reader can skip. Group headings are headers.
- **Analytics** none.

**Status** SUPPORTED_NOW.
**Blockers** none for the specified set. Study paths, due queues and adaptive ordering are BLOCKED.

---

## Topic

**Route** `app/topic/[id].tsx`
**Purpose** The reading surface for one topic: what it is, how it connects, what knowledge exists, and what the learner has answered.
**Primary user question** "What is this, and what is here to read?"
**Dominant action** Practise (inline, 44 px, ink).
**Secondary actions** knowledge index rows, relation rows, back.

**Source repo files** `app/topic/[id].tsx`, `src/components/Button.tsx`.
**API / contract** `knowledge.contract.ts` topic detail, `topic_relations`, per-type knowledge counts, `topicProgressSchema`, `canPractice`.
**Required data** topic name, course path, blurb, relations with curated/derived flag, per-type counts, progress.
**Optional data** most-cited knowledge item.
**Unsupported data** prerequisites, "study first", difficulty ordering, estimated time, mastery.

### Hierarchy

Back + crumb → title → blurb → **2 px rule + coverage row with Practise** → "How it connects" (RelationshipPrimitive) → "Knowledge here" (grouped index) → most-cited item with ProvenanceLine.

### The coverage/accuracy split — corrects Turn 3

Turn 3's "You answered 4 of 7 correctly" made one number do two jobs. Final:

- **Coverage** — "3 questions you have not seen", and in metadata "you have answered 8 of 10 here — 4 correct".
- **Accuracy** — the EvidenceFraction `4/8`, correct of answered.

The delta after an answer lands on **accuracy**: incorrect 4/7 → 4/8, correct 4/7 → 5/8. Coverage moves separately.

### Behaviour

- **Scrolling** one container; Practise scrolls with the coverage row (it is inline, not pinned).
- **Loading / Error** standard. **Deleted topic** → "This topic is no longer available" + back.
- **Empty** a topic with no knowledge → the index section is omitted; the relation section and Practise remain.
- **Offline** cached; Practise inert with the banner.
- **Restricted** a topic outside the viewer's scope returns 403 → RestrictedState explaining scope, with back.
- **RTL** crumb separators follow the flow; chevrons flip; relation labels lead.
- **Mixed script** Arabic topic name with a Latin abbreviation (`FSGS`) isolated inline.
- **Dynamic Type** the coverage row stacks its metadata under its heading before Practise wraps.
- **360 px** the knowledge index may fall below the fold.
- **Accessibility** title is the h1; "How it connects" and "Knowledge here" are headers; each relation row is one label; the derived caption is announced once per section.
- **Refetch** returning from Practice **must refetch** — stale evidence here defeats the loop.

**Status** SUPPORTED_NOW.
