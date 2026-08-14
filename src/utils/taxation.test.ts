import { describe, expect, it } from 'vitest';
import {
  TAX_REGIME,
  classifyTaxBucket,
  postTaxReturn,
  postTaxReturnSeries,
  projectRedemption,
  returnBasisFor,
  slabArbitrageApplies,
  taxProfile,
} from '@/utils/taxation';
import { makeFund } from '@/utils/__fixtures__/fund';

describe('classifyTaxBucket', () => {
  it('classifies by equity allocation, not by declared category', () => {
    // A scheme labelled Hybrid but holding 70% equity is equity-oriented for
    // tax. Trusting the label would put it in the wrong bucket.
    expect(
      classifyTaxBucket(
        makeFund({ category: 'Hybrid', portfolioMetrics: { equityPercentage: 70 } }),
      ),
    ).toBe('equity');
  });

  it('applies the 65% and 35% thresholds at the boundaries', () => {
    const at = (equityPercentage: number) =>
      classifyTaxBucket(makeFund({ portfolioMetrics: { equityPercentage } }));

    expect(at(65)).toBe('equity');
    expect(at(64.9)).toBe('hybrid');
    expect(at(35.1)).toBe('hybrid');
    expect(at(35)).toBe('debt');
    expect(at(0)).toBe('debt');
  });

  it('treats international equity as non-equity despite full equity allocation', () => {
    // This is the trap: a US equity feeder fund holds 100% equity but is not
    // "equity-oriented" under Indian law, so allocation alone gets it wrong.
    expect(
      classifyTaxBucket(
        makeFund({
          schemeName: 'Test US Equity FoF Direct Growth',
          portfolioMetrics: { equityPercentage: 100 },
        }),
      ),
    ).toBe('international');

    expect(
      classifyTaxBucket(
        makeFund({
          subCategory: 'Fund of Fund',
          portfolioMetrics: { equityPercentage: 99 },
        }),
      ),
    ).toBe('international');
  });

  it('detects gold and commodity schemes', () => {
    expect(classifyTaxBucket(makeFund({ schemeName: 'Test Gold ETF FoF' }))).toBe('commodity');
    expect(classifyTaxBucket(makeFund({ category: 'Commodities' }))).toBe('commodity');
  });

  it('falls back to category when allocation data is missing', () => {
    expect(classifyTaxBucket(makeFund({ category: 'Debt' }))).toBe('debt');
    expect(classifyTaxBucket(makeFund({ category: 'Equity' }))).toBe('equity');
    expect(classifyTaxBucket(makeFund({ category: 'Others', subCategory: '' }))).toBe('unknown');
  });
});

describe('taxProfile', () => {
  it('flags whether the classification came from allocation data', () => {
    expect(taxProfile(makeFund({ portfolioMetrics: { equityPercentage: 80 } })).fromAllocation).toBe(
      true,
    );
    expect(taxProfile(makeFund({ category: 'Equity' })).fromAllocation).toBe(false);
  });

  it('exposes the regime label so a stale rate table is visible', () => {
    expect(taxProfile(makeFund()).regimeLabel).toBe(TAX_REGIME.label);
  });
});

