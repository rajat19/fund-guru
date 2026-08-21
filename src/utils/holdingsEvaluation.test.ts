import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_OVERLAP_PERCENT,
  evaluatePortfolio,
  holdingDaysSince,
  holdingMonthsSince,
  OVERWEIGHT_FUND_PERCENT,
  QUICK_BREAK_EVEN_YEARS,
  switchCostOf,
  WEAK_STANDING,
} from '@/utils/holdingsEvaluation';
import { buildScoringContext } from '@/utils/scoringEngine';
import { buildHoldingsIndex } from '@/utils/overlap';
import { makeFund } from '@/utils/__fixtures__/fund';
import type { MutualFund } from '@/types/mutualFund';
import type { MfHolding, SipHolding } from '@/types/userHoldings';
import type { Holding } from '@/types/holdings';

const NOW = new Date('2026-08-16T00:00:00Z');

/**
 * A peer group where returns rise with the index, so peer standing is
 * predictable: fund 0 is the worst in its sub-category and fund 19 the best.
 * Every fund carries a full metric set so `hasSufficientData` holds.
 */
const makePeer = (rank: number, overrides: Partial<MutualFund> = {}): MutualFund =>
  makeFund({
    id: `peer-${rank}`,
    schemeCode: 1000 + rank,
    schemeName: `Peer ${rank} Fund Direct Growth`,
    fundHouse: `AMC ${rank % 4}`,
    subCategory: 'Flexi Cap Fund',
    category: 'Equity',
    expenseRatio: 0.5,
    inceptionDate: '2010-01-01',
    returns: {
      sixMonth: rank,
      oneYear: rank,
      threeYear: rank,
      fiveYear: rank,
      tenYear: rank,
    },
    ratios: { sharpeRatio: rank / 10, sortinoRatio: rank / 10, alpha: rank, informationRatio: rank / 10 },
    categoryReturns: { cat1y: 10, cat3y: 10, cat5y: 10 },
    rankings: { rank1y: 20 - rank, rank3y: 20 - rank, rank5y: 20 - rank },
    riskMetrics: { risk: 'Very High' },
    portfolioMetrics: { equityPercentage: 98 },
    ...overrides,
  });

const universe: MutualFund[] = Array.from({ length: 20 }, (_, index) => makePeer(index));
const context = buildScoringContext(universe);

/**
 * A peer group whose *rank order* is identical to `universe` but whose return
 * spread is realistic — 10.0% to 11.9% rather than 0% to 19%.
 *
 * This matters for the break-even arithmetic. Peer standing is a percentile, so
 * it spreads across the full 0-100 either way; the return *gap* is what decides
 * how quickly a switch cost is recovered. A 19-point gap pays back almost any tax
 * bill in a year, which no real pair of funds in one sub-category would.
 */
const makeTightPeer = (rank: number, overrides: Partial<MutualFund> = {}): MutualFund =>
  makePeer(rank, {
    id: `tight-${rank}`,
    schemeCode: 5000 + rank,
    schemeName: `Tight Peer ${rank} Fund Direct Growth`,
    returns: {
      sixMonth: 10 + rank / 10,
      oneYear: 10 + rank / 10,
      threeYear: 10 + rank / 10,
      fiveYear: 10 + rank / 10,
      tenYear: 10 + rank / 10,
    },
    ...overrides,
  });

const tightUniverse: MutualFund[] = Array.from({ length: 20 }, (_, index) => makeTightPeer(index));
const tightContext = buildScoringContext(tightUniverse);

const holding = (overrides: Partial<MfHolding> = {}): MfHolding => ({
  id: 'mf-1',
  fundId: 'peer-19',
  schemeCode: 1019,
  sourceName: 'Peer 19 Fund Direct Growth',
  matchConfidence: 1,
  looksRegularPlan: false,
  sourceFile: 'holdings.csv',
  units: 100,
  investedAmount: 100_000,
  currentValue: 150_000,
  purchaseDate: '2020-01-01',
  folio: null,
  ...overrides,
});

const sip = (overrides: Partial<SipHolding> = {}): SipHolding => ({
  id: 'sip-1',
  fundId: 'peer-19',
  schemeCode: 1019,
  sourceName: 'Peer 19 Fund Direct Growth',
  matchConfidence: 1,
  looksRegularPlan: false,
  sourceFile: 'sips.csv',
  amount: 10_000,
  frequency: 'monthly',
  startDate: '2022-01-01',
  active: true,
  ...overrides,
});

