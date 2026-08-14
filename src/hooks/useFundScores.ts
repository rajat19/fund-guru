import { useCallback, useMemo } from 'react';
import { useMutualFunds } from '@/hooks/useMutualFunds';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import {
  buildScoringContext,
  rankFundsWithContext,
  scoreFund,
  type ScoreBreakdown,
  type ScoredFund,
} from '@/utils/scoringEngine';
import { MutualFund } from '@/types/mutualFund';

/**
 * Scores are percentiles within a peer group, so they only mean anything
 * relative to the full universe. This hook builds the peer distributions once
 * from the *unfiltered* fund list and shares them, so that filtering the view
 * never shifts a fund's score.
 */
export const useFundScores = () => {
  const { data: universe = [], isLoading: fundsLoading } = useMutualFunds();
  const { weights, isLoading: weightsLoading } = useScoringConfig();

  const context = useMemo(() => buildScoringContext(universe, weights), [universe, weights]);

  const breakdowns = useMemo(() => {
    const map = new Map<string, ScoreBreakdown>();
    for (const fund of universe) {
      map.set(fund.id, scoreFund(fund, context));
    }
    return map;
  }, [universe, context]);

  const breakdownOf = useCallback(
    (fund: MutualFund): ScoreBreakdown => breakdowns.get(fund.id) ?? scoreFund(fund, context),
    [breakdowns, context],
  );

  const scoreOf = useCallback((fund: MutualFund): number => breakdownOf(fund).score, [breakdownOf]);

  const rank = useCallback(
    (funds: MutualFund[]): ScoredFund[] => rankFundsWithContext(funds, context),
    [context],
  );

  /**
   * Ranking that keeps thin-data funds in the list. For browse surfaces where
   * hiding a fund the user searched for would be more confusing than showing it
   * with a "limited data" flag.
   */
  const rankIncludingThinData = useCallback(
    (funds: MutualFund[]): ScoredFund[] =>
      rankFundsWithContext(funds, context, { includeInsufficientData: true }),
    [context],
  );

  return {
    context,
    universe,
    weights,
    isLoading: fundsLoading || weightsLoading,
    breakdownOf,
    scoreOf,
    rank,
    rankIncludingThinData,
  };
};
