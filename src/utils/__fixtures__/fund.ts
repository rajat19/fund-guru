import { MutualFund } from '@/types/mutualFund';

/**
 * Builds a MutualFund with every optional field absent by default, so a test
 * only states the fields it actually cares about. This matters here: most of
 * the interesting behaviour in the scoring and tax code is about how missing
 * data is handled, and a fixture that quietly fills everything in would hide
 * exactly the bugs worth catching.
 */
export const makeFund = (overrides: DeepPartial<MutualFund> = {}): MutualFund => ({
  id: overrides.id ?? 'fund-1',
  schemeName: overrides.schemeName ?? 'Test Scheme Direct Growth',
  fundName: overrides.fundName ?? 'Test Scheme',
  fundHouse: overrides.fundHouse ?? 'Test AMC',
  category: overrides.category ?? 'Equity',
  subCategory: overrides.subCategory ?? 'Large Cap Fund',
  schemeCode: overrides.schemeCode ?? 1,
  aum: overrides.aum,
  expenseRatio: overrides.expenseRatio ?? null,
  logoUrl: null,
  searchId: overrides.searchId,
  planType: overrides.planType ?? 'Direct',
  schemeType: overrides.schemeType ?? 'Growth',
  // Defaults to null (no load) so tests that care must opt in explicitly.
  exitLoad: overrides.exitLoad ?? null,
  inceptionDate: overrides.inceptionDate ?? null,
  returns: { ...overrides.returns },
  ratios: { ...overrides.ratios },
  portfolioMetrics: { ...overrides.portfolioMetrics },
  rankings: { ...overrides.rankings },
  categoryReturns: { ...overrides.categoryReturns },
  indexReturns: { ...overrides.indexReturns },
  riskMetrics: { ...overrides.riskMetrics },
  ratings: { ...overrides.ratings },
  sectors: { ...overrides.sectors },
  lastUpdated: overrides.lastUpdated,
});

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
