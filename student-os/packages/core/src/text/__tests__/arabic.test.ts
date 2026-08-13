import { describe, expect, it } from 'vitest';
import {
  arabicPluralCategory,
  englishPluralCategory,
  normalizeArabic,
  selectPlural,
} from '../arabic.js';

/**
 * Arabic text handling.
 *
 * The normalisation cases below are the ones that were *measured* to fail
 * against pg_trgm before this existed — tashkeel at 0.07 similarity and alef
 * madda at 0.14, both under the 0.15 floor, both therefore returning no result
 * at all. They are here as regressions, not as illustrations.
 */

describe('normalizeArabic', () => {
  it('strips tashkeel, which is what made diacritised text unfindable', () => {
    expect(normalizeArabic('اَلْقَلْب')).toBe('القلب');
    expect(normalizeArabic('مُحَمَّد')).toBe(normalizeArabic('محمد'));
  });

  it('folds every alef form to a bare alef', () => {
    const bare = normalizeArabic('اسم');
    for (const variant of ['أسم', 'إسم', 'آسم', 'ٱسم']) {
      expect(normalizeArabic(variant)).toBe(bare);
    }
  });

  it('folds ta marbuta to heh and alef maqsura to yeh', () => {
    expect(normalizeArabic('الكلوية')).toBe(normalizeArabic('الكلويه'));
    expect(normalizeArabic('مستشفى')).toBe(normalizeArabic('مستشفي'));
  });

  it('removes tatweel, a justification glyph with no phonetic value', () => {
    expect(normalizeArabic('القـــلب')).toBe(normalizeArabic('القلب'));
  });

  it('removes zero-width and bidi controls that survive copy-paste', () => {
    expect(normalizeArabic('القلب‏​')).toBe('القلب');
  });

  it('folds Arabic-Indic digits to ASCII', () => {
    expect(normalizeArabic('٢٠٢٥')).toBe('2025');
    expect(normalizeArabic('۲۰۲۵')).toBe('2025');
  });

  it('leaves Latin text alone apart from case, so one index serves both', () => {
    expect(normalizeArabic('Nephrotic Syndrome')).toBe('nephrotic syndrome');
    expect(normalizeArabic('متلازمة Nephrotic')).toBe('متلازمه nephrotic');
  });

  it('collapses whitespace and trims', () => {
    // The expected value carries the folded yeh, not the alef maqsura that was
    // typed: normalisation still applies inside a whitespace case.
    expect(normalizeArabic('  القلب   والكلى  ')).toBe('القلب والكلي');
  });

  /*
   * The boundary of what this is allowed to do. Folding these would merge words
   * students actually distinguish, so search stays imperfect here on purpose —
   * root-aware matching is a later Search phase, not something normalisation
   * should approximate.
   */
  it('does NOT strip the definite article, and does not fold و/ؤ', () => {
    expect(normalizeArabic('القلب')).not.toBe(normalizeArabic('قلب'));
    expect(normalizeArabic('سؤال')).not.toBe(normalizeArabic('سوال'));
  });

  it('is idempotent', () => {
    for (const input of ['اَلْقَلْب', 'آسم', '  mixed ٢٠٢٥ نَص  ']) {
      expect(normalizeArabic(normalizeArabic(input))).toBe(normalizeArabic(input));
    }
  });
});

describe('arabic plural categories', () => {
  /*
   * Arabic has six categories against English's two. The rule the product used
   * to apply — one form for everything — rendered «2 عضو» and «11 عضو», which
   * are wrong in four of the six.
   */
  it('follows CLDR, not an English-shaped rule', () => {
    expect(arabicPluralCategory(0)).toBe('zero');
    expect(arabicPluralCategory(1)).toBe('one');
    expect(arabicPluralCategory(2)).toBe('two');
    for (const n of [3, 7, 10]) expect(arabicPluralCategory(n)).toBe('few');
    for (const n of [11, 25, 99]) expect(arabicPluralCategory(n)).toBe('many');
    for (const n of [100, 101, 102, 200, 1000]) expect(arabicPluralCategory(n)).toBe('other');
  });

  it('keys on the last two digits, so 103 is `few` and 111 is `many`', () => {
    expect(arabicPluralCategory(103)).toBe('few');
    expect(arabicPluralCategory(111)).toBe('many');
    expect(arabicPluralCategory(210)).toBe('few');
  });

  it('treats negatives and fractions by magnitude and integer part', () => {
    expect(arabicPluralCategory(-2)).toBe('two');
    expect(arabicPluralCategory(1.7)).toBe('one');
  });

  it('keeps English at two categories', () => {
    expect(englishPluralCategory(1)).toBe('one');
    for (const n of [0, 2, 11, 100]) expect(englishPluralCategory(n)).toBe('other');
  });
});

describe('selectPlural', () => {
  const members = {
    zero: 'لا أعضاء',
    one: 'عضو واحد',
    two: 'عضوان',
    few: '{count} أعضاء',
    many: '{count} عضوًا',
    other: '{count} عضو',
  };

  it('picks the Arabic form the language requires', () => {
    expect(selectPlural('ar', 0, members)).toBe('لا أعضاء');
    expect(selectPlural('ar', 1, members)).toBe('عضو واحد');
    expect(selectPlural('ar', 2, members)).toBe('عضوان');
    expect(selectPlural('ar', 5, members)).toBe('{count} أعضاء');
    expect(selectPlural('ar', 15, members)).toBe('{count} عضوًا');
    expect(selectPlural('ar', 100, members)).toBe('{count} عضو');
  });

  it('falls back to `other` for any form a catalogue does not define', () => {
    expect(selectPlural('ar', 2, { other: '{count} عضو' })).toBe('{count} عضو');
    expect(selectPlural('en', 5, { one: '1 member', other: '{count} members' })).toBe(
      '{count} members',
    );
  });
});