describe('postTaxReturn', () => {
  const equityFund = makeFund({ portfolioMetrics: { equityPercentage: 90 } });
  const debtFund = makeFund({ portfolioMetrics: { equityPercentage: 5 } });
  const hybridFund = makeFund({ portfolioMetrics: { equityPercentage: 50 } });

  it('applies the long-term equity rate past the 12-month mark', () => {
    const result = postTaxReturn(equityFund, { grossReturnPercent: 20, holdingMonths: 13 });
    expect(result.isLongTerm).toBe(true);
    expect(result.effectiveRatePercent).toBe(12.5);
    expect(result.postTaxReturnPercent).toBeCloseTo(20 * 0.875, 6);
  });

  it('applies the short-term equity rate before it', () => {
    const result = postTaxReturn(equityFund, { grossReturnPercent: 20, holdingMonths: 11 });
    expect(result.isLongTerm).toBe(false);
    expect(result.effectiveRatePercent).toBe(20);
    expect(result.monthsToLongTerm).toBe(1);
  });

  it('treats exactly 12 months as long-term for equity', () => {
    expect(postTaxReturn(equityFund, { grossReturnPercent: 10, holdingMonths: 12 }).isLongTerm).toBe(
      true,
    );
  });

  it('requires 24 months for the hybrid band', () => {
    expect(
      postTaxReturn(hybridFund, { grossReturnPercent: 10, holdingMonths: 13 }).isLongTerm,
    ).toBe(false);
    expect(
      postTaxReturn(hybridFund, { grossReturnPercent: 10, holdingMonths: 24 }).isLongTerm,
    ).toBe(true);
  });

  it('refuses to guess a slab rate rather than returning a wrong number', () => {
    // Debt funds are slab-taxed. Assuming 30% would produce a confidently wrong
    // post-tax figure for someone in a lower bracket.
    const result = postTaxReturn(debtFund, { grossReturnPercent: 8, holdingMonths: 40 });
    expect(result.postTaxReturnPercent).toBeNull();
    expect(result.explanation).toMatch(/slab/i);
  });

  it('uses the supplied slab rate for debt, regardless of holding period', () => {
    const short = postTaxReturn(debtFund, {
      grossReturnPercent: 8,
      holdingMonths: 3,
      slabRatePercent: 30,
    });
    const long = postTaxReturn(debtFund, {
      grossReturnPercent: 8,
      holdingMonths: 60,
      slabRatePercent: 30,
    });

    expect(short.postTaxReturnPercent).toBeCloseTo(5.6, 6);
    // No long-term concession exists for this bucket, so holding longer changes
    // nothing about the rate.
    expect(long.postTaxReturnPercent).toBeCloseTo(short.postTaxReturnPercent!, 6);
    expect(long.isLongTerm).toBe(false);
  });

  it('lets a lower slab rate produce a better post-tax return on debt', () => {
    const high = postTaxReturn(debtFund, {
      grossReturnPercent: 8,
      holdingMonths: 12,
      slabRatePercent: 30,
    });
    const low = postTaxReturn(debtFund, {
      grossReturnPercent: 8,
      holdingMonths: 12,
      slabRatePercent: 5,
    });

    expect(low.postTaxReturnPercent!).toBeGreaterThan(high.postTaxReturnPercent!);
  });

  it('applies the annual exemption when an absolute gain is supplied', () => {
    // A gain fully inside the exemption should attract no tax at all.
    const covered = postTaxReturn(equityFund, {
      grossReturnPercent: 20,
      holdingMonths: 13,
      gainRupees: 100_000,
      exemptionHeadroomRupees: 125_000,
    });

    expect(covered.effectiveRatePercent).toBe(0);
    expect(covered.postTaxReturnPercent).toBeCloseTo(20, 6);
  });

  it('taxes only the portion above remaining headroom', () => {
    const partly = postTaxReturn(equityFund, {
      grossReturnPercent: 20,
      holdingMonths: 13,
      gainRupees: 200_000,
      exemptionHeadroomRupees: 100_000,
    });

    // Half the gain is exempt, so the effective rate is half the headline rate.
    expect(partly.effectiveRatePercent).toBeCloseTo(6.25, 6);
  });

  it('ignores exemption headroom for buckets that have no exemption', () => {
    const result = postTaxReturn(hybridFund, {
      grossReturnPercent: 15,
      holdingMonths: 30,
      gainRupees: 100_000,
      exemptionHeadroomRupees: 125_000,
    });

    expect(result.effectiveRatePercent).toBe(12.5);
  });

  it('reports months remaining until long-term status', () => {
    expect(
      postTaxReturn(hybridFund, { grossReturnPercent: 5, holdingMonths: 18 }).monthsToLongTerm,
    ).toBe(6);
    expect(
      postTaxReturn(hybridFund, { grossReturnPercent: 5, holdingMonths: 30 }).monthsToLongTerm,
    ).toBe(0);
  });
});

describe('postTaxReturnSeries', () => {
  it('leaves horizons the fund has no history for as null', () => {
    const fund = makeFund({
      portfolioMetrics: { equityPercentage: 90 },
      returns: { oneYear: 20, threeYear: 15 },
    });

    const series = postTaxReturnSeries(fund);
    expect(series.oneYear).not.toBeNull();
    expect(series.threeYear).not.toBeNull();
    expect(series.fiveYear).toBeNull();
  });

  it('never reports a post-tax return above the gross return', () => {
    const fund = makeFund({
      portfolioMetrics: { equityPercentage: 90 },
      returns: { oneYear: 20, threeYear: 15, fiveYear: 14 },
    });

    const series = postTaxReturnSeries(fund);
    expect(series.oneYear!).toBeLessThanOrEqual(20);
    expect(series.threeYear!).toBeLessThanOrEqual(15);
    expect(series.fiveYear!).toBeLessThanOrEqual(14);
  });

  it('returns nulls for slab-taxed funds when no slab rate is given', () => {
    const debt = makeFund({
      portfolioMetrics: { equityPercentage: 10 },
      returns: { oneYear: 7, threeYear: 6, fiveYear: 6.5 },
    });

    expect(postTaxReturnSeries(debt)).toEqual({
      oneYear: null,
      threeYear: null,
      fiveYear: null,
    });
  });
});

