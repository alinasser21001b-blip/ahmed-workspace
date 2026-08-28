/**
 * Arabic / mixed-script helpers for search, comparison, and UI counts.
 * Clinical values stay Latin; interface counts may use Arabic-Indic digits.
 */

const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu;
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;
const LETTER_FOLDS: readonly (readonly [RegExp, string])[] = [
  [/[آأإٱ]/gu, 'ا'],
  [/ة/gu, 'ه'],
  [/[ىی]/gu, 'ي'],
  [/ک/gu, 'ك'],
];
const ARABIC_DIGITS = /[٠-٩۰-۹]/gu;

function foldDigit(digit: string): string {
  const code = digit.codePointAt(0) ?? 0;
  const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
  return String.fromCharCode(0x30 + (code - base));
}

export function normalizeArabic(input: string): string {
  let out = input.normalize('NFKC');
  out = out.replace(ZERO_WIDTH, '');
  out = out.replace(MARKS, '');
  for (const [pattern, replacement] of LETTER_FOLDS) out = out.replace(pattern, replacement);
  out = out.replace(ARABIC_DIGITS, foldDigit);
  return out.toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function normalizeForMatch(input: string): string {
  return normalizeArabic(input)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

const ABBREVIATIONS: Record<string, string> = {
  ns: 'nephrotic syndrome',
  dka: 'diabetic ketoacidosis',
  pph: 'postpartum hemorrhage',
  uti: 'urinary tract infection',
  cp: 'cerebral palsy',
  rf: 'rheumatic fever',
  mcd: 'minimal change disease',
};

export function expandAbbreviations(input: string): string {
  return normalizeForMatch(input)
    .split(' ')
    .map((token) => ABBREVIATIONS[token] ?? token)
    .join(' ');
}

export function tokenSet(input: string): Set<string> {
  return new Set(
    expandAbbreviations(input)
      .split(' ')
      .map((t) => t.trim())
      .filter((t) => t.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function looksArabic(input: string): boolean {
  return /[\u0600-\u06FF]/.test(input);
}

export type Locale = 'ar' | 'en';

export function formatUiCount(n: number, locale: Locale): string {
  return locale === 'ar' ? n.toLocaleString('ar-IQ') : String(n);
}

/** Timer and clinical values stay Latin digits. */
export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

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

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export function selectPlural(locale: Locale, count: number, forms: PluralForms): string {
  const category = locale === 'ar' ? arabicPluralCategory(count) : Math.abs(Math.trunc(count)) === 1 ? 'one' : 'other';
  return forms[category] ?? forms.other;
}
