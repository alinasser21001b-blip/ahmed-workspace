import { normalizeArabic } from '../text/arabic.js';

/**
 * The moderation gate (App Review Guideline 1.2 — "a method for filtering
 * objectionable material from being posted to the app").
 *
 * This file is the hardest thing in the product to get right, and the reason is
 * the product itself: Student OS is written by and for medical students. A
 * filter that blocks "penis", "rape", "suicide", "anal", "abuse", "overdose" or
 * "psychosis" would block the curriculum — urology, forensic medicine,
 * psychiatry, gastroenterology, toxicology. A word list is therefore not a
 * moderation system here; it is a way to make the product useless while
 * appearing safe.
 *
 * So the engine matches the SHAPE OF ABUSE, not the subject matter:
 *
 *   * A slur is a slur in every context. There is no clinical use of a racial
 *     epithet, so that is the one place a lexicon is legitimate — and the
 *     lexicon lives in the database (`moderation_terms`, migration 0015) rather
 *     than in this file, so that changing it is an INSERT and an audit trail
 *     rather than a deploy. That is the same decision `learning_event_kinds`
 *     made in 0005 and for the same reason.
 *
 *   * A threat is structural: a violent verb aimed at a SECOND PERSON. "I will
 *     kill you" is a threat; "the patient will die without dialysis" is a
 *     sentence from a nephrology tutorial, and the difference is the addressee,
 *     not the verb. Every structural rule below keys on the addressee.
 *
 *   * Sexual harassment is likewise structural — an imperative or a proposition
 *     aimed at a person — which is what separates it from a sexual-health
 *     lecture, where nobody is being addressed at all.
 *
 * WHAT THIS CAN AND CANNOT GUARANTEE — stated here because §4 of the brief and
 * Guideline 1.2 both deserve an honest answer rather than a claim:
 *
 *   CAN:  refuse a post, comment or message containing an unambiguous slur;
 *         refuse an explicit threat or sexual proposition aimed at a person;
 *         refuse obvious link-spam; catch the cheap evasions (repeated letters,
 *         leetspeak, Arabic diacritics, zero-width characters) that defeat a
 *         naive substring match; and record every decision so a human can audit
 *         and reverse it.
 *
 *   CANNOT: understand meaning. It does not detect sarcasm, coded language, a
 *         novel slur, harassment expressed politely, an image's contents, or
 *         abuse in a language it has no terms for. It is a FIRST gate, and the
 *         product's actual safety story is this gate plus user reporting plus a
 *         moderator queue plus blocking — which is exactly the four-part answer
 *         Guideline 1.2 asks for. No part of it is AI, and nothing in this
 *         repository should claim otherwise.
 *
 * Nothing here is probabilistic. Every decision is a named rule with an id that
 * is written to the audit trail, so "why was my post refused" has an answer.
 */

// --- what the engine is given ----------------------------------------------

/** A term from `moderation_terms`. Supplied by the caller; never hardcoded. */
export interface ModerationTerm {
  /** Stable id, written to the audit trail so a decision can be explained. */
  id: string;
  /** Already normalised the same way `normaliseForMatching` normalises input. */
  pattern: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
  /** `exact` matches a whole word; `substring` matches anywhere. */
  match: 'word' | 'substring';
}

export type ModerationCategory =
  | 'slur'
  | 'threat'
  | 'sexual_harassment'
  | 'spam'
  | 'self_harm_encouragement';

/**
 * `block` refuses the write. `review` accepts it and queues it for a human.
 *
 * The two-level outcome is deliberate. A gate that can only refuse has to be
 * set loose enough not to break the product, which means it refuses almost
 * nothing; one that can also flag can be strict about the unambiguous cases and
 * still surface the doubtful ones to a person.
 */
export type ModerationSeverity = 'block' | 'review';

export type ModerationVerdict = 'allow' | 'review' | 'block';

