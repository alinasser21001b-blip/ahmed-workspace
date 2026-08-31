import { type CurrencyCode, unitFactor } from './currency.ts';
import { type Money, money } from './money.ts';
import { divRound, gcd, type RoundingMode } from './rounding.ts';

/**
 * An exchange rate held as an exact rational: 1 major unit of `from` equals
 * `num / den` major units of `to`.
 *
 * Rates are never stored as floats. An observed effective rate of
 * 388000 IQD per 1000 SAR is held as exactly that ratio; 1,857,000 IQD over
 * 5,000 SAR stays exact too. Rounding happens once, at display.
 */
export interface Rate {
  readonly num: bigint;
  readonly den: bigint;
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
}

export function rate(num: bigint, den: bigint, from: CurrencyCode, to: CurrencyCode): Rate {
  if (den === 0n) throw new RangeError('rate denominator cannot be zero');
  const neg = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const g = gcd(n, d) || 1n;
  return { num: (neg ? -1n : 1n) * (n / g), den: d / g, from, to };
}

/** Build a rate from a decimal string, e.g. rateFromDecimal("348.30", 'SAR', 'IQD'). */
export function rateFromDecimal(value: string, from: CurrencyCode, to: CurrencyCode): Rate {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value.trim().replace(/[\s,_]/g, ''));
  if (!m) throw new TypeError(`Not a valid rate: ${JSON.stringify(value)}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] === '' ? '0' : (m[2] as string);
  const frac = m[3] ?? '';
  return rate(sign * BigInt(whole + frac), 10n ** BigInt(frac.length), from, to);
}

/**
 * The effective rate implied by paying `cost` to receive `received`.
 *
 * Returns null when `received` is zero. This is the failed-ATM case: a machine
 * that dispensed nothing while debiting the account has no meaningful exchange
 * rate, and dividing by zero to produce one would be worse than saying so.
 */
export function effectiveRate(cost: Money, received: Money): Rate | null {
  if (received.minor === 0n) return null;
  // cost_major / received_major
  //   = (cost.minor / 10^costScale) / (received.minor / 10^recvScale)
  //   = cost.minor * 10^recvScale / (received.minor * 10^costScale)
  const num = cost.minor * unitFactor(received.currency);
  const den = received.minor * unitFactor(cost.currency);
  return rate(num, den, received.currency, cost.currency);
}

/** Convert an amount using an explicit rate. Refuses a rate for another pair. */
export function convert(amount: Money, r: Rate, mode: RoundingMode = 'HALF_UP'): Money {
  if (amount.currency !== r.from) {
    throw new TypeError(
      `Rate converts ${r.from}->${r.to} but amount is ${amount.currency}. ` +
        `Money never changes currency without an explicit conversion basis.`,
    );
  }
  // to.minor = from.minor * (num/den) * 10^toScale / 10^fromScale
  const num = amount.minor * r.num * unitFactor(r.to);
  const den = r.den * unitFactor(r.from);
  return money(divRound(num, den, mode), r.to);
}

export function invertRate(r: Rate): Rate {
  if (r.num === 0n) throw new RangeError('cannot invert a zero rate');
  return rate(r.den, r.num, r.to, r.from);
}

/** Exact decimal rendering to `places`, rounded once. */
export function rateToDecimalString(r: Rate, places = 4, mode: RoundingMode = 'HALF_UP'): string {
  const factor = 10n ** BigInt(places);
  const scaled = divRound(r.num * factor, r.den, mode);
  const neg = scaled < 0n;
  const digits = (neg ? -scaled : scaled).toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const frac = places === 0 ? '' : '.' + digits.slice(digits.length - places);
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** "371.4200 IQD per 1 SAR" — a rate is meaningless without both currencies. */
export function formatRate(r: Rate, places = 4): string {
  return `${rateToDecimalString(r, places)} ${r.to} per 1 ${r.from}`;
}

export function compareRates(a: Rate, b: Rate): -1 | 0 | 1 {
  if (a.from !== b.from || a.to !== b.to) {
    throw new TypeError(`Cannot compare ${a.from}->${a.to} with ${b.from}->${b.to}`);
  }
  const l = a.num * b.den;
  const rr = b.num * a.den;
  return l < rr ? -1 : l > rr ? 1 : 0;
}

export function subtractRates(a: Rate, b: Rate): Rate {
  if (a.from !== b.from || a.to !== b.to) {
    throw new TypeError(`Cannot subtract ${b.from}->${b.to} from ${a.from}->${a.to}`);
  }
  return rate(a.num * b.den - b.num * a.den, a.den * b.den, a.from, a.to);
}

/** Arithmetic mean of rates over the same pair; exact, no float accumulation. */
export function meanRate(rates: readonly Rate[]): Rate | null {
  if (rates.length === 0) return null;
  const first = rates[0] as Rate;
  let num = 0n;
  let den = 1n;
  for (const r of rates) {
    if (r.from !== first.from || r.to !== first.to) {
      throw new TypeError('meanRate requires all rates to share a currency pair');
    }
    num = num * r.den + r.num * den;
    den = den * r.den;
  }
  return rate(num, den * BigInt(rates.length), first.from, first.to);
}

export interface RateWire {
  num: string;
  den: string;
  from: CurrencyCode;
  to: CurrencyCode;
}
export function rateToWire(r: Rate): RateWire {
  return { num: r.num.toString(), den: r.den.toString(), from: r.from, to: r.to };
}
export function rateFromWire(w: RateWire): Rate {
  return rate(BigInt(w.num), BigInt(w.den), w.from, w.to);
}
