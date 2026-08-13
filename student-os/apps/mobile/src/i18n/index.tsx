import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { ar } from './ar';
import { en } from './en';

/**
 * Internationalisation (§62).
 *
 * Arabic is primary; English is secondary. Both catalogues are typed against
 * the same key set, so a missing translation is a COMPILE error rather than a
 * string that silently renders as a key in production.
 */

export type Locale = 'ar' | 'en';
export type TranslationKey = keyof typeof ar;

const catalogues: Record<Locale, Record<TranslationKey, string>> = { ar, en };

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
      t: (key, params) => {
        const template = catalogues[locale][key] ?? catalogues.en[key] ?? key;
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
 */
export function applyDirection(locale: Locale): void {
  const rtl = isRTLLocale(locale);
  if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
}
