import { useMemo } from 'react';
import { MutualFund } from '@/types/mutualFund';
import { useFundScores } from '@/hooks/useFundScores';
import { ScoredFund } from '@/utils/scoringEngine';
import { FundCard } from './FundCard';
import { Separator } from './ui/separator';

interface FundRecommendationsProps {
  currentFund: MutualFund;
}

export function FundRecommendations({ currentFund }: FundRecommendationsProps) {
  const { universe, rank } = useFundScores();

  const { topCategory, topSubCategory, topFundHouse } = useMemo(() => {
    if (!universe.length) return { topCategory: [], topSubCategory: [], topFundHouse: [] };

    const ranked = rank(universe.filter((f) => f.id !== currentFund.id));

    const top5 = (predicate: (fund: ScoredFund) => boolean) =>
      ranked.filter(predicate).slice(0, 5);

    return {
      topCategory: top5((f) => f.category === currentFund.category),
      topSubCategory: top5((f) => f.subCategory === currentFund.subCategory),
      topFundHouse: top5((f) => f.fundHouse === currentFund.fundHouse),
    };
  }, [universe, currentFund, rank]);

  const allFunds = universe;

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
      <h2 className="text-2xl font-bold mb-2">Peer funds</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Funds comparable to this one, ranked by peer score. Not a recommendation to buy.
      </p>

      {renderSection(`Highest scoring in ${currentFund.subCategory}`, topSubCategory)}
      {renderSection(`Highest scoring in ${currentFund.category}`, topCategory)}
      {renderSection(`Highest scoring from ${currentFund.fundHouse}`, topFundHouse)}
    </div>
  );
}
