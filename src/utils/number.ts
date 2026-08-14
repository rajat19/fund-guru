/**
 * Numeric coercion shared by the formatters, the scoring engine, and the data
 * ingest layer.
 *
 * This exists because the upstream feed is not type-honest: fields declared as
 * `number` arrive as numeric strings (`"0.52"`), as empty strings, and
 * occasionally as `"NA"`. Any of those reaching arithmetic or `.toFixed()`
 * produces either a crash or a silently wrong comparison.
 */

export type NumericLike = number | string | null | undefined;

/**
 * Coerce to a finite number, or null.
 *
 * `Number.isNaN` is the trap this replaces: it does not coerce, so
 * `Number.isNaN('0.5')` is false. A guard of `value != null &&
 * !Number.isNaN(value)` therefore lets strings through, which then either throw
 * on `.toFixed()` or compare lexically instead of numerically.
 *
 * Infinity is treated as missing too — it is never a real metric value, and
 * letting it through puts a fund at the top of every percentile.
 */
export const toNumber = (value: NumericLike): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

/** True when the value coerces to a usable finite number. */
export const isNumeric = (value: NumericLike): boolean => toNumber(value) !== null;
