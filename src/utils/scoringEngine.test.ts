import { describe, expect, it } from 'vitest';
import {
  buildScoringContext,
  calculateFundScore,
  defaultWeights,
  peerGroupKey,
  percentileRank,
  rankFunds,
  scoreFund,
  shortlistFunds,
  type ScoringWeights,
} from '@/utils/scoringEngine';
import { makeFund, makePeerGroup } from '@/utils/__fixtures__/fund';

/** Isolates a single metric so assertions are not diluted by the other ten. */
const onlyWeight = (overrides: Partial<ScoringWeights>): ScoringWeights => ({
  returns: { sixMonth: 0, oneYear: 0, threeYear: 0, fiveYear: 0 },
  expenseRatio: 0,
  sharpeRatio: 0,
  sortinoRatio: 0,
  alpha: 0,
  informationRatio: 0,
  categoryOutperformance: 0,
  consistency: 0,
  riskAdjustment: 0,
  ...overrides,
});

/**
 * A fund with every scored metric populated, so it clears the coverage gate.
 *
 * Tests about ranking or shortlisting need this: a fixture carrying only
 * `returns.oneYear` has ~10% coverage and is deliberately excluded from curated
 * rankings, which would make those tests fail for the wrong reason. `base`
 * shifts every metric together so relative order is easy to reason about.
 */
const makeCoveredFund = (
  id: string,
  base: number,
  overrides: Parameters<typeof makeFund>[0] = {},
) =>
  makeFund({
    id,
    schemeName: `${id} Fund`,
    expenseRatio: 2 - base / 50,
    returns: { sixMonth: base / 2, oneYear: base, threeYear: base, fiveYear: base },
    ratios: {
      sharpeRatio: base / 15,
      sortinoRatio: base / 12,
      alpha: base / 6,
      informationRatio: base / 20,
    },
    categoryReturns: { cat1y: 12, cat3y: 11, cat5y: 10 },
    rankings: { rank1y: 100 - base, rank3y: 100 - base, rank5y: 100 - base },
    ...overrides,
  });

describe('percentileRank', () => {
  it('returns 50 for a degenerate distribution', () => {
    expect(percentileRank([], 5)).toBe(50);
    expect(percentileRank([5], 5)).toBe(50);
  });

  it('places the lowest and highest values at the extremes', () => {
    const sorted = [1, 2, 3, 4];
    expect(percentileRank(sorted, 1)).toBeLessThan(20);
    expect(percentileRank(sorted, 4)).toBeGreaterThan(80);
  });

  it('splits ties so an all-identical distribution lands at 50', () => {
    expect(percentileRank([7, 7, 7, 7], 7)).toBe(50);
  });

  it('is monotonic in the value', () => {
    const sorted = [10, 20, 30, 40, 50];
    const ranks = sorted.map((v) => percentileRank(sorted, v));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });
});

describe('peerGroupKey', () => {
  it('prefers sub-category', () => {
    expect(peerGroupKey(makeFund({ subCategory: 'Small Cap Fund', category: 'Equity' }))).toBe(
      'Small Cap Fund',
    );
  });

  it('falls back to category when sub-category is blank', () => {
    expect(peerGroupKey(makeFund({ subCategory: '   ', category: 'Debt' }))).toBe('Debt');
  });
});

describe('risk tilt', () => {
  // This is the bug the previous implementation had: riskAdjustment was applied
  // as `1 + w * (multiplier - 1)` with w = 0.02, producing a 0.2% swing where
  // +/-10% was intended, which made risk effectively absent from the score.
  const tiltFor = (risk: 'Low' | 'Moderate' | 'High' | 'Very High') => {
    // Six peers so peer-group size does not cap confidence, and a single
    // weighted metric so the tilt is the only other thing moving the score.
    const peers = [10, 12, 14, 18, 20, 22].map((v, i) =>
      makeFund({ id: `peer-${i}`, returns: { oneYear: v } }),
    );
    const target = makeFund({ id: 'target', returns: { oneYear: 15 }, riskMetrics: { risk } });
    const weights = onlyWeight({
      returns: { sixMonth: 0, oneYear: 1, threeYear: 0, fiveYear: 0 },
      riskAdjustment: 0.1,
    });
    const context = buildScoringContext([...peers, target], weights);
    return scoreFund(target, context);
  };

  it('actually moves the score, by the configured magnitude', () => {
    const low = tiltFor('Low');
    // measuredScore is the pre-tilt, pre-shrink percentile. With full coverage
    // on the only weighted metric, a 0.1 tilt at +1 must move the score by a
    // full 10%, not a rounding error.
    expect(low.score).toBeCloseTo(low.measuredScore * 1.1, 4);
  });

  it('orders the four buckets and distinguishes Very High from High', () => {
    const scores = (['Low', 'Moderate', 'High', 'Very High'] as const).map((r) => tiltFor(r).score);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
    // The old ternary had no 'Very High' branch, so it collapsed onto 'High'.
    expect(scores[2]).toBeGreaterThan(scores[3]);
  });

  it('is a no-op when riskAdjustment is zero', () => {
    const funds = [10, 12, 14, 16, 18].map((v, i) =>
      makeFund({ id: `peer-${i}`, returns: { oneYear: v } }),
    );
    const target = makeFund({
      id: 'target',
      returns: { oneYear: 20 },
      riskMetrics: { risk: 'Very High' },
    });
    const weights = onlyWeight({
      returns: { sixMonth: 0, oneYear: 1, threeYear: 0, fiveYear: 0 },
      riskAdjustment: 0,
    });
    const breakdown = scoreFund(target, buildScoringContext([...funds, target], weights));
    expect(breakdown.score).toBeCloseTo(breakdown.measuredScore, 6);
  });
});