const evaluate = (
  mf: MfHolding[],
  sips: SipHolding[] = [],
  extra: Partial<Parameters<typeof evaluatePortfolio>[0]> = {},
) => evaluatePortfolio({ mf, sips, universe, context, now: NOW, ...extra });

describe('holdingMonthsSince', () => {
  it('counts whole months and rejects unusable dates', () => {
    expect(holdingMonthsSince('2025-08-16', NOW)).toBe(12);
    expect(holdingMonthsSince(null, NOW)).toBeNull();
    expect(holdingMonthsSince('not a date', NOW)).toBeNull();
    // A purchase date in the future is a misread field, not a holding.
    expect(holdingMonthsSince('2030-01-01', NOW)).toBeNull();
  });
});

describe('holdingDaysSince', () => {
  it('counts exact days', () => {
    expect(holdingDaysSince('2026-08-01', NOW)).toBe(15);
    expect(holdingDaysSince('2026-08-16', NOW)).toBe(0);
    expect(holdingDaysSince(null, NOW)).toBeNull();
    expect(holdingDaysSince('2030-01-01', NOW)).toBeNull();
  });
});

describe('switchCostOf — exit load windows measured in days', () => {
  /*
   * 408 of the 882 live schemes charging a load use a window under a month —
   * 7, 15 and 30 days dominate. Evaluating those in whole months rounds a
   * 20-day holding down to zero and charges it a load it has already escaped,
   * so the exact day count has to reach the exit load parser.
   */
  const fifteenDay = makePeer(10, { exitLoad: 'Exit load of 1%, if redeemed within 15 days.' });

  it('charges inside a 15-day window', () => {
    const cost = switchCostOf(fifteenDay, {
      invested: 100_000,
      currentValue: 110_000,
      holdingMonths: 0,
      holdingDays: 10,
    });
    expect(cost?.exitLoadAmount).toBeCloseTo(1_100, 0);
  });

  it('does not charge a 20-day holding that has escaped a 15-day window', () => {
    const cost = switchCostOf(fifteenDay, {
      invested: 100_000,
      currentValue: 110_000,
      // Both are correct for the same holding: zero completed calendar months,
      // twenty days elapsed. Only the day count can answer this.
      holdingMonths: 0,
      holdingDays: 20,
    });
    expect(cost?.exitLoadAmount).toBe(0);
  });

  it('falls back to months when no day count is supplied, and is lossy', () => {
    // Documents the degradation rather than pretending it does not exist: with
    // months only, a 20-day holding is indistinguishable from a same-day one.
    const cost = switchCostOf(fifteenDay, {
      invested: 100_000,
      currentValue: 110_000,
      holdingMonths: 0,
    });
    expect(cost?.exitLoadAmount).toBeCloseTo(1_100, 0);
  });

  it('applies the free-units allowance rather than the headline rate', () => {
    // The form a third of schemes use. Charging the full rate on the whole
    // redemption overstates the cost by up to 10x.
    const freeLimit = makePeer(10, {
      exitLoad:
        'Exit Load for units in excess of 12% of the investment, 1% will be charged for redemption within 90 days.',
    });

    const cost = switchCostOf(freeLimit, {
      invested: 100_000,
      currentValue: 110_000,
      holdingMonths: 1,
      holdingDays: 40,
    });

    // 110,000 x 88% chargeable x 1%, not 110,000 x 1%.
    expect(cost?.exitLoadAmount).toBeCloseTo(968, 0);
  });

  it('reports an unparsed load as uncertain instead of assuming none', () => {
    const typo = makePeer(10, { exitLoad: 'Exit load of 1% if redeemed wtihin 1 year.' });
    const cost = switchCostOf(typo, {
      invested: 100_000,
      currentValue: 110_000,
      holdingMonths: 2,
      holdingDays: 60,
    });

    expect(cost?.exitLoad.uncertain).toBe(true);
    expect(cost?.exitLoadAmount).toBe(0);
    expect(cost?.notes.join(' ')).toMatch(/could not be read/i);
  });
});

