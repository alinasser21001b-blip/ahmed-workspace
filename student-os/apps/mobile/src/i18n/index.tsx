import { selectPlural } from '@sos/core';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { ar } from './ar';
import { en } from './en';
import { arPlurals, enPlurals, type PluralKey } from './plurals';

/**
 * Internationalisation (§62).
 *
 * Arabic is primary; English is secondary. Both catalogues are typed against
 * the same key set, so a missing translation is a COMPILE error rather than a
 * string that silently renders as a key in production.
 */

export type Locale = 'ar' | 'en';
/** Flat strings and countable strings share one key space at the call site. */
export type TranslationKey = keyof typeof ar | PluralKey;

const catalogues: Record<Locale, Record<keyof typeof ar, string>> = { ar, en };
const pluralCatalogues = { ar: arPlurals, en: enPlurals };

function isPluralKey(key: TranslationKey): key is PluralKey {
  return key in arPlurals;
}

export const isRTLLocale = (locale: Locale): boolean => locale === 'ar';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isRTL: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  children,
  initialLocale = 'ar',
}: {
  children: ReactNode;
  initialLocale?: Locale;
}): React.JSX.Element {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      isRTL: isRTLLocale(locale),
      /*
       * One call site for both kinds of string.
       *
       * A countable key resolves its form from `params.count` through the CLDR
       * rule in @sos/core before interpolation. Screens therefore cannot forget
       * to pluralise: passing a count to a countable key is the only way to use
       * it, and the compiler enforces the key exists in both catalogues.
       */
      t: (key, params) => {
        let template: string;
        if (isPluralKey(key)) {
          const count = Number(params?.count ?? 0);
          const forms = pluralCatalogues[locale][key] ?? enPlurals[key];
          template = selectPlural(locale, count, forms);
        } else {
          template = catalogues[locale][key] ?? catalogues.en[key] ?? key;
        }
        if (!params) return template;
        return Object.entries(params).reduce(
          (acc, [name, replacement]) => acc.replaceAll(`{${name}}`, String(replacement)),
          template,
        );
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

/**
 * Applies writing direction.
 *
 * On native this requires a reload to take effect, which is why the app reads
 * the device locale at startup rather than offering a mid-session flip that
 * would leave the layout half-mirrored.
 *
 * On web it also sets `dir` and `lang` on the document element, which nothing
 * did before. react-native-web puts `writingDirection` on each `Text` it
 * renders, so most visible copy looked right and the document itself stayed
 * `ltr` — leaving the browser's own bidi resolution, text selection, scrollbar
 * placement, form controls and assistive technology all working from the wrong
 * base direction. The layout audit found it by reading
 * `getComputedStyle(document.body).direction`, which is the only place the
 * discrepancy is visible.
 */
export function applyDirection(locale: Locale): void {
  const rtl = isRTLLocale(locale);

  if (typeof document !== 'undefined') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }

  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
}
