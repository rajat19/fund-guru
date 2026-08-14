import { describe, expect, it } from 'vitest';
import {
  formatCrore,
  formatCurrency,
  formatPercent,
  formatRatio,
  formatReturn,
  getReturnColor,
  maxOf,
  minOf,
  sortValue,
} from '@/utils/format';

describe('nullable handling', () => {
  // Every numeric field in the feed is optional, and the old code called
  // .toFixed() straight on them, which threw once a fund lacked 5Y history.
  const absent = [null, undefined, Number.NaN];

  it('renders N/A rather than throwing on missing values', () => {
    for (const value of absent) {
      expect(formatPercent(value)).toBe('N/A');
      expect(formatReturn(value)).toBe('N/A');
      expect(formatRatio(value)).toBe('N/A');
      expect(formatCrore(value)).toBe('N/A');
      expect(formatCurrency(value)).toBe('N/A');
    }
  });

  it('treats zero as present, not missing', () => {
    expect(formatPercent(0)).toBe('0.00%');
    expect(formatReturn(0)).toBe('0.00%');
    expect(formatRatio(0)).toBe('0.00');
  });

  it('rejects non-finite numbers', () => {
    // Infinity is never a real metric; letting it through would put a fund at
    // the top of every percentile.
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('N/A');
    expect(formatRatio(Number.NEGATIVE_INFINITY)).toBe('N/A');
  });
});

describe('string inputs', () => {
  // Regression: expense_ratio arrives from the feed as a string. The previous
  // guard was `value != null && !Number.isNaN(value)`, but Number.isNaN does
  // not coerce — Number.isNaN('0.5') is false — so strings passed the guard and
  // then threw "value.toFixed is not a function".
  it('coerces numeric strings instead of throwing', () => {
    expect(() => formatPercent('0.52')).not.toThrow();
    expect(formatPercent('0.52')).toBe('0.52%');
    expect(formatReturn('12.5')).toBe('+12.50%');
    expect(formatReturn('-3.25')).toBe('-3.25%');
    expect(formatRatio('1.234')).toBe('1.23');
    expect(formatCrore('45000')).toBe('₹45,000 Cr');
  });

  it('tolerates surrounding whitespace', () => {
    expect(formatPercent(' 0.75 ')).toBe('0.75%');
  });

  it('treats empty and non-numeric strings as missing', () => {
    for (const value of ['', '   ', 'NA', 'N/A', '-', 'abc']) {
      expect(formatPercent(value)).toBe('N/A');
      expect(formatRatio(value)).toBe('N/A');
    }
  });

  it('handles the string zero as present', () => {
    expect(formatPercent('0')).toBe('0.00%');
  });

  it('sorts and aggregates numeric strings numerically, not lexically', () => {
    // '9' > '10' as strings. Getting this wrong is worse than crashing because
    // it silently reorders the whole table.
    expect(maxOf(['9', '10'])).toBe(10);
    expect(minOf(['9', '10'])).toBe(9);
    expect(sortValue('9', 'desc')).toBe(9);
  });

  it('colours a numeric string by its value', () => {
    expect(getReturnColor('20')).toBe('text-profit');
    expect(getReturnColor('-2')).toBe('text-loss');
    expect(getReturnColor('abc')).toBe('text-muted-foreground');
  });
});

describe('formatReturn', () => {
  it('signs positive returns and leaves negatives with their own sign', () => {
    expect(formatReturn(12.345)).toBe('+12.35%');
    expect(formatReturn(-4.5)).toBe('-4.50%');
  });

  it('honours the digits argument', () => {
    expect(formatReturn(12.345, 1)).toBe('+12.3%');
  });
});

describe('formatCrore', () => {
  it('uses the Indian grouping convention', () => {
    // 45,000 not 45.000 and not 45K — AUM is quoted in crore in India.
    expect(formatCrore(45000)).toBe('₹45,000 Cr');
    expect(formatCrore(1234567)).toBe('₹12,34,567 Cr');
  });
});

describe('getReturnColor', () => {
  it('maps by magnitude and sign', () => {
    expect(getReturnColor(20)).toBe('text-profit');
    expect(getReturnColor(10)).toBe('text-secondary');
    expect(getReturnColor(3)).toBe('text-muted-foreground');
    expect(getReturnColor(-1)).toBe('text-loss');
    expect(getReturnColor(null)).toBe('text-muted-foreground');
  });
});

describe('maxOf / minOf', () => {
  it('ignores missing values', () => {
    expect(maxOf([1, null, 5, undefined])).toBe(5);
    expect(minOf([1, null, 5, undefined])).toBe(1);
  });

  it('returns null for an empty or all-missing list instead of Infinity', () => {
    // Math.max(...[]) is -Infinity, which used to render as "-Infinity%".
    expect(maxOf([])).toBeNull();
    expect(minOf([])).toBeNull();
    expect(maxOf([null, undefined, Number.NaN])).toBeNull();
  });
});

describe('sortValue', () => {
  it('pushes missing values last in both directions', () => {
    // Descending: missing must sort below every real value.
    expect(sortValue(null, 'desc')).toBe(Number.NEGATIVE_INFINITY);
    // Ascending: missing must still sort below, i.e. at the far end.
    expect(sortValue(null, 'asc')).toBe(Number.POSITIVE_INFINITY);
  });

  it('sorts real values to the top in a descending comparator', () => {
    const values = [5, null, 20, undefined, 10];
    const sorted = [...values].sort(
      (a, b) => sortValue(b, 'desc') - sortValue(a, 'desc'),
    );
    expect(sorted.slice(0, 3)).toEqual([20, 10, 5]);
  });

  it('keeps zero ahead of missing', () => {
    expect(sortValue(0, 'desc')).toBeGreaterThan(sortValue(null, 'desc'));
  });
});