describe('switchCostOf', () => {
  const equity = makePeer(10, { exitLoad: 'Exit load of 1%, if redeemed within 365 days.' });

  it('charges exit load inside the window and nothing outside it', () => {
    const inside = switchCostOf(equity, {
      invested: 100_000,
      currentValue: 110_000,
      holdingMonths: 6,
    });
    expect(inside?.exitLoadAmount).toBeCloseTo(1_100, 0);

    const outside = switchCostOf(equity, {
      invested: 100_000,
      currentValue: 110_000,
      holdingMonths: 24,
    });
    expect(outside?.exitLoadAmount).toBe(0);
  });

  it('applies short-term equity tax before the one-year mark', () => {
    const cost = switchCostOf(equity, {
      invested: 100_000,
      currentValue: 150_000,
      holdingMonths: 6,
    });
    // 20% STCG on a ₹50,000 gain.
    expect(cost?.isLongTerm).toBe(false);
    expect(cost?.taxAmount).toBeCloseTo(10_000, 0);
  });

  it('uses the long-term rate and the annual exemption after a year', () => {
    const cost = switchCostOf(equity, {
      invested: 100_000,
      currentValue: 150_000,
      holdingMonths: 24,
    });
    // The ₹50,000 gain sits entirely inside the ₹1.25L exemption.
    expect(cost?.isLongTerm).toBe(true);
    expect(cost?.taxAmount).toBe(0);
    expect(cost?.percentOfValue).toBe(0);
  });

  it('quantifies what waiting for long-term treatment saves', () => {
    const cost = switchCostOf(equity, {
      invested: 100_000,
      currentValue: 150_000,
      holdingMonths: 9,
    });
    expect(cost?.monthsToLongTerm).toBe(3);
    // ₹10,000 of short-term tax against nothing once the exemption applies.
    expect(cost?.savingByWaiting).toBeCloseTo(10_000, 0);
  });

  it('charges no tax on a position at a loss, and says so', () => {
    const cost = switchCostOf(equity, {
      invested: 100_000,
      currentValue: 80_000,
      holdingMonths: 24,
    });
    expect(cost?.taxAmount).toBe(0);
    expect(cost?.notes.join(' ')).toMatch(/at a loss/i);
  });

  it('returns a null tax rather than guessing a slab rate', () => {
    const debt = makePeer(10, {
      category: 'Debt',
      subCategory: 'Corporate Bond Fund',
      portfolioMetrics: { equityPercentage: 0 },
    });
    const cost = switchCostOf(debt, {
      invested: 100_000,
      currentValue: 150_000,
      holdingMonths: 48,
    });
    expect(cost?.taxAmount).toBeNull();
    expect(cost?.totalAmount).toBeNull();
    expect(cost?.notes.join(' ')).toMatch(/slab rate/i);
  });

  it('computes the slab-taxed cost once a marginal rate is supplied', () => {
    const debt = makePeer(10, {
      category: 'Debt',
      subCategory: 'Corporate Bond Fund',
      portfolioMetrics: { equityPercentage: 0 },
    });
    const cost = switchCostOf(debt, {
      invested: 100_000,
      currentValue: 150_000,
      holdingMonths: 48,
      slabRatePercent: 30,
    });
    expect(cost?.taxAmount).toBeCloseTo(15_000, 0);
  });

  it('cannot be computed without a purchase date or a value', () => {
    expect(
      switchCostOf(equity, { invested: 100_000, currentValue: 150_000, holdingMonths: null }),
    ).toBeNull();
    expect(
      switchCostOf(equity, { invested: 100_000, currentValue: null, holdingMonths: 12 }),
    ).toBeNull();
  });

  it('leaves the tax unknown when there is no cost figure', () => {
    const cost = switchCostOf(equity, {
      invested: null,
      currentValue: 150_000,
      holdingMonths: 24,
    });
    expect(cost?.taxAmount).toBeNull();
    expect(cost?.notes.join(' ')).toMatch(/no cost figure/i);
  });
});

describe('evaluatePortfolio — ranking', () => {
  it('ranks the user\'s holdings by peer standing, best first', () => {
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-2', currentValue: 10_000 }),
      holding({ id: 'mf-2', fundId: 'peer-19', currentValue: 10_000 }),
      holding({ id: 'mf-3', fundId: 'peer-10', currentValue: 10_000 }),
    ]);

    const byId = new Map(result.holdings.map((h) => [h.holding.id, h.rank]));
    expect(byId.get('mf-2')).toBe(1);
    expect(byId.get('mf-3')).toBe(2);
    expect(byId.get('mf-1')).toBe(3);
  });

  it('ranks on the untilted standing, so a debt fund is not flattered by its risk band', () => {
    /*
     * The app's headline score multiplies by a risk factor. If ranking used it, a
     * median liquid fund would outrank a median small-cap fund purely for being
     * lower risk — an exposure the user chose deliberately.
     */
    const debtUniverse = Array.from({ length: 20 }, (_, index) =>
      makePeer(index, {
        id: `debt-${index}`,
        schemeCode: 2000 + index,
        schemeName: `Debt Peer ${index} Fund Direct Growth`,
        subCategory: 'Corporate Bond Fund',
        category: 'Debt',
        riskMetrics: { risk: 'Low' },
        portfolioMetrics: { equityPercentage: 0 },
      }),
    );
    const mixed = [...universe, ...debtUniverse];
    const mixedContext = buildScoringContext(mixed);

    const result = evaluatePortfolio({
      mf: [
        holding({ id: 'mf-1', fundId: 'peer-10', currentValue: 10_000 }),
        holding({ id: 'mf-2', fundId: 'debt-10', currentValue: 10_000 }),
      ],
      sips: [],
      universe: mixed,
      context: mixedContext,
      now: NOW,
    });

    const [equity, debt] = ['mf-1', 'mf-2'].map(
      (id) => result.holdings.find((h) => h.holding.id === id)!,
    );
    // Both are mid-pack in their own sub-category, so both stand the same.
    expect(equity.standing).toBeCloseTo(debt.standing!, 5);
  });
});

