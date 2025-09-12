// API Response Types based on Groww API

import { RiskLevel } from './mutualFund';

export interface GrowwScheme {
  id: string;
  fund_name: string;
  search_id: string;
  category: string;
  sub_category: string;
  aum: number;
  available_for_investment: number;
  return3y: number | null;
  return1y: number | null;
  return5y: number | null;
  groww_rating: number | null;
  risk_rating: number;
  scheme_name: string;
  scheme_type: string;
  fund_house: string;
  scheme_code: string; // Note: This is a string, not number!
  risk: RiskLevel;
  plan_type: string;
  amc: string;
  logo_url: string | null;
}

export interface GrowwSchemeResponse {
  total_results: number;
  content: GrowwScheme[];
}

export interface GrowwSchemeStatsResponse {
  asset_allocation: {
    equity: number;
    debt: number;
    cash: number;
  } | null;
  top_holdings: {
    top_twenty_corpusPer: number;
    top_five_corpus_per: number;
    top_ten_corpus_per: number;
  } | null;
  debt_sector_per: Record<string, number> | null;
  equity_sector_per: Record<string, number> | null;
  market_cap_per: Record<string, number> | null;
  rating_per: Record<string, number> | null;
  small_cap: number | null;
  mid_cap: number | null;
  large_cap: number | null;
  pe: number | null;
  pb: number | null;
  debt_per: number | null;
  equity_per: number | null;
  cash_per: number | null;
  average_maturity: number | null;
  modified_duration: number | null;
  yield_to_maturity: number | null;
  portfolio_turnover: number | null;
  aum: number | null;
  total_holdings: number | null;
  scheme_code: number; // This gets added by our code
}

export interface GrowwSearchResponse {
  // Basic scheme information
  search_id: string;
  scheme_name: string | null;
  fund_name: string | null;
  fund_house: string | null;
  fund_manager: string | null;
  amc: string | null;
  scheme_code: string | null;
  direct_scheme_code: string | null;

  // Fund characteristics
  category: string | null;
  sub_category: string | null;
  plan_type: string | null;
  scheme_type: string | null;

  // Financial metrics
  nav: number | null;
  aum: number | null;
  expense_ratio: number | null;
  exit_load: string | null;
  face_value: number | null;

  // Ratings and risk
  groww_rating: number | null;
  crisil_rating: string | null;

  // Complex objects
  stats: unknown | null;

  // Return stats array
  return_stats: Array<{
    scheme_code: string | null;
    return1m: number | null;
    return3m: number | null;
    return6m: number | null;
    return1y: number | null;
    return3y: number | null;
    return5y: number | null;
    return10y: number | null;
    return_default: number | null;
    mean_return: number | null;
    sharpe_ratio: number | null;
    beta: number | null;
    standard_deviation: number | null;
    risk_rating: number | null;
    risk: RiskLevel | null;
    return_since_created: number | null;
    cat_return3m: number | null;
    cat_return6m: number | null;
    cat_return1y: number | null;
    cat_return3y: number | null;
    cat_return5y: number | null;
    rank3m: number | null;
    rank6m: number | null;
    rank1yr: number | null;
    rank3yr: number | null;
    rank5yr: number | null;
    index_return1y: number | null;
    index_return3y: number | null;
    index_return5y: number | null;
    alpha: number | null;
    sortino_ratio: number | null;
    information_ratio: number | null;
    plan_id: string | null;
  }>;
}
