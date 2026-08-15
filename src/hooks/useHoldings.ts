import { useQuery } from '@tanstack/react-query';
import { HOLDINGS_PATH, isHoldingsDataset } from '@/types/holdings';
import { buildHoldingsIndex, type HoldingsIndex } from '@/utils/overlap';

/**
 * Loads the published holdings file, lazily.
 *
 * Deliberately not part of the main fund query: holdings roughly double the
 * payload and only overlap analysis needs them, so paying for them on every page
 * load would be wasteful. Kept in its own query with a long staleTime since the
 * file only changes when a sync is committed.
 *
 * A missing or malformed file resolves to an empty index rather than an error —
 * overlap analysis then reports "unknown" and the builder falls back to
 * sub-category and AMC diversification, which still works.
 */
export const useHoldings = (enabled = true) => {
  const query = useQuery({
    queryKey: ['fund-holdings'],
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    queryFn: async (): Promise<HoldingsIndex> => {
      const url = `${import.meta.env.BASE_URL}${HOLDINGS_PATH}`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`ℹ️ No holdings file at ${url} — overlap analysis unavailable`);
          return new Map();
        }

        const payload: unknown = await response.json();
        if (!isHoldingsDataset(payload)) {
          console.warn(`⚠️ ${url} is not a recognised holdings dataset; ignoring`);
          return new Map();
        }

        const index = buildHoldingsIndex(payload.funds);
        console.log(`✅ Holdings loaded for ${index.size} funds (${payload.generatedAt})`);
        return index;
      } catch {
        return new Map();
      }
    },
  });

  return {
    holdings: query.data,
    /** True once we know whether overlap analysis is possible. */
    isReady: !query.isLoading,
    hasHoldings: (query.data?.size ?? 0) > 0,
  };
};
