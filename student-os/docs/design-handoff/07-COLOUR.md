# Colour — semantic audit

Full inventory in `tokens.json` → `colorRoles` (token → meaning → allowed → forbidden). This file is the audit and the rules.

## One meaning per colour

| Colour | Meaning | Never |
| --- | --- | --- |
| Ink `#14181F` | text, and the one dominant action | more than one filled control per screen |
| Teal `#178774` | provenance and citation | success, correct, CTA, online, sent, selection, active tab |
| Challenged `#9B3A40` | something does not hold | decoration, destructive confirm, offline |
| Structure `#2C3A82` | how things are organised | progress, success, error |
| Attention `#B4531F` | transient system condition | error, validation failure |
| Danger `#CC4A52` | destructive user action | incorrect answer, load error |
| Muted `#6E6A60` | metadata | anything under 13 px |

## Every audited use across Turns 3–5

| Element | Colour | Semantic |
| --- | --- | --- |
| Correct answer | **ink** + word "Correct" + checkmark | correctness is not a colour |
| Incorrect answer | challenged + word "You chose" | error-of-fact |
| "Cites 2 sources", source rule | teal | provenance |
| Practice CTA / Practise / Start | ink (or paper-on-ink inside a dark band) | dominant action |
| Sent message bubble | ink | own authorship, not success |
| Failed send | challenged + word + retry glyph | failure |
| Unread notification / divider | structure | organisation |
| Active tab | ink + filled glyph + weight 600 | position |
| Selected option (pre-submit) | ink 2 px border + `paper100` fill + weight 500 | selection, with no correctness hint |
| Selected chip | ink fill | choice made |
| Restricted state | textMuted, no colour | absence of permission is not an error |
| Offline / reconnecting | attention | transient condition |
| Evidence updated marker | attention | changed since you last looked |
| Evidence ticks | ink filled / `paper200` empty | count, not performance |
| Role and Official labels | structure | classification |
| Handle available | teal | a fact verified against a server |
| Load error | challenged | failure |
| Destructive confirm | danger | destruction |

No unexplained reuse remains.

## Two reds, and why

`challenged` (#9B3A40) states that a claim or an answer is wrong. `danger` (#CC4A52) warns that an action destroys something. Collapsing them would make "you answered incorrectly" and "delete your account" the same colour. They are never adjacent in the UI, so the near-identical hues are not a discrimination problem.

## Greyscale test — the binding requirement

Convert any screen to greyscale. Every state must remain identifiable:

- **Correct** — 2 px border + `paper100` fill + checkmark glyph + the word "Correct"
- **Incorrect / your choice** — 2 px border + the words "You chose"
- **Selected** — 2 px border + fill + heavier weight
- **Provenance** — a 2 px leading rule + the words "Cites N sources"
- **Unread** — a horizontal rule with the word "Unread", plus a count badge
- **Offline** — a leading rule + the words "You are offline"
- **Failed** — the word "Failed" + a retry glyph

Answer options in particular must be distinguishable under monochrome and under deuteranopia/protanopia. They are: correct and incorrect differ by fill, by glyph and by word, not only by hue.

## Contrast, measured on `#FCFBF9`

| Pair | Ratio | Verdict |
| --- | --- | --- |
| ink on paper50 | 15.8:1 | AAA |
| textSecondary #3C3A34 | 10.4:1 | AAA |
| textMuted #6E6A60 on paper50 | 5.3:1 | AA body ✓ |
| teal600 #178774 | 4.6:1 | AA body ✓ (teal500 was 3.4 — the reason for the change) |
| challenged #9B3A40 | 6.9:1 | AA ✓ |
| structure #2C3A82 | 9.7:1 | AAA |
| attention #B4531F | 5.1:1 | AA ✓ |
| textFaint #A9A497 | 2.4:1 | **decorative only** — never a standalone fact |
| paper on ink (inverse) | 15.8:1 | AAA |

`textFaint` failing AA is intentional and constrained: it is only ever used for a note that restates something already stated at AA, or a placeholder. Any new use is a defect.

## Dark theme

`darkColors` exists in `tokens.ts` and `userInterfaceStyle: automatic` is declared, so dark mode is reachable today. The editorial direction was designed and verified on paper only. Dark-theme values for the new paper ramp and the three new semantic roles are **DEFERRED_PRODUCT_DECISION** — provisional inversions are in `05-TOKENS.md`, but no dark screen has been reviewed. Ship with dark reviewed or with `userInterfaceStyle: light`; do not ship an unreviewed dark theme.
