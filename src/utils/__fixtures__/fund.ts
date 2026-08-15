import { MutualFund } from '@/types/mutualFund';

/**
 * Partial one level deep for the nested metric groups, but leaving leaf values
 * (including Date) alone — `Partial<Date>` is not a Date.
 */
type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends Date
    ? T[K]
    : NonNullable<T[K]> extends object
      ? Partial<NonNullable<T[K]>>
      : T[K];
};

/** The nested metric groups, which merge rather than replace wholesale. */
const GROUPS = [
  'returns',
  'ratios',
  'portfolioMetrics',
  'rankings',
  'categoryReturns',
  'indexReturns',
  'riskMetrics',
  'ratings',
  'sectors',
] as const;

/**
 * Builds a MutualFund with every optional field absent by default, so a test
 * only states the fields it actually cares about. This matters here: most of
 * the interesting behaviour in the scoring and tax code is about how missing
 * data is handled, and a fixture that quietly filled everything in would hide
 * exactly the bugs worth catching.
 *
 * Scalar overrides are applied by spreading rather than by enumerating each
 * field. An earlier version listed them one by one, which meant every new field
 * on MutualFund was silently dropped by the fixture until someone noticed a test
 * failing for the wrong reason — that happened three times (exitLoad,
 * inceptionDate, minInvestment). Spreading makes new fields work automatically.
 */
export const makeFund = (overrides: DeepPartial<MutualFund> = {}): MutualFund => {
  const base: MutualFund = {
    id: 'fund-1',
    schemeName: 'Test Scheme Direct Growth',
    fundName: 'Test Scheme',
    fundHouse: 'Test AMC',
    category: 'Equity',
    subCategory: 'Large Cap Fund',
    schemeCode: 1,
    expenseRatio: null,
    logoUrl: null,
    planType: 'Direct',
    schemeType: 'Growth',
    // Explicitly null rather than undefined so a test that cares must opt in.
    exitLoad: null,
    inceptionDate: null,
    returns: {},
    ratios: {},
    portfolioMetrics: {},
    rankings: {},
    categoryReturns: {},
    indexReturns: {},
    riskMetrics: {},
    ratings: {},
    sectors: {},
  };

  const merged = { ...base, ...(overrides as Partial<MutualFund>) } as MutualFund;

  // Nested groups merge onto the empty defaults instead of being replaced, so a
  // test can set one return without wiping the others.
  for (const group of GROUPS) {
    merged[group] = {
      ...(base[group] as object),
      ...((overrides[group] ?? {}) as object),
    } as never;
  }

  return merged;
};

/**
 * A peer group where a single metric varies linearly, for percentile assertions.
 */
export const makePeerGroup = (
  values: Array<number | null>,
  assign: (fund: MutualFund, value: number | null) => void,
  subCategory = 'Large Cap Fund',
): MutualFund[] =>
  values.map((value, index) => {
    const fund = makeFund({ id: `fund-${index}`, subCategory });
    assign(fund, value);
    return fund;
  });
