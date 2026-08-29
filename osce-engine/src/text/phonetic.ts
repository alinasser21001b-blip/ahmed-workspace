/**
 * Phonetic keys for name blocking.
 *
 * Purpose is *blocking*, not matching. Entity resolution over N examiners is
 * O(N^2) if every pair is compared. A phonetic key partitions candidates into
 * buckets so only plausible pairs are scored, turning the comparison count from
 * ~N^2/2 into the sum of squared bucket sizes - typically a 50-200x reduction
 * at a few thousand examiners.
 *
 * Blocking is tuned for RECALL, not precision. A pair that never shares a
 * bucket can never be matched, and that error is invisible; a pair that shares
 * a bucket wrongly merely costs one string comparison. So the keys here fold
 * vowels aggressively, and "Hassan" and "Hussein" DO land in the same bucket -
 * deliberately.
 *
 * The framework's rule that those two names must never be silently merged is
 * enforced downstream, in the Fellegi-Sunter scorer and its AMBIGUOUS band,
 * which compare the full strings. Trying to enforce it here instead would be a
 * category error: safety belongs in the decision, not in the index.
 *
 * Soundex is avoided for a different reason - it truncates to four characters,
 * so every name beyond the third consonant collapses into one bucket, and
 * bucket sizes stop shrinking as the corpus grows.
 */

const LATIN_TITLES = new Set([
  'dr', 'doctor', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss',
  'consultant', 'assoc', 'assistant', 'associate', 'lecturer', 'a', 'the',
]);

const ARABIC_TITLES = new Set(['د', 'دكتور', 'دكتوره', 'الدكتور', 'الدكتوره', 'استاذ', 'الاستاذ', 'بروفيسور']);

/** Strips academic and courtesy titles from a name's token list. */
export function stripTitles(tokens: readonly string[]): string[] {
  return tokens.filter((t) => !LATIN_TITLES.has(t) && !ARABIC_TITLES.has(t));
}

/**
 * Consonant-skeleton phonetic key for transliterated Arabic/Latin names.
 *
 * Rules target the transliteration variance that actually occurs in Iraqi and
 * wider Arabic medical naming:
 *   - kh/gh/sh/th/ch digraphs map to single symbols (Khalid / Khaled)
 *   - doubled consonants collapse (Abdullah / Abdulah)
 *   - terminal vowels drop (Ali / Aly)
 *   - internal vowels reduce to a single class marker, preserving syllable
 *     count without preserving which vowel was written
 *
 * The last rule is why "Hassan" and "Hussein" share the key HASAN. That is the
 * intended behaviour for a blocking key (see the module note): they are then
 * compared in full by the scorer, which separates them.
 */
export function phoneticKey(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z]/g, '');
  if (s.length === 0) return '';

  // Digraphs first, longest first.
  s = s.replace(/sch/g, 'S');
  s = s.replace(/kh/g, 'X');
  s = s.replace(/gh/g, 'G');
  s = s.replace(/sh/g, 'S');
  s = s.replace(/th/g, 'T');
  s = s.replace(/ch/g, 'X');
  s = s.replace(/ph/g, 'F');
  s = s.replace(/ck/g, 'K');
  s = s.replace(/qu/g, 'K');

  // Single letters to phonetic classes.
  const map: Record<string, string> = {
    a: 'A', e: 'A', i: 'A', o: 'A', u: 'A', y: 'A',
    b: 'B', p: 'B',
    c: 'K', k: 'K', q: 'K', g: 'G',
    d: 'D', t: 'T',
    f: 'F', v: 'F', w: 'W',
    h: 'H',
    j: 'J',
    l: 'L', r: 'R',
    m: 'M', n: 'N',
    s: 'S', z: 'S', x: 'S',
  };
  let out = '';
  for (const ch of s) {
    out += ch >= 'A' && ch <= 'Z' ? ch : (map[ch] ?? '');
  }

  // Collapse runs of the same symbol: Abdullah -> ...L... not ...LL...
  let collapsed = '';
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== out[i - 1]) collapsed += out[i];
  }

  // Drop a trailing vowel marker ("Ali" and "Aly" both end -A after mapping).
  if (collapsed.endsWith('A') && collapsed.length > 2) collapsed = collapsed.slice(0, -1);
  // Drop a leading vowel marker, but never below two symbols: a one-character
  // key puts a large slice of the corpus in a single bucket, which defeats the
  // whole point of blocking. "Ali" must stay "AL", not become "L".
  if (collapsed.startsWith('A') && collapsed.length > 2) collapsed = collapsed.slice(1);

  return collapsed;
}

/**
 * Phonetic key for names written in Arabic script.
 *
 * Folds the letter pairs that Arabic writers interchange in practice:
 * ه/ح (both transliterate to h), س/ص, ت/ط, ذ/ز/ظ, د/ض. Long vowels are
 * dropped because their spelling is unstable in handwritten recall.
 */
export function arabicPhoneticKey(name: string): string {
  let s = name.replace(/[^؀-ۿ]/g, '');
  if (s.length === 0) return '';
  s = s.replace(/[آأإٱ]/g, 'ا');
  s = s.replace(/[ةه]/g, 'H');
  s = s.replace(/[حخ]/g, 'H');
  s = s.replace(/[سصث]/g, 'S');
  s = s.replace(/[تط]/g, 'T');
  s = s.replace(/[ذزظ]/g, 'Z');
  s = s.replace(/[دض]/g, 'D');
  s = s.replace(/[قك]/g, 'K');
  s = s.replace(/[غع]/g, 'E');
  s = s.replace(/[جچ]/g, 'J');
  s = s.replace(/[ىيئ]/g, 'Y');
  s = s.replace(/[ؤو]/g, 'W');
  // Bare alef is an unstable spelling in handwritten recall; Y and W are kept
  // because they distinguish real name pairs (Yasin vs Wasin).
  s = s.replace(/ا/g, '');
  let collapsed = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== s[i - 1]) collapsed += s[i];
  }
  return collapsed;
}

const ARABIC_RE = /[؀-ۿ]/;

/** Dispatches to the script-appropriate key generator. */
export function nameKey(name: string): string {
  return ARABIC_RE.test(name) ? arabicPhoneticKey(name) : phoneticKey(name);
}

/**
 * Blocking keys for one examiner name.
 *
 * Returns several keys rather than one. Two records are compared if they share
 * ANY key - a standard multi-pass blocking scheme, which recovers the recall
 * that a single strict key would lose (a name recorded surname-first still
 * shares its surname key).
 */
export function blockingKeys(nameTokens: readonly string[]): string[] {
  const tokens = stripTitles(nameTokens).filter((t) => t.length > 1);
  if (tokens.length === 0) return [];
  const keys = new Set<string>();

  // Key 1: phonetic key of every token (catches surname-first ordering).
  for (const t of tokens) {
    const k = nameKey(t);
    if (k.length >= 2) keys.add('T:' + k);
  }
  // Key 2: sorted concatenation of all token keys (order-independent full name).
  const all = tokens
    .map(nameKey)
    .filter((k) => k.length >= 2)
    .sort();
  if (all.length > 0) keys.add('F:' + all.join('-'));
  // Key 3: first + last token key (the common "Dr Ahmed ... Hassan" shape).
  if (tokens.length >= 2) {
    const first = nameKey(tokens[0] as string);
    const last = nameKey(tokens[tokens.length - 1] as string);
    if (first.length >= 2 && last.length >= 2) keys.add('E:' + first + '-' + last);
  }
  return [...keys];
}
