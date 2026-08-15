import { describe, expect, it } from 'vitest';
import { buildPortfolio, DEFAULT_DIVERSIFICATION } from '@/utils/investmentBuilder';
import { buildScoringContext, defaultWeights } from '@/utils/scoringEngine';
import { buildHoldingsIndex } from '@/utils/overlap';
import { makeFund } from '@/utils/__fixtures__/fund';
import { MutualFund } from '@/types/mutualFund';

let nextSchemeCode = 1000;

/**
 * A fund with enough history and metrics to clear every gate.
 *
 * Scheme codes are auto-assigned and unique: they are the holdings join key, so
 * a collision would make two funds share a portfolio.
 */
const eligible = (
  id: string,
  overrides: Parameters<typeof makeFund>[0] = {},
  base = 15,
): MutualFund =>
  makeFund({
    id,
    schemeName: `${id} Fund`,
    schemeCode: nextSchemeCode++,
    expenseRatio: 0.8,
    inceptionDate: '2013-01-01',
    minInvestment: 500,
    returns: { sixMonth: base / 2, oneYear: base, threeYear: base, fiveYear: base, tenYear: base },
    ratios: {
      sharpeRatio: base / 15,
      sortinoRatio: base / 12,
      alpha: base / 6,
      informationRatio: base / 20,
    },
    categoryReturns: { cat1y: 12, cat3y: 11, cat5y: 10 },
    rankings: { rank1y: 50 - base, rank3y: 50 - base, rank5y: 50 - base },
    riskMetrics: { risk: 'Moderate' },
    ...overrides,
  });

/**
 * A realistic universe: several sub-categories with more than one fund each.
 *
 * The "more than one" matters. Scoring needs a peer group of at least two to
 * produce a rankable score, so a fixture giving every fund a unique
 * sub-category makes the whole universe unrankable — which is a fixture
 * artefact, not something real data does.
 */
const universe = (): MutualFund[] => {
  const equitySubs = ['Large Cap Fund', 'Mid Cap Fund', 'Small Cap Fund', 'Flexi Cap Fund'];
  const debtSubs = ['Liquid Fund', 'Corporate Bond Fund', 'Gilt Fund', 'Short Duration Fund'];
  const houses = ['AMC A', 'AMC B', 'AMC C'];

  const funds: MutualFund[] = [];

  equitySubs.forEach((sub, s) => {
    houses.forEach((house, h) => {
      funds.push(
        eligible(
          `eq-${s}-${h}`,
          { category: 'Equity', subCategory: sub, fundHouse: house },
          22 - s * 2 - h,
        ),
      );
    });
  });

  debtSubs.forEach((sub, s) => {
    houses.forEach((house, h) => {
      funds.push(
        eligible(
          `dt-${s}-${h}`,
          { category: 'Debt', subCategory: sub, fundHouse: house, riskMetrics: { risk: 'Low' } },
          8 - s * 0.5 - h * 0.2,
        ),
      );
    });
  });

  return funds;
};

/** Two funds in one sub-category, so scoring has a peer to compare against. */
const pairIn = (
  subCategory: string,
  category: MutualFund['category'],
  idPrefix: string,
  base: number,
): MutualFund[] => [
  eligible(`${idPrefix}-a`, { category, subCategory, fundHouse: `${idPrefix} House A` }, base),
  eligible(`${idPrefix}-b`, { category, subCategory, fundHouse: `${idPrefix} House B` }, base - 1),
];

const plan = (funds: MutualFund[], input: Parameters<typeof buildPortfolio>[2]) =>
  buildPortfolio(funds, buildScoringContext(funds, defaultWeights), input);

