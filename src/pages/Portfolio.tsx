import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Target, PieChart as PieChartIcon, BarChart3 } from 'lucide-react';

const portfolioData = [
  { name: 'Equity', value: 65, amount: 158750, color: '#3b82f6' },
  { name: 'Debt', value: 25, amount: 61250, color: '#10b981' },
  { name: 'Hybrid', value: 10, amount: 24500, color: '#f59e0b' }
];

const holdings = [
  {
    id: '1',
    fundName: 'Axis Bluechip Fund',
    category: 'Equity',
    investedAmount: 60000,
    currentValue: 72500,
    units: 1450.25,
    allocation: 29.7,
    returns: 20.83,
    dayChange: 2.5
  },
  {
    id: '2',
    fundName: 'Mirae Asset Large Cap Fund',
    category: 'Equity',
    investedAmount: 33000,
    currentValue: 38200,
    units: 876.45,
    allocation: 15.6,
    returns: 15.76,
    dayChange: -1.2
  },
  {
    id: '3',
    fundName: 'SBI Corporate Bond Fund',
    category: 'Debt',
    investedAmount: 45000,
    currentValue: 48600,
    units: 4320.15,
    allocation: 19.9,
    returns: 8.0,
    dayChange: 0.3
  },
  {
    id: '4',
    fundName: 'HDFC Balanced Advantage Fund',
    category: 'Hybrid',
    investedAmount: 24500,
    currentValue: 27800,
    units: 1234.67,
    allocation: 11.4,
    returns: 13.47,
    dayChange: 1.8
  },
  {
    id: '5',
    fundName: 'Parag Parikh Flexi Cap Fund',
    category: 'Equity',
    investedAmount: 25000,
    currentValue: 29400,
    units: 567.89,
    allocation: 12.0,
    returns: 17.6,
    dayChange: 3.1
  }
];

const monthlyData = [
  { month: 'Jan', invested: 15000, value: 15200 },
  { month: 'Feb', invested: 30000, value: 31800 },
  { month: 'Mar', invested: 45000, value: 48200 },
  { month: 'Apr', invested: 60000, value: 65100 },
  { month: 'May', invested: 75000, value: 81500 },
  { month: 'Jun', invested: 90000, value: 98200 },
  { month: 'Jul', invested: 105000, value: 115800 },
  { month: 'Aug', invested: 120000, value: 133400 },
  { month: 'Sep', invested: 135000, value: 151200 },
  { month: 'Oct', invested: 150000, value: 169500 },
  { month: 'Nov', invested: 165000, value: 188300 },
  { month: 'Dec', invested: 180000, value: 216500 }
];

export default function Portfolio() {
  const totalInvested = holdings.reduce((sum, holding) => sum + holding.investedAmount, 0);
  const totalCurrentValue = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const totalReturns = totalCurrentValue - totalInvested;
  const totalReturnPercentage = (totalReturns / totalInvested) * 100;
  const todayChange = holdings.reduce((sum, holding) => sum + (holding.currentValue * holding.dayChange / 100), 0);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Portfolio</h1>
        <p className="text-muted-foreground">Track your investment performance and allocation</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold">₹{totalInvested.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Invested</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold text-profit">₹{totalCurrentValue.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Current Value</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-bold text-profit">+₹{totalReturns.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Returns (+{totalReturnPercentage.toFixed(2)}%)</div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              {todayChange >= 0 ? <TrendingUp className="h-5 w-5 text-profit" /> : <TrendingDown className="h-5 w-5 text-loss" />}
              <div>
                <div className={`text-2xl font-bold ${todayChange >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {todayChange >= 0 ? '+' : ''}₹{todayChange.toFixed(0)}
                </div>
                <div className="text-sm text-muted-foreground">Today's Change</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Asset Allocation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Asset Allocation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={portfolioData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name} ${value}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {portfolioData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2">
              {portfolioData.map((item) => (
                <div key={item.name} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                    <span className="text-sm">{item.name}</span>
                  </div>
                  <span className="font-semibold">₹{item.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Performance Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Investment vs Value Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData.slice(-6)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `₹${Number(value).toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="invested" fill="#94a3b8" name="Invested" />
                  <Bar dataKey="value" fill="#3b82f6" name="Current Value" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Holdings */}
      <Card>
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {holdings.map(holding => (
              <div key={holding.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{holding.fundName}</h3>
                    <Badge variant="outline">{holding.category}</Badge>
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${holding.dayChange >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {holding.dayChange >= 0 ? '+' : ''}{holding.dayChange}%
                    </div>
                    <div className="text-sm text-muted-foreground">Today</div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Invested</div>
                    <div className="font-semibold">₹{holding.investedAmount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Current Value</div>
                    <div className="font-semibold text-profit">₹{holding.currentValue.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Returns</div>
                    <div className="font-semibold text-profit">+{holding.returns.toFixed(2)}%</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Units</div>
                    <div className="font-semibold">{holding.units}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Allocation</div>
                    <div className="font-semibold">{holding.allocation}%</div>
                  </div>
                </div>
                
                <div className="mt-3">
                  <Progress value={holding.allocation} className="h-2" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}