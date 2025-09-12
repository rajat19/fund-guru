import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useMutualFunds } from '@/hooks/useMutualFunds';
import { calculateFundScore } from '@/utils/scoringEngine';
import {
  PiggyBank,
  Plus,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SIP {
  id: string;
  fundId: string;
  fundName: string;
  monthlyAmount: number;
  startDate: string;
  totalInvested: number;
  currentValue: number;
  isActive: boolean;
}

export function SIPTracker() {
  const { toast } = useToast();
  const { data: allFunds = [], isLoading: fundsLoading } = useMutualFunds();
  const [sips, setSips] = useState<SIP[]>([
    {
      id: 'SIP001',
      fundId: 'MF001',
      fundName: 'Axis Bluechip Fund',
      monthlyAmount: 5000,
      startDate: '2023-01-01',
      totalInvested: 60000,
      currentValue: 68500,
      isActive: true,
    },
    {
      id: 'SIP002',
      fundId: 'MF005',
      fundName: 'Mirae Asset Large Cap Fund',
      monthlyAmount: 3000,
      startDate: '2023-06-01',
      totalInvested: 21000,
      currentValue: 24200,
      isActive: true,
    },
  ]);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newSip, setNewSip] = useState({
    fundId: '',
    monthlyAmount: '',
    startDate: '',
  });

  const addSIP = () => {
    if (!newSip.fundId || !newSip.monthlyAmount || !newSip.startDate) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in all required fields.',
        variant: 'destructive',
      });
      return;
    }

    const selectedFund = allFunds.find((fund) => fund.id === newSip.fundId);
    if (!selectedFund) return;

    const monthsInvested = Math.max(
      1,
      Math.floor((Date.now() - new Date(newSip.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30)),
    );

    const totalInvested = parseInt(newSip.monthlyAmount) * monthsInvested;
    const currentValue =
      totalInvested * (1 + (selectedFund.returns.oneYear / 100 / 12) * monthsInvested);

    const newSipEntry: SIP = {
      id: `SIP${Date.now()}`,
      fundId: newSip.fundId,
      fundName: selectedFund.schemeName,
      monthlyAmount: parseInt(newSip.monthlyAmount),
      startDate: newSip.startDate,
      totalInvested,
      currentValue: Math.round(currentValue),
      isActive: true,
    };

    setSips([...sips, newSipEntry]);
    setNewSip({ fundId: '', monthlyAmount: '', startDate: '' });
    setIsAddDialogOpen(false);

    toast({
      title: 'SIP Added Successfully',
      description: `SIP for ${selectedFund.schemeName} has been added to your portfolio.`,
    });
  };

  const toggleSIP = (sipId: string) => {
    setSips(sips.map((sip) => (sip.id === sipId ? { ...sip, isActive: !sip.isActive } : sip)));

    const sip = sips.find((s) => s.id === sipId);
    toast({
      title: sip?.isActive ? 'SIP Paused' : 'SIP Resumed',
      description: `Your SIP for ${sip?.fundName} has been ${sip?.isActive ? 'paused' : 'resumed'}.`,
    });
  };

  const getSIPRecommendations = () => {
    const recommendations = sips
      .map((sip) => {
        const fund = allFunds.find((f) => f.id === sip.fundId);
        if (!fund) return null;

        const score = calculateFundScore(fund);
        const performance = ((sip.currentValue - sip.totalInvested) / sip.totalInvested) * 100;

        let recommendation: 'continue' | 'pause' | 'stop' = 'continue';
        let reason = '';

        if (score < 50) {
          recommendation = 'stop';
          reason = 'Low scoring fund with poor risk-adjusted returns';
        } else if (performance < -5) {
          recommendation = 'pause';
          reason = 'Current performance is significantly negative';
        } else if (score > 70 && performance > 10) {
          recommendation = 'continue';
          reason = 'Excellent performance and high score';
        } else {
          recommendation = 'continue';
          reason = 'Stable performance within acceptable range';
        }

        return {
          ...sip,
          fund,
          score,
          performance,
          recommendation,
          reason,
        };
      })
      .filter(Boolean);

    return recommendations;
  };

  const recommendations = getSIPRecommendations();
  const totalInvested = sips.reduce((sum, sip) => sum + sip.totalInvested, 0);
  const totalCurrentValue = sips.reduce((sum, sip) => sum + sip.currentValue, 0);
  const totalGainLoss = totalCurrentValue - totalInvested;
  const totalGainLossPercentage = (totalGainLoss / totalInvested) * 100;

  return (
    <div className="space-y-6">
      {/* Portfolio Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-primary" />
            SIP Portfolio Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">Total Invested</div>
              <div className="text-2xl font-bold">₹{totalInvested.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-muted-foreground">Current Value</div>
              <div className="text-2xl font-bold">₹{totalCurrentValue.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-sm text-muted-foreground">Gain/Loss</div>
              <div
                className={`text-2xl font-bold ${totalGainLoss >= 0 ? 'text-profit' : 'text-loss'}`}
              >
                {totalGainLoss >= 0 ? '+' : ''}₹{totalGainLoss.toLocaleString()}
              </div>
              <div className={`text-sm ${totalGainLoss >= 0 ? 'text-profit' : 'text-loss'}`}>
                ({totalGainLossPercentage >= 0 ? '+' : ''}
                {totalGainLossPercentage.toFixed(2)}%)
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SIP List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Your SIPs</CardTitle>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add SIP
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New SIP</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="fund">Select Fund</Label>
                  <Select
                    value={newSip.fundId}
                    onValueChange={(value) => setNewSip({ ...newSip, fundId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a mutual fund" />
                    </SelectTrigger>
                    <SelectContent>
                      {fundsLoading ? (
                        <SelectItem value="" disabled>Loading funds...</SelectItem>
                      ) : (
                        allFunds.map((fund) => (
                          <SelectItem key={fund.id} value={fund.id}>
                            {fund.schemeName}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="amount">Monthly Amount (₹)</Label>
                  <Input
                    id="amount"
                    type="number"
                    placeholder="5000"
                    value={newSip.monthlyAmount}
                    onChange={(e) => setNewSip({ ...newSip, monthlyAmount: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={newSip.startDate}
                    onChange={(e) => setNewSip({ ...newSip, startDate: e.target.value })}
                  />
                </div>
                <Button onClick={addSIP} className="w-full">
                  Add SIP
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sips.map((sip) => {
              const gainLoss = sip.currentValue - sip.totalInvested;
              const gainLossPercentage = (gainLoss / sip.totalInvested) * 100;

              return (
                <div key={sip.id} className="border border-border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold">{sip.fundName}</h3>
                      <p className="text-sm text-muted-foreground">₹{sip.monthlyAmount}/month</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={sip.isActive ? 'default' : 'secondary'}>
                        {sip.isActive ? 'Active' : 'Paused'}
                      </Badge>
                      <Button variant="outline" size="sm" onClick={() => toggleSIP(sip.id)}>
                        {sip.isActive ? 'Pause' : 'Resume'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Invested:</span>
                      <div className="font-semibold">₹{sip.totalInvested.toLocaleString()}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Current:</span>
                      <div className="font-semibold">₹{sip.currentValue.toLocaleString()}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Gain/Loss:</span>
                      <div
                        className={`font-semibold ${gainLoss >= 0 ? 'text-profit' : 'text-loss'}`}
                      >
                        {gainLoss >= 0 ? '+' : ''}₹{gainLoss.toLocaleString()}
                        <span className="block text-xs">
                          ({gainLossPercentage >= 0 ? '+' : ''}
                          {gainLossPercentage.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* SIP Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            SIP Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recommendations.map((rec) => (
              <div key={rec.id} className="border border-border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{rec.fundName}</h3>
                  <div className="flex items-center gap-2">
                    {rec.recommendation === 'continue' && (
                      <CheckCircle className="h-5 w-5 text-success" />
                    )}
                    {rec.recommendation === 'pause' && (
                      <AlertTriangle className="h-5 w-5 text-warning" />
                    )}
                    {rec.recommendation === 'stop' && (
                      <TrendingDown className="h-5 w-5 text-destructive" />
                    )}
                    <Badge
                      variant={
                        rec.recommendation === 'continue'
                          ? 'default'
                          : rec.recommendation === 'pause'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {rec.recommendation.toUpperCase()}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{rec.reason}</p>
                <div className="flex gap-4 text-sm">
                  <span>
                    Score: <strong>{rec.score}</strong>
                  </span>
                  <span className={rec.performance >= 0 ? 'text-profit' : 'text-loss'}>
                    Performance:{' '}
                    <strong>
                      {rec.performance >= 0 ? '+' : ''}
                      {rec.performance.toFixed(1)}%
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
