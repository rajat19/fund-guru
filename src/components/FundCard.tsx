import { MutualFund } from '@/types/mutualFund';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, DollarSign, Sparkles, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFundScores } from '@/hooks/useFundScores';
import type { ScoreBreakdown } from '@/utils/scoringEngine';
import { getCategoryColor, getRiskColor } from '@/utils/colors';
import { formatPercent, formatRatio, formatReturn, getReturnColor } from '@/utils/format';
import { describeTrackRecord, trackRecordOf } from '@/utils/trackRecord';

interface FundCardProps {
  fund: MutualFund & { score?: number; rank?: number; breakdown?: ScoreBreakdown };
  onClick?: (fund: MutualFund) => void;
  showScore?: boolean;
}

export function FundCard({ fund, showScore = false }: FundCardProps) {
  const navigate = useNavigate();
  const { breakdownOf } = useFundScores();

  // Prefer a breakdown handed down from a ranked list; only fall back to the
  // shared scoring context when this card is rendered standalone.
  const breakdown = fund.breakdown ?? (showScore || fund.score != null ? breakdownOf(fund) : null);
  const peerScore = fund.score ?? breakdown?.score ?? null;
  const track = breakdown?.trackRecord ?? trackRecordOf(fund);

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
          <Badge variant="outline" className={getRiskColor(fund.riskMetrics.risk ?? '')}>
            Risk: {fund.riskMetrics.risk ?? 'Unrated'}
          </Badge>
          <Badge
            variant="outline"
            className={
              track.isNew
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-muted/30'
            }
          >
            {describeTrackRecord(track)}
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
              <div className="font-semibold">{formatPercent(fund.expenseRatio)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Sharpe Ratio</div>
              <div className="font-semibold">{formatRatio(fund.ratios.sharpeRatio)}</div>
            </div>
          </div>
        </div>

        {/* Peer score: percentile-weighted position within this fund's own sub-category */}
        {peerScore != null && (
          <div className="pt-2 border-t border-border mt-auto space-y-1">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium text-muted-foreground">Peer Score</span>
              </div>
              <span
                className={`text-lg font-bold ${
                  breakdown && !breakdown.hasSufficientData
                    ? 'text-muted-foreground'
                    : 'text-primary'
                }`}
              >
                {peerScore.toFixed(1)}
              </span>
            </div>

            {/*
              Without this, a fund scored on one metric is indistinguishable from
              one scored on eleven — which is exactly how brand-new FoFs ended up
              looking like top picks.
            */}
            {breakdown && !breakdown.hasSufficientData && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  Limited data — {Math.round(breakdown.coverage * 100)}% of metrics available
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