describe('slabArbitrageApplies', () => {
  it('is true for slab-taxed buckets and false for flat-rate equity', () => {
    expect(slabArbitrageApplies(makeFund({ portfolioMetrics: { equityPercentage: 10 } }))).toBe(
      true,
    );
    // Equity is flat-taxed, so which family member holds it does not change the
    // rate — only the per-PAN exemption differs.
    expect(slabArbitrageApplies(makeFund({ portfolioMetrics: { equityPercentage: 90 } }))).toBe(
      false,
    );
  });
});

describe('returnBasisFor', () => {
  const fund = makeFund({
    returns: { oneYear: 20, threeYear: 15, fiveYear: 12, tenYear: 11 },
  });

  it('picks the shortest horizon that covers the holding period', () => {
    expect(returnBasisFor(fund, 10)?.label).toBe('1Y');
    expect(returnBasisFor(fund, 24)?.label).toBe('3Y');
    expect(returnBasisFor(fund, 48)?.label).toBe('5Y');
    expect(returnBasisFor(fund, 100)?.label).toBe('10Y');
  });

  it('flags extrapolation when no horizon is long enough', () => {
    const young = makeFund({ returns: { oneYear: 20 } });
    const basis = returnBasisFor(young, 60);
    expect(basis?.label).toBe('1Y');
    expect(basis?.extrapolated).toBe(true);
  });

  it('never projects from the 6M figure', () => {
    // 6M is an absolute period return, not annualised — verified against live
    // data. Compounding it would roughly double short-horizon projections.
    const only6m = makeFund({ returns: { sixMonth: 10 } });
    expect(returnBasisFor(only6m, 6)).toBeNull();
  });

  it('returns null when there is no annualised history at all', () => {
    expect(returnBasisFor(makeFund(), 12)).toBeNull();
  });
});

