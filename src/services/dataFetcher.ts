/**
 * Data Fetcher Service
 * 
 * Handles fetching and batching of data from various Groww API endpoints
 */

import { batchProcessSearchData, batchProcessSchemeStats } from '@/services/groww';
import type { GrowwScheme, GrowwSchemeStatsResponse, GrowwSearchResponse } from '@/types/api';

export interface FetchedData {
  schemeStats: Record<number, GrowwSchemeStatsResponse>;
  searchData: Record<string, GrowwSearchResponse>;
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
export const fetchEnhancedData = async (schemes: GrowwScheme[], options: FetchOptions = {}): Promise<FetchedData> => {
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

  console.log(`🔢 Processing ${schemeCodes.length} scheme codes and ${searchIds.length} search IDs`);

  // Fetch both types of data in parallel
  const [schemeStats, searchData] = await Promise.all([
    schemeCodes.length > 0 ? fetchSchemeStats(schemeCodes, fetchOptions) : Promise.resolve({}),
    searchIds.length > 0 ? fetchSearchData(searchIds, fetchOptions) : Promise.resolve({}),
  ]);

  console.log(`✅ Fetched stats for ${Object.keys(schemeStats).length} schemes`);
  console.log(`✅ Fetched search data for ${Object.keys(searchData).length} schemes`);

  return { schemeStats, searchData };
};

/**
 * Fetch scheme statistics with error handling
 */
const fetchSchemeStats = async (schemeCodes: number[], options: Required<FetchOptions>): Promise<Record<number, GrowwSchemeStatsResponse>> => {
  try {
    console.log('📊 Fetching scheme statistics...');
    return await batchProcessSchemeStats(
      schemeCodes, 
      options.statsBatchSize, 
      options.statsDelay
    );
  } catch (error) {
    console.warn('⚠️ Failed to fetch scheme stats, continuing with empty data:', error);
    return {};
  }
};

/**
 * Fetch search data with error handling
 */
const fetchSearchData = async (searchIds: string[], options: Required<FetchOptions>): Promise<Record<string, GrowwSearchResponse>> => {
  try {
    console.log('🔍 Fetching search data...');
    return await batchProcessSearchData(
      searchIds, 
      options.searchBatchSize, 
      options.searchDelay
    );
  } catch (error) {
    console.warn('⚠️ Failed to fetch search data, continuing with empty data:', error);
    return {};
  }
};
