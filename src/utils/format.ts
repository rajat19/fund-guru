/**
 * Display formatters.
 *
 * Two realities drive the shape of these:
 *
 *  1. Almost every numeric field in the feed is optional — a fund can
 *     legitimately have no 5Y return because it is three years old.
 *  2. Some fields are declared as `number` but arrive as numeric *strings*
 *     (expense_ratio being the usual culprit), so the runtime type is wider
 *     than the declared one.
 *
 * Every formatter therefore coerces defensively and returns 'N/A' rather than
 * throwing. A rendering crash over one malformed field is never the right
 * trade in a screen showing thousands of funds.
 */

import { toNumber, type NumericLike } from '@/utils/number';

export type Maybe = NumericLike;

export const formatPercent = (value: Maybe, digits = 2): string => {
  const n = toNumber(value);
  return n === null ? 'N/A' : `${n.toFixed(digits)}%`;
};

/** Percent with an explicit sign, for returns where direction matters. */
export const formatReturn = (value: Maybe, digits = 2): string => {
  const n = toNumber(value);
  if (n === null) return 'N/A';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export const formatRatio = (value: Maybe, digits = 2): string => {
  const n = toNumber(value);
  return n === null ? 'N/A' : n.toFixed(digits);
};

/**
 * AUM arrives from Groww in crore. Rendered in the Indian convention so a
 * ₹45,000 Cr fund reads as "₹45,000 Cr" rather than "₹45B".
 */
export const formatCrore = (value: Maybe): string => {
  const n = toNumber(value);
  return n === null ? 'N/A' : `₹${Math.round(n).toLocaleString('en-IN')} Cr`;
};

export const formatCurrency = (value: Maybe): string => {
  const n = toNumber(value);
  return n === null
    ? 'N/A'
    : n.toLocaleString('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      });
};

/** Tailwind class for a return value, by sign and magnitude. */
export const getReturnColor = (value: Maybe): string => {
  const n = toNumber(value);
  if (n === null) return 'text-muted-foreground';
  if (n > 15) return 'text-profit';
  if (n > 8) return 'text-secondary';
  if (n > 0) return 'text-muted-foreground';
  return 'text-loss';
};

/**
 * Min/max that ignore missing values and return null when nothing is usable —
 * `Math.max(...[])` is -Infinity, which renders as "-Infinity%".
 */
export const maxOf = (values: Maybe[]): number | null => {
  const present = values.map(toNumber).filter((v): v is number => v !== null);
  return present.length > 0 ? Math.max(...present) : null;
};

export const minOf = (values: Maybe[]): number | null => {
  const present = values.map(toNumber).filter((v): v is number => v !== null);
  return present.length > 0 ? Math.min(...present) : null;
};

/** Sort key that pushes missing values to the bottom regardless of direction. */
export const sortValue = (value: Maybe, direction: 'asc' | 'desc'): number => {
  const n = toNumber(value);
  if (n !== null) return n;
  return direction === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
};
