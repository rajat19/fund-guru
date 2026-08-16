import { GrowwScheme, GrowwSchemeStatsResponse, GrowwSearchResponse } from '../types/api';
import { MutualFundCategory, RiskLevel, MutualFund } from '@/types/mutualFund';
import { toNumber, type NumericLike } from '@/utils/number';
import {
  TOP_HOLDINGS_LIMIT,
  type FundHoldings,
  type Holding,
} from '@/types/holdings';

/**
 * Coerce every numeric field on a fund to a real number or null.
 *
 * The upstream feed is not type-honest: `expense_ratio` in particular arrives as
 * a string, and older Firestore documents were written with whatever the feed
 * gave at the time. Normalising once here means the rest of the app can trust
 * the declared types instead of every consumer guarding individually.
 *
 * Applied on both ingest (processSchemeData) and read (sanitizeFundData), so
 * historical documents get repaired on the way out too.
 */
export function normalizeFundNumerics(fund: MutualFund): MutualFund {
  const num = (value: NumericLike) => toNumber(value);

  const mapGroup = <T extends Record<string, unknown>>(group: T | undefined): T =>
    Object.fromEntries(
      Object.entries(group ?? {}).map(([key, value]) => [key, num(value as NumericLike)]),
    ) as T;

  return {
    ...fund,
    aum: num(fund.aum) ?? undefined,
    expenseRatio: num(fund.expenseRatio),
    schemeCode: num(fund.schemeCode) ?? 0,
    minInvestment: num(fund.minInvestment),
    minSipInvestment: num(fund.minSipInvestment),
    lockInMonths: num(fund.lockInMonths),
    returns: mapGroup(fund.returns),
    ratios: mapGroup(fund.ratios),
    rankings: mapGroup(fund.rankings),
    categoryReturns: mapGroup(fund.categoryReturns),
    indexReturns: mapGroup(fund.indexReturns),
    // portfolioMetrics is numeric-only too, but sectors is Record<string, number>
    // maps and ratings holds crisilRating as a string, so both are left alone.
    portfolioMetrics: mapGroup(fund.portfolioMetrics),
    riskMetrics: {
      ...fund.riskMetrics,
      riskRating: num(fund.riskMetrics?.riskRating) ?? undefined,
    },
  };
}

/**
 * Collapse the feed's split lock-in object into months.
 *
 * All three parts are null for the majority of schemes, which means no lock-in
 * rather than zero months — but the two are equivalent downstream, so null is
 * returned to keep "not applicable" distinguishable from a real zero.
 */
export function lockInToMonths(
  lockIn: { years: number | null; months: number | null; days: number | null } | null | undefined,
): number | null {
  if (!lockIn) return null;

  const years = toNumber(lockIn.years) ?? 0;
  const months = toNumber(lockIn.months) ?? 0;
  const days = toNumber(lockIn.days) ?? 0;

  const total = years * 12 + months + days / 30.44;
  return total > 0 ? Math.round(total * 10) / 10 : null;
}

/**
 * Extract the top holdings by corpus share.
 *
 * Capped rather than complete: the top 20 cover 80-99% of a fund's corpus, which
 * is enough to tell whether two funds are the same bet, and storing all 30-50
 * would double the published dataset for no analytical gain.
 */
export function extractHoldings(
  schemeCode: number,
  searchData: GrowwSearchResponse | undefined,
): FundHoldings | null {
  const raw = searchData?.holdings;
  if (!raw || raw.length === 0) return null;

  const holdings: Holding[] = raw
    .map((h) => ({
      name: (h.company_name ?? '').trim(),
      id: h.stock_search_id ?? null,
      sector: h.sector_name ?? null,
      percent: toNumber(h.corpus_per) ?? 0,
    }))
    .filter((h) => h.name !== '' && h.percent > 0)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, TOP_HOLDINGS_LIMIT);

  if (holdings.length === 0) return null;

  return {
    schemeCode,
    portfolioDate: raw.find((h) => h.portfolio_date)?.portfolio_date ?? null,
    holdings,
  };
}

/**
 * Build the holdings dataset from search responses already fetched by the sync.
 *
 * Keyed by scheme code rather than scheme id, because that is what joins across
 * sources and what the app looks up by.
 */
