import { describe, expect, it } from 'vitest';
import {
  exportToCSV,
  mapCategoryToStandard,
  mapRiskRatingToLevel,
  normalizeFundNumerics,
  processSchemeData,
} from '@/services/dataProcessor';
import { GrowwScheme } from '@/types/api';
import { makeFund } from '@/utils/__fixtures__/fund';

const scheme = (overrides: Partial<GrowwScheme> = {}): GrowwScheme =>
  ({
    id: 'scheme-1',
    scheme_name: 'Test Scheme Direct Growth',
    fund_name: 'Test Scheme',
    fund_house: 'Test AMC',
    category: 'Equity',
    sub_category: 'Large Cap Fund',
    scheme_code: '12345',
    ...overrides,
  }) as GrowwScheme;

describe('mapRiskRatingToLevel', () => {
  it('maps the rating bands to riskometer labels', () => {
    expect(mapRiskRatingToLevel(1)).toBe('Low');
    expect(mapRiskRatingToLevel(2)).toBe('Low');
    expect(mapRiskRatingToLevel(3)).toBe('Moderate');
    expect(mapRiskRatingToLevel(4)).toBe('Moderate');
    expect(mapRiskRatingToLevel(5)).toBe('High');
    expect(mapRiskRatingToLevel(6)).toBe('High');
    expect(mapRiskRatingToLevel(7)).toBe('Very High');
  });
});

describe('mapCategoryToStandard', () => {
  it('is case-insensitive', () => {
    expect(mapCategoryToStandard('EQUITY')).toBe('Equity');
    expect(mapCategoryToStandard('debt')).toBe('Debt');
    expect(mapCategoryToStandard('Hybrid')).toBe('Hybrid');
  });

  it('falls back to Others for unrecognised or missing input', () => {
    expect(mapCategoryToStandard('Solution Oriented')).toBe('Others');
    expect(mapCategoryToStandard('')).toBe('Others');
  });
});

describe('processSchemeData', () => {
  it('converts the scheme code to a number', () => {
    // Groww returns it as a string; downstream code indexes on a number.
    expect(processSchemeData(scheme({ scheme_code: '12345' })).schemeCode).toBe(12345);
  });

  it('leaves absent metrics null rather than defaulting them to zero', () => {
    // A zero return is a real, bad result. An absent one is unknown. Conflating
    // them would put young funds at the bottom of every ranking.
    const fund = processSchemeData(scheme());

    expect(fund.returns.fiveYear).toBeNull();
    expect(fund.ratios.sharpeRatio).toBeNull();
    expect(fund.expenseRatio).toBeNull();
  });

  it('derives the risk label from the rating when none is supplied', () => {
    const fund = processSchemeData(scheme({ risk_rating: 7 } as Partial<GrowwScheme>));
    expect(fund.riskMetrics.risk).toBe('Very High');
  });

  it('keeps searchId undefined rather than null so it matches the declared type', () => {
    const fund = processSchemeData(scheme({ search_id: undefined }));
    expect(fund.searchId).toBeUndefined();
  });

  it('stamps lastUpdated', () => {
    expect(processSchemeData(scheme()).lastUpdated).toBeInstanceOf(Date);
  });
});

describe('normalizeFundNumerics', () => {
  // The reason the formatters were crashing: expense_ratio arrives as a string,
  // so nothing downstream could trust the declared `number` type. Coercing once
  // on ingest and once on read means the rest of the app can.
  it('coerces numeric strings to numbers', () => {
    const fund = normalizeFundNumerics(
      makeFund({
        expenseRatio: '0.52' as unknown as number,
        aum: '45000' as unknown as number,
        returns: { oneYear: '12.5' as unknown as number },
        ratios: { sharpeRatio: '1.2' as unknown as number },
      }),
    );

    expect(fund.expenseRatio).toBe(0.52);
    expect(fund.aum).toBe(45000);
    expect(fund.returns.oneYear).toBe(12.5);
    expect(fund.ratios.sharpeRatio).toBe(1.2);
  });

  it('turns unusable values into null rather than keeping them', () => {
    const fund = normalizeFundNumerics(
      makeFund({
        expenseRatio: 'NA' as unknown as number,
        returns: { oneYear: '' as unknown as number, threeYear: Number.NaN },
      }),
    );

    expect(fund.expenseRatio).toBeNull();
    expect(fund.returns.oneYear).toBeNull();
    expect(fund.returns.threeYear).toBeNull();
  });

  it('leaves already-numeric values untouched', () => {
    const fund = normalizeFundNumerics(
      makeFund({ expenseRatio: 0.75, returns: { oneYear: 0 } }),
    );

    expect(fund.expenseRatio).toBe(0.75);
    // Zero must survive — it is a real return, not a missing one.
    expect(fund.returns.oneYear).toBe(0);
  });

  it('preserves non-numeric fields', () => {
    const fund = normalizeFundNumerics(
      makeFund({
        schemeName: 'Test Scheme',
        ratings: { crisilRating: '4 Star' },
        riskMetrics: { risk: 'Very High', riskRating: '7' as unknown as number },
      }),
    );

    expect(fund.schemeName).toBe('Test Scheme');
    expect(fund.ratings.crisilRating).toBe('4 Star');
    expect(fund.riskMetrics.risk).toBe('Very High');
    expect(fund.riskMetrics.riskRating).toBe(7);
  });
});

describe('exportToCSV', () => {
  it('returns an empty string for no funds', () => {
    expect(exportToCSV([])).toBe('');
  });

  it('emits a header row plus one row per fund', () => {
    const rows = exportToCSV([makeFund({ id: 'a' }), makeFund({ id: 'b' })]).split('\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Scheme Name');
  });

  it('renders missing optional fields as empty cells instead of crashing', () => {
    // aum, riskRating and lastUpdated are all optional, and the previous
    // implementation called .toString()/.toISOString() on them unconditionally.
    const bare = makeFund({ id: 'bare' });

    expect(() => exportToCSV([bare])).not.toThrow();
    expect(exportToCSV([bare]).split('\n')[1]).toContain('""');
  });

  it('quotes every cell so commas in scheme names cannot shift columns', () => {
    const fund = makeFund({ schemeName: 'Test Fund, Direct, Growth' });
    const dataRow = exportToCSV([fund]).split('\n')[1];

    expect(dataRow).toContain('"Test Fund, Direct, Growth"');
    // Header count and data count must still agree.
    const headerCells = exportToCSV([fund]).split('\n')[0].split('","').length;
    expect(dataRow.split('","').length).toBe(headerCells);
  });
});
