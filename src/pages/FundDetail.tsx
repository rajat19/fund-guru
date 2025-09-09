import { useParams, useNavigate } from 'react-router-dom';
import { mutualFundsData } from '@/data/mutualFunds';
import { calculateFundScore } from '@/utils/scoringEngine';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, Shield, Target, Activity, DollarSign, BarChart3, PieChart } from 'lucide-react';

export default function FundDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const fund = mutualFundsData.find(f => f.id === id);
  
  if (!fund) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Fund Not Found</h2>
            <p className="text-muted-foreground mb-4">The requested mutual fund could not be found.</p>
            <Button onClick={() => navigate('/')}>Return to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const score = calculateFundScore(fund);
  
  const formatReturn = (value: number) => {
    return value > 0 ? `+${value.toFixed(2)}%` : `${value.toFixed(2)}%`;
  };

  const getReturnColor = (value: number) => {
    if (value > 15) return 'text-profit';
    if (value > 8) return 'text-secondary';
    if (value > 0) return 'text-muted-foreground';
    return 'text-loss';
  };

  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case 'Low': return 'default';
      case 'Moderate': return 'secondary';
      case 'High': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-foreground">{fund.schemeName}</h1>
            <p className="text-lg text-muted-foreground">{fund.fundHouse}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-primary">{score}</div>
            <div className="text-sm text-muted-foreground">AI Score</div>
          </div>
        </div>

        {/* Basic Info */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Fund Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div>
                <div className="text-sm text-muted-foreground">Fund Name</div>
                <div className="font-semibold">{fund.fundName}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Category</div>
                <Badge variant="outline">{fund.category}</Badge>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Sub-category</div>
                <div className="font-semibold">{fund.subCategory}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Risk Level</div>
                <Badge variant={getRiskBadgeVariant(fund.riskLevel)}>{fund.riskLevel}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Returns */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Returns Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries({
                  '1 Month': fund.returns.oneMonth,
                  '3 Months': fund.returns.threeMonth,
                  '6 Months': fund.returns.sixMonth,
                  '1 Year': fund.returns.oneYear,
                  '3 Years': fund.returns.threeYear,
                  '5 Years': fund.returns.fiveYear,
                }).map(([period, value]) => (
                  <div key={period} className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">{period}</span>
                    <span className={`font-semibold ${getReturnColor(value)}`}>
                      {formatReturn(value)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Risk Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Risk Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Sharpe Ratio</span>
                  <span className="font-semibold">{fund.sharpeRatio}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Sortino Ratio</span>
                  <span className="font-semibold">{fund.sortinoRatio}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Alpha</span>
                  <span className="font-semibold">{fund.alpha}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Beta</span>
                  <span className="font-semibold">{fund.beta}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Information Ratio</span>
                  <span className="font-semibold">{fund.informationRatio}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Standard Deviation</span>
                  <span className="font-semibold">{fund.standardDeviation}%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Additional Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Cost & Size
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Expense Ratio</span>
                  <span className="font-semibold">{fund.expenseRatio}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Assets Under Management</span>
                  <span className="font-semibold">₹{(fund.aum / 100).toFixed(0)}K Cr</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Performance Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">AI Score</span>
                  <span className="font-semibold text-primary">{score}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Best Return Period</span>
                  <span className="font-semibold text-profit">
                    {Math.max(fund.returns.oneYear, fund.returns.threeYear, fund.returns.fiveYear) === fund.returns.oneYear ? '1 Year' :
                     Math.max(fund.returns.oneYear, fund.returns.threeYear, fund.returns.fiveYear) === fund.returns.threeYear ? '3 Years' : '5 Years'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}