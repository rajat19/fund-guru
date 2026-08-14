import { MutualFund, RiskLevel } from '@/types/mutualFund';
import { toNumber, type NumericLike } from '@/utils/number';
import { trackRecordOf, type TrackRecord } from '@/utils/trackRecord';

/**
 * Scoring model
 * -------------
 * Every metric is converted to a *percentile within the fund's own peer group*
 * (sub-category where available, category otherwise) before being weighted.
 *
 * This matters for three reasons:
 *
 *  1. Units stop mattering. A 3Y CAGR in percent, a Sharpe ratio around 1, and
 *     an expense ratio in percent are not addable quantities. Percentiles are.
 *  2. Categories stop competing unfairly. A small-cap fund returning 22% and a
 *     liquid fund returning 7% can both be top-decile *for what they are*.
 *  3. Weights become interpretable. With every input on a 0-100 scale and the
 *     weights summing to 1, the output is a 0-100 score and a weight of 0.20
 *     genuinely means "20% of the decision".
 *
 * Funds missing a metric are scored on the metrics they do have, with weights
 * renormalised over what was available — see `coverage` on ScoreBreakdown.
 */

export interface ScoringWeights {
  returns: {
    sixMonth: number;
    oneYear: number;
    threeYear: number;
    fiveYear: number;
  };
  expenseRatio: number;
  sharpeRatio: number;
  sortinoRatio: number;
  alpha: number;
  informationRatio: number;
  /** How far the fund beat its own category average, averaged over 1Y/3Y/5Y. */
  categoryOutperformance: number;
  /** Stability of the fund's category rank across 1Y/3Y/5Y. */
  consistency: number;
  /**
   * Strength of the risk tilt. Applied as a multiplier *after* the weighted
   * percentile sum, so it is deliberately NOT part of the weight sum.
   * 0 ignores risk entirely; 0.1 gives a +/-10% swing between the safest and
   * riskiest buckets.
   */
  riskAdjustment: number;
}

/**
 * Long horizons carry most of the weight on purpose. Trailing 6M and 1Y
 * numbers are extremely sensitive to the start date, and ranking on them
 * produces a list of whatever ran hot recently rather than what has compounded.
 */
export const defaultWeights: ScoringWeights = {
  returns: {
    sixMonth: 0.05,
    oneYear: 0.1,
    threeYear: 0.2,
    fiveYear: 0.2,
  },
  expenseRatio: 0.1,
  sharpeRatio: 0.1,
  sortinoRatio: 0.05,
  alpha: 0.05,
  informationRatio: 0.05,
  categoryOutperformance: 0.05,
  consistency: 0.05,
  riskAdjustment: 0.1,
};

/**
 * Risk tilt per SEBI riskometer bucket. Positive favours lower risk.
 *
 * Note this mostly affects *cross-category* comparison: every small-cap fund is
 * 'Very High', so within that peer group the tilt is uniform and cancels out of
 * the ranking. That is the intended behaviour.
 */
const RISK_TILT: Record<RiskLevel, number> = {
  Low: 1,
  Moderate: 0.5,
  High: -0.5,
  'Very High': -1,
};

export type MetricKey =
  | 'sixMonth'
  | 'oneYear'
  | 'threeYear'
  | 'fiveYear'
  | 'expenseRatio'
  | 'sharpeRatio'
  | 'sortinoRatio'
  | 'alpha'
  | 'informationRatio'
  | 'categoryOutperformance'
  | 'consistency';

interface MetricDef {
  key: MetricKey;
  label: string;
  /** Returns null when the fund has no usable value for this metric. */
  extract: (fund: MutualFund) => number | null;
  /** True when a lower raw value is the better outcome. */
  lowerIsBetter?: boolean;
  weightOf: (weights: ScoringWeights) => number;
}

const mean = (values: number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

const stdDev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
};

/**
 * Coerces a feed value to a usable number, or null.
 *
 * Not just a null check: the feed also emits numeric strings, and a string
 * flowing into the percentile comparisons would sort lexically ("9" > "10")
 * rather than numerically, which is worse than crashing because it is silent.
 */
