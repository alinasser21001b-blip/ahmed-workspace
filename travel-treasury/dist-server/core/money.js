import { CURRENCIES, unitFactor } from "./currency.js";
import { divRound } from "./rounding.js";
export class CurrencyMismatchError extends Error {
    constructor(a, b, op) {
        super(`Currency mismatch in ${op}: ${a} vs ${b}. Money never changes currency ` +
            `without an explicit conversion basis.`);
        this.name = 'CurrencyMismatchError';
    }
}
export function money(minor, currency) {
    if (typeof minor === 'number') {
        if (!Number.isInteger(minor)) {
            throw new TypeError(`Money must be built from whole minor units; received ${minor}. ` +
                `Use fromDecimalString() for a decimal amount.`);
        }
        return { minor: BigInt(minor), currency };
    }
    return { minor, currency };
}
export function zero(currency) {
    return { minor: 0n, currency };
}
/**
 * Parse a human/decimal string ("4,612,000", "1000.50", "-270") into exact
 * minor units for the given currency. Rejects excess precision rather than
 * silently rounding it away: if a user types 3 decimals of SAR, that is a typo
 * or a misunderstanding, and guessing which is not this function's job.
 */
export function fromDecimalString(input, currency) {
    const scale = CURRENCIES[currency].scale;
    const cleaned = input.replace(/[\s,_]/g, '').replace(/[٬،]/g, '');
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
    if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
        throw new TypeError(`Not a valid decimal amount: ${JSON.stringify(input)}`);
    }
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = m[2] === '' ? '0' : m[2];
    const frac = m[3] ?? '';
    if (frac.length > scale) {
        throw new TypeError(`${currency} has ${scale} decimal place(s); ${JSON.stringify(input)} has ${frac.length}.`);
    }
    const padded = frac.padEnd(scale, '0');
    return { minor: sign * BigInt(whole + padded), currency };
}
export function add(a, b) {
    if (a.currency !== b.currency)
        throw new CurrencyMismatchError(a.currency, b.currency, 'add');
    return { minor: a.minor + b.minor, currency: a.currency };
}
export function subtract(a, b) {
    if (a.currency !== b.currency)
        throw new CurrencyMismatchError(a.currency, b.currency, 'subtract');
    return { minor: a.minor - b.minor, currency: a.currency };
}
export function negate(a) {
    return { minor: -a.minor, currency: a.currency };
}
export function abs(a) {
    return { minor: a.minor < 0n ? -a.minor : a.minor, currency: a.currency };
}
export function sum(items, currency) {
    let total = 0n;
    for (const m of items) {
        if (m.currency !== currency)
            throw new CurrencyMismatchError(currency, m.currency, 'sum');
        total += m.minor;
    }
    return { minor: total, currency };
}
/** Multiply by an exact rational (e.g. a percentage), rounding at the end only. */
export function multiplyRational(a, num, den, mode = 'HALF_UP') {
    return { minor: divRound(a.minor * num, den, mode), currency: a.currency };
}
/**
 * Percent of an amount, where `percent` is given as an exact decimal string
 * ("2", "2.5", "0.3"). A string, not a number, because 2.5 is representable in
 * binary but 0.1 is not, and the distinction has bitten enough financial code.
 */
export function percentOf(a, percent, mode = 'HALF_UP') {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(percent.trim());
    if (!m)
        throw new TypeError(`Not a valid percentage: ${JSON.stringify(percent)}`);
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = m[2] === '' ? '0' : m[2];
    const frac = m[3] ?? '';
    const num = sign * BigInt(whole + frac);
    const den = 100n * 10n ** BigInt(frac.length);
    return multiplyRational(a, num, den, mode);
}
export function isZero(a) {
    return a.minor === 0n;
}
export function isNegative(a) {
    return a.minor < 0n;
}
export function isPositive(a) {
    return a.minor > 0n;
}
export function compare(a, b) {
    if (a.currency !== b.currency)
        throw new CurrencyMismatchError(a.currency, b.currency, 'compare');
    return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}
export function equals(a, b) {
    return a.currency === b.currency && a.minor === b.minor;
}
export function min(a, b) {
    return compare(a, b) <= 0 ? a : b;
}
export function max(a, b) {
    return compare(a, b) >= 0 ? a : b;
}
/** Exact decimal string, no grouping. "-270.00", "4612000". */
export function toDecimalString(a) {
    const scale = CURRENCIES[a.currency].scale;
    const neg = a.minor < 0n;
    const digits = (neg ? -a.minor : a.minor).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const frac = scale === 0 ? '' : '.' + digits.slice(digits.length - scale);
    return `${neg ? '-' : ''}${whole}${frac}`;
}
/**
 * Display form. Always renders the currency code beside the amount — the UI is
 * never permitted to show a bare number, so the code is produced here rather
 * than left to the caller to remember.
 */
export function format(a, locale = 'en') {
    const s = toDecimalString(a);
    const neg = s.startsWith('-');
    const body = neg ? s.slice(1) : s;
    const [whole = '0', frac] = body.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const num = `${neg ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
    const name = locale === 'ar' ? CURRENCIES[a.currency].nameAr : a.currency;
    return `${num} ${name}`;
}
export function toWire(a) {
    return { minor: a.minor.toString(), currency: a.currency };
}
export function fromWire(w) {
    return { minor: BigInt(w.minor), currency: w.currency };
}
/** Convert whole major units to Money, e.g. majorUnits(5000, 'SAR'). */
export function majorUnits(whole, currency) {
    const b = typeof whole === 'number' ? BigInt(whole) : whole;
    if (typeof whole === 'number' && !Number.isInteger(whole)) {
        throw new TypeError('majorUnits() takes whole units; use fromDecimalString() otherwise.');
    }
    return { minor: b * unitFactor(currency), currency };
}