export function collectHoldings(
  schemes: GrowwScheme[],
  searchData: Record<string, GrowwSearchResponse>,
): Record<string, FundHoldings> {
  const out: Record<string, FundHoldings> = {};

  for (const scheme of schemes) {
    const schemeCode = toNumber(scheme.scheme_code);
    if (schemeCode == null) continue;

    const entry = extractHoldings(schemeCode, searchData[scheme.id]);
    if (entry) out[String(schemeCode)] = entry;
  }

  return out;
}

export function mapRiskRatingToLevel(riskRating: number): RiskLevel {
  if (riskRating <= 2) return 'Low';
  if (riskRating <= 4) return 'Moderate';
  if (riskRating <= 6) return 'High';
  return 'Very High';
}

export function mapCategoryToStandard(category: string): MutualFundCategory {
  const categoryLower = category?.toLowerCase() || '';

  if (categoryLower === 'equity') return 'Equity';
  if (categoryLower === 'debt') return 'Debt';
  if (categoryLower === 'hybrid') return 'Hybrid';
  if (categoryLower === 'commodities') return 'Commodities';
  return 'Others';
}

export const processSchemeData = (
  scheme: GrowwScheme,
  stats?: GrowwSchemeStatsResponse,
  searchData?: GrowwSearchResponse,
): MutualFund => {
  // Get the first return stats entry that has a valid scheme_code
  const returnStats = searchData?.return_stats?.find((stat) => stat.scheme_code !== null);

  return normalizeFundNumerics({
    id: scheme.id,
    schemeName: scheme.scheme_name,
    fundName: scheme.fund_name,
    fundHouse: scheme.fund_house,
    category: mapCategoryToStandard(scheme.category),
    subCategory: scheme.sub_category || '',
    schemeCode: parseInt(scheme.scheme_code, 10), // Convert string to number
    aum: scheme.aum || searchData?.aum || 0,
    expenseRatio: searchData?.expense_ratio || null,
    logoUrl: scheme.logo_url || null,
    
    // Additional fields from search response
    searchId: scheme.search_id || searchData?.search_id || undefined,
    planType: scheme.plan_type || searchData?.plan_type || null,
    schemeType: scheme.scheme_type || searchData?.scheme_type || null,
    exitLoad: searchData?.exit_load || null,
    minInvestment: searchData?.min_investment_amount ?? null,
    minSipInvestment: searchData?.min_sip_investment ?? null,
    sipAllowed: scheme.sip_allowed ?? searchData?.sip_allowed ?? null,
    lockInMonths: lockInToMonths(searchData?.lock_in),
    benchmarkName: searchData?.benchmark_name ?? null,
    
    returns: {
      oneMonth: returnStats?.return1m || null,
      threeMonth: returnStats?.return3m || null,
      sixMonth: returnStats?.return6m || null,
      oneYear: returnStats?.return1y || scheme.return1y || null,
      threeYear: returnStats?.return3y || scheme.return3y || null,
      fiveYear: returnStats?.return5y || scheme.return5y || null,
      tenYear: returnStats?.return10y || null,
      sinceCreated: returnStats?.return_since_created || null,
      default: returnStats?.return_default || null,
    },
    ratios: {
      sharpeRatio: returnStats?.sharpe_ratio || null,
      sortinoRatio: returnStats?.sortino_ratio || null,
      alpha: returnStats?.alpha || null,
      beta: returnStats?.beta || null,
      informationRatio: returnStats?.information_ratio || null,
      standardDeviation: returnStats?.standard_deviation || null,
      meanReturn: returnStats?.mean_return || null,
    },
    portfolioMetrics: {
      pe: stats?.pe || null,
      pb: stats?.pb || null,
      debtPercentage: stats?.debt_per || stats?.asset_allocation?.debt || null,
      equityPercentage: stats?.equity_per || stats?.asset_allocation?.equity || null,
      cashPercentage: stats?.cash_per || stats?.asset_allocation?.cash || null,
      yieldToMaturity: stats?.yield_to_maturity || null,
      portfolioTurnover: stats?.portfolio_turnover || null,
      totalHoldings: stats?.total_holdings || null,
    },
    rankings: {
      rank3m: returnStats?.rank3m || null,
      rank6m: returnStats?.rank6m || null,
      rank1y: returnStats?.rank1yr || null,
      rank3y: returnStats?.rank3yr || null,
      rank5y: returnStats?.rank5yr || null,
    },
    categoryReturns: {
      cat3m: returnStats?.cat_return3m || null,
      cat6m: returnStats?.cat_return6m || null,
      cat1y: returnStats?.cat_return1y || null,
      cat3y: returnStats?.cat_return3y || null,
      cat5y: returnStats?.cat_return5y || null,
    },
    indexReturns: {
      index1y: returnStats?.index_return1y || null,
      index3y: returnStats?.index_return3y || null,
      index5y: returnStats?.index_return5y || null,
    },
    riskMetrics: {
      riskRating: scheme.risk_rating || returnStats?.risk_rating || 5,
      risk: scheme.risk || returnStats?.risk || mapRiskRatingToLevel(scheme.risk_rating || returnStats?.risk_rating || 5) || null,
    },
    ratings: {
      growwRating: scheme.groww_rating || searchData?.groww_rating || null,
      crisilRating: searchData?.crisil_rating || null,
    },
    sectors: {
      debtSectors: stats?.debt_sector_per || null,
      equitySectors: stats?.equity_sector_per || null,
    },
    lastUpdated: new Date(),
  });
};

