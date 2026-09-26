/**
 * Data Fetcher Service
 * 
 * Handles fetching and batching of data from various Groww API endpoints
 */

import { batchProcessSearchData, batchProcessSchemeStats, type RedirectedFund } from '@/services/groww';
import type { GrowwScheme, GrowwSchemeStatsResponse, GrowwSearchResponse } from '@/types/api';

export interface FetchedData {
  schemeStats: Record<number, GrowwSchemeStatsResponse>;
  searchData: Record<string, GrowwSearchResponse>;
  /** Funds whose search_id redirected to a different scheme (merged/replaced). */
  redirects: RedirectedFund[];
}

export interface FetchOptions {
  statsBatchSize?: number;
  searchBatchSize?: number;
  statsDelay?: number;
  searchDelay?: number;
}

/**
 * Fetch all enhanced data (stats + search) for given schemes
 */
export const fetchEnhancedData = async (
  schemes: GrowwScheme[],
  options: FetchOptions = {},
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<FetchedData> => {
  const fetchOptions = {
    statsBatchSize: options.statsBatchSize ?? 10,
    searchBatchSize: options.searchBatchSize ?? 10,
    statsDelay: options.statsDelay ?? 500,
    searchDelay: options.searchDelay ?? 500,
  };

  console.log('📊 Fetching enhanced data for schemes...');
  
  const schemeCodes = schemes
    .map((scheme) => parseInt(String(scheme.scheme_code), 10))
    .filter((code) => !isNaN(code));
    
  const searchIds = schemes
    .map((scheme) => scheme.id)
    .filter(Boolean);

  // Build a map of search_id → scheme_name so redirected funds can be named.
  const schemeNamesBySearchId = new Map<string, string>();
  for (const s of schemes) {
    if (s.id && s.scheme_name) schemeNamesBySearchId.set(s.id, s.scheme_name);
  }

  console.log(`🔢 Processing ${schemeCodes.length} scheme codes and ${searchIds.length} search IDs`);

  if (signal?.aborted) throw new Error('Sync cancelled by user');

  // Fetch both types of data in parallel
  const [schemeStats, searchResult] = await Promise.all([
    schemeCodes.length > 0 ? fetchSchemeStats(schemeCodes, fetchOptions, signal, onProgress) : Promise.resolve({}),
    searchIds.length > 0 ? fetchSearchData(searchIds, fetchOptions, signal, onProgress, schemeNamesBySearchId) : Promise.resolve({ data: {}, redirects: [] as RedirectedFund[] }),
  ]);

  console.log(`✅ Fetched stats for ${Object.keys(schemeStats).length} schemes`);
  console.log(`✅ Fetched search data for ${Object.keys(searchResult.data).length} schemes`);

  return { schemeStats, searchData: searchResult.data, redirects: searchResult.redirects };
};

/**
 * Fetch scheme statistics with error handling
 */
const fetchSchemeStats = async (
  schemeCodes: number[],
  options: Required<FetchOptions>,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<Record<number, GrowwSchemeStatsResponse>> => {
  try {
    console.log('📊 Fetching scheme statistics...');
    return await batchProcessSchemeStats(
      schemeCodes, 
      options.statsBatchSize, 
      options.statsDelay,
      onProgress,
      signal
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Sync cancelled by user') throw error;
    console.warn('⚠️ Failed to fetch scheme stats, continuing with empty data:', error);
    return {};
  }
};

/**
 * Fetch search data with error handling
 */
const fetchSearchData = async (
  searchIds: string[],
  options: Required<FetchOptions>,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
  schemeNamesBySearchId?: Map<string, string>,
): Promise<{ data: Record<string, GrowwSearchResponse>; redirects: RedirectedFund[] }> => {
  try {
    console.log('🔍 Fetching search data...');
    return await batchProcessSearchData(
      searchIds, 
      options.searchBatchSize, 
      options.searchDelay,
      onProgress,
      signal,
      schemeNamesBySearchId,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Sync cancelled by user') throw error;
    console.warn('⚠️ Failed to fetch search data, continuing with empty data:', error);
    return { data: {}, redirects: [] };
  }
};
