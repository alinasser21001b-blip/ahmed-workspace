# Typography

## The core decision

**Latin and Arabic do not share a display face.** Newsreader has no Arabic coverage. Rather than force visual parity or abandon the editorial voice, the display *role* is constant and the *voice* changes by script.

| Role | Latin | Arabic |
| --- | --- | --- |
| Display / screen title | Newsreader 500, −0.015em tracking | IBM Plex Sans Arabic 600, no tracking |
| Knowledge body (feed, search, notification) | Newsreader 400 | IBM Plex Sans Arabic 600 |
| Everything else | IBM Plex Sans | IBM Plex Sans Arabic |
| Numerals, page references | IBM Plex Mono 500, tabular | same |

IBM Plex Sans and IBM Plex Sans Arabic are metric siblings from one type family, so a Latin drug name inside an Arabic sentence keeps its baseline, weight and colour without per-run adjustment. That is the reason for the pairing.

## Full role table

| Role | Size | LH Latin | LH Arabic | Weight L / A | Colour |
| --- | --- | --- | --- | --- | --- |
| Display | 32 | 38 | 46 (at 30) | 500 / 600 | ink |
| Screen title | 30 | 36 | 44 | 500 / 600 | ink |
| Section title | 13 | 20 | 22 | 600 / 600 | ink or role colour |
| Knowledge body | 17–20 | 25–29 | 29–33 | 400 / 600 | ink |
| Body | 15.5 | 25 | 29 | 400 | textSecondary |
| Metadata | 13 | 20 | 22 | 500 | textMuted |
| Caption | 13 | 20 | 22 | 400 | textFaint |
| Button | 15.5 | 22 | 26 | 600 | per control |
| Input | 16 | 22 | 22 | 400 | ink |
| Numeric / reference | 15 | 22 | 22 | 500 | ink or textMuted |
| Practice stem | 24 L / 22 A | 34 | 40 | 400 / 600 | ink |
| Practice option | 15.5 | 23 | 28 | 400, 500 selected | ink |
| Feedback explanation | 15.5 | 25 | 29 | 400 | textSecondary |

**Nothing below 13 px exists in this product.** `typography.micro` (11/16) is deleted in `05-TOKENS.md` §4 for that reason.

**`micro` is retired. Final UI implementation must not use it.** It is not a token with a narrow remit, not a metadata role and not an escape hatch for a tight row — there is no size below 13 px in this system, so there is nothing for it to express. Call sites that still render `variant="micro"` (`settings/index.tsx`, `settings/delete-account.tsx`) are **implementation debt to be removed**, not evidence of a surviving role: replace each with the 13/20 metadata role. Deleting the token from `tokens.ts` is what makes the rule enforceable — while it exists, it comes back.

## Line-height parity is deliberately broken

Arabic runs at roughly 1.45–1.5× against Latin's 1.2–1.6× at the same size, because Arabic carries more vertical detail — ascenders, descenders, and the dot clusters that distinguish letters. `tokens.ts` already states this rationale in the `typography` comment; this table is its per-role expression.

Consequence: **an Arabic screen is taller than the same English screen.** Do not compensate by tightening leading, and do not design a fixed-height row anywhere.

## Weight parity

Arabic display uses 600 where Latin uses 500. IBM Plex Sans Arabic at 500 reads lighter than Newsreader at 500 against the same ground, so the numbers differ to make the optical weight match. Do not "fix" this to matching numerals.

## Truncation

| Content | Behaviour |
| --- | --- |
| Screen title | never truncates — wraps to as many lines as needed |
| Knowledge body in a list | wraps, no clamp |
| Conversation preview | single line, `ellipsis` at the reading end |
| Display name in a row | single line, ellipsis; the handle truncates before the name |
| Topic name | wraps to two lines, then ellipsis |
| Source title | wraps; a long source never truncates its locator away — the locator wraps to its own line first |
| Classroom title | wraps to three lines |
| Option label | wraps, never truncates. An unreadable option is an unanswerable question. |

## Long Arabic display — tested

`كتلة الكلى والمسالك البولية` at 25/40 wraps to two lines at 360 px. `المتلازمة الكلوية المقاومة للستيرويد عند الأطفال` at 30/46 wraps to three and clears the header rule without clipping, because no header is a fixed height. Both verified in the Turn 5 Arabic frames.

## Loading

Four families, ten static faces total — see `tokens.json` → `fontsToBundle`. Static weights only; no variable axes. Load through `expo-font` at root and hold the splash until resolved: a script-swap flash is worse here than a 200 ms delay, because the fallback for Arabic display is a system face at a visibly different weight.

**Fallbacks:** Latin display → Georgia, serif. Arabic → Geeza Pro (iOS) / Noto Naskh Arabic (Android), sans-serif. Mono → Menlo, monospace.