describe('evaluatePortfolio — holding verdicts', () => {
  it('keeps a top-ranked fund', () => {
    const result = evaluate([holding({ fundId: 'peer-19' })]);
    expect(result.holdings[0].verdict).toBe('keep');
    expect(result.holdings[0].standing).toBeGreaterThan(WEAK_STANDING);
  });

  it('calls a laggard worth switching when leaving is free', () => {
    // Bottom of its sub-category, no exit load, and the whole gain fits inside
    // the long-term exemption — so the only question left is the fund itself.
    const result = evaluate([
      holding({
        fundId: 'peer-0',
        investedAmount: 100_000,
        currentValue: 150_000,
        purchaseDate: '2020-01-01',
      }),
    ]);

    const [only] = result.holdings;
    expect(only.standing).toBeLessThan(WEAK_STANDING);
    expect(only.betterPeer).not.toBeNull();
    expect(only.verdict).toBe('exit');
    expect(only.verdictReason).toMatch(/free|recover/i);
  });

  it('holds back on a laggard when the tax makes switching expensive', () => {
    /*
     * The heart of this module: a bad fund is not automatically a sell. Realising
     * an ₹800,000 short-term gain costs 20%, or 17.8% of the position, which a
     * realistic 1.9-point return gap takes nine years to earn back.
     */
    const result = evaluatePortfolio({
      mf: [
        holding({
          fundId: 'tight-0',
          investedAmount: 100_000,
          currentValue: 900_000,
          purchaseDate: '2026-02-16',
        }),
      ],
      sips: [],
      universe: tightUniverse,
      context: tightContext,
      now: NOW,
    });

    const [only] = result.holdings;
    expect(only.switchCost?.taxAmount).toBeCloseTo(160_000, 0);
    expect(only.breakEvenYears).toBeGreaterThan(QUICK_BREAK_EVEN_YEARS);
    expect(only.verdict).toBe('watch');
    expect(only.verdictReason).toMatch(/switching costs/i);
  });

  it('says the switch cost is unknown rather than judging without a purchase date', () => {
    const result = evaluate([holding({ fundId: 'peer-0', purchaseDate: null })]);

    const [only] = result.holdings;
    expect(only.switchCost).toBeNull();
    expect(only.verdict).toBe('watch');
    expect(only.verdictReason).toMatch(/could not be worked out/i);
  });

  it('does not judge a fund with too little data either way', () => {
    const thin = makeFund({
      id: 'thin',
      schemeCode: 9001,
      schemeName: 'Brand New Fund Direct Growth',
      subCategory: 'Flexi Cap Fund',
      expenseRatio: 0.06,
    });
    const withThin = [...universe, thin];

    const result = evaluatePortfolio({
      mf: [holding({ fundId: 'thin' })],
      sips: [],
      universe: withThin,
      context: buildScoringContext(withThin),
      now: NOW,
    });

    expect(result.holdings[0].verdict).toBe('unjudged');
    expect(result.holdings[0].verdictReason).toMatch(/history|metrics/i);
  });

  it('does not judge a row that matched no fund', () => {
    const result = evaluate([holding({ fundId: null })]);
    expect(result.holdings[0].verdict).toBe('unjudged');
    expect(result.notes.join(' ')).toMatch(/could not be matched/i);
  });

  it('flags a good fund that has become too large a share as a trim, not an exit', () => {
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 900_000 }),
      holding({ id: 'mf-2', fundId: 'peer-18', currentValue: 25_000 }),
      holding({ id: 'mf-3', fundId: 'peer-17', currentValue: 25_000 }),
      holding({ id: 'mf-4', fundId: 'peer-16', currentValue: 25_000 }),
      holding({ id: 'mf-5', fundId: 'peer-15', currentValue: 25_000 }),
    ]);

    const big = result.holdings.find((h) => h.holding.id === 'mf-1')!;
    expect(big.weightPercent).toBeGreaterThan(OVERWEIGHT_FUND_PERCENT);
    expect(big.verdict).toBe('trim');
    expect(big.verdictReason).toMatch(/nothing wrong with the fund/i);
  });

  it('does not call a share concentrated when an equal split would exceed the bar anyway', () => {
    // With four holdings an equal split is already 25% each, so flagging the
    // threshold would be reporting arithmetic as a problem.
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
      holding({ id: 'mf-2', fundId: 'peer-18', currentValue: 100_000 }),
      holding({ id: 'mf-3', fundId: 'peer-17', currentValue: 100_000 }),
      holding({ id: 'mf-4', fundId: 'peer-16', currentValue: 100_000 }),
    ]);

    expect(result.holdings.every((h) => h.verdict !== 'trim')).toBe(true);
  });

  it('does not offer a fund the user already holds as the alternative', () => {
    /*
     * A three-fund sub-category where the user owns all three. The weakest one
     * has nowhere better to go that is not already in the portfolio, so there is
     * no switch to make — pointing at a fund they already own is not an
     * alternative.
     */
    const trio = [0, 1, 2].map((rank) =>
      makeTightPeer(rank, { id: `trio-${rank}`, schemeCode: 6000 + rank }),
    );

    const result = evaluatePortfolio({
      mf: [
        holding({ id: 'mf-1', fundId: 'trio-0', currentValue: 100_000 }),
        holding({ id: 'mf-2', fundId: 'trio-1', currentValue: 100_000 }),
        holding({ id: 'mf-3', fundId: 'trio-2', currentValue: 100_000 }),
      ],
      sips: [],
      universe: trio,
      context: buildScoringContext(trio),
      now: NOW,
    });

    const weakest = result.holdings.find((h) => h.holding.id === 'mf-1')!;
    expect(weakest.standing).toBeLessThan(WEAK_STANDING);
    expect(weakest.betterPeer).toBeNull();
    expect(weakest.verdict).toBe('watch');
    expect(weakest.verdictReason).toMatch(/already hold/i);
  });
});

