/**
 * Plain-English explanations for the metrics shown in comparisons.
 *
 * `direction` is deliberately three-valued. Most metrics have a better end, but
 * beta and AUM genuinely do not: a low-beta fund is not better than a high-beta
 * one, it is a different exposure, and a large AUM buys liquidity in a large-cap
 * fund while actively hampering a small-cap fund's ability to execute its
 * mandate. Labelling those "higher is better" would be the kind of confident
 * wrongness this app is trying to avoid.
 */

export type MetricDirection = 'higher' | 'lower' | 'depends';

export interface MetricInfo {
  label: string;
  direction: MetricDirection;
  /** One or two sentences. Shown in a tooltip, so brevity matters. */
  description: string;
}

export const DIRECTION_LABEL: Record<MetricDirection, string> = {
  higher: 'Higher is better',
  lower: 'Lower is better',
  depends: 'Neither is better — depends what you want',
};

const RETURN_NOTE =
  'Already net of the expense ratio, since fees come out of NAV daily.';

export const METRIC_INFO: Record<string, MetricInfo> = {
  oneYear: {
    label: '1 Year Return',
    direction: 'higher',
    description: `Return over the last 12 months. Very sensitive to the start date, so a strong number here is weak evidence on its own. ${RETURN_NOTE}`,
  },
  threeYear: {
    label: '3 Year Return',
    direction: 'higher',
    description: `Annualised return (CAGR) over three years, not the total. More reliable than 1Y because it usually spans at least one drawdown. ${RETURN_NOTE}`,
  },
  fiveYear: {
    label: '5 Year Return',
    direction: 'higher',
    description: `Annualised return (CAGR) over five years. Long enough to cover a full market cycle. ${RETURN_NOTE}`,
  },
  tenYear: {
    label: '10 Year Return',
    direction: 'higher',
    description: `Annualised return (CAGR) over ten years, spanning multiple cycles. ${RETURN_NOTE}`,
  },
  expenseRatio: {
    label: 'Expense Ratio',
    direction: 'lower',
    description:
      'Annual fee as a percentage of your investment, deducted from NAV a little each day. The only number here that is guaranteed rather than historical — a 1% fee costs 1% every year regardless of performance.',
  },
  sharpeRatio: {
    label: 'Sharpe Ratio',
    direction: 'higher',
    description:
      'Return earned per unit of total volatility, above the risk-free rate. Answers "was the bumpy ride worth it?". Above 1 is generally considered good, but only compare within the same category.',
  },
  sortinoRatio: {
    label: 'Sortino Ratio',
    direction: 'higher',
    description:
      'Like Sharpe, but only counts downside volatility. Often the more relevant of the two, since upside swings are not a problem you need compensating for.',
  },
  alpha: {
    label: 'Alpha',
    direction: 'higher',
    description:
      'Return above what the benchmark and the fund’s market exposure explain — the part attributable to the manager. Negative alpha means an index fund would have done better for the risk taken.',
  },
  beta: {
    label: 'Beta',
    direction: 'depends',
    description:
      'How much the fund moves when the market moves. 1.0 tracks the market; 1.2 amplifies both gains and falls by ~20%; 0.8 dampens both. Not good or bad — pick the exposure you actually want.',
  },
  standardDeviation: {
    label: 'Std Deviation',
    direction: 'depends',
    description:
      'How much returns vary around their average. Higher means a bumpier ride, which is fine if you are compensated for it — check Sharpe alongside this.',
  },
  informationRatio: {
    label: 'Information Ratio',
    direction: 'higher',
    description:
      'How consistently the fund beats its benchmark, not just by how much. Rewards steady outperformance over a single lucky year.',
  },
  aum: {
    label: 'AUM',
    direction: 'depends',
    description:
      'Total money the fund manages, in crore. Large AUM brings liquidity and stability, but in small- and mid-cap funds it can make the mandate harder to execute. Not a quality signal either way.',
  },
};

export const metricInfoFor = (key: string): MetricInfo | undefined => METRIC_INFO[key];
