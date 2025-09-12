import { useState, useMemo } from 'react';
import { useMutualFunds, useSyncMutualFunds, MutualFundsFilters } from '@/hooks/useMutualFunds';
import { getTopFundsByCategory, getRecommendations } from '@/utils/scoringEngine';
import { FundCard } from './FundCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, Award, Target, PieChart, RefreshCw, Filter, X } from 'lucide-react';

export function Dashboard() {
  const [riskTolerance, setRiskTolerance] = useState<'Low' | 'Moderate' | 'High'>('Moderate');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<MutualFundsFilters>({});

  const { data: allFunds = [], isLoading, error } = useMutualFunds(filters);
  const syncMutation = useSyncMutualFunds();

  // Calculate dashboard metrics
  const dashboardMetrics = useMemo(() => {
    if (allFunds.length === 0) return null;

    const totalFunds = allFunds.length;
    
    // Calculate averages with null safety
    const fundsWithOneYearReturn = allFunds.filter(fund => fund.returns.oneYear != null);
    const avgOneYearReturn = fundsWithOneYearReturn.length > 0 
      ? fundsWithOneYearReturn.reduce((sum, fund) => sum + (fund.returns.oneYear || 0), 0) / fundsWithOneYearReturn.length
      : 0;
    
    const fundsWithExpenseRatio = allFunds.filter(fund => fund.expenseRatio != null);
    const avgExpenseRatio = fundsWithExpenseRatio.length > 0
      ? fundsWithExpenseRatio.reduce((sum, fund) => sum + (fund.expenseRatio || 0), 0) / fundsWithExpenseRatio.length
      : 0;
    
    const fundsWithSharpeRatio = allFunds.filter(fund => fund.ratios.sharpeRatio != null);
    const avgSharpeRatio = fundsWithSharpeRatio.length > 0
      ? fundsWithSharpeRatio.reduce((sum, fund) => sum + (fund.ratios.sharpeRatio || 0), 0) / fundsWithSharpeRatio.length
      : 0;

    return {
      totalFunds,
      avgOneYearReturn: avgOneYearReturn.toFixed(1),
      avgExpenseRatio: avgExpenseRatio.toFixed(2),
      avgSharpeRatio: avgSharpeRatio.toFixed(2),
    };
  }, [allFunds]);

  const topEquityFunds = getTopFundsByCategory(allFunds, 'Equity', 3);
  const topDebtFunds = getTopFundsByCategory(allFunds, 'Debt', 3);
  const topHybridFunds = getTopFundsByCategory(allFunds, 'Hybrid', 3);
  const personalizedRecommendations = getRecommendations(allFunds, riskTolerance);

  const handleFilterChange = (
    key: keyof MutualFundsFilters,
    value: string | number | undefined,
  ) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const activeFiltersCount = Object.values(filters).filter(Boolean).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading mutual funds data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center space-y-4">
        <p className="text-destructive">Error loading data: {error.message}</p>
        <Button onClick={() => window.location.reload()}>Reload Page</Button>
      </div>
    );
  }

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
              Discover top-performing mutual funds with real-time data from leading platforms. Make
              informed investment decisions based on comprehensive analysis.
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
                <span>Real-Time Data</span>
              </div>
            </div>
            <div className="pt-4">
              <Button
                onClick={() => syncMutation.mutate({ incremental: true })}
                disabled={syncMutation.isPending}
                variant="outline"
                className="mr-2"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`}
                />
                Refresh Data
              </Button>
              <Button
                onClick={() => setShowFilters(!showFilters)}
                variant="outline"
                className="relative"
              >
                <Filter className="h-4 w-4 mr-2" />
                Filters
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="ml-2 h-5 w-5 p-0 text-xs">
                    {activeFiltersCount}
                  </Badge>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Filters */}
      {showFilters && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Advanced Filters
              </CardTitle>
              <Button
                onClick={clearFilters}
                variant="ghost"
                size="sm"
                disabled={activeFiltersCount === 0}
              >
                <X className="h-4 w-4 mr-2" />
                Clear All
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Search</label>
                <Input
                  placeholder="Fund name, house..."
                  value={filters.searchTerm || ''}
                  onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                />
              </div>

              {/* Category */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={filters.category || ''}
                  onValueChange={(value) => handleFilterChange('category', value || undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Categories</SelectItem>
                    <SelectItem value="Equity">Equity</SelectItem>
                    <SelectItem value="Debt">Debt</SelectItem>
                    <SelectItem value="Hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Risk Level */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Risk Level</label>
                <Select
                  value={filters.riskLevel || ''}
                  onValueChange={(value) => handleFilterChange('riskLevel', value || undefined)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Risk Levels" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Risk Levels</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Moderate">Moderate</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Min AUM */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Min AUM (₹ Cr)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={filters.minAUM || ''}
                  onChange={(e) =>
                    handleFilterChange(
                      'minAUM',
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                />
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Min 1Y Return Slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Min 1Y Return (%)</label>
                  <Badge variant="secondary">{filters.minReturn || 0}%</Badge>
                </div>
                <Slider
                  value={[filters.minReturn || 0]}
                  onValueChange={(value) => handleFilterChange('minReturn', value[0])}
                  max={50}
                  step={1}
                  className="w-full"
                />
              </div>

              {/* Max Expense Ratio Slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Max Expense Ratio (%)</label>
                  <Badge variant="secondary">{filters.maxExpenseRatio || 2}%</Badge>
                </div>
                <Slider
                  value={[filters.maxExpenseRatio || 2]}
                  onValueChange={(value) => handleFilterChange('maxExpenseRatio', value[0])}
                  max={2}
                  step={0.1}
                  className="w-full"
                />
              </div>
            </div>

            {/* Applied Filters */}
            {activeFiltersCount > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Applied Filters:</label>
                <div className="flex flex-wrap gap-2">
                  {filters.category && (
                    <Badge variant="outline">Category: {filters.category}</Badge>
                  )}
                  {filters.riskLevel && <Badge variant="outline">Risk: {filters.riskLevel}</Badge>}
                  {filters.minReturn && (
                    <Badge variant="outline">Return ≥ {filters.minReturn}%</Badge>
                  )}
                  {filters.maxExpenseRatio && (
                    <Badge variant="outline">Expense ≤ {filters.maxExpenseRatio}%</Badge>
                  )}
                  {filters.minAUM && <Badge variant="outline">AUM ≥ ₹{filters.minAUM}Cr</Badge>}
                  {filters.searchTerm && (
                    <Badge variant="outline">Search: "{filters.searchTerm}"</Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
              <Select
                value={riskTolerance}
                onValueChange={(value: 'Low' | 'Moderate' | 'High') => setRiskTolerance(value)}
              >
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
                      <span className="text-xs text-profit">
                        +{fund.returns.oneYear.toFixed(1)}%
                      </span>
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
                      <span className="text-xs text-profit">
                        +{fund.returns.oneYear.toFixed(1)}%
                      </span>
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
                      <span className="text-xs text-profit">
                        +{fund.returns.oneYear.toFixed(1)}%
                      </span>
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
              <div className="text-2xl font-bold text-primary">
                {dashboardMetrics?.totalFunds || 0}
              </div>
              <div className="text-sm text-muted-foreground">Total Funds Analyzed</div>
            </div>
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-secondary">
                {dashboardMetrics?.avgOneYearReturn || 0}%
              </div>
              <div className="text-sm text-muted-foreground">Avg. 1Y Return</div>
            </div>
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-accent">
                {dashboardMetrics?.avgExpenseRatio || 0}%
              </div>
              <div className="text-sm text-muted-foreground">Avg. Expense Ratio</div>
            </div>
            <div className="text-center p-4 border border-border rounded-lg">
              <div className="text-2xl font-bold text-profit">
                {dashboardMetrics?.avgSharpeRatio || 0}
              </div>
              <div className="text-sm text-muted-foreground">Avg. Sharpe Ratio</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
