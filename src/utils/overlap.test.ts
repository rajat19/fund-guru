import { describe, expect, it } from 'vitest';
import {
  buildHoldingsIndex,
  describeOverlap,
  overlapMatrix,
  overlapPercent,
  sharedHoldings,
} from '@/utils/overlap';
import { makeFund } from '@/utils/__fixtures__/fund';
import type { Holding } from '@/types/holdings';

const holding = (name: string, percent: number, id?: string | null): Holding => ({
  name,
  id: id === undefined ? name.toLowerCase().replace(/\s+/g, '-') : id,
  sector: null,
  percent,
});

const index = (entries: Record<number, Holding[]>) =>
  buildHoldingsIndex(
    Object.fromEntries(
      Object.entries(entries).map(([code, holdings]) => [
        code,
        { schemeCode: Number(code), portfolioDate: null, holdings },
      ]),
    ),
  );

const fundWith = (schemeCode: number) => makeFund({ id: `f${schemeCode}`, schemeCode });

describe('overlapPercent', () => {
  it('reports 100 for identical portfolios', () => {
    const holdings = [holding('HDFC Bank Ltd', 50), holding('Infosys Ltd', 50)];
    const idx = index({ 1: holdings, 2: holdings });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(100);
  });

  it('reports 0 for portfolios with nothing in common', () => {
    const idx = index({
      1: [holding('HDFC Bank Ltd', 100)],
      2: [holding('Infosys Ltd', 100)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(0);
  });

  it('takes the smaller weight for each shared name', () => {
    // Shared: A at min(60,20)=20, B at min(40,30)=30. Total 50.
    const idx = index({
      1: [holding('A Ltd', 60), holding('B Ltd', 40)],
      2: [holding('A Ltd', 20), holding('B Ltd', 30), holding('C Ltd', 50)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(50);
  });

  it('is symmetric', () => {
    const idx = index({
      1: [holding('A Ltd', 60), holding('B Ltd', 40)],
      2: [holding('A Ltd', 20), holding('C Ltd', 80)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(
      overlapPercent(fundWith(2), fundWith(1), idx),
    );
  });

  it('weights positions rather than counting names', () => {
    // Both pairs share exactly one name out of two, but the position sizes make
    // them very different bets — a plain count would call these identical.
    const heavy = index({
      1: [holding('A Ltd', 90), holding('X Ltd', 10)],
      2: [holding('A Ltd', 90), holding('Y Ltd', 10)],
    });
    const light = index({
      1: [holding('A Ltd', 10), holding('X Ltd', 90)],
      2: [holding('A Ltd', 10), holding('Y Ltd', 90)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), heavy)).toBe(90);
    expect(overlapPercent(fundWith(1), fundWith(2), light)).toBe(10);
  });

  it('returns null when either side has no holdings', () => {
    // Null, not zero: "unknown" and "shares nothing" are opposite conclusions,
    // and treating unknown as zero would let the builder call an unchecked pair
    // safely diversified.
    const idx = index({ 1: [holding('A Ltd', 100)] });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBeNull();
    expect(overlapPercent(fundWith(3), fundWith(4), idx)).toBeNull();
  });

  it('treats a fund as fully overlapping itself', () => {
    const idx = index({ 1: [holding('A Ltd', 100)] });
    expect(overlapPercent(fundWith(1), fundWith(1), idx)).toBe(100);
  });

  it('excludes cash and cash equivalents', () => {
    // Two funds both parking 40% in TREPS are not making the same equity bet.
    const idx = index({
      1: [holding('TREPS', 40, null), holding('A Ltd', 60)],
      2: [holding('TREPS', 40, null), holding('B Ltd', 60)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(0);
  });

  it('matches on the feed slug rather than the display name', () => {
    // AMCs write the same company differently.
    const idx = index({
      1: [{ ...holding('HDFC Bank Ltd', 100), id: 'hdfc-bank-ltd' }],
      2: [{ ...holding('HDFC Bank Limited', 100), id: 'hdfc-bank-ltd' }],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(100);
  });

  it('falls back to a normalised name when the slug is missing', () => {
    const idx = index({
      1: [holding('HDFC Bank Ltd', 100, null)],
      2: [holding('HDFC Bank Limited', 100, null)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(100);
  });

  it('sums duplicate entries for the same issuer', () => {
    const idx = index({
      1: [holding('A Ltd', 30), holding('A Ltd', 30), holding('B Ltd', 40)],
      2: [holding('A Ltd', 60)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(60);
  });

  it('ignores non-positive weights', () => {
    const idx = index({
      1: [holding('A Ltd', 0), holding('B Ltd', 100)],
      2: [holding('A Ltd', 50), holding('B Ltd', 50)],
    });

    expect(overlapPercent(fundWith(1), fundWith(2), idx)).toBe(50);
  });
});

describe('overlapMatrix', () => {
  it('returns every known pair, worst first', () => {
    const idx = index({
      1: [holding('A Ltd', 100)],
      2: [holding('A Ltd', 100)],
      3: [holding('A Ltd', 30), holding('B Ltd', 70)],
    });

    const pairs = overlapMatrix([fundWith(1), fundWith(2), fundWith(3)], idx);

    expect(pairs).toHaveLength(3);
    expect(pairs[0].percent).toBe(100);
    expect(pairs[pairs.length - 1].percent).toBe(30);
  });

  it('omits pairs whose overlap is unknown', () => {
    const idx = index({ 1: [holding('A Ltd', 100)], 2: [holding('A Ltd', 100)] });
    // Fund 3 has no holdings, so its two pairings are unknowable.
    expect(overlapMatrix([fundWith(1), fundWith(2), fundWith(3)], idx)).toHaveLength(1);
  });
});

describe('sharedHoldings', () => {
  it('lists shared names by the smaller position, largest first', () => {
    const idx = index({
      1: [holding('A Ltd', 10), holding('B Ltd', 40), holding('C Ltd', 50)],
      2: [holding('A Ltd', 30), holding('B Ltd', 35), holding('D Ltd', 35)],
    });

    const shared = sharedHoldings(fundWith(1), fundWith(2), idx);

    expect(shared.map((s) => s.name)).toEqual(['B Ltd', 'A Ltd']);
    expect(shared[0]).toMatchObject({ percentA: 40, percentB: 35 });
  });

  it('respects the limit and returns empty when data is missing', () => {
    const idx = index({
      1: [holding('A Ltd', 25), holding('B Ltd', 25), holding('C Ltd', 50)],
      2: [holding('A Ltd', 25), holding('B Ltd', 25), holding('C Ltd', 50)],
    });

    expect(sharedHoldings(fundWith(1), fundWith(2), idx, 2)).toHaveLength(2);
    expect(sharedHoldings(fundWith(1), fundWith(9), idx)).toEqual([]);
  });
});

describe('buildHoldingsIndex', () => {
  it('handles missing input', () => {
    expect(buildHoldingsIndex(undefined).size).toBe(0);
    expect(buildHoldingsIndex(null).size).toBe(0);
    expect(buildHoldingsIndex({}).size).toBe(0);
  });
});

describe('describeOverlap', () => {
  it('escalates the wording with the number', () => {
    expect(describeOverlap(85)).toMatch(/near-duplicate/i);
    expect(describeOverlap(60)).toMatch(/high/i);
    expect(describeOverlap(35)).toMatch(/moderate/i);
    expect(describeOverlap(5)).toMatch(/minimal/i);
  });
});
