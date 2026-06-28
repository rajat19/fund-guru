import { GrowwSearchResponse } from '@/types/api';
import { DEFAULT_HEADERS, MF_SEARCH_API } from '@/services/groww/constant';
import { delay } from '@/services/groww/constant';

export const getSchemeSearchData = async (searchId: string): Promise<GrowwSearchResponse> => {
  const url = MF_SEARCH_API.replace('{search_id}', searchId);

  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
  });

  if (response.status >= 400 && response.status < 500) {
    console.error(`❌ Failed to fetch search data for ${searchId}: url: ${url}`);
    throw new Error(`Failed to fetch search data for ${searchId}: ${response.statusText}`);
  }

  return response.json();
};

export const batchProcessSearchData = async (
  searchIds: string[],
  batchSize: number = 10,
  delayMs: number = 500,
  onProgress?: (msg: string) => void,
  signal?: AbortSignal
): Promise<Record<string, GrowwSearchResponse>> => {
  if (searchIds.length === 0) {
    return {};
  }

  console.log(`🔍 Processing ${searchIds.length} search data in batches of ${batchSize}...`);

  const results: Record<string, GrowwSearchResponse> = {};
  const totalBatches = Math.ceil(searchIds.length / batchSize);

  for (let i = 0; i < searchIds.length; i += batchSize) {
    if (signal?.aborted) {
      console.log('⚠️ Batch processing search data cancelled by user.');
      throw new Error('Sync cancelled by user');
    }

    const currentBatchNum = Math.floor(i / batchSize) + 1;
    const msg = `Fetching search batch ${currentBatchNum}/${totalBatches}`;
    console.log(`📊 ${msg}...`);
    if (onProgress) onProgress(msg);

    const batch = searchIds.slice(i, i + batchSize);

    const batchPromises = batch.map(async (searchId) => {
      try {
        const result = await getSchemeSearchData(searchId);
        
        // Detect if the fund was replaced or is invalid
        if (result.search_id !== searchId || !result.scheme_name) {
          console.warn(`⚠️ Fund replaced or invalid: ${searchId} (redirects to ${result.search_id || 'unknown'}). Skipping.`);
          return null;
        }
        
        return { originalId: searchId, data: result };
      } catch (error) {
        console.error(`❌ Error fetching search data for ${searchId}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((item) => {
      if (item) {
        results[item.originalId] = item.data;
      }
    });

    // Add delay between batches
    if (i + batchSize < searchIds.length) {
      await delay(delayMs);
    }
  }

  console.log(`✅ Successfully processed ${Object.keys(results).length} search data`);
  return results;
};