describe('percentile normalisation', () => {
  it('does not let a large-magnitude metric dominate a small-magnitude one', () => {
    // Fund A wins on 1Y return by a huge absolute margin; Fund B wins on Sharpe
    // by a small one. With equal weights the two should offset, which is exactly
    // what raw-value summing got wrong (returns ~20 vs Sharpe ~1).
    const a = makeFund({ id: 'a', returns: { oneYear: 60 }, ratios: { sharpeRatio: 0.5 } });
    const b = makeFund({ id: 'b', returns: { oneYear: 5 }, ratios: { sharpeRatio: 2.0 } });

    const weights = onlyWeight({
      returns: { sixMonth: 0, oneYear: 0.5, threeYear: 0, fiveYear: 0 },
      sharpeRatio: 0.5,
    });

    const context = buildScoringContext([a, b], weights);
    expect(scoreFund(a, context).score).toBeCloseTo(scoreFund(b, context).score, 4);
  });

  it('scores funds relative to their own sub-category, not the whole universe', () => {
    // A liquid fund returning 7% should beat its 6% peers even though every
    // small-cap fund in the universe returns far more.
    const liquid = makePeerGroup(
      [6, 6.2, 7],
      (fund, value) => {
        fund.returns.oneYear = value;
      },
      'Liquid Fund',
    );
    const smallCap = makePeerGroup(
      [30, 35, 40],
      (fund, value) => {
        fund.returns.oneYear = value;
      },
      'Small Cap Fund',
    );
    smallCap.forEach((fund, i) => (fund.id = `sc-${i}`));

    const weights = onlyWeight({
      returns: { sixMonth: 0, oneYear: 1, threeYear: 0, fiveYear: 0 },
    });
    const context = buildScoringContext([...liquid, ...smallCap], weights);

    const bestLiquid = scoreFund(liquid[2], context);
    const worstSmallCap = scoreFund(smallCap[0], context);

    expect(bestLiquid.peerGroup).toBe('Liquid Fund');
    expect(bestLiquid.score).toBeGreaterThan(worstSmallCap.score);
  });

  it('inverts expense ratio so cheaper scores higher', () => {
    const cheap = makeFund({ id: 'cheap', expenseRatio: 0.2 });
    const dear = makeFund({ id: 'dear', expenseRatio: 2.0 });

    const weights = onlyWeight({ expenseRatio: 1 });
    const context = buildScoringContext([cheap, dear], weights);

    expect(scoreFund(cheap, context).score).toBeGreaterThan(scoreFund(dear, context).score);
  });
});

