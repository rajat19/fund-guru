import { useState } from 'react';
import { mutualFundsData } from '@/data/mutualFunds';
import { getTopFundsByCategory, getRecommendations } from '@/utils/scoringEngine';
import { FundCard } from './FundCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, Award, Target, PieChart } from 'lucide-react';

export function Dashboard() {
  const [riskTolerance, setRiskTolerance] = useState<'Low' | 'Moderate' | 'High'>('Moderate');

  const topEquityFunds = getTopFundsByCategory(mutualFundsData, 'Equity', 3);
  const topDebtFunds = getTopFundsByCategory(mutualFundsData, 'Debt', 3);
  const topHybridFunds = getTopFundsByCategory(mutualFundsData, 'Hybrid', 3);
  const personalizedRecommendations = getRecommendations(mutualFundsData, riskTolerance);

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-secondary/10 border-primary/20">
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold text-foreground">
              Smart Mutual Fund Recommendations
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Discover top-performing mutual funds with our advanced scoring engine. 
              Make informed investment decisions based on comprehensive analysis.
            </p>
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <div className="flex items-center gap-2 text-sm">
                <Award className="h-4 w-4 text-primary" />
                <span>AI-Powered Rankings</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Target className="h-4 w-4 text-secondary" />
                <span>Risk-Adjusted Returns</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <PieChart className="h-4 w-4 text-accent" />
                <span>Portfolio Optimization</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personalized Recommendations */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Personalized Recommendations
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Risk Tolerance:</label>
              <Select value={riskTolerance} onValueChange={(value: 'Low' | 'Moderate' | 'High') => setRiskTolerance(value)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Moderate">Moderate</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {personalizedRecommendations.slice(0, 3).map((fund) => (
              <div key={fund.id} className="relative">
                <FundCard fund={fund} showScore={true} />
                {fund.reason && (
                  <div className="mt-2 text-xs text-muted-foreground p-2 bg-muted/50 rounded">
                    <strong>Why recommended:</strong> {fund.reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top Funds by Category */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Equity Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="w-3 h-3 bg-primary rounded-full"></div>
              Top Equity Funds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topEquityFunds.map((fund, index) => (
              <div key={fund.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center text-sm font-bold text-primary">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{fund.schemeName}</h4>
                    <p className="text-xs text-muted-foreground">{fund.fundHouse}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-profit">+{fund.returns.oneYear.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground">Score: {fund.score}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top Debt Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="w-3 h-3 bg-secondary rounded-full"></div>
              Top Debt Funds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topDebtFunds.map((fund, index) => (
              <div key={fund.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-secondary/10 rounded-full flex items-center justify-center text-sm font-bold text-secondary">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{fund.schemeName}</h4>
                    <p className="text-xs text-muted-foreground">{fund.fundHouse}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-profit">+{fund.returns.oneYear.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground">Score: {fund.score}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top Hybrid Funds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="w-3 h-3 bg-accent rounded-full"></div>
              Top Hybrid Funds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topHybridFunds.map((fund, index) => (
              <div key={fund.id} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center text-sm font-bold text-accent-foreground">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{fund.schemeName}</h4>
                    <p className="text-xs text-muted-foreground">{fund.fundHouse}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-profit">+{fund.returns.oneYear.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground">Score: {fund.score}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Market Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Market Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-primary">8</div>
              <div className="text-sm text-muted-foreground">Total Funds Analyzed</div>
            </div>
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-secondary">16.2%</div>
              <div className="text-sm text-muted-foreground">Avg. 1Y Return</div>
            </div>
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-accent">0.52%</div>
              <div className="text-sm text-muted-foreground">Avg. Expense Ratio</div>
            </div>
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-profit">1.42</div>
              <div className="text-sm text-muted-foreground">Avg. Sharpe Ratio</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}