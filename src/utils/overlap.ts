import { MutualFund } from '@/types/mutualFund';
import { FundHoldings, Holding } from '@/types/holdings';

/**
 * Portfolio overlap between two funds.
 *
 * This is the measure that exposes the most common false diversification in
 * Indian mutual fund portfolios: five top-ranked large-cap funds are five
 * different products holding largely the same twenty stocks. Owning all five
 * feels diversified and is not.
 *
 * The metric is the standard weighted overlap — for every holding the two funds
 * share, take the smaller of the two weights, and sum:
 *
 *     overlap = Σ min(weight_A(stock), weight_B(stock))
 *
 * Two identical portfolios give 100; two with nothing in common give 0. It is
 * symmetric, and unlike a plain count of shared names it accounts for position
 * size — sharing a 9% position matters far more than sharing a 0.2% one.
 */

export type HoldingsIndex = Map<number, FundHoldings>;

export const buildHoldingsIndex = (
  funds: Record<string, FundHoldings> | undefined | null,
): HoldingsIndex => {
  const index: HoldingsIndex = new Map();
  if (!funds) return index;

  for (const entry of Object.values(funds)) {
    if (entry && Number.isFinite(entry.schemeCode)) index.set(entry.schemeCode, entry);
  }
  return index;
};

/**
 * Join key for a holding.
 *
 * Prefers the feed's slug, since company names are not written consistently
 * across AMCs ("HDFC Bank Ltd" vs "HDFC Bank Limited"). Falls back to a
 * normalised name so a missing slug does not silently drop the position.
 */
const holdingKey = (holding: Holding): string =>
  holding.id?.trim().toLowerCase() ||
  holding.name
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|corp|co|plc)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Cash and cash-equivalents are not a shared bet and must not count as overlap. */
const isInvestable = (holding: Holding): boolean => {
  const key = holdingKey(holding);
  if (!key) return false;
  return !/^(cash|treps|trep|reverserepo|repo|netreceivables|netcurrentassets|margin)/.test(key);
};

const weightsOf = (entry: FundHoldings | undefined): Map<string, number> => {
  const weights = new Map<string, number>();
  if (!entry) return weights;

  for (const holding of entry.holdings) {
    if (!isInvestable(holding)) continue;
    const percent = typeof holding.percent === 'number' ? holding.percent : Number(holding.percent);
    if (!Number.isFinite(percent) || percent <= 0) continue;

    const key = holdingKey(holding);
    // A fund can list the same issuer twice across instruments; sum them.
    weights.set(key, (weights.get(key) ?? 0) + percent);
  }

  return weights;
};

/**
 * Weighted overlap in percent, or null when either fund has no holdings data.
 *
 * Null rather than zero is deliberate: "we do not know" and "these funds share
 * nothing" are opposite conclusions, and conflating them would let the builder
 * treat unknown pairs as safely diversified.
 */
export const overlapPercent = (
  a: MutualFund,
  b: MutualFund,
  index: HoldingsIndex,
): number | null => {
  if (a.schemeCode === b.schemeCode) return 100;

  const weightsA = weightsOf(index.get(a.schemeCode));
  const weightsB = weightsOf(index.get(b.schemeCode));

  if (weightsA.size === 0 || weightsB.size === 0) return null;

  let shared = 0;
  // Iterate the smaller map; the result is symmetric either way.
  const [small, large] = weightsA.size <= weightsB.size ? [weightsA, weightsB] : [weightsB, weightsA];

  for (const [key, weight] of small) {
    const other = large.get(key);
    if (other != null) shared += Math.min(weight, other);
  }

  return Math.round(shared * 10) / 10;
};

export interface OverlapPair {
  a: MutualFund;
  b: MutualFund;
  percent: number;
}

/** Every pair with known overlap, worst first. */
export const overlapMatrix = (funds: MutualFund[], index: HoldingsIndex): OverlapPair[] => {
  const pairs: OverlapPair[] = [];

  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const percent = overlapPercent(funds[i], funds[j], index);
      if (percent == null) continue;
      pairs.push({ a: funds[i], b: funds[j], percent });
    }
  }

  return pairs.sort((x, y) => y.percent - x.percent);
};

/** Names shared between two funds, largest combined position first. */
export const sharedHoldings = (
  a: MutualFund,
  b: MutualFund,
  index: HoldingsIndex,
  limit = 5,
): Array<{ name: string; percentA: number; percentB: number }> => {
  const entryA = index.get(a.schemeCode);
  const entryB = index.get(b.schemeCode);
  if (!entryA || !entryB) return [];

  const byKeyB = new Map(
    entryB.holdings.filter(isInvestable).map((h) => [holdingKey(h), h] as const),
  );

  return entryA.holdings
    .filter(isInvestable)
    .map((h) => {
      const match = byKeyB.get(holdingKey(h));
      return match ? { name: h.name, percentA: h.percent, percentB: match.percent } : null;
    })
    .filter((x): x is { name: string; percentA: number; percentB: number } => x !== null)
    .sort((x, y) => Math.min(y.percentA, y.percentB) - Math.min(x.percentA, x.percentB))
    .slice(0, limit);
};

export const describeOverlap = (percent: number): string => {
  if (percent >= 70) return 'Near-duplicate — largely the same portfolio';
  if (percent >= 50) return 'High — these are substantially the same bet';
  if (percent >= 30) return 'Moderate — meaningful common ground';
  if (percent >= 15) return 'Low';
  return 'Minimal';
};
