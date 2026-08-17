# Arabic / RTL critique

Question asked: *does this feel designed for an Arabic-speaking medical
student?* — not *does dir=rtl work* (it does; 352/352).

## What genuinely works
- Native composition, not mirroring: Plex Arabic 600 display roles with taller
  leading; per-script line heights; interface counts in Arabic-Indic numerals
  (٤٢ عضوًا، مادتان) with correct plural forms; clinical values kept Latin and
  isolated (pH 7.1, 18 g/L inside Arabic sentences); join codes pinned LTR;
  unread divider and date pills composed, not flipped.

## Where the promise breaks
1. **Content language (RC-02).** The Arabic student's feed opens with an
   English explanation paragraph; the conversation's own-bubble is English.
   The *interface* is Arabic-first; the *world* is not. For the pilot the
   fixture corpus must be genuinely bilingual the way the real corpus is —
   Arabic-dominant with Latin clinical runs — or the first impression
   contradicts the product's founding claim.
2. **Mixed-script truncation (RC-03).** `…n circle — مجموعة مراجعة الفسلجة`:
   the ellipsis lands at the visual start. Reading order of the truncated line
   is destroyed. P0; component-level.
3. **Send glyph in RTL** renders as a leftward triangle that reads as
   "rewind"; icon needs the RTL-aware treatment the back arrow already has.
4. **Density.** Arabic text at 390 with taller leading eats more vertical
   space; sparse screens look *emptier* in Arabic. Sparse-state design
   (RC-04) must be judged in Arabic first.
5. Punctuation isolation is correct everywhere inspected (؟ ، ٪); keep the
   bidi='auto' discipline.

Verdict: the typography system passes; the product does not yet *feel*
Arabic-first because the content layer and the truncation defect undercut it.
