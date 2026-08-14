import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FUNDS_CACHE_KEY, clearLocalCache } from '../utils/cache';
import {
  getAllFunds,
  getFundsByCategory,
  getFundById,
  getTopPerformingFunds,
  searchFunds,
  shouldRefreshData,
  revalidateFunds,
} from '../services/firebaseService';
import { MutualFund } from '../types/mutualFund';
import { classifyTaxBucket, type TaxBucket } from '../utils/taxation';
import { hasTrackRecord } from '../utils/trackRecord';

/**
 * Default minimum history for the explorer.
 *
 * Three years is the shortest span that has almost certainly contained a
 * meaningful drawdown, so it filters out funds whose entire record is a single
 * favourable stretch. Set `minTrackRecordYears: 0` to opt out.
 */
export const DEFAULT_MIN_TRACK_RECORD_YEARS = 3;

export interface MutualFundsFilters {
  category?: string;
  subCategory?: string;
  fundHouse?: string;
  riskLevel?: string;
  /** Tax bucket, derived from allocation rather than stored on the fund. */
  taxBucket?: TaxBucket;
  /**
   * Minimum years of judgeable history. Defaults to DEFAULT_MIN_TRACK_RECORD
   * when the filter object is present at all — a screener aimed at long-term
   * holdings should not surface funds with no record by default.
   */
  minTrackRecordYears?: number;
  minReturn?: number;
  minReturn3Y?: number;
  minReturn5Y?: number;
  maxExpenseRatio?: number;
  minAUM?: number;
  minSharpeRatio?: number;
  minAlpha?: number;
  searchTerm?: string;
}

export function useMutualFunds(filters?: MutualFundsFilters) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['mutual-funds'], // Filters are applied via `select`, so no refetch on change
    queryFn: async (): Promise<MutualFund[]> => {
      return await getAllFunds();
    },
    select: (funds) => applyFilters(funds, filters),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Stale-while-revalidate. The cache TTL is deliberately long (syncs are manual
  // and infrequent), so freshness comes from comparing the cached dataset build
  // against what is published rather than from a clock. Runs once per mount and
  // is a no-op when the versions match.
  useEffect(() => {
    let cancelled = false;

    void revalidateFunds((funds) => {
      if (cancelled) return;
      queryClient.setQueryData(['mutual-funds'], funds);
    });

    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  return query;
}

export function useFundsByCategory(category: string, limit?: number) {
  return useQuery({
    queryKey: ['mutual-funds-by-category', category, limit],
    queryFn: async (): Promise<MutualFund[]> => {
      return await getFundsByCategory(category, limit);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useFundById(id: string) {
  return useQuery({
    queryKey: ['mutual-fund', id],
    queryFn: async (): Promise<MutualFund | null> => {
      return await getFundById(id);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useTopPerformingFunds(limit: number = 10) {
  return useQuery({
    queryKey: ['top-performing-funds', limit],
    queryFn: async (): Promise<MutualFund[]> => {
      return await getTopPerformingFunds(limit);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSearchFunds(searchTerm: string) {
  return useQuery({
    queryKey: ['search-funds', searchTerm],
    queryFn: async (): Promise<MutualFund[]> => {
      if (!searchTerm.trim()) return [];
      return await searchFunds(searchTerm);
    },
    staleTime: 1 * 60 * 1000, // 1 minute for search results
    enabled: !!searchTerm.trim(),
  });
}

export function useSyncMutualFunds() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ incremental = false }: { incremental?: boolean } = {}) => {
      if (incremental) {
        const shouldRefresh = await shouldRefreshData();
        if (!shouldRefresh) {
          return { message: 'Data is fresh, no sync needed' };
        }
      }

      // Use the new browser-compatible sync orchestrator
      const { executeSync } = await import('../services/syncOrchestrator');
      await executeSync({ incremental, skipFirebase: false });

      return { message: 'Sync completed successfully' };
    },
    onSuccess: async () => {
      // Clear the IndexedDB browser cache so we pull fresh data from Firebase
      await clearLocalCache(FUNDS_CACHE_KEY).catch(console.error);
      
      // Invalidate all fund-related queries to refetch from Firebase
      queryClient.invalidateQueries({ queryKey: ['mutual-funds'] });
      queryClient.invalidateQueries({ queryKey: ['mutual-funds-by-category'] });
      queryClient.invalidateQueries({ queryKey: ['top-performing-funds'] });
    },
  });
}


// Utility function to apply filters
function applyFilters(funds: MutualFund[], filters?: MutualFundsFilters): MutualFund[] {
  if (!filters) return funds;

  return funds.filter((fund) => {
    if (filters.category && fund.category !== filters.category) return false;
    if (filters.subCategory && fund.subCategory !== filters.subCategory) return false;
    if (filters.fundHouse && fund.fundHouse !== filters.fundHouse) return false;
    if (filters.riskLevel && fund.riskMetrics?.risk !== filters.riskLevel) return false;
    if (filters.taxBucket && classifyTaxBucket(fund) !== filters.taxBucket) return false;

    // `?? DEFAULT_MIN_TRACK_RECORD` rather than `if (filters.x)`: 0 is a
    // meaningful value here ("show me everything") and must not be treated as
    // "filter absent".
    const minYears = filters.minTrackRecordYears ?? DEFAULT_MIN_TRACK_RECORD_YEARS;
    if (minYears > 0 && !hasTrackRecord(fund, minYears)) return false;
    
    // Returns filters
    if (filters.minReturn && (!fund.returns?.oneYear || fund.returns.oneYear < filters.minReturn)) return false;
    if (filters.minReturn3Y && (!fund.returns?.threeYear || fund.returns.threeYear < filters.minReturn3Y)) return false;
    if (filters.minReturn5Y && (!fund.returns?.fiveYear || fund.returns.fiveYear < filters.minReturn5Y)) return false;
    
    // Ratios and metrics filters
    if (filters.maxExpenseRatio && (!fund.expenseRatio || fund.expenseRatio > filters.maxExpenseRatio)) return false;
    if (filters.minAUM && (!fund.aum || fund.aum < filters.minAUM)) return false;
    if (filters.minSharpeRatio && (!fund.ratios?.sharpeRatio || fund.ratios.sharpeRatio < filters.minSharpeRatio)) return false;
    if (filters.minAlpha && (!fund.ratios?.alpha || fund.ratios.alpha < filters.minAlpha)) return false;

    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      const matchesSearch =
        fund.schemeName?.toLowerCase().includes(searchLower) ||
        fund.fundName?.toLowerCase().includes(searchLower) ||
        fund.fundHouse?.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
    }

    return true;
  });
}
