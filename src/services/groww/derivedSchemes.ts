import { GrowwScheme, GrowwSchemeResponse } from '@/types/api';
import { DERIVED_SCHEME_URL, DEFAULT_HEADERS } from '@/services/groww/constant';
import { delay } from '@/services/groww/constant';

export const getDerivedScheme = async (page: number = 0): Promise<GrowwSchemeResponse> => {
  const params = new URLSearchParams({
    available_for_investment: 'true',
    doc_type: 'scheme',
    page: page.toString(),
    plan_type: 'Direct',
    sort_by: '0',
    size: '20',
  });

  const response = await fetch(`${DERIVED_SCHEME_URL}?${params}`, {
    headers: DEFAULT_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch derived schemes: ${response.statusText}`);
  }

  return response.json();
};

export const getAllDerivedSchemes = async (maxSchemesToFetch?: number): Promise<GrowwScheme[]> => {
  console.log('🚀 Starting to fetch all mutual fund derived schemes...');

  const initialResponse = await getDerivedScheme(0);
  let totalSchemes = initialResponse.total_results || 0;
  const perPage = initialResponse.content?.length || 20;

  if (maxSchemesToFetch) {
    totalSchemes = maxSchemesToFetch;
  }

  console.log(`📊 Total derived schemes: ${totalSchemes}, Per page: ${perPage}`);

  const allFunds: GrowwScheme[] = [...(initialResponse.content || [])];
  const totalPages = Math.ceil(totalSchemes / perPage);

  for (let page = 1; page < totalPages; page++) {
    try {
      console.log(`📄 Fetching derived page ${page + 1}/${totalPages}...`);
      const schemes = await getDerivedScheme(page);
      if (schemes.content) {
        allFunds.push(...schemes.content);
      }

      // Add delay to avoid rate limiting
      await delay(1000);
    } catch (error) {
      console.error(`❌ Error fetching derived page ${page}:`, error);
      // Continue with next page instead of failing completely
    }
  }

  console.log(`✅ Successfully fetched ${allFunds.length} derived schemes`);
  return allFunds;
};