describe('evaluatePortfolio — passive funds', () => {
  /**
   * An index fund scored against active peers trails them whenever they beat the
   * index, because alpha, Sharpe and information ratio are all measured against
   * the very benchmark it replicates. Treating that as failure would push people
   * out of a defensible strategy on an arithmetic artefact.
   */
  const indexFund = makeTightPeer(0, {
    id: 'index-cheap',
    schemeCode: 7001,
    schemeName: 'UTI Nifty 50 Index Fund Direct Growth',
    fundHouse: 'UTI Mutual Fund',
    expenseRatio: 0.2,
    benchmarkName: 'NIFTY 50',
  });

  const cheaperIndexFund = makeTightPeer(1, {
    id: 'index-cheaper',
    schemeCode: 7002,
    schemeName: 'Navi Nifty 50 Index Fund Direct Growth',
    fundHouse: 'Navi Mutual Fund',
    expenseRatio: 0.06,
    benchmarkName: 'NIFTY 50',
  });

  const withIndex = [...tightUniverse, indexFund, cheaperIndexFund];
  const withIndexContext = buildScoringContext(withIndex);

  it('does not tell you to switch an index fund for ranking below active peers', () => {
    const result = evaluatePortfolio({
      mf: [holding({ fundId: 'index-cheap', currentValue: 100_000 })],
      sips: [],
      universe: withIndex,
      context: withIndexContext,
      now: NOW,
    });

    const [only] = result.holdings;
    expect(only.isPassive).toBe(true);
    expect(only.standing).toBeLessThan(WEAK_STANDING);
    expect(only.verdict).toBe('keep');
    expect(only.verdictReason).toMatch(/not the test|meant to track/i);
    // No active alternative is offered, because that is not the comparison.
    expect(only.betterPeer).toBeNull();
  });

  it('compares a tracker on cost against the same benchmark instead', () => {
    const result = evaluatePortfolio({
      mf: [holding({ fundId: 'index-cheap', currentValue: 100_000 })],
      sips: [],
      universe: withIndex,
      context: withIndexContext,
      now: NOW,
    });

    const tracker = result.holdings[0].cheaperTracker;
    expect(tracker?.fund.id).toBe('index-cheaper');
    expect(tracker?.saving).toBeCloseTo(0.14, 3);
    // 0.14% of ₹100,000.
    expect(tracker?.annualSavingRupees).toBeCloseTo(140, 0);
  });

  it('does not redirect a passive SIP on ranking grounds either', () => {
    const result = evaluatePortfolio({
      mf: [],
      sips: [sip({ fundId: 'index-cheap' })],
      universe: withIndex,
      context: withIndexContext,
      now: NOW,
    });

    expect(result.sips[0].verdict).not.toBe('redirect');
    expect(result.sips[0].verdictReason).toMatch(/index fund/i);
  });

  it('leaves the money-into-weak-funds total alone for trackers', () => {
    const result = evaluatePortfolio({
      mf: [],
      sips: [sip({ fundId: 'index-cheap', amount: 10_000 })],
      universe: withIndex,
      context: withIndexContext,
      now: NOW,
    });

    expect(result.sipTotals.monthlyIntoWeak).toBe(0);
  });

  it('still calls out two trackers on the same index as a duplication', () => {
    // Cost is not the only passive question — owning the index twice is real.
    const sameStocks = buildHoldingsIndex({
      7001: { schemeCode: 7001, portfolioDate: null, holdings: stocks(['A', 'B', 'C']) },
      7002: { schemeCode: 7002, portfolioDate: null, holdings: stocks(['A', 'B', 'C']) },
    });

    const result = evaluatePortfolio({
      mf: [
        holding({ id: 'mf-1', fundId: 'index-cheap', currentValue: 100_000 }),
        holding({ id: 'mf-2', fundId: 'index-cheaper', currentValue: 100_000 }),
      ],
      sips: [],
      universe: withIndex,
      context: withIndexContext,
      fundHoldings: sameStocks,
      now: NOW,
    });

    expect(result.overlapPairs[0].percent).toBe(100);
    const lower = result.holdings.find((h) => h.holding.id === 'mf-1')!;
    expect(lower.worstOverlap?.percent).toBe(100);
  });
});

