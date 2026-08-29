/**
 * Text normalization for Arabic/English mixed medical recall material.
 *
 * Two distinct levels, deliberately separated:
 *
 *   normalizeForDisplay  - conservative. Fixes encoding noise and whitespace
 *                          only. Safe to store as `canonicalText` and show to
 *                          a student. Never changes a letter's identity.
 *
 *   normalizeForMatching - aggressive. Folds orthographic variation that
 *                          carries no medical meaning (alef hamza forms,
 *                          diacritics, case, Arabic-Indic digits) so that two
 *                          spellings of the same question collapse to one key.
 *                          Used for dedup and evaluation only, never persisted
 *                          as display text.
 *
 * The framework calls for "conservative Arabic normalization" (Section 4.2).
 * The reason to still have an aggressive level is that dedup and answer
 * matching are comparisons, not content: folding there loses nothing, while
 * folding in stored text is irreversible corruption.
 */

/** Arabic diacritics (harakat), superscript alef, and Quranic annotation marks. */
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
/** Tatweel / kashida: pure typographic elongation, never semantic. */
const TATWEEL = /ـ/g;
/** Zero-width and bidi control characters that survive copy-paste from PDFs. */
const INVISIBLES = /[​-‏‪-‮⁠-⁤﻿]/g;

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Conservative normalization. Idempotent.
 *
 * - Unicode NFC (composes, does not decompose meaning)
 * - strips invisible/bidi controls
 * - collapses whitespace runs to a single space, keeping paragraph breaks
 * - normalizes the four dash variants and both quote families
 */
export function normalizeForDisplay(input: string): string {
  if (input.length === 0) return '';
  let s = input.normalize('NFC');
  s = s.replace(INVISIBLES, '');
  s = s.replace(TATWEEL, '');
  // Typographic punctuation to ASCII so that a question copied from Word and
  // the same question typed by hand produce the same canonical text.
  s = s.replace(/[‘’‛′]/g, "'");
  s = s.replace(/[“”‟″]/g, '"');
  s = s.replace(/[‐-―−]/g, '-');
  s = s.replace(/…/g, '...');
  // Normalize line endings, then collapse horizontal runs, then cap blank runs.
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/[^\S\n]+/g, ' ');
  s = s.replace(/ *\n */g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * Aggressive normalization for comparison keys. Idempotent.
 *
 * Everything in `normalizeForDisplay`, plus:
 * - lowercase (Latin)
 * - Arabic diacritics removed
 * - alef family (أ إ آ ٱ) folded to bare alef
 * - alef maqsura (ى) folded to yeh (ي); hamza-on-yeh (ئ) folded to yeh
 * - teh marbuta (ة) folded to heh (ه)
 * - waw/yeh hamza carriers folded
 * - Arabic-Indic and Eastern-Arabic digits folded to ASCII
 * - all punctuation collapsed to single spaces
 *
 * Note on teh marbuta: folding it is safe for *matching* because Arabic medical
 * writing is inconsistent about the final ة/ه, and no pair of distinct medical
 * terms is distinguished solely by it in this corpus. It is never applied to
 * stored text.
 */
export function normalizeForMatching(input: string): string {
  if (input.length === 0) return '';
  let s = normalizeForDisplay(input).toLowerCase();
  s = s.replace(ARABIC_DIACRITICS, '');
  s = s.replace(/[آأإٱٲٳ]/g, 'ا'); // آ أ إ ٱ ٲ ٳ -> ا
  s = s.replace(/[ىيئیے]/g, 'ي'); //  ى ي ئ ی ے -> ي
  s = s.replace(/ة/g, 'ه'); // ة -> ه
  s = s.replace(/ؤ/g, 'و'); // ؤ -> و
  s = s.replace(/[کڪ]/g, 'ك'); // ک -> ك
  s = s.replace(/گ/g, 'ك'); // گ -> ك (loanword spelling)
  s = foldDigits(s);
  // Any non-alphanumeric, non-Arabic-letter character becomes a separator.
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Folds Arabic-Indic (٠-٩) and Eastern Arabic (۰-۹) digits to ASCII 0-9. */
export function foldDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const ai = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (ai >= 0) {
      out += String(ai);
      continue;
    }
    const ei = EASTERN_ARABIC_DIGITS.indexOf(ch);
    if (ei >= 0) {
      out += String(ei);
      continue;
    }
    out += ch;
  }
  return out;
}

export type ScriptClass = 'ar' | 'en' | 'mixed' | 'none';

/**
 * Classifies a string's dominant script. Drives tokenizer selection and lets
 * the review UI group Arabic and English variants of the same question.
 */
export function detectScript(input: string): ScriptClass {
  let arabic = 0;
  let latin = 0;
  for (const ch of input) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0x0600 && cp <= 0x06ff) arabic++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  if (arabic === 0 && latin === 0) return 'none';
  if (arabic === 0) return 'en';
  if (latin === 0) return 'ar';
  const total = arabic + latin;
  // A handful of Latin drug names inside an Arabic sentence is still Arabic.
  if (arabic / total > 0.85) return 'ar';
  if (latin / total > 0.85) return 'en';
  return 'mixed';
}

/**
 * Detects whether extracted text is usable at all.
 *
 * A scanned PDF that yielded only ligature garbage must fail as OCR_REQUIRED
 * rather than producing fabricated candidates - this is acceptance test 6 in
 * Section 14. The heuristic: usable text has a reasonable ratio of letters to
 * total characters and a plausible mean token length.
 */
export function assessTextQuality(text: string): {
  usable: boolean;
  letterRatio: number;
  meanTokenLength: number;
  reason: string | null;
} {
  const trimmed = text.trim();
  if (trimmed.length < 20) {
    return { usable: false, letterRatio: 0, meanTokenLength: 0, reason: 'TEXT_TOO_SHORT' };
  }
  let letters = 0;
  for (const ch of trimmed) {
    if (/\p{L}/u.test(ch)) letters++;
  }
  const letterRatio = letters / trimmed.length;
  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  const meanTokenLength = tokens.reduce((a, t) => a + t.length, 0) / Math.max(1, tokens.length);

  if (letterRatio < 0.5) {
    return { usable: false, letterRatio, meanTokenLength, reason: 'LOW_LETTER_RATIO' };
  }
  // Mean token length far outside natural-language range signals a broken
  // extraction (one giant run-on token, or single characters per token).
  if (meanTokenLength > 25 || meanTokenLength < 1.5) {
    return { usable: false, letterRatio, meanTokenLength, reason: 'IMPLAUSIBLE_TOKENIZATION' };
  }
  return { usable: true, letterRatio, meanTokenLength, reason: null };
}
