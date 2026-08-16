/**
 * Portfolio holdings, kept in a separate published file from funds.json.
 *
 * Two reasons for the split. Holdings roughly double the dataset (~2.8 MB raw
 * for the top 20 per fund on top of a 2.6 MB fund file), and almost nothing
 * needs them — only overlap analysis in the investment builder does. Shipping
 * them inside the main dataset would slow every first page load to serve a
 * feature most visits never reach.
 */

export interface Holding {
  /** Company name as reported in the scheme portfolio. */
  name: string;
  /** Stable slug from the feed. Preferred join key across funds. */
  id: string | null;
  sector: string | null;
  /** Share of the fund's corpus, in percent. */
  percent: number;
}

export interface FundHoldings {
  schemeCode: number;
  /** Portfolio disclosure date, ISO. Holdings are a monthly snapshot. */
  portfolioDate: string | null;
  /** Top holdings by corpus share, capped at TOP_HOLDINGS_LIMIT. */
  holdings: Holding[];
}

export interface HoldingsDataset {
  generatedAt: string;
  count: number;
  /** Keyed by scheme code, as a string because JSON object keys are strings. */
  funds: Record<string, FundHoldings>;
}


export const HOLDINGS_PATH = 'data/holdings.json';

/**
 * Only the top 20 are stored. Measured against live data, the top 20 account for
 * 80-99% of a fund's corpus, which is ample for judging whether two funds are
 * the same bet, and it bounds the file size.
 */
export const TOP_HOLDINGS_LIMIT = 20;

export const isHoldingsDataset = (value: unknown): value is HoldingsDataset =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as HoldingsDataset).generatedAt === 'string' &&
  typeof (value as HoldingsDataset).funds === 'object' &&
  (value as HoldingsDataset).funds !== null;