describe('evaluatePortfolio — overlap', () => {
  const overlapIndex = buildHoldingsIndex({
    // peer-19 and peer-18 are the same portfolio; peer-0 shares nothing.
    1019: { schemeCode: 1019, portfolioDate: null, holdings: stocks(['A', 'B', 'C']) },
    1018: { schemeCode: 1018, portfolioDate: null, holdings: stocks(['A', 'B', 'C']) },
    1000: { schemeCode: 1000, portfolioDate: null, holdings: stocks(['X', 'Y', 'Z']) },
  });

  it('reports a duplicated pair and points at the higher-ranked one', () => {
    const result = evaluate(
      [
        holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
        holding({ id: 'mf-2', fundId: 'peer-18', currentValue: 100_000 }),
      ],
      [],
      { fundHoldings: overlapIndex },
    );

    expect(result.overlapPairs[0].percent).toBe(100);
    expect(result.overlapPairs[0].combinedAmount).toBe(200_000);

    const lower = result.holdings.find((h) => h.holding.id === 'mf-2')!;
    expect(lower.worstOverlap?.otherRanksHigher).toBe(true);
    expect(lower.worstOverlap!.percent).toBeGreaterThanOrEqual(DUPLICATE_OVERLAP_PERCENT);
    expect(lower.verdict).toBe('exit');
    expect(lower.verdictReason).toMatch(/duplicate/i);
  });

  it('leaves the higher-ranked half of the pair alone', () => {
    const result = evaluate(
      [
        holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
        holding({ id: 'mf-2', fundId: 'peer-18', currentValue: 100_000 }),
      ],
      [],
      { fundHoldings: overlapIndex },
    );

    const higher = result.holdings.find((h) => h.holding.id === 'mf-1')!;
    expect(higher.verdict).toBe('keep');
  });

  it('says overlap is unknown rather than assuming none', () => {
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-19' }),
      holding({ id: 'mf-2', fundId: 'peer-18' }),
    ]);

    expect(result.overlapPairs).toHaveLength(0);
    expect(result.notes.join(' ')).toMatch(/holdings data is unavailable/i);
  });

  it('resolves funds to their underlying companies', () => {
    const result = evaluate(
      [
        holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
        holding({ id: 'mf-2', fundId: 'peer-0', currentValue: 100_000 }),
      ],
      [],
      { fundHoldings: overlapIndex },
    );

    expect(result.lookThrough?.uniqueIssuers).toBe(6);
    expect(result.lookThrough?.coveragePercent).toBe(100);
  });
});

