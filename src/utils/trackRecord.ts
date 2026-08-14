import { MutualFund } from '@/types/mutualFund';
import { toNumber } from '@/utils/number';

/**
 * How much history a fund actually has
 * ====================================
 *
 * "Is this fund old enough to judge?" needs a trustworthy answer, and neither
 * available source gives one on its own.
 *
 * **Groww's `launch_date` is not inception.** Measured across 1,659 live
 * schemes it holds only 20 distinct values, all inside the last 13 months, and
 * funds with a populated 10-year return are stamped with today's date. It is a
 * data-ingestion timestamp on their side. It is deliberately not ingested.
 *
 * **A first-NAV date is a floor, not the truth.** AMFI-derived inception dates
 * (via the tigzig snapshot) are real, but they are per *plan*: direct plans only
 * began in January 2013, so a scheme running since 2005 shows a 2013 first NAV.
 * Using it alone would call a twenty-year-old fund twelve years old.
 *
 * **Return horizons are the most honest signal.** A populated 10Y return means
 * the scheme has ten years of history, whatever any date field says. It also
 * measures the thing that actually matters here — how much history is available
 * to judge — rather than mere calendar age.
 *
 * So the effective track record is the *maximum* of the two: the longest return
 * horizon present, and the age implied by the inception date.
 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Longest return horizon the fund has data for, in years. Zero when even the
 * 1-year figure is missing.
 *
 * 6M is excluded on purpose: it is an absolute period return rather than an
 * annualised one, and a fund with only a 6M number has no judgeable record.
 */
export const longestReturnHorizonYears = (fund: MutualFund): number => {
  const has = (value: unknown) => toNumber(value as never) !== null;

  if (has(fund.returns?.tenYear)) return 10;
  if (has(fund.returns?.fiveYear)) return 5;
  if (has(fund.returns?.threeYear)) return 3;
  if (has(fund.returns?.oneYear)) return 1;
  return 0;
};

/** Calendar age from the inception date, or null when we do not have one. */
export const inceptionAgeYears = (fund: MutualFund, now: Date = new Date()): number | null => {
  if (!fund.inceptionDate) return null;

  const inception = new Date(fund.inceptionDate);
  if (Number.isNaN(inception.getTime())) return null;

  const years = (now.getTime() - inception.getTime()) / MS_PER_YEAR;
  return years >= 0 ? years : null;
};

export interface TrackRecord {
  /** Years of history we can actually judge the fund on. */
  years: number;
  /** Where the figure came from, for honest display. */
  basis: 'returns' | 'inception' | 'both' | 'none';
  /** Calendar age, when known. May be lower than `years` for direct plans. */
  inceptionAgeYears: number | null;
  /** True when there is not enough history to rank the fund meaningfully. */
  isNew: boolean;
}

/** Below this, a fund has no meaningful record to judge. */
export const MIN_TRACK_RECORD_YEARS = 1;

export const trackRecordOf = (fund: MutualFund, now: Date = new Date()): TrackRecord => {
  const fromReturns = longestReturnHorizonYears(fund);
  const fromInception = inceptionAgeYears(fund, now);

  const years = Math.max(fromReturns, fromInception ?? 0);

  const basis: TrackRecord['basis'] =
    fromReturns > 0 && fromInception != null
      ? 'both'
      : fromReturns > 0
        ? 'returns'
        : fromInception != null
          ? 'inception'
          : 'none';

  return {
    years,
    basis,
    inceptionAgeYears: fromInception,
    isNew: years < MIN_TRACK_RECORD_YEARS,
  };
};

/** Does the fund clear a minimum-history bar? */
export const hasTrackRecord = (
  fund: MutualFund,
  minYears: number,
  now: Date = new Date(),
): boolean => trackRecordOf(fund, now).years >= minYears;

export const describeTrackRecord = (record: TrackRecord): string => {
  if (record.basis === 'none') return 'No usable history';
  if (record.years < 1) return 'Under 1 year';

  const rounded = record.years >= 10 ? Math.floor(record.years) : Math.round(record.years * 10) / 10;
  const label = `${rounded}${record.years >= 10 ? '+' : ''} year${rounded === 1 ? '' : 's'}`;

  // Flag the direct-plan floor rather than presenting it as the whole story.
  if (
    record.basis === 'both' &&
    record.inceptionAgeYears != null &&
    record.years - record.inceptionAgeYears > 1
  ) {
    return `${label} of returns (direct plan since ${record.inceptionAgeYears.toFixed(1)}y ago)`;
  }

  return label;
};

/**
 * Preset bars for the explorer filter. Chosen around what a horizon can actually
 * tell you rather than round numbers for their own sake.
 */
export const TRACK_RECORD_PRESETS = [
  { years: 0, label: 'Any' },
  { years: 1, label: '1y+' },
  { years: 3, label: '3y+ (survived a drawdown)' },
  { years: 5, label: '5y+ (a full cycle)' },
  { years: 10, label: '10y+ (multiple cycles)' },
] as const;