describe('buildPortfolio — allocation arithmetic', () => {
  it('allocates the full amount with no rupee lost to rounding', () => {
    const funds = universe();
    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 60, debt: 40 },
      fundCount: 6,
    });

    expect(result.allocatedAmount).toBe(100_000);
    expect(result.unallocatedAmount).toBe(0);
    // Per-fund amounts must reconcile to the total too, not just the class sums.
    expect(result.funds.reduce((s, f) => s + f.amount, 0)).toBe(100_000);
  });

  it('reconciles exactly for amounts that do not divide evenly', () => {
    const funds = universe();
    for (const total of [10_000, 33_333, 77_777, 250_000, 1_000_000]) {
      const result = plan(funds, {
        totalAmount: total,
        maxRisk: 'Very High',
        allocation: { equity: 70, debt: 30 },
        fundCount: 5,
        roundTo: 100,
      });
      // Rounding to ₹100 means a remainder below ₹100 can be left over, but the
      // reported allocated + unallocated must always equal the input exactly.
      expect(result.allocatedAmount + result.unallocatedAmount).toBe(total);
      expect(result.unallocatedAmount).toBeGreaterThanOrEqual(0);
      expect(result.unallocatedAmount).toBeLessThan(100 * result.funds.length + 100);
    }
  });

  it('respects the rounding multiple', () => {
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 3,
      roundTo: 500,
    });

    for (const f of result.funds) expect(f.amount % 500).toBe(0);
  });

  it('splits money in proportion to the asset allocation', () => {
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 75, debt: 25 },
      fundCount: 4,
    });

    const equity = result.classes.find((c) => c.assetClass === 'equity')!;
    const debt = result.classes.find((c) => c.assetClass === 'debt')!;

    expect(equity.allocatedAmount).toBeCloseTo(75_000, -3);
    expect(debt.allocatedAmount).toBeCloseTo(25_000, -3);
  });

  it('normalises allocations that do not sum to 100', () => {
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      // 3:1 expressed as 30:10 must behave the same as 75:25.
      allocation: { equity: 30, debt: 10 },
      fundCount: 4,
    });

    const equity = result.classes.find((c) => c.assetClass === 'equity')!;
    expect(equity.targetPercent).toBeCloseTo(75, 6);
  });

  it('percentages sum to 100 across the plan', () => {
    const result = plan(universe(), {
      totalAmount: 500_000,
      maxRisk: 'Very High',
      allocation: { equity: 60, debt: 40 },
      fundCount: 8,
    });

    expect(result.funds.reduce((s, f) => s + f.percent, 0)).toBeCloseTo(100, 4);
  });
});

describe('buildPortfolio — scheme minimums', () => {
  it('drops funds whose share falls below their minimum and redistributes', () => {
    // ₹6,000 across 4 funds is ₹1,500 each, but two funds demand ₹5,000.
    const funds = [
      eligible('eq1', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'A', minInvestment: 500 }, 20),
      eligible('eq2', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'B', minInvestment: 500 }, 18),
      eligible('eq3', { category: 'Equity', subCategory: 'Mid Cap Fund', fundHouse: 'C', minInvestment: 5000 }, 16),
      eligible('eq4', { category: 'Equity', subCategory: 'Mid Cap Fund', fundHouse: 'D', minInvestment: 5000 }, 14),
    ];

    const result = plan(funds, {
      totalAmount: 6_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 4,
    });

    // Nothing placed below its minimum.
    for (const f of result.funds) {
      const min = f.fund.minInvestment ?? 0;
      expect(f.amount).toBeGreaterThanOrEqual(min);
    }
    expect(result.funds.length).toBeLessThan(4);
    expect(result.warnings.some((w) => /below the scheme minimum/i.test(w))).toBe(true);
  });

  it('still reconciles after dropping funds', () => {
    const funds = [
      eligible('eq1', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'A', minInvestment: 100 }, 20),
      eligible('eq2', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'B', minInvestment: 25_000 }, 18),
    ];

    const result = plan(funds, {
      totalAmount: 10_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 2,
    });

    expect(result.allocatedAmount + result.unallocatedAmount).toBe(10_000);
  });

  it('ignores minimums when the feed does not report one', () => {
    const funds = [
      eligible('eq1', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'A', minInvestment: null }, 20),
      eligible('eq2', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'B', minInvestment: null }, 18),
    ];

    const result = plan(funds, {
      totalAmount: 1_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 2,
    });

    expect(result.funds).toHaveLength(2);
  });
});

