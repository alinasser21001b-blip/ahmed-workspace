# Screen-by-screen audit

Rendered from the running corrected build at 390 px (en + ar) and desktop.
Severity: P0 blocks pilot, P1 before students judge quality, P2 polish.
`DO_NOT_IMPLEMENT_YET: true` applies to every entry.

Legend: RC-nn = systemic cause in `09-ROOT-CAUSES.md`.

---
**Auth** · `/(auth)/sign-in` · frame 5f
Works: composition matches the frame; serif title; hairline inputs; one filled
action; quiet links. Fails: preview banner above the masthead (RC-01);
"Forgot password?" link sits flush-left with field labels and reads as a label
at a glance. Severity P1. Keep: everything structural. Rethink: banner.
Owner impact: first screen already carries scaffolding.

**Today** · `/` · frame 3a[0]
Works: masthead, rule, classified section, cites blocks, author rows — the
identity screen, recognizably the frame. Fails: banner (RC-01); date line
wraps to two lines (fixture string length, RC-02); resume band absent in
fixture world so the screen's dominant action never appears (RC-02); feed is
3 items then void (RC-04). Severity P1. Keep: all composition.

**Topics** · `/topics` · spec 03/04 (no drawn frame)
Works: serif topic rows are handsome; course header with mono code. Fails:
three rows then an 80 % void (RC-02/RC-04); subtitle sits directly on the
2 px rule and the course header directly under it — three text lines with no
breathing rhythm (typography spacing, local); a curriculum of one course does
not feel like a curriculum (RC-02). Severity P1. Rethink: sparse composition.

**TopicDetail** · `/topic/[id]` · frame 3a[2]
Works: crumb, serif title, evidence line, knowledge list with provenance.
Fails: banner; knowledge filter chips' selected state fine but list thins to
2–3 entries (RC-02). Severity P2.

**Learn** · `/learn` · frame 3a[1]
Works: ready-band, difficulty group, dashed low-evidence group — matches
frame. Fails: banner; ink band's Start is the only strong move, rest sparse
(RC-04); the approved Learn→Topic survivor transition is absent — rows just
navigate (RC-06). Severity P1.

**PracticeQuestion / Selected / Correct / Incorrect / Feedback** ·
`/practice/[topicId]` · frames 3a[3], 4a/4b
Works: the best surface in the product. Band + segments + mono counter, serif
stem largest on screen, lettered hairline options, fill+rules+check selection
at 120 ms, worded verdict, staged reveal, quiet completion, pinned footer.
Fails: **the preview banner sits above the focus band — the one screen whose
contract is "nothing else on screen" carries chrome** (RC-01, P0 within this
screen); explanation can scroll under the pinned footer with no scrim/fade
cue (P2). Severity: P0 (banner) / P2. Keep: everything else exactly.

**Rooms** · `/rooms` · spec 03 (no frame)
Works: two labelled groups; Browse / Create actions. Fails: two rows in an
85 % void (RC-04); **mixed-script group name truncates with leading ellipsis**
(RC-03, P0); classroom named only in Arabic while UI is English — content
language mismatch (RC-02); two right-aligned bare links as the only actions
make the screen feel decorative. Severity P0 (truncation) / P1.

**Classroom** · `/classrooms/[id]` · frame 5a
Works: crumb, role label, avatar row + dashed +N, most-recent band, numbered
lectures — matches frame. Fails: banner; join code block only for staff, fine.
Severity P2.

**ChatList** · `/chat` · frame 5b[0]
Works: serif title, unread weight+pill, honest connection line. Fails: the
connection line is *permanent and top-of-list* — the first thing read, every
visit (RC-05); one conversation then void (RC-04). Severity P1.

**Conversation** · `/chat/[id]` · frame 5b[1]
Works: bubble grammar, ink own-bubbles, worded states, structure unread
divider, date pill. Fails: banner + attention line stack two notices above
content (RC-05); ~60 % void with three fixture bubbles (RC-02); send glyph in
RTL renders as an ambiguous left-pointing triangle (P2, RC-03-adjacent).
Severity P1.

**Search / SearchResults** · `/search` · frames 5c/5h
Works: pinned field, four typed sections with counts, editorial knowledge
results, honest deferred-topics line. Fails: **browser default focus ring
renders inside the designed pill** (RC-07, P1); **mixed-script group row
leading-ellipsis** (RC-03, P0); “Preview Student” appears as a knowledge
author (RC-01 content pollution, P0); reachable only from Home's glyph — not
from Topics/Learn where the need arises (IA, P1).

**Profile** · `/profile/[handle]` · frame 5d[0]
Works: identity block, 2 px rule, interests, outline relationship action,
editorial posts. Fails: contribution score is an unexplained integer (RC-08);
posts thin to 1–2 (RC-02). Severity P2.

**Compose** · `/compose` · frame 5d[1]
Works: serif title, audience-first, optional labels, ink chips, challenged
error rule, Publish dominant. Fails: banner; language-detected line appears
only after typing — fine; nothing else material. Severity P2.

**Settings** · `/settings` · no frame (specs 21/24)
Works: quiet rows, grouped, notifications state stated. Fails: the
notifications-blocked group is a permanent negative (RC-05) — correct fact,
prominent placement. Severity P2.

**Report / Block** · modal from Profile · spec 24
Works: full-screen modal, approved lift+fade, radiogroup reasons, moderator
note, block offered on confirmation. Fails: none material beyond banner.
Severity P2.

**PasswordReset (forgot/reset)** · frames — none (spec 20)
Works: enumeration-safe confirmation, DominantAction, live region. Severity P2.

**AccountDeletion** · `/settings/delete-account` · spec 24 (7 states)
Works: full lifecycle, tombstone honesty, distinct failure branches.
Severity P2.

Blocked-by-backend (correctly absent, do not fake): realtime, push, topic
search, adaptive anything.