describe('missing data', () => {
  /** Enough peers that peer-group size stops limiting confidence. */
  const padPeers = (count = 6, subCategory = 'Large Cap Fund') =>
    Array.from({ length: count }, (_, i) =>
      makeFund({
        id: `pad-${i}-${subCategory}`,
        subCategory,
        returns: { oneYear: i, fiveYear: i },
        expenseRatio: 1 + i / 10,
      }),
    );

  it('reports coverage without dropping the metrics it does have', () => {
    const young = makeFund({ id: 'young', returns: { oneYear: 30 } });
    const weights = onlyWeight({
      returns: { sixMonth: 0, oneYear: 0.5, threeYear: 0, fiveYear: 0.5 },
    });
    const context = buildScoringContext([young, ...padPeers()], weights);
    const breakdown = scoreFund(young, context);

    expect(breakdown.percentiles.oneYear).toBeDefined();
    expect(breakdown.percentiles.fiveYear).toBeUndefined();
    expect(breakdown.coverage).toBeCloseTo(0.5, 6);
    // Judged top of its peer group on the metric it has...
    expect(breakdown.measuredScore).toBeGreaterThan(80);
  });

  it('shrinks the score toward neutral in proportion to missing data', () => {
    // This is the bug the shrinkage fixes. A brand-new passive FoF with no
    // return history but a rock-bottom expense ratio was scoring ~98 off that
    // single metric and topping the rankings — less data produced a better
    // score, because the metrics that would drag it down were not counted.
    const thin = makeFund({ id: 'thin', expenseRatio: 0.06 });
    const context = buildScoringContext([thin, ...padPeers()], defaultWeights);
    const breakdown = scoreFund(thin, context);

    // Top of its peer group on the one metric it has.
    expect(breakdown.measuredScore).toBeGreaterThan(90);
    // But the score that ranks it is nowhere near that.
    expect(breakdown.score).toBeLessThan(60);
    expect(breakdown.coverage).toBeLessThan(0.2);
  });

  it('leaves a fully covered fund essentially unshrunk', () => {
    const complete = makeFund({
      id: 'complete',
      expenseRatio: 0.3,
      returns: { sixMonth: 9, oneYear: 25, threeYear: 20, fiveYear: 18 },
      ratios: { sharpeRatio: 2, sortinoRatio: 2.5, alpha: 5, informationRatio: 1.2 },
      categoryReturns: { cat1y: 12, cat3y: 11, cat5y: 10 },
      rankings: { rank1y: 2, rank3y: 3, rank5y: 2 },
      riskMetrics: { risk: 'Moderate' },
    });

    const weights = { ...defaultWeights, riskAdjustment: 0 };
    const context = buildScoringContext([complete, ...padPeers()], weights);
    const breakdown = scoreFund(complete, context);

    expect(breakdown.coverage).toBe(1);
    expect(breakdown.confidence).toBe(1);
    expect(breakdown.score).toBeCloseTo(breakdown.measuredScore, 4);
  });

  it('ranks a well-covered good fund above a thin-data one that looks perfect', () => {
    // The exact inversion seen in the UI: FoFs with only an expense ratio
    // outranking funds with a full decade of top-quartile results.
    const thin = makeFund({ id: 'thin', expenseRatio: 0.05 });
    const solid = makeFund({
      id: 'solid',
      expenseRatio: 0.6,
      returns: { sixMonth: 8, oneYear: 22, threeYear: 19, fiveYear: 17 },
      ratios: { sharpeRatio: 1.8, sortinoRatio: 2.2, alpha: 4, informationRatio: 1.1 },
      categoryReturns: { cat1y: 14, cat3y: 12, cat5y: 11 },
      rankings: { rank1y: 3, rank3y: 4, rank5y: 3 },
    });

    const ranked = rankFunds(
      [thin, solid, ...padPeers()],
      [thin, solid, ...padPeers()],
      defaultWeights,
      { includeInsufficientData: true },
    );

    const thinRank = ranked.find((f) => f.id === 'thin')!.rank;
    const solidRank = ranked.find((f) => f.id === 'solid')!.rank;
    expect(solidRank).toBeLessThan(thinRank);
  });

  it('reports zero coverage and a neutral score when nothing is available', () => {
    const empty = makeFund({ id: 'empty' });
    const context = buildScoringContext([empty, ...padPeers()], {
      ...defaultWeights,
      riskAdjustment: 0,
    });
    const breakdown = scoreFund(empty, context);

    expect(breakdown.coverage).toBe(0);
    // Neutral, not zero — we know nothing, which is not the same as "bad".
    expect(breakdown.score).toBe(50);
    expect(breakdown.hasSufficientData).toBe(false);
  });

  it('reduces confidence when the peer group is too small to be meaningful', () => {
    // "Top third of three funds" is not information.
    const a = makeFund({ id: 'a', subCategory: 'Tiny Niche', returns: { oneYear: 30 } });
    const b = makeFund({ id: 'b', subCategory: 'Tiny Niche', returns: { oneYear: 5 } });

    const context = buildScoringContext([a, b], onlyWeight({
      returns: { sixMonth: 0, oneYear: 1, threeYear: 0, fiveYear: 0 },
    }));
    const breakdown = scoreFund(a, context);

    expect(breakdown.peerCount).toBe(2);
    expect(breakdown.confidence).toBeLessThan(1);
    expect(breakdown.score).toBeLessThan(breakdown.measuredScore);
  });

  it('excludes insufficient-data funds from curated rankings by default', () => {
    const thin = makeFund({ id: 'thin', expenseRatio: 0.05 });
    const universe = [thin, ...padPeers()];

    expect(rankFunds(universe, universe, defaultWeights).map((f) => f.id)).not.toContain('thin');
    expect(
      rankFunds(universe, universe, defaultWeights, { includeInsufficientData: true }).map(
        (f) => f.id,
      ),
    ).toContain('thin');
  });

  it('keeps shortlists free of unrankable funds', () => {
    const thin = makeFund({
      id: 'thin',
      expenseRatio: 0.05,
      riskMetrics: { risk: 'Very High' },
    });
    const universe = [thin, ...padPeers()];

    expect(shortlistFunds(universe, 'Very High', 10).map((f) => f.id)).not.toContain('thin');
  });

  it('treats NaN as missing', () => {
    const nan = makeFund({ id: 'nan', returns: { oneYear: Number.NaN } });
    const good = makeFund({ id: 'good', returns: { oneYear: 12 } });

    const weights = onlyWeight({
      returns: { sixMonth: 0, oneYear: 1, threeYear: 0, fiveYear: 0 },
    });
    const context = buildScoringContext([nan, good], weights);

    expect(scoreFund(nan, context).percentiles.oneYear).toBeUndefined();
    expect(scoreFund(good, context).percentiles.oneYear).toBeDefined();
  });

  it('compares numeric strings from the feed numerically', () => {
    // Regression guard: the feed emits some metrics as strings, and a string
    // reaching the percentile comparison would sort lexically ('9' > '10').
    const nine = makeFund({ id: 'nine', expenseRatio: '9' as unknown as number });
    const ten = makeFund({ id: 'ten', expenseRatio: '10' as unknown as number });

    const context = buildScoringContext([nine, ten], onlyWeight({ expenseRatio: 1 }));

    // Lower expense is better, so 9 must outrank 10.
    expect(scoreFund(nine, context).score).toBeGreaterThan(scoreFund(ten, context).score);
  });

  it('treats non-numeric strings as missing rather than scoring them', () => {
    const bad = makeFund({ id: 'bad', returns: { oneYear: 'NA' as unknown as number } });
    const context = buildScoringContext(
      [bad],
      onlyWeight({ returns: { sixMonth: 0, oneYear: 1, threeYear: 0, fiveYear: 0 } }),
    );

    expect(scoreFund(bad, context).percentiles.oneYear).toBeUndefined();
  });
});