const usable = (value: NumericLike): number | null => toNumber(value);

/**
 * Average excess return over the fund's own category, across whichever of
 * 1Y/3Y/5Y have both sides populated.
 */
const categoryExcess = (fund: MutualFund): number | null => {
  const pairs: Array<[number | null | undefined, number | null | undefined]> = [
    [fund.returns.oneYear, fund.categoryReturns.cat1y],
    [fund.returns.threeYear, fund.categoryReturns.cat3y],
    [fund.returns.fiveYear, fund.categoryReturns.cat5y],
  ];

  const excesses = pairs
    .map(([fundReturn, catReturn]) => {
      const f = usable(fundReturn);
      const c = usable(catReturn);
      return f == null || c == null ? null : f - c;
    })
    .filter((v): v is number => v != null);

  return excesses.length > 0 ? mean(excesses) : null;
};

/**
 * Rank stability across horizons. We return the *negative* standard deviation
 * of the fund's category ranks so that higher is better, consistent with every
 * other metric.
 *
 * This deliberately measures stability, not level — a fund parked at rank 200
 * every year scores well here. The returns terms are what capture level; this
 * term exists to stop a single hot year from carrying a fund to the top.
 */
const rankConsistency = (fund: MutualFund): number | null => {
  const ranks = [fund.rankings.rank1y, fund.rankings.rank3y, fund.rankings.rank5y]
    .map(usable)
    .filter((v): v is number => v != null);

  return ranks.length >= 2 ? -stdDev(ranks) : null;
};

const METRICS: MetricDef[] = [
  {
    key: 'sixMonth',
    label: '6M return',
    extract: (f) => usable(f.returns.sixMonth),
    weightOf: (w) => w.returns.sixMonth,
  },
  {
    key: 'oneYear',
    label: '1Y return',
    extract: (f) => usable(f.returns.oneYear),
    weightOf: (w) => w.returns.oneYear,
  },
  {
    key: 'threeYear',
    label: '3Y return',
    extract: (f) => usable(f.returns.threeYear),
    weightOf: (w) => w.returns.threeYear,
  },
  {
    key: 'fiveYear',
    label: '5Y return',
    extract: (f) => usable(f.returns.fiveYear),
    weightOf: (w) => w.returns.fiveYear,
  },
  {
    key: 'expenseRatio',
    label: 'Expense ratio',
    extract: (f) => usable(f.expenseRatio),
    lowerIsBetter: true,
    weightOf: (w) => w.expenseRatio,
  },
  {
    key: 'sharpeRatio',
    label: 'Sharpe ratio',
    extract: (f) => usable(f.ratios.sharpeRatio),
    weightOf: (w) => w.sharpeRatio,
  },
  {
    key: 'sortinoRatio',
    label: 'Sortino ratio',
    extract: (f) => usable(f.ratios.sortinoRatio),
    weightOf: (w) => w.sortinoRatio,
  },
  {
    key: 'alpha',
    label: 'Alpha',
    extract: (f) => usable(f.ratios.alpha),
    weightOf: (w) => w.alpha,
  },
  {
    key: 'informationRatio',
    label: 'Information ratio',
    extract: (f) => usable(f.ratios.informationRatio),
    weightOf: (w) => w.informationRatio,
  },
  {
    key: 'categoryOutperformance',
    label: 'Beat category',
    extract: categoryExcess,
    weightOf: (w) => w.categoryOutperformance,
  },
  {
    key: 'consistency',
    label: 'Rank consistency',
    extract: rankConsistency,
    weightOf: (w) => w.consistency,
  },
];

export const METRIC_LABELS: Record<MetricKey, string> = METRICS.reduce(
  (acc, metric) => {
    acc[metric.key] = metric.label;
    return acc;
  },
  {} as Record<MetricKey, string>,
);

/**
 * Peer group key. Sub-category is what actually makes funds comparable
 * ('Small Cap Fund' vs 'Liquid Fund'); category is the fallback when the feed
 * did not give us one.
 */