describe('buildPortfolio — diversification', () => {
  it('avoids stacking one AMC', () => {
    const funds = [
      ...['Large Cap Fund', 'Mid Cap Fund', 'Small Cap Fund', 'Value Fund'].map((sub, i) =>
        eligible(`same${i}`, { category: 'Equity', subCategory: sub, fundHouse: 'Crowded AMC' }, 20 - i),
      ),
      eligible('other1', { category: 'Equity', subCategory: 'Flexi Cap Fund', fundHouse: 'Other AMC' }, 10),
    ];

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 3,
    });

    const crowded = result.funds.filter((f) => f.fund.fundHouse === 'Crowded AMC');
    expect(crowded.length).toBeLessThanOrEqual(DEFAULT_DIVERSIFICATION.maxPerFundHouse);
  });

  it('prefers distinct sub-categories over three of the same', () => {
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 3,
    });

    const subs = result.funds.map((f) => f.fund.subCategory);
    expect(new Set(subs).size).toBe(subs.length);
  });

  it('relaxes rules rather than returning fewer funds, and says so', () => {
    // Only two sub-categories exist, but four funds are requested.
    const funds = ['A', 'B', 'C', 'D'].map((house, i) =>
      eligible(`f${i}`, {
        category: 'Equity',
        subCategory: i < 2 ? 'Large Cap Fund' : 'Mid Cap Fund',
        fundHouse: `AMC ${house}`,
      }, 20 - i),
    );

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 4,
    });

    expect(result.funds).toHaveLength(4);
    expect(result.warnings.some((w) => /sub-category/i.test(w))).toBe(true);
  });
});

describe('buildPortfolio — overlap awareness', () => {
  const twins = () => {
    // Two funds holding the same five stocks at the same weights, plus a
    // genuinely different one.
    const shared = [
      { name: 'HDFC Bank Ltd', id: 'hdfc-bank-ltd', sector: 'Financials', percent: 20 },
      { name: 'ICICI Bank Ltd', id: 'icici-bank-ltd', sector: 'Financials', percent: 20 },
      { name: 'Reliance Industries Ltd', id: 'reliance-industries-ltd', sector: 'Energy', percent: 20 },
      { name: 'Infosys Ltd', id: 'infosys-ltd', sector: 'Technology', percent: 20 },
      { name: 'ITC Ltd', id: 'itc-ltd', sector: 'Consumer Staples', percent: 20 },
    ];
    const distinct = [
      { name: 'Tata Motors Ltd', id: 'tata-motors-ltd', sector: 'Consumer Discretionary', percent: 50 },
      { name: 'Sun Pharma Ltd', id: 'sun-pharma-ltd', sector: 'Healthcare', percent: 50 },
    ];

    const funds = [
      eligible('eq1', { category: 'Equity', subCategory: 'Flexi Cap Fund', fundHouse: 'A', schemeCode: 101 }, 20),
      eligible('eq2', { category: 'Equity', subCategory: 'Flexi Cap Fund', fundHouse: 'B', schemeCode: 102 }, 19),
      eligible('eq3', { category: 'Equity', subCategory: 'Flexi Cap Fund', fundHouse: 'C', schemeCode: 103 }, 18),
    ];

    const holdings = buildHoldingsIndex({
      '101': { schemeCode: 101, portfolioDate: null, holdings: shared },
      '102': { schemeCode: 102, portfolioDate: null, holdings: shared },
      '103': { schemeCode: 103, portfolioDate: null, holdings: distinct },
    });

    return { funds, holdings };
  };

  it('skips a near-duplicate in favour of a genuinely different fund', () => {
    const { funds, holdings } = twins();

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 2,
      holdings,
    });

    const ids = result.funds.map((f) => f.fund.id);
    // eq1 and eq2 are 100% overlapping; the plan must not hold both.
    expect(ids).toContain('eq1');
    expect(ids).toContain('eq3');
    expect(ids).not.toContain('eq2');
  });

  it('reports the worst overlap in the finished plan', () => {
    const { funds, holdings } = twins();

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      // Forcing all three means the duplicate pair has to be accepted.
      fundCount: 3,
      holdings,
    });

    expect(result.worstOverlapPercent).toBe(100);
    expect(result.warnings.some((w) => /overlap by 100%/.test(w))).toBe(true);
  });

  it('works without holdings, reporting overlap as unknown', () => {
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 3,
    });

    expect(result.worstOverlapPercent).toBeNull();
    expect(result.funds.every((f) => f.maxOverlapPercent === null)).toBe(true);
  });
});