describe('derived metrics', () => {
  it('scores category outperformance from fund-vs-category returns', () => {
    const beat = makeFund({
      id: 'beat',
      returns: { oneYear: 20, threeYear: 18 },
      categoryReturns: { cat1y: 12, cat3y: 11 },
    });
    const lag = makeFund({
      id: 'lag',
      returns: { oneYear: 20, threeYear: 18 },
      categoryReturns: { cat1y: 25, cat3y: 24 },
    });

    const weights = onlyWeight({ categoryOutperformance: 1 });
    const context = buildScoringContext([beat, lag], weights);

    expect(scoreFund(beat, context).score).toBeGreaterThan(scoreFund(lag, context).score);
  });

  it('rewards stable ranks over volatile ones', () => {
    const steady = makeFund({ id: 'steady', rankings: { rank1y: 10, rank3y: 12, rank5y: 11 } });
    const erratic = makeFund({ id: 'erratic', rankings: { rank1y: 1, rank3y: 90, rank5y: 45 } });

    const weights = onlyWeight({ consistency: 1 });
    const context = buildScoringContext([steady, erratic], weights);

    expect(scoreFund(steady, context).score).toBeGreaterThan(scoreFund(erratic, context).score);
  });

  it('needs at least two ranks to judge consistency', () => {
    const single = makeFund({ id: 'single', rankings: { rank1y: 5 } });
    const context = buildScoringContext([single], onlyWeight({ consistency: 1 }));
    expect(scoreFund(single, context).percentiles.consistency).toBeUndefined();
  });
});

