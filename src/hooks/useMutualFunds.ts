import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getAllFunds,
  getFundsByCategory,
  getFundById,
  getTopPerformingFunds,
  searchFunds,
  shouldRefreshData
} from '../services/firebaseService';
import { MutualFund } from '../types/mutualFund';

export interface MutualFundsFilters {
  category?: string;
  subCategory?: string;
  fundHouse?: string;
  riskLevel?: string;
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
  return useQuery({
    queryKey: ['mutual-funds'], // Removed filters from queryKey so it doesn't refetch on change
    queryFn: async (): Promise<MutualFund[]> => {
      return await getAllFunds();
    },
    select: (funds) => applyFilters(funds, filters),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
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
    onSuccess: () => {
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
