import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, TrendingDown, Download, Calendar, DollarSign, Target, PieChart } from 'lucide-react';

const performanceData = [
  { month: 'Jan', portfolio: 245000, benchmark: 240000, invested: 180000 },
  { month: 'Feb', portfolio: 252000, benchmark: 245000, invested: 195000 },
  { month: 'Mar', portfolio: 238000, benchmark: 235000, invested: 210000 },
  { month: 'Apr', portfolio: 265000, benchmark: 255000, invested: 225000 },
  { month: 'May', portfolio: 278000, benchmark: 268000, invested: 240000 },
  { month: 'Jun', portfolio: 285000, benchmark: 275000, invested: 255000 },
  { month: 'Jul', portfolio: 292000, benchmark: 282000, invested: 270000 },
  { month: 'Aug', portfolio: 305000, benchmark: 290000, invested: 285000 },
  { month: 'Sep', portfolio: 298000, benchmark: 285000, invested: 300000 },
  { month: 'Oct', portfolio: 315000, benchmark: 305000, invested: 315000 },
  { month: 'Nov', portfolio: 328000, benchmark: 315000, invested: 330000 },
  { month: 'Dec', portfolio: 342000, benchmark: 328000, invested: 345000 }
];

const categoryPerformance = [
  { category: 'Large Cap Equity', invested: 120000, current: 145000, returns: 20.83 },
  { category: 'Mid Cap Equity', invested: 45000, current: 52000, returns: 15.56 },
  { category: 'Debt Funds', invested: 80000, current: 86000, returns: 7.50 },
  { category: 'Hybrid Funds', invested: 35000, current: 42000, returns: 20.00 },
  { category: 'International', invested: 25000, current: 28000, returns: 12.00 }
];

const monthlyReturns = [
  { month: 'Jan', returns: 2.5 },
  { month: 'Feb', returns: 1.8 },
  { month: 'Mar', returns: -3.2 },
  { month: 'Apr', returns: 4.8 },
  { month: 'May', returns: 2.1 },
  { month: 'Jun', returns: 1.5 },
  { month: 'Jul', returns: 2.8 },
  { month: 'Aug', returns: 3.2 },
  { month: 'Sep', returns: -1.8 },
  { month: 'Oct', returns: 4.1 },
  { month: 'Nov', returns: 2.9 },
  { month: 'Dec', returns: 3.5 }
];

export default function Reports() {
  const totalInvested = 345000;
  const currentValue = 342000;
  const totalReturns = currentValue - totalInvested;
  const returnPercentage = (totalReturns / totalInvested) * 100;
  const benchmarkValue = 328000;
  const benchmarkReturns = ((benchmarkValue - totalInvested) / totalInvested) * 100;
  const alpha = returnPercentage - benchmarkReturns;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Performance Reports</h1>
          <p className="text-muted-foreground">Detailed analysis of your investment performance</p>
        </div>
        
        <div className="flex gap-2">
          <Select defaultValue="12months">
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3months">Last 3 Months</SelectItem>
              <SelectItem value="6months">Last 6 Months</SelectItem>
              <SelectItem value="12months">Last 12 Months</SelectItem>
              <SelectItem value="3years">Last 3 Years</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">₹{currentValue.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Portfolio Value</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-profit" />
              <div>
                <div className="text-2xl font-bold text-profit">{returnPercentage > 0 ? '+' : ''}{returnPercentage.toFixed(2)}%</div>
                <div className="text-sm text-muted-foreground">Total Returns</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">{benchmarkReturns > 0 ? '+' : ''}{benchmarkReturns.toFixed(2)}%</div>
                <div className="text-sm text-muted-foreground">Benchmark Returns</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className={`text-2xl font-bold ${alpha >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {alpha > 0 ? '+' : ''}{alpha.toFixed(2)}%
                </div>
                <div className="text-sm text-muted-foreground">Alpha</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Portfolio Performance */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Portfolio Performance vs Benchmark</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `₹${Number(value).toLocaleString()}`} />
                  <Legend />
                  <Line type="monotone" dataKey="portfolio" stroke="#3b82f6" strokeWidth={2} name="Portfolio" />
                  <Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={2} name="Benchmark" strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="invested" stroke="#10b981" strokeWidth={2} name="Invested Amount" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Monthly Returns */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyReturns}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `${value}%`} />
                  <Bar dataKey="returns" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Asset Allocation Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Category Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {categoryPerformance.map((category, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold">{category.category}</h4>
                    <Badge variant={category.returns > 15 ? 'default' : category.returns > 8 ? 'secondary' : 'outline'}>
                      +{category.returns.toFixed(2)}%
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Invested</div>
                      <div className="font-semibold">₹{category.invested.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Current</div>
                      <div className="font-semibold text-profit">₹{category.current.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Risk Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Risk Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold">1.45</div>
              <div className="text-sm text-muted-foreground">Sharpe Ratio</div>
              <div className="text-xs text-muted-foreground mt-1">Risk-adjusted returns</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">2.18</div>
              <div className="text-sm text-muted-foreground">Sortino Ratio</div>
              <div className="text-xs text-muted-foreground mt-1">Downside risk measure</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">15.2%</div>
              <div className="text-sm text-muted-foreground">Volatility</div>
              <div className="text-xs text-muted-foreground mt-1">Standard deviation</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">-8.5%</div>
              <div className="text-sm text-muted-foreground">Max Drawdown</div>
              <div className="text-xs text-muted-foreground mt-1">Peak to trough decline</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}