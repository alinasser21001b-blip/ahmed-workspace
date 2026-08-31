import { getLocale, tCurrency } from '../i18n.ts';

/**
 * Display formatting for money that arrives from the API as minor units.
 *
 * No arithmetic happens here — the server computed every figure. This file
 * only turns an exact integer string into digits a person can read, and it
 * always puts the currency beside them: the UI is never allowed to show a bare
 * number.
 */
const SCALES: Record<string, number> = { IQD: 0, USD: 2, SAR: 2 };

export function formatMinor(
  minor: string | number | bigint | null | undefined,
  currency: string,
): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  // Coerce defensively. The server sends decimal strings, but a single
  // unexpected type must degrade one figure, never take down the screen a
  // traveller is standing at an ATM reading.
  const raw = typeof minor === 'string' ? minor : String(minor);
  if (!/^-?\d+$/.test(raw)) return '—';
  const scale = SCALES[currency] ?? 2;
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const frac = scale === 0 ? '' : '.' + digits.slice(digits.length - scale);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${frac}`;
}

/** Amount plus currency name. This is the only approved way to render money. */
export function money(
  minor: string | number | bigint | null | undefined,
  currency: string,
): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const shown = formatMinor(minor, currency);
  return shown === '—' ? '—' : `${shown} ${tCurrency(currency)}`;
}

export function moneyFromWire(w: { minor: string; currency: string } | null | undefined): string {
  if (!w) return '—';
  return money(w.minor, w.currency);
}

/** Turn a typed decimal amount into minor units for the API. Rejects junk. */
export function toMinor(input: string, currency: string): string | null {
  const scale = SCALES[currency] ?? 2;
  const cleaned = input.replace(/[\s,_٬،]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (cleaned === '' ) return null;
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) return null;
  const whole = m[2] === '' ? '0' : (m[2] as string);
  const frac = m[3] ?? '';
  if (frac.length > scale) return null;
  if (m[2] === '' && frac === '') return null;
  return `${m[1] === '-' ? '-' : ''}${whole}${frac.padEnd(scale, '0')}`.replace(/^(-?)0+(\d)/, '$1$2');
}

export function scaleOf(currency: string): number {
  return SCALES[currency] ?? 2;
}

export function formatSaudiTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // Gregorian, Latin digits, in both languages: dates on bank statements and
  // in banking apps are Gregorian, and the traveller reconciles against those.
  return new Intl.DateTimeFormat(getLocale() === 'ar' ? 'ar-IQ-u-ca-gregory-nu-latn' : 'en-GB', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export function todayRiyadh(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${g.year}-${g.month}-${g.day}`;
}