describe('evaluatePortfolio — SIP verdicts', () => {
  it('redirects a laggard SIP without weighing any switch cost', () => {
    // Nothing to weigh: no load, no tax, nothing realised.
    const result = evaluate([], [sip({ fundId: 'peer-0' })]);

    expect(result.sips[0].verdict).toBe('redirect');
    expect(result.sips[0].verdictReason).toMatch(/no cost|costs nothing|no exit load/i);
  });

  it('continues a top-ranked SIP', () => {
    const result = evaluate([], [sip({ fundId: 'peer-19' })]);
    expect(result.sips[0].verdict).toBe('continue');
  });

  it('treats the same fund via a SIP and a holding as a full duplication', () => {
    const result = evaluate(
      [holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 })],
      [sip({ id: 'sip-1', fundId: 'peer-19' })],
      { fundHoldings: buildHoldingsIndex({}) },
    );

    expect(result.sips[0].worstOverlap?.percent).toBe(100);
  });

  it('holds the same fund to a lower bar for new money than for existing units', () => {
    /*
     * The asymmetry this module exists for. One mediocre fund, held and also
     * being added to: keep what you own, because realising the gain costs more
     * than the gap is worth — and stop feeding it, because that costs nothing.
     */
    const result = evaluatePortfolio({
      mf: [
        holding({
          fundId: 'tight-0',
          investedAmount: 100_000,
          currentValue: 900_000,
          purchaseDate: '2026-02-16',
        }),
      ],
      sips: [sip({ fundId: 'tight-0' })],
      universe: tightUniverse,
      context: tightContext,
      now: NOW,
    });

    expect(result.holdings[0].verdict).toBe('watch');
    expect(result.sips[0].verdict).toBe('redirect');
  });

  it('normalises instalments to a monthly figure and refuses to guess an unknown frequency', () => {
    const result = evaluate(
      [],
      [
        sip({ id: 'sip-1', amount: 10_000, frequency: 'monthly' }),
        sip({ id: 'sip-2', amount: 30_000, frequency: 'quarterly' }),
        sip({ id: 'sip-3', amount: 5_000, frequency: 'unknown' }),
      ],
    );

    const byId = new Map(result.sips.map((s) => [s.sip.id, s.monthlyEquivalent]));
    expect(byId.get('sip-1')).toBe(10_000);
    expect(byId.get('sip-2')).toBe(10_000);
    expect(byId.get('sip-3')).toBeNull();

    expect(result.sipTotals.monthlyTotal).toBe(20_000);
    expect(result.sipTotals.annualTotal).toBe(240_000);
    expect(result.notes.join(' ')).toMatch(/no readable frequency/i);
  });

  it('leaves an inactive SIP out of the commitment totals', () => {
    const result = evaluate(
      [],
      [sip({ id: 'sip-1', amount: 10_000 }), sip({ id: 'sip-2', amount: 5_000, active: false })],
    );

    expect(result.sipTotals.monthlyTotal).toBe(10_000);
    expect(result.sipTotals.activeCount).toBe(1);
  });
});