describe('default weights', () => {
  it('sum to 1 excluding the risk multiplier, so the score is a 0-100 number', () => {
    const { returns, riskAdjustment, ...rest } = defaultWeights;
    const total =
      returns.sixMonth +
      returns.oneYear +
      returns.threeYear +
      returns.fiveYear +
      Object.values(rest).reduce((sum, w) => sum + w, 0);

    expect(total).toBeCloseTo(1, 6);
    expect(riskAdjustment).toBeGreaterThan(0);
  });

  it('weight long horizons above short ones', () => {
    const { returns } = defaultWeights;
    const longHorizon = returns.threeYear + returns.fiveYear;
    const shortHorizon = returns.sixMonth + returns.oneYear;
    expect(longHorizon).toBeGreaterThan(shortHorizon);
  });
});

describe('rankFunds', () => {
  it('assigns dense ascending ranks in descending score order', () => {
    const funds = [
      makeCoveredFund('low', 5),
      makeCoveredFund('high', 25),
      makeCoveredFund('mid', 15),
      makeCoveredFund('pad1', 10),
      makeCoveredFund('pad2', 20),
    ];

    const ranked = rankFunds(funds, funds, defaultWeights);

    expect(ranked.map((f) => f.id)).toEqual(['high', 'pad2', 'mid', 'pad1', 'low']);
    expect(ranked.map((f) => f.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it('keeps percentiles stable when ranking a subset against the full universe', () => {
    const universe = makePeerGroup([5, 10, 15, 20, 25], (fund, value) => {
      fund.returns.oneYear = value;
    });

    const wholeUniverse = rankFunds(universe, universe, defaultWeights);
    const subset = rankFunds(universe.slice(0, 2), universe, defaultWeights);

    const target = universe[0].id;
    expect(subset.find((f) => f.id === target)?.score).toBe(
      wholeUniverse.find((f) => f.id === target)?.score,
    );
  });

  it('breaks score ties deterministically by name', () => {
    const a = makeCoveredFund('a', 10, { schemeName: 'Bravo Fund' });
    const b = makeCoveredFund('b', 10, { schemeName: 'Alpha Fund' });
    const pad = [makeCoveredFund('p1', 5), makeCoveredFund('p2', 15), makeCoveredFund('p3', 20)];
    const universe = [a, b, ...pad];

    const tied = rankFunds(universe, universe, defaultWeights)
      .filter((f) => f.id === 'a' || f.id === 'b')
      .map((f) => f.schemeName);

    expect(tied).toEqual(['Alpha Fund', 'Bravo Fund']);
  });
});

describe('shortlistFunds', () => {
  // Fully covered so the coverage gate does not filter them out — this suite is
  // about the risk filter, not about missing data.
  const universe = [
    makeCoveredFund('low', 7, { riskMetrics: { risk: 'Low' } }),
    makeCoveredFund('mod', 11, { riskMetrics: { risk: 'Moderate' } }),
    makeCoveredFund('high', 18, { riskMetrics: { risk: 'High' } }),
    makeCoveredFund('vhigh', 28, { riskMetrics: { risk: 'Very High' } }),
    makeCoveredFund('unrated', 40),
    makeCoveredFund('pad1', 9, { riskMetrics: { risk: 'Low' } }),
    makeCoveredFund('pad2', 13, { riskMetrics: { risk: 'Moderate' } }),
  ];

  it('includes only buckets at or below the stated tolerance', () => {
    expect(shortlistFunds(universe, 'Low', 10).map((f) => f.id).sort()).toEqual(['low', 'pad1']);
    expect(shortlistFunds(universe, 'Moderate', 10).map((f) => f.id).sort()).toEqual([
      'low',
      'mod',
      'pad1',
      'pad2',
    ]);
  });

  it('admits unrated funds only at the widest tolerance', () => {
    expect(shortlistFunds(universe, 'High', 10).map((f) => f.id)).not.toContain('unrated');
    expect(shortlistFunds(universe, 'Very High', 10).map((f) => f.id)).toContain('unrated');
  });

  it('explains each pick in peer-relative terms rather than absolute thresholds', () => {
    const [top] = shortlistFunds(universe, 'Very High', 1);
    expect(top.reason).toBeTruthy();
    expect(top.reason).not.toMatch(/\d+%\s*(return|expense)$/);
  });

  it('respects the limit', () => {
    expect(shortlistFunds(universe, 'Very High', 2)).toHaveLength(2);
  });
});

describe('calculateFundScore', () => {
  it('matches the context-based path for a single fund', () => {
    const funds = makePeerGroup([5, 10, 15], (fund, value) => {
      fund.returns.oneYear = value;
    });

    const viaContext = scoreFund(funds[1], buildScoringContext(funds, defaultWeights)).score;
    expect(calculateFundScore(funds[1], funds, defaultWeights)).toBe(viaContext);
  });
});
