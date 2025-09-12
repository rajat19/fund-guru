export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Very High';
export type MutualFundCategory = 'Equity' | 'Debt' | 'Hybrid' | 'Commodities' | 'Others';

export interface MutualFund {
  id: string;
  schemeName: string;
  fundName: string;
  fundHouse: string;
  category: MutualFundCategory;
  subCategory: string;
  schemeCode: number;
  aum?: number;
  expenseRatio: number | null;
  logoUrl: string | null;
  
  // Basic fund information from search response
  searchId?: string;
  planType?: string | null;
  schemeType?: string | null;
  exitLoad?: string | null;
  
  returns: {
    oneMonth?: number | null;
    threeMonth?: number | null;
    sixMonth?: number | null;
    oneYear?: number | null;
    threeYear?: number | null;
    fiveYear?: number | null;
    tenYear?: number | null;
    sinceCreated?: number | null;
    default?: number | null;
  };
  ratios: {
    sharpeRatio?: number | null;
    sortinoRatio?: number | null;
    alpha?: number | null;
    beta?: number | null;
    informationRatio?: number | null;
    standardDeviation?: number | null;
    meanReturn?: number | null;
  };
  portfolioMetrics: {
    pe?: number | null;
    pb?: number | null;
    debtPercentage?: number | null;
    equityPercentage?: number | null;
    cashPercentage?: number | null;
    yieldToMaturity?: number | null;
    portfolioTurnover?: number | null;
    totalHoldings?: number | null;
  };
  rankings: {
    rank3m?: number | null;
    rank6m?: number | null;
    rank1y?: number | null;
    rank3y?: number | null;
    rank5y?: number | null;
  };
  categoryReturns: {
    cat3m?: number | null;
    cat6m?: number | null;
    cat1y?: number | null;
    cat3y?: number | null;
    cat5y?: number | null;
  };
  indexReturns: {
    index1y?: number | null;
    index3y?: number | null;
    index5y?: number | null;
  };
  riskMetrics: {
    riskRating?: number;
    risk?: RiskLevel;
  };
  ratings: {
    growwRating?: number | null;
    crisilRating?: string | null;
  };
  sectors: {
    debtSectors?: Record<string, number> | null;
    equitySectors?: Record<string, number> | null;
  };
  lastUpdated?: Date;
}

// Alias for backward compatibility during transition
export type ProcessedMutualFundData = MutualFund;
