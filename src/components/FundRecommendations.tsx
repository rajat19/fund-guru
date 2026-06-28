import { useMemo } from 'react';
import { MutualFund } from '@/types/mutualFund';
import { useMutualFunds } from '@/hooks/useMutualFunds';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { calculateFundScore } from '@/utils/scoringEngine';
import { FundCard } from './FundCard';
import { Separator } from './ui/separator';

interface FundRecommendationsProps {
  currentFund: MutualFund;
}

export function FundRecommendations({ currentFund }: FundRecommendationsProps) {
  const { data: allFunds = [] } = useMutualFunds();
  const { weights } = useScoringConfig();

  // Memoize the scored and sorted funds to avoid recalculating on every render
  const { topCategory, topSubCategory, topFundHouse } = useMemo(() => {
    if (!allFunds.length) return { topCategory: [], topSubCategory: [], topFundHouse: [] };

    // Score all funds (except the current one)
    const scoredFunds = allFunds
      .filter(f => f.id !== currentFund.id)
      .map(f => ({
        ...f,
        score: calculateFundScore(f, weights)
      }));

    const getTop5 = (funds: typeof scoredFunds, filterFn: (f: typeof scoredFunds[0]) => boolean) => {
      return funds
        .filter(filterFn)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    };

    return {
      topCategory: getTop5(scoredFunds, f => f.category === currentFund.category),
      topSubCategory: getTop5(scoredFunds, f => f.subCategory === currentFund.subCategory),
      topFundHouse: getTop5(scoredFunds, f => f.fundHouse === currentFund.fundHouse),
    };
  }, [allFunds, currentFund, weights]);

  if (!allFunds.length) return null;

  const renderSection = (title: string, funds: MutualFund[]) => {
    if (!funds.length) return null;
    return (
      <div className="space-y-4 mb-8">
        <h3 className="text-xl font-bold tracking-tight">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {funds.map(fund => (
            <FundCard key={fund.id} fund={fund} showScore={true} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-12 space-y-8 animate-fade-in-up">
      <Separator className="mb-8" />
      <h2 className="text-2xl font-bold mb-6">Similar Funds You Might Like</h2>
      
      {renderSection(`Top ${currentFund.subCategory} Funds`, topSubCategory)}
      {renderSection(`Top ${currentFund.category} Funds`, topCategory)}
      {renderSection(`Top from ${currentFund.fundHouse}`, topFundHouse)}
    </div>
  );
}