export const peerGroupKey = (fund: MutualFund): string =>
  (fund.subCategory && fund.subCategory.trim()) || fund.category || 'Others';

/** Sorted ascending values per metric, per peer group. */
type PeerDistributions = Map<string, Partial<Record<MetricKey, number[]>>>;

export interface ScoringContext {
  weights: ScoringWeights;
  distributions: PeerDistributions;
  /** Number of funds seen per peer group, for reporting. */
  peerCounts: Map<string, number>;
}

/**
 * Neutral percentile. A metric we cannot measure is assumed average rather than
 * ignored — see the coverage discussion on `scoreFund`.
 */
const NEUTRAL_PERCENTILE = 50;

/**
 * Minimum share of total weight a fund must have data for before it appears in
 * a curated ranking (dashboard tiles, shortlists, "top N" lists).
 *
 * Shrinkage alone already stops thin funds from topping a list, but a brand-new
 * scheme with nothing but an expense ratio has no meaningful ranking at all, and
 * showing it a score implies otherwise. It stays visible in the explorer, which
 * is a browse surface, not a recommendation surface.
 */
export const MIN_RANKING_COVERAGE = 0.4;

/**
 * Peer groups smaller than this make percentiles meaningless — being "top 33%"
 * of three funds says nothing. Treated as reduced confidence.
 */
const MIN_MEANINGFUL_PEER_COUNT = 5;

export interface ScoreBreakdown {
  /**
   * The ranking number, 0-100. Coverage-shrunk and risk-tilted.
   */
  score: number;
  /**
   * Score over the metrics that actually had data, before shrinkage and before
   * the risk tilt. This is "how good does it look on what we can see" — useful
   * to display, dangerous to rank on.
   */
  measuredScore: number;
  /** Per-metric percentile within peer group. Missing metrics are absent. */
  percentiles: Partial<Record<MetricKey, number>>;
  /** Fraction of total weight that had data behind it (0-1). */
  coverage: number;
  /**
   * How much of `measuredScore`'s distance from neutral survived shrinkage
   * (0-1). Combines coverage with peer-group size.
   */
  confidence: number;
  /** Whether this fund has enough data to belong in a curated ranking. */
  hasSufficientData: boolean;
  /** How much history the fund has, and where that figure came from. */
  trackRecord: TrackRecord;
  peerGroup: string;
  peerCount: number;
}

