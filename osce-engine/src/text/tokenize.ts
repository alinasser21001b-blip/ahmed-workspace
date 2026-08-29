/**
 * Tokenization and light stemming for Arabic/English medical text.
 *
 * No statistical model, no wordlist download, no tokenizer vocabulary file.
 * Everything is rule-based so the same input always yields the same tokens on
 * every runtime and every deploy.
 *
 * The stemmers are deliberately *light*. Aggressive stemming destroys medical
 * meaning: Porter reduces "arteries" and "arterial" to the same stem, which is
 * fine, but it also reduces "operative" and "operation" to "oper", which starts
 * matching "operator". For grading, a false merge is worse than a missed one,
 * so both stemmers stop at inflectional suffixes.
 */

import { normalizeForMatching } from './normalize.ts';

/**
 * English stop words. Kept small on purpose: removing too much destroys short
 * answers ("no fever" must not become "fever").
 *
 * Negation words are explicitly NOT stop words - they are handled by the
 * negation detector and carry full clinical weight.
 */
export const EN_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as',
  'that', 'this', 'these', 'those', 'it', 'its', 'and', 'or',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'how', 'why',
  'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'shall',
  'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she', 'his', 'her',
  'about', 'into', 'than', 'then', 'there', 'here', 'also', 'any', 'some',
]);

/** Arabic stop words, already in matching-normalized form. */
export const AR_STOPWORDS: ReadonlySet<string> = new Set([
  'من', 'الي', 'علي', 'في', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك',
  'التي', 'الذي', 'ما', 'ماذا', 'كيف', 'متي', 'اين', 'لماذا', 'هل',
  'ان', 'انه', 'كان', 'كانت', 'يكون', 'تكون', 'قد', 'كل', 'بعض',
  'او', 'ثم', 'حتي', 'عند', 'بين', 'بعد', 'قبل', 'هو', 'هي', 'هم',
]);

/** Arabic clitic prefixes, longest first so that "وبال" strips before "و". */
const AR_PREFIXES = ['وبال', 'فبال', 'بال', 'كال', 'وال', 'فال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل'];
/** Arabic inflectional suffixes, longest first. */
const AR_SUFFIXES = ['اتها', 'اتهم', 'يهما', 'كما', 'هما', 'تها', 'ات', 'ان', 'ين', 'ون', 'ية', 'يه', 'ها', 'هم', 'كم', 'نا', 'ه', 'ي'];

export interface TokenizeOptions {
  /** Remove stop words. Default true for question keys, false for answers. */
  readonly removeStopwords?: boolean;
  /** Apply light stemming. Default true. */
  readonly stem?: boolean;
  /** Drop tokens shorter than this after stemming. Default 2. */
  readonly minLength?: number;
}

const DEFAULTS: Required<TokenizeOptions> = { removeStopwords: true, stem: true, minLength: 2 };

/**
 * Splits already-normalized text into word tokens.
 *
 * Preserves numbers with units attached ("5mg", "120/80") as single tokens,
 * because splitting them loses the clinical value that makes them scorable.
 */
export function splitWords(normalized: string): string[] {
  const out: string[] = [];
  for (const raw of normalized.split(' ')) {
    if (raw.length === 0) continue;
    out.push(raw);
  }
  return out;
}

/**
 * Light English stemmer.
 *
 * Handles only the inflections that actually vary in medical answers:
 * plurals, -ing/-ed verb forms, and the -al/-ic adjectival pair. Everything
 * else is left alone.
 */
export function stemEnglish(word: string): string {
  if (word.length <= 3) return word;
  let w = word;

  // Plurals
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ses') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('xes') || w.endsWith('ches') || w.endsWith('shes')) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) {
    w = w.slice(0, -1);
  }

  // Verb forms. After stripping the suffix, a doubled final consonant is
  // usually gemination introduced by the suffix ("stopped" -> "stopp" -> "stop")
  // and should be reduced - EXCEPT for -ll, -ss and -zz, where the doubling
  // belongs to the word itself. Porter's step 1b carries the same exemption,
  // and without it "swelling" reduces to "swel" and "falling" to "fal".
  if (w.endsWith('ing') && w.length > 5) {
    w = undoubleFinal(w.slice(0, -3));
  } else if (w.endsWith('ed') && w.length > 4) {
    w = undoubleFinal(w.slice(0, -2));
  }

  return w;
}


/** Reduces a suffix-induced doubled final consonant, keeping -ll, -ss and -zz. */
function undoubleFinal(stem: string): string {
  if (stem.length <= 2) return stem;
  const last = stem.at(-1) as string;
  if (last !== stem.at(-2)) return stem;
  if (last === 'l' || last === 's' || last === 'z') return stem;
  return stem.slice(0, -1);
}

/**
 * Light Arabic stemmer: strips one clitic prefix and one inflectional suffix,
 * never reducing a word below three characters (the Arabic root length).
 */
export function stemArabic(word: string): string {
  if (word.length <= 3) return word;
  let w = word;
  for (const p of AR_PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 3) {
      w = w.slice(p.length);
      break;
    }
  }
  for (const s of AR_SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

const ARABIC_RE = /[؀-ۿ]/;

export function stemToken(token: string): string {
  return ARABIC_RE.test(token) ? stemArabic(token) : stemEnglish(token);
}

export function isStopword(token: string): boolean {
  return ARABIC_RE.test(token) ? AR_STOPWORDS.has(token) : EN_STOPWORDS.has(token);
}

/**
 * Full pipeline: normalize, split, drop stop words, stem, drop short tokens.
 * Returns tokens in source order (order is needed by the LCS metric).
 */
export function tokenize(input: string, options: TokenizeOptions = {}): string[] {
  const opts = { ...DEFAULTS, ...options };
  const normalized = normalizeForMatching(input);
  const words = splitWords(normalized);
  const out: string[] = [];
  for (const word of words) {
    if (opts.removeStopwords && isStopword(word)) continue;
    const token = opts.stem ? stemToken(word) : word;
    // Keep every numeric token regardless of length: "5" is clinically load-bearing.
    if (token.length < opts.minLength && !/^\d+$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

/** Contiguous n-grams over a token list. Used for multi-word key point matching. */
export function tokenNgrams(tokens: readonly string[], n: number): string[] {
  if (n <= 0 || tokens.length < n) return [];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
  return out;
}
