import type { PluralForms } from '@sos/core';

/**
 * Countable strings.
 *
 * These are separate from the flat catalogue because they are a different kind
 * of thing: a flat string has one form, a countable string has up to six in
 * Arabic and two in English, and a `Record<string, string>` cannot express
 * that. Trying to make it — `'{count} عضو'` — is what produced «٢ عضو» and
 * «١١ عضو» on three screens, both of which are wrong.
 *
 * The selection rule is CLDR's, implemented and unit-tested in
 * `@sos/core/text/arabic`, so the client does not carry its own opinion about
 * Arabic grammar.
 *
 * Only `other` is required per entry. Where Arabic needs the dual or the
 * accusative singular, the entry says so; where a phrase genuinely does not
 * change, the omission is deliberate rather than an oversight.
 */

export const arPlurals = {
  'learn.answered.count': {
    zero: 'لم تُجب بعد',
    one: 'إجابة واحدة',
    two: 'إجابتان',
    few: '{count} إجابات',
    many: '{count} إجابة',
    other: '{count} إجابة',
  },
  'provenance.cites': {
    zero: 'بلا مصادر',
    one: 'يستشهد بمصدر واحد',
    two: 'يستشهد بمصدرين',
    few: 'يستشهد بـ{count} مصادر',
    many: 'يستشهد بـ{count} مصدرًا',
    other: 'يستشهد بـ{count} مصدر',
  },
  'groups.members.count': {
    zero: 'لا أعضاء',
    one: 'عضو واحد',
    two: 'عضوان',
    // 3–10 take the plural of paucity.
    few: '{count} أعضاء',
    // 11–99 take the accusative singular — the form an English-shaped rule
    // never produces.
    many: '{count} عضوًا',
    other: '{count} عضو',
  },
  'groups.requests.count': {
    zero: 'لا طلبات',
    one: 'طلب واحد',
    two: 'طلبان',
    few: '{count} طلبات',
    many: '{count} طلبًا',
    other: '{count} طلب',
  },
  'post.likes.count': {
    zero: 'لا إعجابات',
    one: 'إعجاب واحد',
    two: 'إعجابان',
    few: '{count} إعجابات',
    many: '{count} إعجابًا',
    other: '{count} إعجاب',
  },
  'post.comments.count': {
    zero: 'لا تعليقات',
    one: 'تعليق واحد',
    two: 'تعليقان',
    few: '{count} تعليقات',
    many: '{count} تعليقًا',
    other: '{count} تعليق',
  },
} satisfies Record<string, PluralForms>;

export type PluralKey = keyof typeof arPlurals;

/** Typed against Arabic, so a missing entry is a compile error. */
export const enPlurals: Record<PluralKey, PluralForms> = {
  'learn.answered.count': {
    zero: 'Not answered yet',
    one: '1 answered',
    other: '{count} answered',
  },
  'provenance.cites': {
    one: 'Cites 1 source',
    other: 'Cites {count} sources',
  },
  'groups.members.count': { zero: 'No members', one: '1 member', other: '{count} members' },
  'groups.requests.count': { zero: 'No requests', one: '1 request', other: '{count} requests' },
  'post.likes.count': { zero: 'No likes', one: '1 like', other: '{count} likes' },
  'post.comments.count': { zero: 'No comments', one: '1 comment', other: '{count} comments' },
};