describe('buildPortfolio — gates and edge cases', () => {
  it('excludes funds above the risk ceiling', () => {
    const funds = [
      eligible('low', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'A', riskMetrics: { risk: 'Low' } }, 10),
      eligible('low2', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'B', riskMetrics: { risk: 'Low' } }, 9),
      eligible('vhigh', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'C', riskMetrics: { risk: 'Very High' } }, 30),
    ];

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Low',
      allocation: { equity: 100 },
      fundCount: 2,
    });

    expect(result.funds.map((f) => f.fund.id).sort()).toEqual(['low', 'low2']);
  });

  it('excludes funds without the requested track record', () => {
    const funds = [
      eligible('old', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'A' }, 15),
      eligible('old2', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'B' }, 14),
      makeFund({
        id: 'new',
        schemeCode: 9999,
        category: 'Equity',
        subCategory: 'Large Cap Fund',
        inceptionDate: '2026-06-01',
        expenseRatio: 0.1,
      }),
    ];

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 2,
      minTrackRecordYears: 5,
    });

    expect(result.funds.map((f) => f.fund.id).sort()).toEqual(['old', 'old2']);
  });

  it('reports an unfillable asset class instead of silently reallocating', () => {
    // Gold is requested but no gold fund exists.
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 70, gold: 30 },
      fundCount: 4,
    });

    const gold = result.classes.find((c) => c.assetClass === 'gold')!;
    expect(gold.funds).toHaveLength(0);
    expect(gold.shortfallReason).toMatch(/no gold/i);
    expect(result.unallocatedAmount).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /unallocated/i.test(w))).toBe(true);
  });

  it('gives every funded class at least one fund even when its share is small', () => {
    const result = plan(universe(), {
      totalAmount: 1_000_000,
      maxRisk: 'Very High',
      // 2% of 3 funds rounds to zero funds without the floor.
      allocation: { equity: 98, debt: 2 },
      fundCount: 3,
    });

    const debt = result.classes.find((c) => c.assetClass === 'debt')!;
    expect(debt.funds.length).toBeGreaterThanOrEqual(1);
  });

  it('returns a clear result when nothing passes', () => {
    const result = plan([], {
      totalAmount: 100_000,
      maxRisk: 'Low',
      allocation: { equity: 100 },
      fundCount: 3,
    });

    expect(result.funds).toHaveLength(0);
    expect(result.unallocatedAmount).toBe(100_000);
    expect(result.warnings[0]).toMatch(/no fund passed the filters/i);
  });

  it('rejects an empty allocation', () => {
    const result = plan(universe(), {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: {},
      fundCount: 3,
    });

    expect(result.warnings[0]).toMatch(/no asset allocation/i);
  });

  it('warns about lock-in rather than hiding it', () => {
    const funds = [
      eligible('elss', { category: 'Equity', subCategory: 'ELSS', fundHouse: 'A', lockInMonths: 36 }, 18),
      eligible('elss2', { category: 'Equity', subCategory: 'ELSS', fundHouse: 'B', lockInMonths: 36 }, 16),
    ];

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 2,
    });

    expect(result.warnings.some((w) => /lock-in/i.test(w))).toBe(true);
  });
});

describe('buildPortfolio — reporting', () => {
  it('computes the money-weighted expense ratio', () => {
    const funds = [
      eligible('cheap', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'A', expenseRatio: 0.2 }, 20),
      eligible('dear', { category: 'Equity', subCategory: 'Large Cap Fund', fundHouse: 'B', expenseRatio: 1.8 }, 18),
    ];

    const result = plan(funds, {
      totalAmount: 100_000,
      maxRisk: 'Very High',
      allocation: { equity: 100 },
      fundCount: 2,
      weighting: 'equal',
    });

    // Equal rupees in each, so the blend is the simple average.
    expect(result.weightedExpenseRatio).toBeCloseTo(1.0, 2);
  });

  it('score-weighting gives the better fund more money than equal-weighting', () => {
    const funds = universe();
    const config = {
      totalAmount: 100_000,
      maxRisk: 'Very High' as const,
      allocation: { equity: 100 },
      fundCount: 3,
    };

    const equal = plan(funds, { ...config, weighting: 'equal' });
    const scored = plan(funds, { ...config, weighting: 'score' });

    const topEqual = equal.funds[0].amount;
    const topScored = scored.funds.find((f) => f.fund.id === equal.funds[0].fund.id)!.amount;

    expect(topScored).toBeGreaterThan(topEqual);
  });
});