describe('projectRedemption', () => {
  const equity = makeFund({
    portfolioMetrics: { equityPercentage: 90 },
    expenseRatio: 0.5,
    returns: { oneYear: 20, threeYear: 15, fiveYear: 12 },
    exitLoad: 'Exit load of 1% if redeemed within 1 year',
  });

  it('compounds the chosen CAGR over the holding period', () => {
    const p = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 36 })!;
    // 3Y CAGR of 15% over 36 months.
    expect(p.grossValue).toBeCloseTo(100_000 * 1.15 ** 3, 0);
    expect(p.basis.label).toBe('3Y');
  });

  it('applies exit load inside the window and not outside it', () => {
    const inside = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 6 })!;
    expect(inside.exitLoadAmount).toBeGreaterThan(0);
    expect(inside.exitLoadAmount).toBeCloseTo(inside.grossValue * 0.01, 4);

    const outside = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 36 })!;
    expect(outside.exitLoadAmount).toBe(0);
  });

  it('charges exit load on only the chargeable fraction when there is a free allowance', () => {
    const withAllowance = makeFund({
      portfolioMetrics: { equityPercentage: 90 },
      returns: { oneYear: 20 },
      exitLoad:
        'Exit load for units in excess of 10% of the investment, 1% will be charged for redemption within 1 year.',
    });

    const p = projectRedemption(withAllowance, { amountRupees: 100_000, holdingMonths: 6 })!;
    // 1% of 90%, not 1% of everything.
    expect(p.exitLoadAmount).toBeCloseTo(p.grossValue * 0.9 * 0.01, 4);
  });

  it('switches from short-term to long-term tax at the threshold', () => {
    const short = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 11 })!;
    const long = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 13 })!;

    expect(short.isLongTerm).toBe(false);
    expect(long.isLongTerm).toBe(true);
    expect(long.effectiveTaxRatePercent!).toBeLessThan(short.effectiveTaxRatePercent!);
  });

  it('reports how many months remain until long-term status', () => {
    const p = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 9 })!;
    expect(p.monthsToLongTerm).toBe(3);
    expect(p.notes.some((n) => /3 more months/.test(n))).toBe(true);
  });

  it('leaves net figures null for slab-taxed funds with no slab rate supplied', () => {
    const debt = makeFund({
      portfolioMetrics: { equityPercentage: 10 },
      returns: { oneYear: 7, threeYear: 6.5 },
    });

    const p = projectRedemption(debt, { amountRupees: 100_000, holdingMonths: 36 })!;
    expect(p.taxAmount).toBeNull();
    expect(p.netValue).toBeNull();
    expect(p.notes.some((n) => /slab rate/i.test(n))).toBe(true);
  });

  it('computes net figures once a slab rate is given', () => {
    const debt = makeFund({
      portfolioMetrics: { equityPercentage: 10 },
      returns: { oneYear: 7, threeYear: 6.5 },
    });

    const p = projectRedemption(debt, {
      amountRupees: 100_000,
      holdingMonths: 36,
      slabRatePercent: 30,
    })!;

    expect(p.taxAmount).toBeCloseTo(p.grossGain * 0.3, 4);
    expect(p.netValue).toBeCloseTo(p.grossValue - p.exitLoadAmount - p.taxAmount!, 4);
  });

  it('never reports a net value above the gross value', () => {
    for (const months of [3, 11, 13, 25, 60]) {
      const p = projectRedemption(equity, { amountRupees: 250_000, holdingMonths: months })!;
      expect(p.netValue!).toBeLessThanOrEqual(p.grossValue);
      expect(p.netCagrPercent!).toBeLessThanOrEqual(p.basis.annualPercent);
    }
  });

  it('applies the long-term exemption to the projected gain', () => {
    const small = projectRedemption(equity, {
      amountRupees: 100_000,
      holdingMonths: 13,
      exemptionHeadroomRupees: 125_000,
    })!;
    // A ~20k gain sits entirely inside the exemption.
    expect(small.taxAmount).toBe(0);
  });

  it('treats the expense ratio as already-deducted context, never a deduction', () => {
    const p = projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 60 })!;

    // The TER figure is a counterfactual (what a zero-fee fund would have
    // reached), so it must be positive and must NOT reduce the net value.
    expect(p.terDragAmount!).toBeGreaterThan(0);
    expect(p.netValue).toBeCloseTo(p.grossValue - p.exitLoadAmount - p.taxAmount!, 4);

    const withoutTer = makeFund({
      portfolioMetrics: { equityPercentage: 90 },
      expenseRatio: null,
      returns: { oneYear: 20, threeYear: 15, fiveYear: 12 },
    });
    const q = projectRedemption(withoutTer, { amountRupees: 100_000, holdingMonths: 60 })!;
    // Same return assumption, so the same gross value regardless of TER.
    expect(q.grossValue).toBeCloseTo(p.grossValue, 4);
    expect(q.terDragAmount).toBeNull();
  });

  it('returns null for nonsense inputs instead of NaN', () => {
    expect(projectRedemption(equity, { amountRupees: 0, holdingMonths: 12 })).toBeNull();
    expect(projectRedemption(equity, { amountRupees: 100_000, holdingMonths: 0 })).toBeNull();
    expect(projectRedemption(makeFund(), { amountRupees: 100_000, holdingMonths: 12 })).toBeNull();
  });

  it('notes when no gain is projected', () => {
    const losing = makeFund({
      portfolioMetrics: { equityPercentage: 90 },
      returns: { oneYear: -8, threeYear: -5 },
    });
    const p = projectRedemption(losing, { amountRupees: 100_000, holdingMonths: 36 })!;

    expect(p.grossGain).toBeLessThan(0);
    expect(p.taxAmount).toBe(0);
    expect(p.notes.some((n) => /no gain/i.test(n))).toBe(true);
  });
});

describe('TAX_REGIME', () => {
  it('defines every bucket referenced by the classifier', () => {
    const buckets = [
      'equity',
      'debt',
      'hybrid',
      'commodity',
      'international',
      'unknown',
    ] as const;

    for (const bucket of buckets) {
      expect(TAX_REGIME.buckets[bucket]).toBeDefined();
      expect(TAX_REGIME.buckets[bucket].note).toBeTruthy();
    }
  });

  it('is dated, so a stale table can be spotted', () => {
    expect(TAX_REGIME.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