export interface ModerationSurface {
  /**
   * Where the text will end up.
   *
   * A direct message to one person and a post visible to a whole college are
   * not the same risk, and Apple's guideline is about material "posted to the
   * app". Private surfaces still run the gate — a slur in a DM is the
   * harassment case Guideline 1.2 names — but the spam rules, which exist to
   * protect an audience, do not apply where there is no audience.
   */
  audience: 'public' | 'private';
}

export interface ModerationMatch {
  ruleId: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
  /** The matched fragment, for the audit trail. Never returned to the author. */
  excerpt: string;
}

export interface ModerationResult {
  verdict: ModerationVerdict;
  matches: ModerationMatch[];
  /** Stable, translatable key for the message the author sees. */
  reasonKey: string | null;
}

// --- normalisation ----------------------------------------------------------

/**
 * Collapses the cheap evasions, and only those.
 *
 * Every transformation here is one that cannot change the meaning of a clinical
 * sentence: case, Arabic diacritics, zero-width characters, stretched letters,
 * and the small set of digit-for-letter substitutions that exist to defeat
 * filters. Nothing here does stemming or synonym expansion — that would create
 * false positives on exactly the vocabulary this product is made of.
 *
 * Deliberately NOT applied: stripping spaces entirely. `s p a m` becomes
 * detectable that way, and so does every sentence containing "he rapes" inside
 * "therapies". Losing word boundaries is how a filter starts refusing
 * pharmacology.
 */
/*
 * Zero-width and invisible-formatting codepoints, written as \u escapes rather
 * than literal characters — the same reason `arabic.ts` does it for combining
 * marks: an invisible character pasted into source is unreviewable, and this
 * file is exactly the one where a hidden character slipping past review would
 * matter.
 *
 *   200B-200F  zero-width space/joiners, LTR/RTL marks
 *   2060       word joiner
 *   FEFF       BOM / zero-width no-break space
 *   00AD       soft hyphen
 */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u2060\uFEFF\u00AD]/gu;