describe('buildPortfolio — pinned and excluded funds', () => {
  const base = {
    totalAmount: 1_000_000,
    maxRisk: 'Moderate' as const,
    allocation: { equity: 60, debt: 40 },
    fundCount: 6,
    minTrackRecordYears: 3,
  };

  it('never selects an excluded fund', () => {
    const funds = universe();
    const first = plan(funds, base).funds[0].fund.id;

    const after = plan(funds, { ...base, excludedIds: [first] });
    expect(after.funds.map((f) => f.fund.id)).not.toContain(first);
  });

  it('backfills the freed slot from the same asset class', () => {
    // The point of re-solving rather than sliding in the next fund overall:
    // removing an equity fund must be replaced by an equity fund, or the target
    // split silently breaks.
    const funds = universe();
    const before = plan(funds, base);
    const victim = before.funds.find((f) => f.assetClass === 'equity')!;

    const after = plan(funds, { ...base, excludedIds: [victim.fund.id] });

    expect(after.funds).toHaveLength(before.funds.length);
    expect(after.funds.filter((f) => f.assetClass === 'equity')).toHaveLength(
      before.funds.filter((f) => f.assetClass === 'equity').length,
    );
    expect(after.allocatedAmount).toBe(before.allocatedAmount);
  });

  it('leaves higher-ranked picks undisturbed when a later one is excluded', () => {
    // Selection is a greedy walk over a stable ranking, so excluding a fund can
    // only affect picks at or after its position.
    const funds = universe();
    const before = plan(funds, base);
    const equity = before.funds.filter((f) => f.assetClass === 'equity');
    const last = equity[equity.length - 1];

    const after = plan(funds, { ...base, excludedIds: [last.fund.id] });
    const survivors = after.funds.filter((f) => f.assetClass === 'equity').map((f) => f.fund.id);

    for (const kept of equity.slice(0, -1)) {
      expect(survivors).toContain(kept.fund.id);
    }
  });

  it('includes a pinned fund', () => {
    const funds = universe();
    const pin = funds.find((f) => f.id === 'eq-3-2')!;

    const result = plan(funds, { ...base, pinnedFunds: [pin] });
    expect(result.funds.map((f) => f.fund.id)).toContain(pin.id);
  });

  it('counts pins against the requested fund count', () => {
    const funds = universe();
    const pin = funds.find((f) => f.id === 'eq-3-2')!;

    const withPin = plan(funds, { ...base, pinnedFunds: [pin] });
    expect(withPin.funds).toHaveLength(plan(funds, base).funds.length);
  });

  it('keeps a pin that is not in the candidate list at all', () => {
    // The realistic case: a fund the user already holds, screened out by their
    // own rules, so it never reaches buildPortfolio as a candidate.
    const funds = universe();
    const held = eligible('held-elsewhere', {
      category: 'Equity',
      subCategory: 'Large Cap Fund',
      fundHouse: 'Outside AMC',
    });

    const result = plan(funds, { ...base, pinnedFunds: [held] });
    expect(result.funds.map((f) => f.fund.id)).toContain('held-elsewhere');
  });

  it('keeps a pin that fails the risk ceiling, and says so', () => {
    const funds = universe();
    const risky = eligible('risky-pin', {
      category: 'Equity',
      subCategory: 'Small Cap Fund',
      riskMetrics: { risk: 'Very High' },
    });

    const result = plan(funds, { ...base, pinnedFunds: [risky] });

    expect(result.funds.map((f) => f.fund.id)).toContain('risky-pin');
    expect(result.warnings.some((w) => /risky-pin/.test(w) && /risk is Very High/.test(w))).toBe(
      true,
    );
  });

  it('keeps a pin with too little history, and says so', () => {
    const funds = universe();
    const young = makeFund({
      id: 'young-pin',
      schemeName: 'young-pin Fund',
      schemeCode: 99_001,
      category: 'Equity',
      subCategory: 'Flexi Cap Fund',
      inceptionDate: '2026-01-01',
      minInvestment: 500,
      expenseRatio: 0.5,
      riskMetrics: { risk: 'Moderate' },
    });

    const result = plan(funds, { ...base, pinnedFunds: [young] });

    expect(result.funds.map((f) => f.fund.id)).toContain('young-pin');
    expect(result.warnings.some((w) => /young-pin/.test(w) && /history/.test(w))).toBe(true);
  });

  it('lets an exclusion override a pin', () => {
    // Both set means the user pinned it and then removed it; the later intent wins.
    const funds = universe();
    const pin = funds.find((f) => f.id === 'eq-3-2')!;

    const result = plan(funds, { ...base, pinnedFunds: [pin], excludedIds: [pin.id] });
    expect(result.funds.map((f) => f.fund.id)).not.toContain(pin.id);
  });

  it('honours pins beyond the class allotment and warns', () => {
    const funds = universe();
    // Four equity pins against a plan that only wants two equity funds.
    const pins = ['eq-0-0', 'eq-1-1', 'eq-2-2', 'eq-3-0'].map(
      (id) => funds.find((f) => f.id === id)!,
    );

    const result = plan(funds, {
      ...base,
      fundCount: 3,
      allocation: { equity: 60, debt: 40 },
      pinnedFunds: pins,
    });

    for (const pin of pins) {
      expect(result.funds.map((f) => f.fund.id)).toContain(pin.id);
    }
    expect(result.warnings.some((w) => /pinned fund/.test(w) && /allotted/.test(w))).toBe(true);
  });

  it('keeps a pin below its scheme minimum rather than dropping it', () => {
    // Auto-selected funds get dropped when their share is too small. A pin must
    // not be: the user asked for it, and a visible unexecutable share tells them
    // what to change.
    const funds = universe();
    const expensive = eligible('high-minimum', {
      category: 'Equity',
      subCategory: 'Large Cap Fund',
      fundHouse: 'Outside AMC',
      minInvestment: 5_000_000,
    });

    const result = plan(funds, {
      ...base,
      totalAmount: 100_000,
      pinnedFunds: [expensive],
    });

    expect(result.funds.map((f) => f.fund.id)).toContain('high-minimum');
    expect(
      result.warnings.some((w) => /high-minimum/.test(w) && /minimum/.test(w)),
    ).toBe(true);
  });

  it('builds a plan from pins alone when nothing passes the filters', () => {
    const pin = eligible('only-pin', { category: 'Equity', subCategory: 'Large Cap Fund' });

    const result = plan([], {
      ...base,
      allocation: { equity: 100 },
      pinnedFunds: [pin],
    });

    expect(result.funds.map((f) => f.fund.id)).toEqual(['only-pin']);
    expect(result.allocatedAmount).toBeGreaterThan(0);
  });

  it('counts a pin against the per-AMC cap', () => {
    // Otherwise auto-selection piles more of the same house on top of the user's
    // own choice, quietly concentrating the plan.
    const funds = universe();
    const pin = funds.find((f) => f.id === 'eq-0-0')!;

    // The fixture universe has three AMCs and the house cap is global across
    // classes, so a cap of 1 supports at most three funds. Asking for more would
    // force the relaxation stages and test nothing about the cap.
    const result = plan(funds, {
      ...base,
      fundCount: 3,
      allocation: { equity: 67, debt: 33 },
      pinnedFunds: [pin],
      diversification: { ...DEFAULT_DIVERSIFICATION, maxPerFundHouse: 1 },
    });

    expect(result.warnings.some((w) => /per AMC/.test(w))).toBe(false);

    const fromSameHouse = result.funds.filter((f) => f.fund.fundHouse === pin.fundHouse);
    expect(fromSameHouse).toHaveLength(1);
    expect(fromSameHouse[0].fund.id).toBe(pin.id);
  });
});
