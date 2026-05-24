import { MutualFund } from '@/types/mutualFund';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Shield, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface FundCardProps {
  fund: MutualFund & { score?: number; rank?: number };
  showScore?: boolean;
}

export function FundCard({ fund, showScore = false }: FundCardProps) {
  const navigate = useNavigate();
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

  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case 'Low':
        return 'default';
      case 'Moderate':
        return 'secondary';
      case 'High':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  return (
    <Card
      className="group glass-card animate-fade-in-up cursor-pointer"
      onClick={() => navigate(`/fund/${fund.id}`)}
    >
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg font-semibold text-card-foreground truncate">
              {fund.schemeName}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{fund.fundHouse}</p>
          </div>
          {showScore && fund.score && (
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-bold text-primary">{fund.score}</div>
              {fund.rank && <div className="text-xs text-muted-foreground">Rank #{fund.rank}</div>}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-2">
          <Badge variant="outline">{fund.category}</Badge>
          <Badge variant={getRiskBadgeVariant(fund.riskMetrics.risk)}>
            {fund.riskMetrics.risk}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Returns Grid */}
        <div className="grid grid-cols-3 gap-3">
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
          <div className="text-center">
            <div className="text-xs text-muted-foreground">5Y Return</div>
            <div className={`font-semibold ${getReturnColor(fund.returns.fiveYear)}`}>
              {formatReturn(fund.returns.fiveYear)}
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

        {/* AUM */}
        <div className="flex justify-between items-center pt-2 border-t border-border">
          <span className="text-sm text-muted-foreground">AUM</span>
          <span className="font-semibold">₹{(fund.aum / 100).toFixed(0)}K Cr</span>
        </div>
      </CardContent>
    </Card>
  );
}
