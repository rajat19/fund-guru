import { useState, useMemo } from 'react';
import {
  useMutualFunds,
  MutualFundsFilters,
  DEFAULT_MIN_TRACK_RECORD_YEARS,
} from '@/hooks/useMutualFunds';
import { TRACK_RECORD_PRESETS } from '@/utils/trackRecord';
import { useFundScores } from '@/hooks/useFundScores';
import { getCategoryColor, getRiskColor } from '@/utils/colors';
import {
  formatCrore,
  formatPercent,
  formatRatio,
  formatReturn,
  getReturnColor,
  maxOf,
  minOf,
  sortValue,
} from '@/utils/format';
import { FundCard } from './FundCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Search,
  SlidersHorizontal,
  BarChart3,
  TrendingUp,
  Shield,
  DollarSign,
  SortAsc,
  SortDesc,
  GitCompare,
} from 'lucide-react';
import { MutualFund } from '@/types/mutualFund';

type SortField = 'peerScore' | 'returns' | 'returns3Y' | 'returns5Y' | 'expenseRatio' | 'sharpeRatio' | 'alpha' | 'sortinoRatio' | 'aum' | 'fundName';
type SortDirection = 'asc' | 'desc';

export function FundExplorer() {
  const [filters, setFilters] = useState<MutualFundsFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [selectedFunds, setSelectedFunds] = useState<string[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const [sortField, setSortField] = useState<SortField>('returns');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [displayLimit, setDisplayLimit] = useState(20);

  const { data: allFunds = [], isLoading, error } = useMutualFunds(filters);
  const { scoreOf } = useFundScores();

  const fundHouses = useMemo(() => Array.from(new Set(allFunds.map(f => f.fundHouse))).filter(Boolean).sort(), [allFunds]);
  const subCategories = useMemo(() => Array.from(new Set(allFunds.map(f => f.subCategory))).filter(Boolean).sort(), [allFunds]);

  // Sort funds based on selected criteria
  const sortedFunds = useMemo(() => [...allFunds]
    .sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortField) {
        case 'peerScore':
          // Precomputed against the full universe, so filtering never moves it.
          aValue = scoreOf(a);
          bValue = scoreOf(b);
          break;
        case 'returns':
          aValue = sortValue(a.returns?.oneYear, sortDirection);
          bValue = sortValue(b.returns?.oneYear, sortDirection);
          break;
        case 'returns3Y':
          aValue = sortValue(a.returns?.threeYear, sortDirection);
          bValue = sortValue(b.returns?.threeYear, sortDirection);
          break;
        case 'returns5Y':
          aValue = sortValue(a.returns?.fiveYear, sortDirection);
          bValue = sortValue(b.returns?.fiveYear, sortDirection);
          break;
        case 'expenseRatio':
          aValue = sortValue(a.expenseRatio, sortDirection);
          bValue = sortValue(b.expenseRatio, sortDirection);
          break;
        case 'sharpeRatio':
          aValue = sortValue(a.ratios?.sharpeRatio, sortDirection);
          bValue = sortValue(b.ratios?.sharpeRatio, sortDirection);
          break;
        case 'alpha':
          aValue = sortValue(a.ratios?.alpha, sortDirection);
          bValue = sortValue(b.ratios?.alpha, sortDirection);
          break;
        case 'sortinoRatio':
          aValue = sortValue(a.ratios?.sortinoRatio, sortDirection);
          bValue = sortValue(b.ratios?.sortinoRatio, sortDirection);
          break;
        case 'aum':
          aValue = sortValue(a.aum, sortDirection);
          bValue = sortValue(b.aum, sortDirection);
          break;
        case 'fundName':
          return sortDirection === 'desc'
            ? b.fundName.localeCompare(a.fundName)
            : a.fundName.localeCompare(b.fundName);
        default:
          aValue = sortValue(a.returns?.oneYear, sortDirection);
          bValue = sortValue(b.returns?.oneYear, sortDirection);
      }

      return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
    })
    .slice(0, displayLimit), [allFunds, sortField, sortDirection, displayLimit, scoreOf]);

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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const activeFiltersCount = Object.values(filters).filter(Boolean).length;

  const handleFundSelection = (fundId: string) => {
    setSelectedFunds((prev) => {
      if (prev.includes(fundId)) {
        return prev.filter((id) => id !== fundId);
      } else if (prev.length < 4) {
        // Limit to 4 funds for comparison
        return [...prev, fundId];
      }
      return prev;
    });
  };

  const selectedFundObjects = sortedFunds.filter((fund) => selectedFunds.includes(fund.id));

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant={sortField === field ? 'default' : 'ghost'}
      size="sm"
      onClick={() => handleSort(field)}
      className="h-8"
    >
      {children}
      {sortField === field &&
        (sortDirection === 'desc' ? (
          <SortDesc className="ml-1 h-3 w-3" />
        ) : (
          <SortAsc className="ml-1 h-3 w-3" />
        ))}
    </Button>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <Search className="h-8 w-8 animate-pulse mx-auto text-primary" />
          <p className="text-muted-foreground">Searching mutual funds...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center space-y-4">
        <p className="text-destructive">Error loading funds: {error.message}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Fund Explorer
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              Top {displayLimit} Results
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search funds by name or fund house..."
                  value={filters.searchTerm || ''}
                  onChange={(e) => handleFilterChange('searchTerm', e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="whitespace-nowrap relative"
            >
              <SlidersHorizontal className="h-4 w-4 mr-2" />
              Filters
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 w-5 p-0 text-xs">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
            {selectedFunds.length > 0 && (
              <Dialog open={showComparison} onOpenChange={setShowComparison}>
                <DialogTrigger asChild>
                  <Button variant="default" className="whitespace-nowrap">
                    <GitCompare className="h-4 w-4 mr-2" />
                    Compare ({selectedFunds.length})
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Fund Comparison</DialogTitle>
                  </DialogHeader>
                  <FundComparison funds={selectedFundObjects} />
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Sort Options */}
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground self-center">Sort by:</span>
            <SortButton field="peerScore">Peer Score</SortButton>
            <SortButton field="returns">1Y Return</SortButton>
            <SortButton field="returns3Y">3Y Return</SortButton>
            <SortButton field="returns5Y">5Y Return</SortButton>
            <SortButton field="expenseRatio">Expense Ratio</SortButton>
            <SortButton field="sharpeRatio">Sharpe</SortButton>
            <SortButton field="alpha">Alpha</SortButton>
            <SortButton field="aum">AUM</SortButton>
            <SortButton field="fundName">Name</SortButton>
          </div>

          {showFilters && (
            <div className="space-y-4 p-4 bg-muted/30 rounded-lg">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category</label>
                  <Select
                    value={filters.category || 'all'}
                    onValueChange={(value) => handleFilterChange('category', value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="Equity">Equity</SelectItem>
                      <SelectItem value="Debt">Debt</SelectItem>
                      <SelectItem value="Hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Sub Category</label>
                  <Select
                    value={filters.subCategory || 'all'}
                    onValueChange={(value) => handleFilterChange('subCategory', value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Sub Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sub Categories</SelectItem>
                      {subCategories.map(sc => (
                        <SelectItem key={sc} value={sc}>{sc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Fund House</label>
                  <Select
                    value={filters.fundHouse || 'all'}
                    onValueChange={(value) => handleFilterChange('fundHouse', value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Fund Houses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Fund Houses</SelectItem>
                      {fundHouses.map(fh => (
                        <SelectItem key={fh} value={fh}>{fh}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Risk Level</label>
                  <Select
                    value={filters.riskLevel || 'all'}
                    onValueChange={(value) => handleFilterChange('riskLevel', value === 'all' ? undefined : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All Risk Levels" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Risk Levels</SelectItem>
                      <SelectItem value="Low">Low Risk</SelectItem>
                      <SelectItem value="Moderate">Moderate Risk</SelectItem>
                      <SelectItem value="Moderately High">Moderately High Risk</SelectItem>
                      <SelectItem value="High">High Risk</SelectItem>
                      <SelectItem value="Very High">Very High Risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Minimum track record</label>
                  <Select
                    value={String(filters.minTrackRecordYears ?? DEFAULT_MIN_TRACK_RECORD_YEARS)}
                    onValueChange={(value) => handleFilterChange('minTrackRecordYears', Number(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRACK_RECORD_PRESETS.map((preset) => (
                        <SelectItem key={preset.years} value={String(preset.years)}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min 1Y Return (%)</label>
                  <Input type="number" placeholder="0" value={filters.minReturn || ''} onChange={(e) => handleFilterChange('minReturn', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min 3Y Return (%)</label>
                  <Input type="number" placeholder="0" value={filters.minReturn3Y || ''} onChange={(e) => handleFilterChange('minReturn3Y', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min 5Y Return (%)</label>
                  <Input type="number" placeholder="0" value={filters.minReturn5Y || ''} onChange={(e) => handleFilterChange('minReturn5Y', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Expense Ratio (%)</label>
                  <Input type="number" step="0.1" placeholder="2.0" value={filters.maxExpenseRatio || ''} onChange={(e) => handleFilterChange('maxExpenseRatio', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min Sharpe Ratio</label>
                  <Input type="number" step="0.1" placeholder="1.0" value={filters.minSharpeRatio || ''} onChange={(e) => handleFilterChange('minSharpeRatio', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min Alpha</label>
                  <Input type="number" step="0.1" placeholder="0" value={filters.minAlpha || ''} onChange={(e) => handleFilterChange('minAlpha', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min AUM (Cr)</label>
                  <Input type="number" placeholder="500" value={filters.minAUM || ''} onChange={(e) => handleFilterChange('minAUM', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Button
                  onClick={clearFilters}
                  variant="ghost"
                  size="sm"
                  disabled={activeFiltersCount === 0}
                >
                  Clear All Filters
                </Button>
                {activeFiltersCount > 0 && (
                  <Badge variant="outline">{sortedFunds.length} funds found</Badge>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Showing top {sortedFunds.length} funds {allFunds.length > displayLimit && `(of ${allFunds.length} total)`}
                  {selectedFunds.length > 0 && (
                    <span className="ml-2">• {selectedFunds.length} selected for comparison</span>
                  )}
                </p>
                {allFunds.length > displayLimit && (
                  <p className="text-xs text-muted-foreground">
                    Sorted by {sortField === 'peerScore' ? 'Peer Score' :
                              sortField === 'returns' ? '1Y Returns' : 
                              sortField === 'returns3Y' ? '3Y Returns' :
                              sortField === 'returns5Y' ? '5Y Returns' :
                              sortField === 'expenseRatio' ? 'Expense Ratio' :
                              sortField === 'sharpeRatio' ? 'Sharpe Ratio' :
                              sortField === 'alpha' ? 'Alpha' :
                              sortField === 'sortinoRatio' ? 'Sortino Ratio' :
                              sortField === 'aum' ? 'AUM' : 'Fund Name'} 
                    ({sortDirection === 'desc' ? 'High to Low' : 'Low to High'})
                  </p>
                )}
              </div>
              {selectedFunds.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setSelectedFunds([])}>
                  Clear Selection
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedFunds.map((fund) => (
                <div key={fund.id} className="relative">
                  <div className="absolute top-2 right-2 z-10">
                    <Checkbox
                      checked={selectedFunds.includes(fund.id)}
                      onCheckedChange={() => handleFundSelection(fund.id)}
                      disabled={!selectedFunds.includes(fund.id) && selectedFunds.length >= 4}
                      className="bg-white/90 backdrop-blur-sm"
                    />
                  </div>
                  <FundCard fund={fund} showScore={true} />
                </div>
              ))}
            </div>

            {/* Load More Button */}
            {allFunds.length > displayLimit && (
              <div className="flex justify-center pt-6">
                <Button 
                  variant="outline" 
                  onClick={() => setDisplayLimit(prev => Math.min(prev + 20, allFunds.length))}
                  disabled={displayLimit >= allFunds.length}
                >
                  Load More ({Math.min(20, allFunds.length - displayLimit)} more)
                </Button>
              </div>
            )}

            {sortedFunds.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  No mutual funds match your current search criteria.
                </p>
                <Button variant="outline" onClick={clearFilters} className="mt-4">
                  Clear Filters
                </Button>
              </div>
            )}
          </div>

          {selectedFunds.length > 1 && (
            <div className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Quick Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Selected:</span>
                      <p className="text-muted-foreground">{selectedFunds.length} funds</p>
                    </div>
                    <div>
                      <span className="font-medium">Best 1Y Return:</span>
                      <p className="text-green-600 font-medium">
                        {formatReturn(maxOf(selectedFundObjects.map((f) => f.returns.oneYear)), 1)}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium">Lowest Expense:</span>
                      <p className="text-blue-600 font-medium">
                        {formatPercent(minOf(selectedFundObjects.map((f) => f.expenseRatio)))}
                      </p>
                    </div>
                    <div>
                      <span className="font-medium">Highest Sharpe:</span>
                      <p className="text-purple-600 font-medium">
                        {formatRatio(maxOf(selectedFundObjects.map((f) => f.ratios.sharpeRatio)))}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Fund comparison component for detailed analysis
interface Leader {
  label: string;
  className: string;
  display: string;
  fundName: string;
}

/**
 * "Best on each metric" tiles for the comparison view. Every metric here is
 * optional in the feed, so a tile can legitimately have no winner at all.
 */
function leadersFor(funds: MutualFund[]): Leader[] {
  const specs = [
    {
      label: 'Highest 1Y Return',
      className: 'text-green-600',
      pick: (f: MutualFund) => f.returns.oneYear,
      best: maxOf,
      display: (v: number) => formatReturn(v, 1),
    },
    {
      label: 'Lowest Expense',
      className: 'text-blue-600',
      pick: (f: MutualFund) => f.expenseRatio,
      best: minOf,
      display: (v: number) => formatPercent(v),
    },
    {
      label: 'Best Sharpe Ratio',
      className: 'text-purple-600',
      pick: (f: MutualFund) => f.ratios.sharpeRatio,
      best: maxOf,
      display: (v: number) => formatRatio(v),
    },
    {
      label: 'Largest AUM',
      className: 'text-indigo-600',
      pick: (f: MutualFund) => f.aum,
      best: maxOf,
      display: (v: number) => formatCrore(v),
    },
  ];

  return specs.map(({ label, className, pick, best, display }) => {
    const winning = best(funds.map(pick));
    const winner = winning == null ? undefined : funds.find((f) => pick(f) === winning);

    return {
      label,
      className,
      display: winning == null ? 'N/A' : display(winning),
      fundName: winner ? winner.schemeName.split(' ').slice(0, 2).join(' ') : '—',
    };
  });
}

function FundComparison({ funds }: { funds: MutualFund[] }) {
  if (funds.length === 0) {
    return <div className="text-center py-8">No funds selected for comparison.</div>;
  }

  const metrics = [
    { key: 'oneYear', label: '1 Year Return', suffix: '%', color: 'text-green-600' },
    { key: 'threeYear', label: '3 Year Return', suffix: '%', color: 'text-green-600' },
    { key: 'fiveYear', label: '5 Year Return', suffix: '%', color: 'text-green-600' },
    {
      key: 'expenseRatio',
      label: 'Expense Ratio',
      suffix: '%',
      color: 'text-blue-600',
      lower: true,
    },
    { key: 'sharpeRatio', label: 'Sharpe Ratio', suffix: '', color: 'text-purple-600' },
    { key: 'sortinoRatio', label: 'Sortino Ratio', suffix: '', color: 'text-purple-600' },
    { key: 'alpha', label: 'Alpha', suffix: '', color: 'text-orange-600' },
    { key: 'beta', label: 'Beta', suffix: '', color: 'text-gray-600' },
    { key: 'aum', label: 'AUM (₹ Cr)', suffix: '', color: 'text-indigo-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3 font-semibold">Fund Details</th>
              {funds.map((fund) => (
                <th key={fund.id} className="text-left p-3 font-medium text-sm">
                  <div className="space-y-1">
                    <div className="font-semibold text-foreground">{fund.schemeName}</div>
                    <div className="text-xs text-muted-foreground">{fund.fundHouse}</div>
                    <Badge variant="outline" className={`text-xs ${getCategoryColor(fund.category)}`}>
                      {fund.category}
                    </Badge>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b hover:bg-muted/50">
              <td className="p-3 font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                Risk Level
              </td>
              {funds.map((fund) => (
                <td key={fund.id} className="p-3">
                  <Badge
                    variant="outline"
                    className={getRiskColor(fund.riskMetrics.risk ?? '')}
                  >
                    Risk: {fund.riskMetrics.risk ?? 'Unrated'}
                  </Badge>
                </td>
              ))}
            </tr>
            <tr className="border-b hover:bg-muted/50">
              <td className="p-3 font-medium">Sub Category</td>
              {funds.map((fund) => (
                <td key={fund.id} className="p-3 text-sm">
                  {fund.subCategory}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <Separator />

      {/* Performance Metrics */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Performance Comparison
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 font-semibold">Metrics</th>
                {funds.map((fund) => (
                  <th key={fund.id} className="text-center p-3 font-medium text-sm">
                    {fund.schemeName.split(' ').slice(0, 2).join(' ')}
                  </th>
                ))}
                <th className="text-center p-3 font-medium text-sm">Best</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const values = funds.map((fund) => {
                  if (metric.key === 'aum') return fund.aum;
                  if (metric.key === 'expenseRatio') return fund.expenseRatio;
                  if (metric.key in fund.returns) {
                    return fund.returns[metric.key as keyof typeof fund.returns];
                  }
                  if (metric.key in fund.ratios) {
                    return fund.ratios[metric.key as keyof typeof fund.ratios];
                  }
                  return null;
                });

                const numericValues = values.filter((v): v is number => v !== null);
                const bestValue =
                  numericValues.length > 0
                    ? metric.lower
                      ? Math.min(...numericValues)
                      : Math.max(...numericValues)
                    : null;

                return (
                  <tr key={metric.key} className="border-b hover:bg-muted/50">
                    <td className="p-3 font-medium">{metric.label}</td>
                    {funds.map((fund, index) => {
                      const value = values[index];
                      const isNumerical = typeof value === 'number';
                      const displayValue = isNumerical
                        ? metric.key === 'aum'
                          ? value.toLocaleString()
                          : value.toFixed(2)
                        : 'N/A';

                      const isBest = isNumerical && value === bestValue;

                      return (
                        <td
                          key={fund.id}
                          className={`p-3 text-center ${isBest ? 'font-bold ' + metric.color : 'text-muted-foreground'}`}
                        >
                          {displayValue}
                          {metric.suffix}
                          {isBest && <span className="ml-1">🏆</span>}
                        </td>
                      );
                    })}
                    <td className={`p-3 text-center font-bold ${metric.color}`}>
                      {typeof bestValue === 'number'
                        ? (metric.key === 'aum'
                            ? bestValue.toLocaleString()
                            : bestValue.toFixed(2)) + metric.suffix
                        : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Separator />

      {/* Key Highlights */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Key Highlights
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {leadersFor(funds).map((leader) => (
            <Card key={leader.label}>
              <CardContent className="p-4">
                <div className="text-center">
                  <div className={`text-2xl font-bold ${leader.className}`}>{leader.display}</div>
                  <div className="text-sm text-muted-foreground">{leader.label}</div>
                  <div className="text-xs mt-1">{leader.fundName}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
