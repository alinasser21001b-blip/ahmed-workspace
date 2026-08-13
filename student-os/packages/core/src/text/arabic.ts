/**
 * Arabic text handling.
 *
 * Two things live here, and they are the two places a bilingual product usually
 * gets Arabic wrong: search normalisation and plural agreement.
 *
 * Everything in this file is pure and has an exact mirror in SQL
 * (`sos_normalize_arabic`, migration 0009). The two are compared by test, for
 * the same reason the feed's ranking is: a normalisation the application does
 * and the index does not is a normalisation that returns nothing.
 */

// --- search normalisation ---------------------------------------------------

/*
 * MEASURED BEHAVIOUR of `pg_trgm` on Arabic, against PostgreSQL 16, UTF-8.
 * Similarity floor in use is 0.15.
 *
 *   exact phrase                      1.00   ok
 *   word inside a phrase              0.50   ok
 *   five-character prefix             0.29   ok
 *   mixed Arabic + English            0.37   ok
 *   أمراض  vs  امراض  (hamza)         0.64   ok, narrowly
 *   الكلوية vs الكلويه (ة/ه)           0.60   ok, narrowly
 *   مستشفى vs مستشفي  (ى/ي)           0.56   ok, narrowly
 *   القـــلب vs القلب  (tatweel)       0.36   degraded
 *   آفة    vs  افة    (alef madda)    0.14   FAILS — below the floor
 *   اَلْقَلْب  vs  القلب   (tashkeel)      0.07   FAILS — below the floor
 *   القلب  vs  قلب    (article ال)    0.25   weak, and NOT normalised away
 *
 * Also true, and worth stating rather than discovering later:
 *
 *  - `show_trgm` on Arabic returns hashed trigrams, not readable ones. pg_trgm
 *    CRC-hashes any trigram containing a multibyte character, so the index is a
 *    hash index in effect and collisions are possible at scale.
 *  - There is no Arabic stemming, tokenisation, or root analysis here, and
 *    trigrams cannot provide one. كتاب / كتب / مكتبة share a root and not a
 *    trigram profile. Root-aware and semantic matching are a later Search phase,
 *    a different endpoint, and an explicit deferral — not something this file
 *    quietly approximates.
 *
 * The normalisation below therefore covers exactly the differences that carry
 * no meaning in ordinary Arabic writing. It is the set Lucene's
 * `ArabicNormalizationFilter` uses, chosen because it is a published, tested
 * standard rather than an invention of ours. Nothing more aggressive is applied:
 * stripping the definite article ال would merge القلب («the heart») with قلب
 * («heart») and also with unrelated words beginning in ال, and collapsing و/ؤ or
 * ا/ع would destroy distinctions students actually rely on.
 */

/*
 * Written as \u escapes rather than as literal codepoints, because most of
 * these characters are invisible. A zero-width joiner pasted into source is
 * unreviewable — and the SQL mirror of this rule carries the same escapes for
 * the same reason.
 */

/**
 * Combining marks — harakat, tanween, shadda, sukun, superscript alef and the
 * Quranic range — plus tatweel, the kashida, a justification glyph with no
 * phonetic value at all.
 */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu;

/** Zero-width and bidi controls that survive copy-paste from formatted text. */
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

const LETTER_FOLDS: readonly (readonly [RegExp, string])[] = [
  // Alef with madda, hamza above, hamza below, and wasla -> bare alef.
  [/[آأإٱ]/gu, 'ا'],
  // Ta marbuta -> heh. Routinely interchanged in informal typing.
  [/ة/gu, 'ه'],
  // Alef maqsura, and the Farsi yeh that arrives from mixed keyboards -> yeh.
  [/[ىی]/gu, 'ي'],
  // Farsi keheh -> Arabic kaf.
  [/ک/gu, 'ك'],
];

/** Arabic-Indic (U+0660...) and extended Arabic-Indic (U+06F0...) digits. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/gu;

function foldDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0;
  const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
  return String.fromCharCode(0x30 + (code - base));
}

/**
 * Folds away orthographic variation that carries no meaning, so that what a
 * student types matches what another student wrote.
 *
 * Latin text passes through unchanged apart from case folding, which is what
 * lets one index serve a corpus that mixes both inside a single sentence.
 *
 * MUST stay in exact agreement with `sos_normalize_arabic()` in SQL. A test
 * asserts it does.
 */
export function normalizeArabic(input: string): string {
  let out = input.normalize('NFKC');
  out = out.replace(ZERO_WIDTH, '');
  out = out.replace(MARKS, '');
  for (const [pattern, replacement] of LETTER_FOLDS) out = out.replace(pattern, replacement);
  out = out.replace(ARABIC_DIGITS, foldDigit);
  return out.toLowerCase().replace(/\s+/gu, ' ').trim();
}

// --- pluralisation ----------------------------------------------------------

/**
 * Arabic plural categories (CLDR).
 *
 * Arabic has six, against English's two. Applying an English rule — append a
 * suffix past one — is wrong for four of them, and produces «٢ عضو» where the
 * language requires the dual «عضوان». The rule below is CLDR's `ar`, not an
 * approximation of it.
 *
 *   zero   n = 0
 *   one    n = 1
 *   two    n = 2
 *   few    n % 100 ∈ 3…10
 *   many   n % 100 ∈ 11…99
 *   other  everything else (100, 101, 102, 200, …)
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export function arabicPluralCategory(count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count));
  if (n === 0) return 'zero';
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  const mod100 = n % 100;
  if (mod100 >= 3 && mod100 <= 10) return 'few';
  if (mod100 >= 11 && mod100 <= 99) return 'many';
  return 'other';
}

/** English's two categories, so both locales resolve through one code path. */
export function englishPluralCategory(count: number): PluralCategory {
  return Math.abs(Math.trunc(count)) === 1 ? 'one' : 'other';
}

export function pluralCategory(locale: 'ar' | 'en', count: number): PluralCategory {
  return locale === 'ar' ? arabicPluralCategory(count) : englishPluralCategory(count);
}

/**
 * A plural form set.
 *
 * `other` is required; the rest fall back to it, so an English catalogue writes
 * two forms and an Arabic one writes as many as the phrase needs. A category
 * that genuinely has no distinct form is then an omission on purpose rather
 * than an oversight.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export function selectPlural(
  locale: 'ar' | 'en',
  count: number,
  forms: PluralForms,
): string {
  const category = pluralCategory(locale, count);
  return forms[category] ?? forms.other;
}
