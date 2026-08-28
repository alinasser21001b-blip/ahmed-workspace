'use client';

import { useLocale } from '@/app/providers';
import { t } from '@/i18n/copy';

export function Disclaimer() {
  const { locale } = useLocale();
  return (
    <p className="disclaimer" role="note">
      {t(locale).disclaimer}
    </p>
  );
}

export function SampleBanner() {
  const { locale } = useLocale();
  return (
    <p className="sample-banner" role="status">
      {t(locale).sampleBanner}
    </p>
  );
}

export function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      type="button"
      className="ghost-btn locale-toggle"
      onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      aria-label={t(locale).language}
    >
      {t(locale).language}
    </button>
  );
}
