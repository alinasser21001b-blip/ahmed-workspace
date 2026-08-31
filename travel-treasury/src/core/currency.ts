/**
 * Currency definitions.
 *
 * `scale` is the number of decimal places used to express the currency in its
 * minor unit. Every amount in this system is stored and computed as an integer
 * count of minor units, so this number is load-bearing: it decides what "1"
 * means.
 *
 * IQD is scale 0 — whole dinars. The dinar nominally subdivides into 1000 fils,
 * but fils have not circulated for decades and Iraqi bank statements, ATM
 * receipts and banking apps all quote whole dinars. Modelling a fils place we
 * would never observe would invent precision the evidence does not have.
 */
export const CURRENCIES = {
  IQD: { code: 'IQD', scale: 0, nameEn: 'Iraqi Dinar', nameAr: 'دينار عراقي' },
  USD: { code: 'USD', scale: 2, nameEn: 'US Dollar', nameAr: 'دولار أمريكي' },
  SAR: { code: 'SAR', scale: 2, nameEn: 'Saudi Riyal', nameAr: 'ريال سعودي' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && Object.hasOwn(CURRENCIES, v);
}

export function scaleOf(currency: CurrencyCode): number {
  return CURRENCIES[currency].scale;
}

/** 10^scale, as a bigint. Used to move between major and minor units. */
export function unitFactor(currency: CurrencyCode): bigint {
  return 10n ** BigInt(CURRENCIES[currency].scale);
}
