/**
 * Integer rounding for money. There is no floating point in this file, and no
 * floating point anywhere downstream of it.
 */
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

/**
 * Divide two bigints and round the quotient. Handles negative numerators and
 * denominators correctly by rounding on magnitude and re-applying the sign,
 * so that -0.5 rounds to -1 under HALF_UP just as 0.5 rounds to 1.
 */
export function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode = 'HALF_UP'): bigint {
  if (denominator === 0n) throw new RangeError('division by zero');

  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const q = n / d;
  const r = n % d;
  if (r === 0n) return negative ? -q : q;

  let rounded: bigint;
  switch (mode) {
    case 'DOWN':
      rounded = q;
      break;
    case 'UP':
      rounded = q + 1n;
      break;
    case 'HALF_UP':
      rounded = r * 2n >= d ? q + 1n : q;
      break;
    case 'HALF_EVEN': {
      const twice = r * 2n;
      if (twice > d) rounded = q + 1n;
      else if (twice < d) rounded = q;
      else rounded = q % 2n === 0n ? q : q + 1n;
      break;
    }
  }
  return negative ? -rounded : rounded;
}

/** Greatest common divisor of two non-negative bigints. */
export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}
