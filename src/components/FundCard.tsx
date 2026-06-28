import { MutualFund } from '@/types/mutualFund';
import { calculateFundScore } from '@/utils/scoringEngine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Shield, DollarSign, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { getCategoryColor, getRiskColor } from '@/utils/colors';

interface FundCardProps {
  fund: MutualFund & { score?: number; rank?: number };
  onClick?: (fund: MutualFund) => void;
  showScore?: boolean;
}

export function FundCard({ fund, onClick, showScore = false }: FundCardProps) {
  const navigate = useNavigate();
  const { weights } = useScoringConfig();

  const aiScore = useMemo(() => {
    if (fund.score != null) return fund.score;
    if (showScore) return calculateFundScore(fund, weights);
    return null;
  }, [fund, showScore, weights]);

  const formatReturn = (value: number | null) => {
    if (value === null) return 'N/A';
    return value > 0 ? `+${value.toFixed(2)}%` : `${value.toFixed(2)}%`;
  };

  const getReturnColor = (value: number | null) => {
    if (value === null) return 'text-muted-foreground';
    if (value > 15) return 'text-profit';
    if (value > 8) return 'text-secondary';
    if (value > 0) return 'text-muted-foreground';
    return 'text-loss';
  };

  return (
    <Card
      className="group glass-card animate-fade-in-up cursor-pointer h-full flex flex-col"
      onClick={() => navigate(`/fund/${fund.id}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg font-semibold text-card-foreground leading-snug">
              {fund.schemeName}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{fund.fundHouse}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline" className={getCategoryColor(fund.category)}>
            {fund.category}
          </Badge>
          {fund.subCategory && (
            <Badge variant="outline" className="bg-muted/30">
              {fund.subCategory}
            </Badge>
          )}
          <Badge variant="outline" className={getRiskColor(fund.riskMetrics.risk)}>
            Risk: {fund.riskMetrics.risk}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 flex-1 flex flex-col">
        {/* Returns Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">6M Return</div>
            <div className={`font-semibold ${getReturnColor(fund.returns.sixMonth)}`}>
              {formatReturn(fund.returns.sixMonth)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">1Y Return</div>
            <div className={`font-semibold ${getReturnColor(fund.returns.oneYear)}`}>
              {formatReturn(fund.returns.oneYear)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">3Y Return</div>
            <div className={`font-semibold ${getReturnColor(fund.returns.threeYear)}`}>
              {formatReturn(fund.returns.threeYear)}
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Expense Ratio</div>
              <div className="font-semibold">
                {fund.expenseRatio ? fund.expenseRatio : 'N/A'}%
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Sharpe Ratio</div>
              <div className="font-semibold">
                {fund.ratios.sharpeRatio ? fund.ratios.sharpeRatio.toFixed(2) : 'N/A'}
              </div>
            </div>
          </div>
        </div>

        {/* AI Score */}
        {aiScore != null && (
          <div className="flex justify-between items-center pt-2 border-t border-border mt-auto">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">AI Score</span>
            </div>
            <span className="text-lg font-bold text-primary">{aiScore}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