/** Index of the first element >= value in a sorted ascending array. */
const lowerBound = (sorted: number[], value: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Index of the first element > value in a sorted ascending array. */
const upperBound = (sorted: number[], value: number): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * Percentile of `value` within `sorted`, on 0-100, splitting ties so that a
 * value equal to every peer lands at 50 rather than 0 or 100.
 */
export const percentileRank = (sorted: number[], value: number): number => {
  if (sorted.length <= 1) return 50;
  const below = lowerBound(sorted, value);
  const atOrBelow = upperBound(sorted, value);
  const ties = atOrBelow - below;
  return ((below + ties / 2) / sorted.length) * 100;
};

/**
 * Precompute peer distributions once for the whole universe. Build this from
 * the *unfiltered* fund list — if you build it from a filtered list the
 * percentiles shift every time the user changes a filter.
 */
export const buildScoringContext = (
  funds: MutualFund[],
  weights: ScoringWeights = defaultWeights,
): ScoringContext => {
  const distributions: PeerDistributions = new Map();
  const peerCounts = new Map<string, number>();

  for (const fund of funds) {
    const key = peerGroupKey(fund);
    peerCounts.set(key, (peerCounts.get(key) ?? 0) + 1);

    let group = distributions.get(key);
    if (!group) {
      group = {};
      distributions.set(key, group);
    }

    for (const metric of METRICS) {
      const value = metric.extract(fund);
      if (value == null) continue;
      const bucket = group[metric.key] ?? (group[metric.key] = []);
      bucket.push(value);
    }
  }

  for (const group of distributions.values()) {
    for (const values of Object.values(group)) {
      values?.sort((a, b) => a - b);
    }
  }

  return { weights, distributions, peerCounts };
};

/**
 * Score a single fund against a prebuilt context.
 *
 * Missing data and coverage
 * -------------------------
 * Renormalising purely over available weight — scoring a fund only on what it
 * has — sounds fair but creates a perverse incentive: a brand-new passive
 * fund-of-fund with no return history and a 0.06% expense ratio would score in
 * the high 90s off a single metric, outranking a fund with a decade of
 * top-quartile results. Less data produced a *better* score, because the metrics
 * that would have dragged it down simply were not counted.
 *
 * So an unmeasurable metric is treated as **average**, not absent: the score is
 * shrunk toward the neutral 50 in proportion to how little is known. Concretely
 *
 *     score = measuredScore * confidence + 50 * (1 - confidence)
 *
 * which is equivalent to imputing the neutral percentile for every metric with
 * no data. A fund with full coverage is unaffected. A fund with 10% coverage
 * lands near 50 no matter how good that 10% looks — which is the honest answer,
 * since we have almost no evidence either way.
 *
 * Confidence also accounts for peer-group size, because "top third of three
 * funds" is not information.
 */
export const scoreFund = (fund: MutualFund, context: ScoringContext): ScoreBreakdown => {
  const { weights, distributions, peerCounts } = context;
  const key = peerGroupKey(fund);
  const group = distributions.get(key) ?? {};
  const peerCount = peerCounts.get(key) ?? 0;

  const percentiles: Partial<Record<MetricKey, number>> = {};
  let weightedSum = 0;
  let usedWeight = 0;
  let totalWeight = 0;

  for (const metric of METRICS) {
    const weight = metric.weightOf(weights);
    totalWeight += weight;
    if (weight === 0) continue;

    const value = metric.extract(fund);
    const distribution = group[metric.key];
    if (value == null || !distribution || distribution.length === 0) continue;

    const raw = percentileRank(distribution, value);
    const percentile = metric.lowerIsBetter ? 100 - raw : raw;

    percentiles[metric.key] = percentile;
    weightedSum += percentile * weight;
    usedWeight += weight;
  }

  const measuredScore = usedWeight > 0 ? weightedSum / usedWeight : NEUTRAL_PERCENTILE;
  const coverage = totalWeight > 0 ? usedWeight / totalWeight : 0;

  // A group of 1 gives percentileRank no signal at all; below the threshold,
  // scale confidence down proportionally rather than cutting off sharply.
  const peerConfidence = Math.min(1, peerCount / MIN_MEANINGFUL_PEER_COUNT);
  const confidence = coverage * peerConfidence;

  const track = trackRecordOf(fund);

  const shrunk = measuredScore * confidence + NEUTRAL_PERCENTILE * (1 - confidence);

  const tilt = RISK_TILT[fund.riskMetrics.risk ?? 'Moderate'] ?? 0;
  const score = shrunk * (1 + weights.riskAdjustment * tilt);

  return {
    score: Math.round(Math.max(0, Math.min(100, score)) * 100) / 100,
    measuredScore: Math.round(measuredScore * 100) / 100,
    percentiles,
    coverage,
    confidence,
    // Track record is an independent gate: a fund can have decent coverage on
    // short-horizon metrics and still be too young to judge.
    hasSufficientData:
      coverage >= MIN_RANKING_COVERAGE && peerCount >= 2 && !track.isNew,
    trackRecord: track,
    peerGroup: key,
    peerCount,
  };
};

/**
 * Convenience wrapper for scoring one fund against one universe. Prefer
 * `buildScoringContext` + `scoreFund` when scoring many funds — this rebuilds
 * the peer distributions on every call.
 */
export const calculateFundScore = (
  fund: MutualFund,
  universe: MutualFund[],
  weights: ScoringWeights = defaultWeights,
): number => scoreFund(fund, buildScoringContext(universe, weights)).score;

export type ScoredFund = MutualFund & {
  score: number;
  rank: number;
  breakdown: ScoreBreakdown;
};

export interface RankOptions {
  /**
   * Include funds below MIN_RANKING_COVERAGE. Default false, because a fund with
   * only an expense ratio has no meaningful ranking and showing it one implies
   * otherwise. Set true for browse surfaces like the explorer, where hiding
   * funds outright would be more confusing than flagging them.
   */
  includeInsufficientData?: boolean;
}

export const rankFundsWithContext = (
  funds: MutualFund[],
  context: ScoringContext,
  options: RankOptions = {},
): ScoredFund[] =>
  funds
    .map((fund) => {
      const breakdown = scoreFund(fund, context);
      return { ...fund, score: breakdown.score, breakdown, rank: 0 };
    })
    .filter((fund) => options.includeInsufficientData || fund.breakdown.hasSufficientData)
    .sort((a, b) => b.score - a.score || a.schemeName.localeCompare(b.schemeName))
    .map((fund, index) => ({ ...fund, rank: index + 1 }));

/**
 * Rank `funds` using peer distributions from `universe`.
 *
 * Pass the full fund list as `universe` and a subset as `funds` to rank a
 * filtered view without distorting the percentiles.
 */
export const rankFunds = (
  funds: MutualFund[],
  universe: MutualFund[] = funds,
  weights: ScoringWeights = defaultWeights,
  options: RankOptions = {},
): ScoredFund[] =>
  rankFundsWithContext(funds, buildScoringContext(universe, weights), options);

export const getTopFundsByCategory = (
  funds: MutualFund[],
  category: MutualFund['category'],
  limit = 3,
  weights: ScoringWeights = defaultWeights,
): ScoredFund[] => {
  const context = buildScoringContext(funds, weights);
  const categoryFunds = funds.filter((fund) => fund.category === category);
  return rankFundsWithContext(categoryFunds, context).slice(0, limit);
};

/** Risk buckets a user with a given tolerance is willing to hold. */
const ALLOWED_RISK: Record<RiskLevel, RiskLevel[]> = {
  Low: ['Low'],
  Moderate: ['Low', 'Moderate'],
  High: ['Low', 'Moderate', 'High'],
  'Very High': ['Low', 'Moderate', 'High', 'Very High'],
};

export type ShortlistedFund = ScoredFund & { reason: string };

/**
 * Funds from `funds` that fit `riskTolerance`, ranked. Named "shortlist"
 * rather than "recommendations" deliberately: this is a filter over public
 * data, not advice.
 */
export const shortlistFunds = (
  funds: MutualFund[],
  riskTolerance: RiskLevel,
  limit = 5,
  weights: ScoringWeights = defaultWeights,
): ShortlistedFund[] => {
  const context = buildScoringContext(funds, weights);
  const allowed = new Set(ALLOWED_RISK[riskTolerance] ?? ALLOWED_RISK['Very High']);

  const eligible = funds.filter((fund) => {
    const risk = fund.riskMetrics.risk;
    // Funds with no riskometer reading are kept only for the widest tolerance.
    if (!risk) return riskTolerance === 'Very High';
    return allowed.has(risk);
  });

  return rankFundsWithContext(eligible, context)
    .slice(0, limit)
    .map((fund) => ({ ...fund, reason: describeStrengths(fund) }));
};

/**
 * Describes *why* a fund ranked where it did, using its own percentiles rather
 * than hardcoded thresholds — a 12% return means something very different in a
 * liquid fund than in a small-cap fund.
 */
export const describeStrengths = (fund: ScoredFund, limit = 3): string => {
  if (!fund.breakdown.hasSufficientData) {
    return `Too little data to judge — only ${Math.round(fund.breakdown.coverage * 100)}% of the scored metrics are available`;
  }

  const strengths = Object.entries(fund.breakdown.percentiles)
    .filter(([, percentile]) => percentile >= 75)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key, percentile]) => {
      const label = METRIC_LABELS[key as MetricKey];
      return `${label} in the top ${Math.max(1, Math.round(100 - percentile))}% of ${fund.breakdown.peerGroup}`;
    });

  if (strengths.length === 0) {
    return `Middle of the pack across ${fund.breakdown.peerGroup} on every tracked metric`;
  }

  return strengths.join('; ');
};
