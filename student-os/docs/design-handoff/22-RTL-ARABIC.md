# RTL and Arabic — the constitution

**Arabic is the default.** `app/_layout.tsx` resolves any non-English device locale to `'ar'`, and `signupRequest.locale` defaults to `'ar'`. An Arabic defect is a majority-path defect, not an edge case.

Direction is applied **once, before first paint** (`applyDirection(locale)`). There is no runtime flip: a language change requires a reload. **Do not design a live language toggle.**

---

## The constitution — 18 rules

### 1. Alignment and flow
Logical properties everywhere: `marginInlineStart`, `paddingInlineEnd`, `borderInlineStart`, `start`/`end`. No `left`/`right` in any style that is not physically fixed. No mirrored stylesheet.

### 2. Own-side alignment via flex, never position
Message bubbles, badges and counters align with `alignSelf` and `justifyContent`, so they follow direction with no RTL branch. Absolute positioning is the most common source of a half-mirrored screen.

### 3. Directional icons — flip
Back arrow (`arrow-back` → `arrow-forward`), list chevrons (`chevron-forward` → `chevron-back`), the evidence-delta arrow (it means "progressed to"), and **the send glyph** (a paper plane depicts motion along the writing direction). Matches `DirectionalIcon.tsx`.

### 4. Directional icons — do not flip
Checkmark, close, shield/verification, search, image, refresh/retry, notification bell, battery and signal. A checkmark is not directional; mirroring it makes it look wrong.

### 5. Numbers — interface counts are Arabic-Indic
Counts the interface is stating about itself: `٢٤ عضوًا`, `٩ محاضرات`, `٣ من ٧`, `٦ مواد`, timestamps as relative words, dates.

### 6. Numbers — clinical and technical values stay Latin
`18 g/L`, `pH 7.1`, `+3`, `> 40 mg/m²/hr`, `8 MB`, `21:40`, `p.2521`, `Nelson 21e`, `KDIGO 2021`. That is how they appear in the textbooks and on the ward, and units are read as symbols, not translated.

### 7. Fractions do not mirror — use the word form
`5/12` is unsafe in RTL. Arabic uses `٥ من ١٢`. Better than an isolate, and it reads aloud correctly.

### 8. Latin abbreviations are isolated inline
`DKA`, `ECG`, `ABG`, `ACEi`, `FSGS`, `KDIGO` in `<bdi>` / `unicode-bidi: isolate`. Parentheses then attach correctly because the isolate carries its own direction: `التصلب الكبيبي البؤري القطعي (FSGS)`.

### 9. English titles inside Arabic copy are isolated as one run
`Nelson 21e, p.2521` isolated whole, so the comma and the full stop do not jump to the wrong end.

### 10. Product name stays Latin
"Student OS" is not transliterated.

### 11. Credential and code fields stay LTR
Email, password, handle, join code: `direction: ltr` with leading alignment, in both languages. The label above is Arabic; the field is not. A join code shown right-to-left is a code the student did not type.

### 12. Handles and mentions
`@noor_hj · Stage 3` is **one** isolated LTR run aligned to the reading start, so the separator does not migrate. Never isolate each fragment separately.

### 13. Punctuation
Arabic comma `،` and Arabic quotation `«…»` in Arabic copy. Latin punctuation stays inside isolated Latin runs. Never mix a Latin comma into an Arabic sentence to "look consistent".

### 14. Plurals go through `selectPlural`
Arabic has **six** CLDR categories — zero, one, two, few (3–10), many (11–99), other. `arabicPluralCategory` in `packages/core/src/text/arabic.ts` implements them. **String concatenation of a count and a noun is a bug**: `٢ عضو` is wrong, the dual `عضوان` is required. Every count in every Arabic string must resolve through `selectPlural`.

### 15. Search normalisation is real and asymmetric
`normalizeArabic` folds hamza forms, ta marbuta, alef maqsura, Farsi yeh and keheh, strips tashkeel and tatweel, and folds Arabic-Indic digits — and has an exact SQL mirror. It does **not** strip the definite article and does **not** stem. Fully vocalised text and alef madda fall below the similarity floor. See `16` for the empty-state copy this forces.

### 16. Typography changes voice by script
Newsreader has no Arabic. Latin display is Newsreader; Arabic display is IBM Plex Sans Arabic 600 at ~1.5 line-height. Body and metadata are IBM Plex Sans / IBM Plex Sans Arabic — metric siblings, so a Latin drug name inside an Arabic sentence keeps its baseline. See `06`.

### 17. Avatar initials follow the name's script
`أر` for أمجد الربيعي, `AR` for a Latin name. Never romanise an Arabic name to make an initial.

### 18. Arabic screens are taller
Same content, more vertical space, because leading is 1.45–1.5×. Never compensate by tightening leading. Never put anything on a fixed height.

---

## Screen exceptions

| Screen | Exception |
| --- | --- |
| Sign in / sign up | credential fields LTR (rule 11); the closing note is Arabic |
| Onboarding step 5 | handle LTR, display name RTL-capable, in the same form |
| Classroom list | join-code field LTR |
| Conversation | send glyph mirrors (rule 3); own bubbles move to the left in Arabic (rule 2) |
| Search | the query field follows the typed script; `@handles` in results stay isolated |
| Practice | option letters become أ ب ج د; the counter is `٣ من ٧`; segments fill from the trailing edge |
| Profile | `@handle` isolated beside an Arabic display name |
| Compose | the body field's direction follows the typed script, not the locale |

## Worked mixed-script examples — use these as fixtures

1. `بروتينية <bdi>&gt; 40 mg/m²/hr</bdi>، ألبومين <bdi>&lt; 25 g/L</bdi>، وذمة، فرط شحميات الدم.`
2. `«أعطِ البيكاربونات كلما كان <bdi>pH</bdi> أقل من <bdi>7.1</bdi>.»`
3. `يستند إلى مصدرين — <bdi>Nelson 21e, p.2521</bdi> · محاضرة الكلى ١٤`
4. `هل أحد عنده ملاحظات محاضرة ٩؟ أحتاج جدول <bdi>KDIGO</bdi> من <bdi>Nelson 21e</bdi>، وأي شيء عن <bdi>ACEi</bdi>.`
5. `عندي. بعثتها إلى <bdi>@renal_block</bdi> أمس الساعة <bdi>21:40</bdi>.`
6. `التصلب الكبيبي البؤري القطعي <bdi>(FSGS)</bdi>`
7. `جرّب صورة أقل من <bdi>8 MB</bdi>. نصّك محفوظ.`
8. `طفل عمره ٤ سنوات لديه وذمة حول الحجاج وبيلة بروتينية <bdi>+3</bdi>، والألبومين <bdi>18 g/L</bdi>.`

## Engineering treatment

React Native has no `<bdi>`. Use `<Text>` children with an explicit `writingDirection: 'ltr'` **and** wrap the run in U+2066 (LRI) … U+2069 (PDI) so the bidi algorithm isolates it even where the style is ignored. Add a `<Isolated>` helper component and use it everywhere rules 8–12 apply. Do not hand-place U+200F marks in translation strings — they are invisible, unreviewable, and get stripped by tooling.

**Missing translation keys** are listed per surface in `25-DESIGN-TO-CODE.md`.
