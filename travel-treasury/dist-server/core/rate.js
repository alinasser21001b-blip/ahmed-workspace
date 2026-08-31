import { unitFactor } from "./currency.js";
import { money } from "./money.js";
import { divRound, gcd } from "./rounding.js";
export function rate(num, den, from, to) {
    if (den === 0n)
        throw new RangeError('rate denominator cannot be zero');
    const neg = (num < 0n) !== (den < 0n);
    const n = num < 0n ? -num : num;
    const d = den < 0n ? -den : den;
    const g = gcd(n, d) || 1n;
    return { num: (neg ? -1n : 1n) * (n / g), den: d / g, from, to };
}
/** Build a rate from a decimal string, e.g. rateFromDecimal("348.30", 'SAR', 'IQD'). */
export function rateFromDecimal(value, from, to) {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(value.trim().replace(/[\s,_]/g, ''));
    if (!m)
        throw new TypeError(`Not a valid rate: ${JSON.stringify(value)}`);
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = m[2] === '' ? '0' : m[2];
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
export function effectiveRate(cost, received) {
    if (received.minor === 0n)
        return null;
    // cost_major / received_major
    //   = (cost.minor / 10^costScale) / (received.minor / 10^recvScale)
    //   = cost.minor * 10^recvScale / (received.minor * 10^costScale)
    const num = cost.minor * unitFactor(received.currency);
    const den = received.minor * unitFactor(cost.currency);
    return rate(num, den, received.currency, cost.currency);
}
/** Convert an amount using an explicit rate. Refuses a rate for another pair. */
export function convert(amount, r, mode = 'HALF_UP') {
    if (amount.currency !== r.from) {
        throw new TypeError(`Rate converts ${r.from}->${r.to} but amount is ${amount.currency}. ` +
            `Money never changes currency without an explicit conversion basis.`);
    }
    // to.minor = from.minor * (num/den) * 10^toScale / 10^fromScale
    const num = amount.minor * r.num * unitFactor(r.to);
    const den = r.den * unitFactor(r.from);
    return money(divRound(num, den, mode), r.to);
}
export function invertRate(r) {
    if (r.num === 0n)
        throw new RangeError('cannot invert a zero rate');
    return rate(r.den, r.num, r.to, r.from);
}
/** Exact decimal rendering to `places`, rounded once. */
export function rateToDecimalString(r, places = 4, mode = 'HALF_UP') {
    const factor = 10n ** BigInt(places);
    const scaled = divRound(r.num * factor, r.den, mode);
    const neg = scaled < 0n;
    const digits = (neg ? -scaled : scaled).toString().padStart(places + 1, '0');
    const whole = digits.slice(0, digits.length - places);
    const frac = places === 0 ? '' : '.' + digits.slice(digits.length - places);
    return `${neg ? '-' : ''}${whole}${frac}`;
}
/** "371.4200 IQD per 1 SAR" — a rate is meaningless without both currencies. */
export function formatRate(r, places = 4) {
    return `${rateToDecimalString(r, places)} ${r.to} per 1 ${r.from}`;
}
export function compareRates(a, b) {
    if (a.from !== b.from || a.to !== b.to) {
        throw new TypeError(`Cannot compare ${a.from}->${a.to} with ${b.from}->${b.to}`);
    }
    const l = a.num * b.den;
    const rr = b.num * a.den;
    return l < rr ? -1 : l > rr ? 1 : 0;
}
export function subtractRates(a, b) {
    if (a.from !== b.from || a.to !== b.to) {
        throw new TypeError(`Cannot subtract ${b.from}->${b.to} from ${a.from}->${a.to}`);
    }
    return rate(a.num * b.den - b.num * a.den, a.den * b.den, a.from, a.to);
}
/** Arithmetic mean of rates over the same pair; exact, no float accumulation. */
export function meanRate(rates) {
    if (rates.length === 0)
        return null;
    const first = rates[0];
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
export function rateToWire(r) {
    return { num: r.num.toString(), den: r.den.toString(), from: r.from, to: r.to };
}
export function rateFromWire(w) {
    return rate(BigInt(w.num), BigInt(w.den), w.from, w.to);
}