export const processAllMutualFunds = async (
  schemes: GrowwScheme[],
  onProgress?: (processed: number, total: number) => void,
): Promise<MutualFund[]> => {
  console.log(`🔄 Processing ${schemes.length} mutual funds...`);

  const processedFunds: MutualFund[] = [];
  let processed = 0;

  // Process in smaller batches to avoid overwhelming the APIs
  const batchSize = 50;

  for (let i = 0; i < schemes.length; i += batchSize) {
    const batch = schemes.slice(i, i + batchSize);

    for (const scheme of batch) {
      try {
        // For now, process with basic scheme data
        // Later we can enhance this to fetch stats and search data
        const processedFund = processSchemeData(scheme);
        processedFunds.push(processedFund);

        processed++;
        if (onProgress) {
          onProgress(processed, schemes.length);
        }

        // Small delay to be nice to the API
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        console.error(`❌ Error processing fund ${scheme.id}:`, error);
      }
    }

    console.log(
      `✅ Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(schemes.length / batchSize)}`,
    );
  }

  console.log(`🎉 Successfully processed ${processedFunds.length}/${schemes.length} funds`);
  return processedFunds;
};

export function exportToCSV(funds: MutualFund[]): string {
  if (funds.length === 0) return '';

  const headers = [
    'ID',
    'Scheme Name',
    'Fund Name',
    'Fund House',
    'Category',
    'Sub Category',
    'Scheme Code',
    'AUM',
    'Expense Ratio',
    '1M Return',
    '3M Return',
    '6M Return',
    '1Y Return',
    '3Y Return',
    '5Y Return',
    '10Y Return',
    'Sharpe Ratio',
    'Sortino Ratio',
    'Alpha',
    'Beta',
    'Information Ratio',
    'Standard Deviation',
    'Risk Rating',
    'Risk Level',
    'Groww Rating',
    'Crisil Rating',
    'Last Updated',
  ];

  const rows = funds.map((fund) => [
    fund.id,
    fund.schemeName,
    fund.fundName,
    fund.fundHouse,
    fund.category,
    fund.subCategory,
    fund.schemeCode.toString(),
    fund.aum?.toString() ?? '',
    fund.expenseRatio?.toString() || '',
    fund.returns.oneMonth?.toString() || '',
    fund.returns.threeMonth?.toString() || '',
    fund.returns.sixMonth?.toString() || '',
    fund.returns.oneYear?.toString() || '',
    fund.returns.threeYear?.toString() || '',
    fund.returns.fiveYear?.toString() || '',
    fund.returns.tenYear?.toString() || '',
    fund.ratios.sharpeRatio?.toString() || '',
    fund.ratios.sortinoRatio?.toString() || '',
    fund.ratios.alpha?.toString() || '',
    fund.ratios.beta?.toString() || '',
    fund.ratios.informationRatio?.toString() || '',
    fund.ratios.standardDeviation?.toString() || '',
    fund.riskMetrics.riskRating?.toString() ?? '',
    fund.riskMetrics.risk ?? '',
    fund.ratings.growwRating?.toString() || '',
    fund.ratings.crisilRating?.toString() || '',
    fund.lastUpdated ? new Date(fund.lastUpdated).toISOString() : '',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(','))
    .join('\n');

  return csvContent;
}
