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
): Promise<Record<string, GrowwSearchResponse>> => {
  if (searchIds.length === 0) {
    return {};
  }

  console.log(`🔍 Processing ${searchIds.length} search data in batches of ${batchSize}...`);

  const results: Record<string, GrowwSearchResponse> = {};

  for (let i = 0; i < searchIds.length; i += batchSize) {
    const batch = searchIds.slice(i, i + batchSize);
    console.log(
      `📊 Processing search batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(searchIds.length / batchSize)}...`,
    );

    const batchPromises = batch.map(async (searchId) => {
      try {
        return await getSchemeSearchData(searchId);
      } catch (error) {
        console.error(`❌ Error fetching search data for ${searchId}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((result, index) => {
      if (result) {
        results[result.search_id] = result;
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
