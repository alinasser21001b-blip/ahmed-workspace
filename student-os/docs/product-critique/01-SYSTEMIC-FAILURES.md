# Systemic failures

The smallest set of causes producing the largest number of visible defects.
Each is systemic: fixing it once fixes many screens; polishing screens without
fixing it reproduces the defect. Full schema per cause in `09-ROOT-CAUSES.md`.

## P0

**RC-01 — Preview chrome contaminates the product.** The black
`Student OS Preview — sample data · بيانات تجريبية · Give feedback` bar sits
above every screen — including Practice, whose entire design premise is an
uninterrupted focus mode — and displaces every composition downward. The
`/motion-samples` route (developer copy, replay buttons, duration notes) ships
inside the same build students receive. The fixture signs its own posts as
“Preview Student”. A student cannot tell where the product ends and the
scaffolding begins.

**RC-02 — The fixture world is too thin and half-English to carry judgement.**
Topics: one course, three rows. Rooms: two rows. Conversation: three bubbles.
An Arabic student sees English explanations, an English student sees Arabic
room names. The result reads as an unfinished product, and it also *blinds
review*: half of this critique's layout findings only became visible because
the sparse world exposed them.

**RC-03 — Bidirectional truncation is broken at the component level.** Any
mixed-script single-line name truncates with the ellipsis at the line start:
`…n circle — مجموعة مراجعة الفسلجة` (Rooms), `…gy revision circle — …`
(Search). One shared row/text component causes it everywhere names render.

**RC-04 — Compositions have no designed sparse state.** The editorial grammar
assumes a full page. With two rows, Topics/Rooms/Conversation are 60–85 %
void — not an “empty state” (those exist and are good) but a *sparse* state
nobody designed. Minimal and unfinished are different things; today the
product reads as the latter.

**RC-05 — The honesty posture stacks into apology.** Three permanent negative
notices can be on screen at once (sample-data banner + “live delivery is
unavailable” + “notifications are blocked”). Each is honest; together they
read as a product that keeps apologizing. The facts must stay; their
frequency, placement and tone are design decisions nobody made.

## P1

**RC-06 — The approved motion language is only half-generalized.** Approved
sample 1 (Learn → Topic spatial continuity — the strongest of the five) was
never implemented in the real app; screens received only the entrance fade.
Tab selection feedback is platform-default. Motion currently plays only on
load, so in normal use the app feels static — the language was approved but
mostly not spoken.

**RC-07 — Web affordances are undesigned.** The browser's default focus ring
renders inside the designed search pill; keyboard focus states generally are
UA defaults; the desktop canvas has no keyboard hint. The web preview is the
owner's and students' first contact surface, and it shows.

## P2

**RC-08 — Unexplained numbers.** The profile's contribution score is a bare
integer with no explanation a student could act on. Evidence fractions are
better (labelled) but still assume the reader knows the model.
