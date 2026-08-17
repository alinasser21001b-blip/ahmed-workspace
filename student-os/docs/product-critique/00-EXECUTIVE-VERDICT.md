# Executive verdict — Student OS, critic pass 2026-08-17

Reviewed at head `e1109cd` from the running fixture build (paper theme, desktop
canvas, motion integrated), rendered in a real browser at 390 px and desktop,
English and Arabic. This is a product critique, not a compliance check — the
build passes every automated gate, and that is precisely why this document
exists. **Passing tests is not a good product.**

## The verdict in one paragraph

The visual identity is now genuinely present — paper, ink, Newsreader over
Plex, hairlines, one dominant action — and Practice is a legitimately good
learning surface. But the product a student meets is **polluted by its own
preview chrome**, **skeletal wherever the fixture world runs thin**, and
**apologetic in tone**: three permanent negative notices (sample data, live
delivery unavailable, notifications blocked) stack into the feeling of a
broken product. Two real rendering defects survived every audit: mixed-script
names truncate with the ellipsis at the *start* of the line, and the web
search field shows the browser's default focus ring inside the designed pill.
The deepest problem is not visual at all: outside Practice, the product does
not yet answer "why would I open this every day?"

## Scores (0–10; 8 = pilot-ready)

Average **6.3**. Highest: **PracticeUX 8**. Lowest: **StudentUsefulness 5,
EmotionalQuality 5, ProductionPolish 5**. Full table in `04-UIUX-SCORECARD.md`.

## What must not be lost

- Practice: band, counter, serif stem, lettered hairline rows, worded verdict,
  staged reveal. This is the product's best screen and the template for the rest.
- The typography system and paper ground — now real, do not reopen.
- The honesty discipline (no fake realtime, no fake push). Keep the *facts*;
  redesign the *delivery* (see RC-05).

## What blocks a student pilot (P0)

1. Preview chrome on every screen, including inside the Practice focus mode
   (RC-01).
2. Fixture world too thin and half-English — screens read unfinished and the
   Arabic-first promise breaks at the content layer (RC-02).
3. Bidi truncation defect on mixed-script names (RC-03).
4. No designed sparse states — screens built for full data collapse into
   60–85 % void with 1–3 fixture rows (RC-04).
5. Stacked negative notices — the apologetic posture (RC-05).

Root causes with evidence: `09-ROOT-CAUSES.md`. Orders for the builder:
`10-IMPLEMENTATION-ORDERS.md` and `MASTER_IMPLEMENTATION_COMMAND.md`.
Nothing in this package modifies product code; nothing here was fixed.
