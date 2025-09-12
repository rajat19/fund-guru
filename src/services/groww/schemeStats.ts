import { GrowwSchemeStatsResponse } from '@/types/api';
import { DEFAULT_HEADERS, delay, SCHEME_STATS_URL } from '@/services/groww/constant';

export const getSchemeStats = async (
  schemeCode: number | string,
): Promise<GrowwSchemeStatsResponse> => {
  const url = SCHEME_STATS_URL.replace('{scheme_code}', schemeCode.toString());

  const response = await fetch(url, {
    headers: DEFAULT_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch scheme stats for ${schemeCode}: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    ...data,
    scheme_code: typeof schemeCode === 'string' ? parseInt(schemeCode, 10) : schemeCode,
  };
};

export const batchProcessSchemeStats = async (
  schemeCodes: (number | string)[],
  batchSize: number = 10,
  delayMs: number = 500,
): Promise<Record<string, GrowwSchemeStatsResponse>> => {
  if (schemeCodes.length === 0) {
    return {};
  }

  console.log(`🔄 Processing ${schemeCodes.length} scheme stats in batches of ${batchSize}...`);

  const results: Record<string, GrowwSchemeStatsResponse> = {};

  for (let i = 0; i < schemeCodes.length; i += batchSize) {
    const batch = schemeCodes.slice(i, i + batchSize);
    console.log(
      `📊 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(schemeCodes.length / batchSize)}...`,
    );

    const batchPromises = batch.map(async (schemeCode) => {
      try {
        return await getSchemeStats(schemeCode);
      } catch (error) {
        console.error(`❌ Error fetching stats for scheme ${schemeCode}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((result) => {
      if (result) {
        results[result.scheme_code] = result;
      }
    });

    // Add delay between batches
    if (i + batchSize < schemeCodes.length) {
      await delay(delayMs);
    }
  }

  console.log(`✅ Successfully processed ${Object.keys(results).length} scheme stats`);
  return results;
};