export function normaliseForMatching(input: string): string {
  const withoutInvisibles = input.replace(INVISIBLE_CHARACTERS, '');
  const arabicFolded = normalizeArabic(withoutInvisibles);

  return arabicFolded
    .toLowerCase()
    .normalize('NFKD')
    // Latin combining marks (U+0300-U+036F), after NFKD has split them off.
    .replace(/[̀-ͯ]/gu, '')
    .replace(/\S+/gu, foldLeetWithinToken)
    // Three or more of the same letter is emphasis or evasion, never spelling.
    .replace(/(.)\1{2,}/gu, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Folds leetspeak digits, but only inside a token that also contains a Latin
 * letter — "k1ll" folds to "kill", a bare phone number does not fold at all.
 *
 * Without this restriction, `1` → `i` and `3` → `e` corrupt exactly the digit
 * sequences the spam rule's phone-number pattern needs intact, and a genuine
 * phone number stops matching the rule that exists to catch it.
 */
function foldLeetWithinToken(token: string): string {
  if (!/[a-z]/iu.test(token) || !/[013@$!|]/u.test(token)) return token;
  return token.replace(/[013@$!|]/gu, (c) => LEET[c] ?? c);
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
};

// --- structural rules -------------------------------------------------------

/**
 * A rule that matches a shape rather than a subject.
 *
 * Each carries the reason it exists, because the next person to read this file
 * will be deciding whether it is safe to loosen — and "why is this here" is the
 * only thing that makes that decision possible.
 */
interface StructuralRule {
  id: string;
  category: ModerationCategory;
  severity: ModerationSeverity;
  audience?: ModerationSurface['audience'];
  pattern: RegExp;
  why: string;
}

/*
 * Second-person addressee, English and Arabic.
 *
 * This fragment is what separates "I will kill you" from "the toxin kills the
 * neuron". It is required by every threat and harassment rule below, and it is
 * the single most important design decision in this file.
 */
const YOU_EN = String.raw`\b(you|u|ur|yourself)\b`;
const YOU_AR = String.raw`(انت|إنت|انتي|إنتي|أنت|نفسك|حالك|\bك\b)`;
const ADDRESSEE = `(?:${YOU_EN}|${YOU_AR})`;

const STRUCTURAL_RULES: StructuralRule[] = [
  {
    id: 'threat.violence.second_person',
    category: 'threat',
    severity: 'block',
    pattern: new RegExp(
      String.raw`\b(i(?:'|)?ll|i am going to|im going to|gonna|will)\s+(kill|murder|stab|shoot|beat|burn|rape|destroy)\s+${ADDRESSEE}`,
      'iu',
    ),
    why:
      'A violent verb with a first-person subject and a second-person object. ' +
      'Clinical text never has this shape: pathology kills patients, not "you".',
  },
  {
    id: 'threat.violence.imperative',
    category: 'threat',
    severity: 'block',
    pattern: new RegExp(
      String.raw`\b(kill|hang|drown)\s+(yourself|urself)\b|\b(go\s+)?die\b\s*(already|bitch|idiot)`,
      'iu',
    ),
    why:
      'Telling a person to kill themselves. Distinct from any discussion OF ' +
      'suicide, which psychiatry students must be able to have: the rule ' +
      'requires the imperative and the reflexive object together.',
  },
  {
    id: 'threat.violence.second_person.ar',
    category: 'threat',
    severity: 'block',
    pattern: /(راح|رح|سوف)\s*(أقتلك|اقتلك|أذبحك|اذبحك|أضربك|اضربك)|(أقتلك|اقتلك|أذبحك|اذبحك)/u,
    why:
      'The Arabic equivalents, which carry the object pronoun inside the verb ' +
      '(‑ك = "you"), so the addressee test is the suffix rather than a word.',
  },
  {
    id: 'self_harm.encouragement',
    category: 'self_harm_encouragement',
    severity: 'block',
    pattern: new RegExp(
      String.raw`\b(you|u)\s+should\s+(kill\s+yourself|end\s+it|die)\b|\bnobody\s+would\s+miss\s+(you|u)\b`,
      'iu',
    ),
    why:
      'Encouraging self-harm in the second person. Again keyed on the ' +
      'addressee, so that a case discussion of self-harm — which a medical ' +
      'cohort has every reason to hold — is untouched.',
  },
  {
    id: 'sexual_harassment.proposition',
    category: 'sexual_harassment',
    severity: 'block',
    pattern: new RegExp(
      String.raw`\b(send|show)\s+(me\s+)?(your|ur)\s+(nudes?|tits|boobs|dick|pussy)\b|\bi\s+want\s+to\s+(fuck|bang)\s+${ADDRESSEE}`,
      'iu',
    ),
    why:
      'A demand or proposition aimed at a person. The anatomical words alone ' +
      'are never the trigger — a urology summary uses them and must pass — the ' +
      'imperative plus the possessive second person is.',
  },
  {
    id: 'spam.link_flood',
    category: 'spam',
    severity: 'review',
    audience: 'public',
    pattern: /(https?:\/\/|www\.)\S+(\s|\S)*?(https?:\/\/|www\.)\S+(\s|\S)*?(https?:\/\/|www\.)\S+/iu,
    why:
      'Three or more links in one post. Flagged rather than refused, because a ' +
      'genuine literature post cites several sources — the difference is a ' +
      'judgement a person should make, which is what `review` is for.',
  },
  {
    id: 'spam.contact_solicitation',
    category: 'spam',
    severity: 'review',
    audience: 'public',
    pattern:
      /\b(whatsapp|telegram|واتساب|تلغرام|تليجرام)\b[\s\S]{0,40}?(\+?\d[\d\s-]{7,})|(\+?\d[\d\s-]{9,})[\s\S]{0,40}?\b(whatsapp|telegram|واتساب)\b/iu,
    why:
      'A phone number next to a messaging-app name is the standard shape of ' +
      'off-platform solicitation. Flagged, not refused: a study group genuinely ' +
      'does share a group link, and a moderator can tell the difference.',
  },
];

/** The rules, exposed so the audit document and tests can enumerate them. */
export function structuralRules(): readonly { id: string; category: ModerationCategory; severity: ModerationSeverity; why: string }[] {
  return STRUCTURAL_RULES.map(({ id, category, severity, why }) => ({ id, category, severity, why }));
}

// --- the gate ---------------------------------------------------------------

const SEVERITY_ORDER: Record<ModerationSeverity, number> = { review: 1, block: 2 };

/**
 * Runs the gate over one piece of text.
 *
 * Pure: the caller supplies the lexicon, so this function is fully testable and
 * the same code decides a post, a comment and a message. Returning ALL matches
 * rather than the first is what makes the audit row useful — "blocked" with one
 * rule id is a different conversation from "blocked" with four.
 */
export function moderateText(
  text: string,
  options: { terms: readonly ModerationTerm[]; surface: ModerationSurface },
): ModerationResult {
  const normalised = normaliseForMatching(text);
  if (normalised.length === 0) {
    return { verdict: 'allow', matches: [], reasonKey: null };
  }

  const matches: ModerationMatch[] = [];

  for (const term of options.terms) {
    if (term.pattern.length === 0) continue;
    /*
     * The pattern is folded through the same normalisation as the
     * submission, at match time, rather than trusted to have been stored
     * pre-folded.
     *
     * A seeded term containing taa marbuta (ة) never matched anything: the
     * submission passes through `normaliseForMatching`, which folds ة to ه
     * (routine in informal Arabic typing), but the stored pattern did not,
     * so the comparison was always between a folded string and an unfolded
     * one. The database's own hygiene constraint only checks ASCII
     * lower-casing, which is a no-op for Arabic script and caught nothing.
     * Folding here — the one place both sides of every comparison already
     * meet — makes the match correct regardless of how a term was typed
     * when it was added, and closes the same class of miss for every other
     * fold this module knows about (alef variants, farsi yeh/keheh), not
     * just this one term.
     */
    const pattern = normaliseForMatching(term.pattern);
    if (pattern.length === 0) continue;
    const found =
      term.match === 'word' ? containsWord(normalised, pattern) : normalised.includes(pattern);
    if (found) {
      matches.push({
        ruleId: `term:${term.id}`,
        category: term.category,
        severity: term.severity,
        excerpt: term.pattern,
      });
    }
  }

  for (const rule of STRUCTURAL_RULES) {
    if (rule.audience && rule.audience !== options.surface.audience) continue;
    const hit = rule.pattern.exec(normalised);
    if (hit) {
      matches.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        excerpt: hit[0].slice(0, 120),
      });
    }
  }

  if (matches.length === 0) return { verdict: 'allow', matches: [], reasonKey: null };

  const worst = matches.reduce((a, b) =>
    SEVERITY_ORDER[b.severity] > SEVERITY_ORDER[a.severity] ? b : a,
  );

  return {
    verdict: worst.severity,
    matches,
    // A key, not a sentence: the client translates it, and the author is told
    // WHICH rule fired without being handed the matched pattern — which would
    // turn every refusal into a tutorial on evading the filter.
    reasonKey: `moderation.${worst.category}`,
  };
}

/**
 * Whole-word containment that works for Arabic.
 *
 * `\b` is defined on ASCII word characters, so `\bكلمة\b` does not mean what it
 * looks like it means. Splitting on a Unicode-aware separator class and
 * comparing tokens does.
 */
function containsWord(haystack: string, needle: string): boolean {
  if (!haystack.includes(needle)) return false;
  const tokens = haystack.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  return tokens.includes(needle);
}