describe('evaluatePortfolio — portfolio figures', () => {
  it('totals invested, value and gain', () => {
    const result = evaluate([
      holding({ id: 'mf-1', investedAmount: 100_000, currentValue: 150_000 }),
      holding({ id: 'mf-2', fundId: 'peer-18', investedAmount: 100_000, currentValue: 90_000 }),
    ]);

    expect(result.totals.invested).toBe(200_000);
    expect(result.totals.currentValue).toBe(240_000);
    expect(result.totals.gain).toBe(40_000);
    expect(result.totals.gainPercent).toBe(20);
  });

  it('computes the gain only over rows that have both figures, and says so', () => {
    // Summing every value against a partial cost base would report a wildly
    // overstated gain.
    const result = evaluate([
      holding({ id: 'mf-1', investedAmount: 100_000, currentValue: 150_000 }),
      holding({ id: 'mf-2', fundId: 'peer-18', investedAmount: null, currentValue: 500_000 }),
    ]);

    expect(result.totals.gain).toBe(50_000);
    expect(result.totals.currentValue).toBe(650_000);
    expect(result.notes.join(' ')).toMatch(/no cost figure/i);
  });

  it('weights the expense ratio by money and states the annual cost in rupees', () => {
    const pricey = makePeer(19, { id: 'pricey', schemeCode: 3001, expenseRatio: 1.5 });
    const withPricey = [...universe, pricey];

    const result = evaluatePortfolio({
      mf: [
        holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
        holding({ id: 'mf-2', fundId: 'pricey', currentValue: 300_000 }),
      ],
      sips: [],
      universe: withPricey,
      context: buildScoringContext(withPricey),
      now: NOW,
    });

    // (0.5 × 100k + 1.5 × 300k) / 400k = 1.25%
    expect(result.weightedExpenseRatio).toBeCloseTo(1.25, 3);
    expect(result.annualCostRupees).toBeCloseTo(5_000, 0);
  });

  it('measures asset allocation drift against a target', () => {
    const debt = makePeer(19, {
      id: 'debt-1',
      schemeCode: 4001,
      subCategory: 'Corporate Bond Fund',
      category: 'Debt',
      portfolioMetrics: { equityPercentage: 0 },
    });
    const withDebt = [...universe, debt];

    const result = evaluatePortfolio({
      mf: [
        holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 900_000 }),
        holding({ id: 'mf-2', fundId: 'debt-1', currentValue: 100_000 }),
      ],
      sips: [],
      universe: withDebt,
      context: buildScoringContext(withDebt),
      targetAllocation: { equity: 60, debt: 40 },
      now: NOW,
    });

    const equity = result.allocation.find((row) => row.assetClass === 'equity')!;
    expect(equity.currentPercent).toBe(90);
    expect(equity.driftPoints).toBe(30);
    expect(result.suggestions.map((s) => s.id)).toContain('allocation-drift');
  });

  it('reports actual allocation without inventing a target', () => {
    const result = evaluate([holding({ currentValue: 100_000 })]);
    const equity = result.allocation.find((row) => row.assetClass === 'equity')!;
    expect(equity.targetPercent).toBeNull();
    expect(equity.driftPoints).toBeNull();
  });

  it('flags concentration in one fund house', () => {
    const result = evaluate([
      // peer-0, peer-4, peer-8 all sit at 'AMC 0'.
      holding({ id: 'mf-1', fundId: 'peer-0', currentValue: 300_000 }),
      holding({ id: 'mf-2', fundId: 'peer-4', currentValue: 300_000 }),
      holding({ id: 'mf-3', fundId: 'peer-19', currentValue: 100_000 }),
    ]);

    expect(result.amcConcentration[0].label).toBe('AMC 0');
    expect(result.amcConcentration[0].percent).toBeGreaterThan(40);
    expect(result.suggestions.map((s) => s.id)).toContain('amc-concentration');
  });

  it('flags more than two funds in one sub-category', () => {
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
      holding({ id: 'mf-2', fundId: 'peer-18', currentValue: 100_000 }),
      holding({ id: 'mf-3', fundId: 'peer-17', currentValue: 100_000 }),
    ]);

    expect(result.suggestions.map((s) => s.id)).toContain('sub-category-crowding');
  });

  it('counts multiple folios of one fund without merging them', () => {
    // Merging would lose the per-folio purchase date, and with it the capital
    // gains clock that decides what a switch costs.
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-19', folio: 'A', purchaseDate: '2019-01-01' }),
      holding({ id: 'mf-2', fundId: 'peer-19', folio: 'B', purchaseDate: '2026-06-01' }),
    ]);

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0].signals.some((s) => s.kind === 'duplicate-row')).toBe(true);
  });

  it('says nothing is pressing when nothing is', () => {
    const result = evaluate([holding({ fundId: 'peer-19', currentValue: 100_000 })]);
    expect(result.suggestions.map((s) => s.id)).toContain('nothing-pressing');
  });

  it('handles an empty portfolio without dividing by zero', () => {
    const result = evaluate([], []);

    expect(result.holdings).toHaveLength(0);
    expect(result.totals.invested).toBeNull();
    expect(result.totals.gainPercent).toBeNull();
    expect(result.weightedExpenseRatio).toBeNull();
    expect(result.sipTotals.monthlyTotal).toBeNull();
    expect(result.allocation).toHaveLength(0);
  });

  it('excludes an unmatched holding from every figure and reports the money', () => {
    const result = evaluate([
      holding({ id: 'mf-1', fundId: 'peer-19', currentValue: 100_000 }),
      holding({ id: 'mf-2', fundId: null, currentValue: 400_000 }),
    ]);

    expect(result.totals.matchedCount).toBe(1);
    expect(result.totals.rowCount).toBe(2);
    // Allocation covers only what could be classified.
    expect(result.allocation.find((row) => row.assetClass === 'equity')!.amount).toBe(100_000);
    expect(result.notes.join(' ')).toMatch(/₹4,00,000/);
  });
});

/** Equal-weighted stock list, for overlap fixtures. */
function stocks(names: string[]): Holding[] {
  return names.map((name) => ({
    name,
    id: name.toLowerCase(),
    sector: null,
    percent: 100 / names.length,
  }));
}
