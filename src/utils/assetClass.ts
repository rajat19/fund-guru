import { MutualFund } from '@/types/mutualFund';
import { classifyTaxBucket } from '@/utils/taxation';

/**
 * Asset classes as an investor thinks about them when splitting money.
 *
 * Deliberately not the same as the tax buckets. Tax cares whether a scheme is
 * equity-oriented (>=65% equity); allocation cares what role the money plays in
 * a portfolio. An aggressive hybrid fund is equity-oriented for tax but is a
 * hybrid holding for allocation purposes, and an international equity fund is
 * debt-taxed but is still equity exposure.
 */
export type AssetClass = 'equity' | 'debt' | 'hybrid' | 'gold' | 'international';

export const ASSET_CLASSES: AssetClass[] = [
  'equity',
  'debt',
  'hybrid',
  'gold',
  'international',
];

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equity: 'Equity',
  debt: 'Debt',
  hybrid: 'Hybrid',
  gold: 'Gold & commodities',
  international: 'International',
};

export const classifyAssetClass = (fund: MutualFund): AssetClass => {
  const taxBucket = classifyTaxBucket(fund);

  // Gold and international are identified by name/category in the tax
  // classifier, and that identification is what matters here too.
  if (taxBucket === 'commodity') return 'gold';
  if (taxBucket === 'international') return 'international';

  switch (fund.category) {
    case 'Equity':
      return 'equity';
    case 'Debt':
      return 'debt';
    case 'Hybrid':
      return 'hybrid';
    case 'Commodities':
      return 'gold';
    default:
      // Solution-oriented and unclassified schemes: fall back to allocation.
      return taxBucket === 'equity' ? 'equity' : taxBucket === 'debt' ? 'debt' : 'hybrid';
  }
};

export type AssetAllocation = Partial<Record<AssetClass, number>>;

/**
 * Starting splits by risk appetite.
 *
 * These are conventional reference points, not advice — the builder lets the
 * user override every number, and the UI presents them as starting points.
 */
export const ALLOCATION_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  allocation: AssetAllocation;
}> = [
  {
    id: 'conservative',
    label: 'Conservative',
    description: 'Capital preservation first. Most of the money in debt.',
    allocation: { equity: 25, debt: 65, gold: 10 },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Growth with a meaningful cushion.',
    allocation: { equity: 55, debt: 35, gold: 10 },
  },
  {
    id: 'growth',
    label: 'Growth',
    description: 'Long horizon, tolerant of drawdowns.',
    allocation: { equity: 75, debt: 15, gold: 10 },
  },
  {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Maximum equity exposure, minimal ballast.',
    allocation: { equity: 90, debt: 5, gold: 5 },
  },
];

/** Normalise weights to sum to 100, dropping zero and negative entries. */
export const normaliseAllocation = (allocation: AssetAllocation): AssetAllocation => {
  const entries = Object.entries(allocation).filter(
    ([, weight]) => typeof weight === 'number' && weight > 0,
  ) as Array<[AssetClass, number]>;

  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total === 0) return {};

  return Object.fromEntries(
    entries.map(([cls, weight]) => [cls, (weight / total) * 100]),
  ) as AssetAllocation;
};
