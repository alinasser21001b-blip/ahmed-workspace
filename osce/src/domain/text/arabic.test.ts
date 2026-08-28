import { describe, expect, it } from 'vitest';
import { formatTimer, normalizeArabic, selectPlural } from './arabic';

describe('arabic helpers', () => {
  it('folds hamza and ta marbuta for matching', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(normalizeArabic('المدرسة')).toBe(normalizeArabic('المدرسه'));
  });

  it('keeps timers in Latin digits', () => {
    expect(formatTimer(240)).toBe('04:00');
    expect(formatTimer(5)).toBe('00:05');
  });

  it('uses Arabic dual for two', () => {
    expect(
      selectPlural('ar', 2, {
        one: 'سؤال واحد',
        two: 'سؤالان',
        other: 'أسئلة',
      }),
    ).toBe('سؤالان');
  });
});
