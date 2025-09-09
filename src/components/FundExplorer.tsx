import { useState } from 'react';
import { MutualFund, mutualFundsData } from '@/data/mutualFunds';
import { rankFunds } from '@/utils/scoringEngine';
import { FundCard } from './FundCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, BarChart3, SortAsc, SortDesc } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type SortField = 'score' | 'oneYear' | 'threeYear' | 'fiveYear' | 'expenseRatio' | 'sharpeRatio' | 'aum';
type SortDirection = 'asc' | 'desc';

export function FundExplorer() {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const rankedFunds = rankFunds(mutualFundsData);

  const filteredAndSortedFunds = rankedFunds
    .filter(fund => {
      const matchesSearch = fund.schemeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           fund.fundHouse.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || fund.category === categoryFilter;
      const matchesRisk = riskFilter === 'all' || fund.riskLevel === riskFilter;
      
      return matchesSearch && matchesCategory && matchesRisk;
    })
    .sort((a, b) => {
      let aValue: number;
      let bValue: number;

      switch (sortField) {
        case 'score':
          aValue = a.score;
          bValue = b.score;
          break;
        case 'oneYear':
          aValue = a.returns.oneYear;
          bValue = b.returns.oneYear;
          break;
        case 'threeYear':
          aValue = a.returns.threeYear;
          bValue = b.returns.threeYear;
          break;
        case 'fiveYear':
          aValue = a.returns.fiveYear;
          bValue = b.returns.fiveYear;
          break;
        case 'expenseRatio':
          aValue = a.expenseRatio;
          bValue = b.expenseRatio;
          break;
        case 'sharpeRatio':
          aValue = a.sharpeRatio;
          bValue = b.sharpeRatio;
          break;
        case 'aum':
          aValue = a.aum;
          bValue = b.aum;
          break;
        default:
          aValue = a.score;
          bValue = b.score;
      }

      return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
    });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant={sortField === field ? "default" : "ghost"}
      size="sm"
      onClick={() => handleSort(field)}
      className="h-8"
    >
      {children}
      {sortField === field && (
        sortDirection === 'desc' ? <SortDesc className="ml-1 h-3 w-3" /> : <SortAsc className="ml-1 h-3 w-3" />
      )}
    </Button>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Fund Explorer
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search funds or fund houses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="Equity">Equity</SelectItem>
                <SelectItem value="Debt">Debt</SelectItem>
                <SelectItem value="Hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>

            <Select value={riskFilter} onValueChange={setRiskFilter}>
              <SelectTrigger className="w-full sm:w-32">
                <SelectValue placeholder="Risk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Risk</SelectItem>
                <SelectItem value="Low">Low</SelectItem>
                <SelectItem value="Moderate">Moderate</SelectItem>
                <SelectItem value="High">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort Options */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-sm text-muted-foreground self-center">Sort by:</span>
            <SortButton field="score">Score</SortButton>
            <SortButton field="oneYear">1Y Return</SortButton>
            <SortButton field="threeYear">3Y Return</SortButton>
            <SortButton field="fiveYear">5Y Return</SortButton>
            <SortButton field="expenseRatio">Expense</SortButton>
            <SortButton field="sharpeRatio">Sharpe</SortButton>
            <SortButton field="aum">AUM</SortButton>
          </div>

          {/* Results Count */}
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="secondary">
              {filteredAndSortedFunds.length} fund{filteredAndSortedFunds.length !== 1 ? 's' : ''} found
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Fund Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAndSortedFunds.map((fund) => (
          <FundCard key={fund.id} fund={fund} showScore={true} />
        ))}
      </div>

      {filteredAndSortedFunds.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <Filter className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No funds found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search criteria or filters to find more funds.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}